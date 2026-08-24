import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, lte, lt, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { breaks, cafeteriaOrders, crewMembers, outboxEvents, profileAssignments, profileSessions, roles, shiftTemplates, shifts, users } from '../../database/schema/index.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { buildScheduledRange, businessDateInBogota, weekdayForBusinessDate } from './shift-schedule.js';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService, private readonly redis: RedisService, private readonly realtime: RealtimeService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.runExclusive('sessions:reap', 55, () => this.reapSessions()), 60_000));
    this.timers.push(setInterval(() => void this.runExclusive('cafeteria:expire-orders', 55, () => this.expireOrders()), 60_000));
    this.timers.push(setInterval(() => void this.runExclusive('shifts:materialize', 55, async () => { await this.materializeShifts(); }), 60_000));
    this.timers.push(setInterval(() => void this.runExclusive('shifts:open-close', 55, () => this.closeExpiredShifts()), 60_000));
    this.timers.push(setInterval(() => void this.runExclusive('breaks:notify', 55, () => this.notifyUpcomingBreaks()), 60_000));
  }

  async onModuleDestroy(): Promise<void> { for (const timer of this.timers) clearInterval(timer); }

  private async runExclusive(name: string, ttl: number, work: () => Promise<void>): Promise<void> {
    const token = await this.redis.acquireLock(`agency:job:${name}`, ttl).catch(() => null);
    if (!token) return;
    try { await work(); } finally { await this.redis.releaseLock(`agency:job:${name}`, token).catch(() => undefined); }
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
      .set({ status: 'CLOSED', endedAt: now, endReason: 'ASSIGNMENT_ENDED' })
      .where(and(or(eq(profileSessions.status, 'LAUNCHING'), eq(profileSessions.status, 'ACTIVE'), eq(profileSessions.status, 'ERROR')), assignmentEnded))
      .returning({ operatorId: profileSessions.operatorId });

    // LAUNCHING has its own deadline. Otherwise a failed extension handshake
    // occupies the partial unique index forever and blocks the next operator.
    const launchClosed = await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', endedAt: now, endReason: 'LAUNCH_TIMEOUT' })
      .where(and(eq(profileSessions.status, 'LAUNCHING'), lt(profileSessions.startedAt, new Date(now.getTime() - 120_000))))
      .returning({ operatorId: profileSessions.operatorId });

    const heartbeatClosed = await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', endedAt: now, endReason: 'HEARTBEAT_TIMEOUT' })
      .where(and(eq(profileSessions.status, 'ACTIVE'), lt(profileSessions.lastHeartbeatAt, new Date(now.getTime() - 120_000))))
      .returning({ operatorId: profileSessions.operatorId });
    const changed = new Set([...assignmentClosed, ...launchClosed, ...heartbeatClosed].map((row) => row.operatorId));
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

  private async closeExpiredShifts(at = new Date()): Promise<void> {
    const endedAt = at;
    const atIso = at.toISOString();
    const operatorIds = await this.db.transaction(async () => {
      const atSql = sql`${atIso}::timestamptz`;
      const missed = await this.db.db.update(shifts).set({ status: 'MISSED' }).where(and(eq(shifts.status, 'SCHEDULED'), isNotNull(shifts.scheduledRange), sql`upper(${shifts.scheduledRange}) <= ${atSql}`)).returning({ id: shifts.id, operatorId: shifts.operatorId });
      const completed = await this.db.db.update(shifts).set({ status: 'COMPLETED', actualEndAt: endedAt, effectiveMinutes: sql`greatest(0, extract(epoch from (${atSql} - coalesce(${shifts.actualStartAt}, ${atSql}))) / 60)::int` }).where(and(eq(shifts.status, 'IN_PROGRESS'), isNotNull(shifts.scheduledRange), sql`upper(${shifts.scheduledRange}) <= ${atSql}`)).returning({ id: shifts.id, operatorId: shifts.operatorId });
      const ids = [...missed, ...completed].map((row) => row.id);
      if (!ids.length) return [];
      await this.db.db.update(breaks).set({ status: 'COMPLETED', endedAt, durationMinutes: sql`greatest(0, round(extract(epoch from (${endedAt.toISOString()}::timestamptz - ${breaks.startedAt})) / 60))::int` }).where(and(inArray(breaks.shiftId, ids), eq(breaks.status, 'IN_PROGRESS')));
      await this.db.db.update(breaks).set({ status: 'CANCELLED', endedAt }).where(and(inArray(breaks.shiftId, ids), eq(breaks.status, 'PENDING')));
      return [...new Set([...missed, ...completed].map((row) => row.operatorId))];
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
