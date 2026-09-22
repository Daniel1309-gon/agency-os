import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, lte, lt, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { breaks, cafeteriaOrders, crewMembers, outboxEvents, profileAssignments, profileSessions, roles, shiftTemplates, shifts, users } from '../../database/schema/index.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { buildScheduledRange, businessDateInBogota, shiftBusinessDate, weekdayForBusinessDate } from './shift-schedule.js';
import { EFFECTIVE_TIME_REPOSITORY, type EffectiveTimeRepository } from '../shifts/effective-time.port.js';
import { DurableJobService } from './durable-job.service.js';

interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
}

interface ClaimedRun {
  id: number;
  jobName: string;
  attempts: number;
  leaseToken: string | null;
}

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private static readonly MATERIALIZATION_LOOKBACK_DAYS = 1;
  private static readonly MAX_ATTEMPTS = 5;
  private readonly timers: NodeJS.Timeout[] = [];
  private ticking = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
    @Inject(EFFECTIVE_TIME_REPOSITORY) private readonly effectiveTimeRepository: EffectiveTimeRepository,
    @Optional() private readonly durable?: DurableJobService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // En produccion el scheduler corre solo en el worker dedicado; las APIs
    // llevan JOBS_ENABLED=false para no duplicar materializacion ni cierres.
    if (process.env.JOBS_ENABLED === 'false') return;
    this.timers.push(setInterval(() => void this.schedulerTick(), 60_000));
    void this.schedulerTick();
  }

  async onModuleDestroy(): Promise<void> { for (const timer of this.timers) clearInterval(timer); }

  private get schedule(): ScheduledJob[] {
    return [
      { name: 'sessions:reap', intervalMs: 60_000, run: () => this.reapSessions() },
      { name: 'cafeteria:expire-orders', intervalMs: 60_000, run: () => this.expireOrders() },
      { name: 'shifts:materialize', intervalMs: 60_000, run: () => this.materializeShiftBacklog() },
      { name: 'shifts:open-close', intervalMs: 60_000, run: () => this.closeExpiredShifts() },
      { name: 'breaks:notify', intervalMs: 60_000, run: () => this.notifyUpcomingBreaks() },
      { name: 'audit:partitions', intervalMs: 3_600_000, run: () => this.maintainAuditPartitions() },
    ];
  }

  /**
   * El scheduler es durable: cada intervalo encola su `runKey` en `job_runs` y
   * lo reclama con lease (SKIP LOCKED). Un worker que muere a mitad deja la
   * ejecucion en PROCESSING y el siguiente la recupera al vencer el lease; el
   * claim es la exclusion mutua, no hace falta lock en Redis.
   */
  private async schedulerTick(): Promise<void> {
    if (this.ticking || !this.durable) return;
    this.ticking = true;
    try {
      const now = Date.now();
      for (const job of this.schedule) {
        const scheduledFor = new Date(Math.floor(now / job.intervalMs) * job.intervalMs);
        await this.durable.enqueue(job.name, String(scheduledFor.getTime()), scheduledFor).catch(() => undefined);
      }
      const claimed = await this.durable.claim().catch(() => [] as ClaimedRun[]);
      for (const run of claimed) await this.executeRun(run);
    } finally {
      this.ticking = false;
    }
  }

  private async executeRun(run: ClaimedRun): Promise<void> {
    const leaseToken = run.leaseToken ?? '';
    const job = this.schedule.find((candidate) => candidate.name === run.jobName);
    if (!job) {
      await this.durable?.complete(run.id, leaseToken).catch(() => undefined);
      return;
    }
    const keepAlive = setInterval(() => void this.durable?.renew(run.id, leaseToken).catch(() => undefined), 20_000);
    try {
      await job.run();
      await this.durable?.complete(run.id, leaseToken).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.durable?.fail(run.id, leaseToken, message, run.attempts, run.attempts >= JobsService.MAX_ATTEMPTS).catch(() => undefined);
    } finally {
      clearInterval(keepAlive);
    }
  }

  /**
   * Crea las particiones de audit_log por adelantado y aplica la retención configurada.
   * `audit.retention_months = 0` conserva todo, que es lo que corresponde mientras OQ-08
   * siga abierta: nadie ha fijado todavía cuántos meses de auditoría hay que guardar.
   */
  private async maintainAuditPartitions(): Promise<void> {
    await this.db.db.execute(sql`
      SELECT audit_log_maintain(2, COALESCE((
        SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN greatest((value #>> '{}')::int, 0) END
        FROM app_settings
        WHERE key = 'audit.retention_months'
      ), 0))
    `);
  }

  private async reapSessions(): Promise<void> {
    const now = new Date();
    const assignmentEnded = sql`NOT EXISTS (
      SELECT 1
      FROM ${profileAssignments} AS assignment
      WHERE assignment.id = ${profileSessions.assignmentId}
        AND assignment.status = 'ACTIVE'
        AND assignment.valid_range @> now()
    )`;

    // The assignment boundary is authoritative: a stale heartbeat must not
    // keep a profile alive after the handoff, and a heartbeat arriving after
    // the boundary must never revive it.
    const assignmentClosed = await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', version: sql<number>`${profileSessions.version} + 1`, endedAt: now, endReason: 'ASSIGNMENT_ENDED' })
      .where(and(or(eq(profileSessions.status, 'LAUNCHING'), eq(profileSessions.status, 'ACTIVE'), eq(profileSessions.status, 'ERROR')), assignmentEnded))
      .returning({ operatorId: profileSessions.operatorId });

    // LAUNCHING has its own deadline. Otherwise a failed extension handshake
    // occupies the partial unique index forever and blocks the next operator.
    const launchClosed = await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', version: sql<number>`${profileSessions.version} + 1`, endedAt: now, endReason: 'LAUNCH_TIMEOUT' })
      .where(and(eq(profileSessions.status, 'LAUNCHING'), lt(profileSessions.startedAt, new Date(now.getTime() - 120_000))))
      .returning({ operatorId: profileSessions.operatorId });

    const heartbeatStale = await this.db.db
      .update(profileSessions)
      .set({ status: 'STALE', version: sql<number>`${profileSessions.version} + 1`, endedAt: now, endReason: 'HEARTBEAT_TIMEOUT' })
      .where(and(eq(profileSessions.status, 'ACTIVE'), lt(profileSessions.lastHeartbeatAt, new Date(now.getTime() - 120_000))))
      .returning({ operatorId: profileSessions.operatorId });
    const changed = new Set([...assignmentClosed, ...launchClosed, ...heartbeatStale].map((row) => row.operatorId));
    await Promise.all([...changed].map((operatorId) => this.realtime.publishOperatorChanged(operatorId)));
  }

  private async expireOrders(): Promise<void> {
    await this.db.db.update(cafeteriaOrders).set({ status: 'EXPIRED' }).where(and(eq(cafeteriaOrders.status, 'READY'), isNotNull(cafeteriaOrders.pickupDeadlineAt), lt(cafeteriaOrders.pickupDeadlineAt, new Date())));
  }

  private async materializeShifts(businessDate = businessDateInBogota(new Date())): Promise<number> {
    const weekday = weekdayForBusinessDate(businessDate);
    return this.db.transaction(async () => {
      const templates = await this.db.db
        .select({ id: shiftTemplates.id, crewId: shiftTemplates.crewId, startTime: shiftTemplates.startTime, endTime: shiftTemplates.endTime, crossesMidnight: shiftTemplates.crossesMidnight, weekdays: shiftTemplates.weekdays })
        .from(shiftTemplates)
        .where(and(eq(shiftTemplates.isActive, true), lte(shiftTemplates.validFrom, businessDate), or(isNull(shiftTemplates.validTo), gte(shiftTemplates.validTo, businessDate))));
      const applicable = templates.filter((template) => template.weekdays.includes(weekday));
      if (!applicable.length) return 0;

      const globalOperators = await this.db.db
        .select({ operatorId: users.id })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.status, 'ACTIVE'), eq(roles.code, 'OPERADOR')));
      const candidates: Array<{ operatorId: string; templateId: string; businessDate: string; scheduledRange: string; status: 'SCHEDULED' }> = [];

      for (const template of applicable) {
        const scheduledRange = buildScheduledRange(businessDate, template.startTime, template.endTime, template.crossesMidnight);
        const startAt = scheduledRange.slice(1, scheduledRange.indexOf(','));
        const operators = template.crewId
          ? await this.db.db
            .select({ operatorId: crewMembers.userId })
            .from(crewMembers)
            .innerJoin(users, eq(users.id, crewMembers.userId))
            .innerJoin(roles, eq(roles.id, users.roleId))
            .where(and(eq(crewMembers.crewId, template.crewId), eq(users.status, 'ACTIVE'), eq(roles.code, 'OPERADOR'), sql`${crewMembers.validRange} @> ${startAt}::timestamptz`))
          : globalOperators;
        candidates.push(...operators.map((operator) => ({ operatorId: operator.operatorId, templateId: template.id, businessDate, scheduledRange, status: 'SCHEDULED' as const })));
      }
      if (!candidates.length) return 0;
      const inserted = await this.db.db.insert(shifts).values(candidates).onConflictDoNothing().returning({ id: shifts.id });
      return inserted.length;
    });
  }

  /** Reconcile today and the immediately previous business date after a short outage. */
  private async materializeShiftBacklog(at = new Date()): Promise<number> {
    const today = businessDateInBogota(at);
    let inserted = 0;
    for (let offset = -JobsService.MATERIALIZATION_LOOKBACK_DAYS; offset <= 0; offset += 1) {
      inserted += await this.materializeShifts(shiftBusinessDate(today, offset));
    }
    return inserted;
  }

  private async closeExpiredShifts(at = new Date()): Promise<void> {
    const atIso = at.toISOString();
    const operatorIds = await this.db.transaction(async () => {
      const atSql = sql`${atIso}::timestamptz`;
      // La tabla de turnos es la cola durable del cierre. El lock dura toda la
      // liquidación, incluso si vence el lock Redis de quien despertó el job.
      const due = await this.db.db.select({ id: shifts.id, operatorId: shifts.operatorId })
        .from(shifts)
        .where(and(inArray(shifts.status, ['SCHEDULED', 'IN_PROGRESS']), isNotNull(shifts.scheduledRange), sql`upper(${shifts.scheduledRange}) <= ${atSql}`))
        .orderBy(sql`upper(${shifts.scheduledRange})`, shifts.id).limit(100)
        .for('update', { skipLocked: true });
      const ids = due.map((row) => row.id);
      if (!ids.length) return [];
      await this.db.db.update(shifts).set({ status: 'MISSED' }).where(and(inArray(shifts.id, ids), eq(shifts.status, 'SCHEDULED')));
      const completed = await this.db.db.update(shifts).set({ status: 'COMPLETED', actualEndAt: sql`upper(${shifts.scheduledRange})` })
        .where(and(inArray(shifts.id, ids), eq(shifts.status, 'IN_PROGRESS')))
        .returning({ id: shifts.id, endedAt: shifts.actualEndAt });
      const endedAt = sql`(select upper(${shifts.scheduledRange}) from ${shifts} where ${shifts.id} = ${breaks.shiftId})`;
      await this.db.db.update(breaks).set({ status: 'COMPLETED', endedAt, durationMinutes: sql`greatest(0, round(extract(epoch from (${endedAt} - ${breaks.startedAt})) / 60))::int` }).where(and(inArray(breaks.shiftId, ids), eq(breaks.status, 'IN_PROGRESS')));
      await this.db.db.update(breaks).set({ status: 'CANCELLED', endedAt }).where(and(inArray(breaks.shiftId, ids), eq(breaks.status, 'PENDING')));
      // Agrupar por borde conserva el procesamiento por lotes de OPS-07.
      const byBoundary = new Map<string, string[]>();
      for (const row of completed) {
        const boundary = row.endedAt!.toISOString();
        byBoundary.set(boundary, [...(byBoundary.get(boundary) ?? []), row.id]);
      }
      for (const [boundary, shiftIds] of byBoundary) await this.effectiveTimeRepository.settle(shiftIds, new Date(boundary));
      return [...new Set(due.map((row) => row.operatorId))];
    });
    await Promise.all(operatorIds.map((operatorId) => this.realtime.publishOperatorChanged(operatorId)));
  }

  private async notifyUpcomingBreaks(): Promise<void> {
    await this.db.transaction(async () => {
      const candidates = await this.db.db
        .select({ id: breaks.id, shiftId: breaks.shiftId, scheduledAt: breaks.scheduledAt, operatorId: shifts.operatorId })
        .from(breaks)
        .innerJoin(shifts, eq(shifts.id, breaks.shiftId))
        .where(and(
          eq(breaks.status, 'PENDING'),
          isNull(breaks.notifiedAt),
          isNotNull(breaks.scheduledAt),
          lte(breaks.scheduledAt, new Date(Date.now() + 10 * 60_000)),
          or(eq(shifts.status, 'SCHEDULED'), eq(shifts.status, 'IN_PROGRESS')),
        ))
        .limit(250);
      for (const candidate of candidates) {
        const [claimed] = await this.db.db.update(breaks).set({ notifiedAt: new Date() }).where(and(eq(breaks.id, candidate.id), isNull(breaks.notifiedAt))).returning({ id: breaks.id });
        if (!claimed) continue;
        await this.db.db.insert(outboxEvents).values({
          eventType: 'break.reminder',
          aggregateType: 'break',
          aggregateId: candidate.id,
          payload: { breakId: candidate.id, shiftId: candidate.shiftId, operatorId: candidate.operatorId, scheduledAt: candidate.scheduledAt?.toISOString() },
        });
      }
    });
  }
}
