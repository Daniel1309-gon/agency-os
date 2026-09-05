import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, isPgError } from '../../database/pg-error.js';
import { breaks, crewMembers, crews, roles, shiftOverrides, shiftTemplates, shifts, users } from '../../database/schema/index.js';
import type { ShiftCreateInput, ShiftOverrideInput, ShiftTemplateInput } from './shifts.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

function scheduledRange(from: string, to: string) {
  if (new Date(from).getTime() >= new Date(to).getTime()) throw new ConflictException('Shift end must be after start');
  return `[${from},${to})`;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(input: ShiftCreateInput, actorId: string) {
    await this.assertActorCanManageOperator(actorId, input.operatorId);
    const rangeValue = scheduledRange(input.scheduledFrom, input.scheduledTo);
    const start = new Date(input.scheduledFrom).getTime();
    const end = new Date(input.scheduledTo).getTime();
    const scheduledBreaks = input.breaks ?? [];
    if (scheduledBreaks.some((item) => {
      const scheduledAt = new Date(item.scheduledAt).getTime();
      return scheduledAt < start || scheduledAt >= end;
    })) throw new ConflictException('Every break must be scheduled inside the shift window');
    try {
      return await this.db.transaction(async () => {
        const [row] = await this.db.db.insert(shifts).values({ operatorId: input.operatorId, templateId: input.templateId, businessDate: input.businessDate, scheduledRange: rangeValue, notes: input.notes, createdBy: actorId }).returning({ id: shifts.id, operatorId: shifts.operatorId, businessDate: shifts.businessDate, scheduledRange: shifts.scheduledRange, status: shifts.status });
        if (scheduledBreaks.length) {
          await this.db.db.insert(breaks).values(scheduledBreaks.map((item) => ({ shiftId: row.id, type: item.type, scheduledAt: new Date(item.scheduledAt), status: 'PENDING' })));
        }
        await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'shift.created', entityType: 'shift', entityId: row.id, result: 'SUCCESS', metadata: { shiftId: row.id, operatorId: row.operatorId, businessDate: row.businessDate, count: scheduledBreaks.length } });
        return row;
      });
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Operator already has an overlapping shift');
      throw error;
    }
  }

  async current(operatorId: string) {
    return this.db.db.query.shifts.findFirst({
      columns: {
        id: true,
        operatorId: true,
        businessDate: true,
        scheduledRange: true,
        actualStartAt: true,
        actualEndAt: true,
        status: true,
        effectiveMinutes: true,
        notes: true,
      },
      where: and(eq(shifts.operatorId, operatorId), sql`${shifts.scheduledRange} @> now()`, eq(shifts.status, 'IN_PROGRESS')),
    });
  }

  async start(id: string, operatorId?: string) {
    const [row] = await this.db.db.update(shifts).set({ status: 'IN_PROGRESS', actualStartAt: new Date() }).where(and(eq(shifts.id, id), operatorId ? eq(shifts.operatorId, operatorId) : undefined, eq(shifts.status, 'SCHEDULED'), sql`${shifts.scheduledRange} @> now()`)).returning({ id: shifts.id, status: shifts.status, actualStartAt: shifts.actualStartAt });
    if (!row) throw new NotFoundException('Shift not found or already started');
    await this.audit.record({ actorType: operatorId ? 'USER' : 'SYSTEM', actorUserId: operatorId, action: 'shift.started', entityType: 'shift', entityId: row.id, result: 'SUCCESS', metadata: { shiftId: row.id, toStatus: row.status } });
    return row;
  }

  async end(id: string, operatorId?: string) {
    const endedAt = new Date();
    return this.db.transaction(async () => {
      const [row] = await this.db.db.update(shifts).set({ status: 'COMPLETED', actualEndAt: endedAt, effectiveMinutes: sql`greatest(0, extract(epoch from (${endedAt.toISOString()}::timestamptz - coalesce(${shifts.actualStartAt}, ${endedAt.toISOString()}::timestamptz))) / 60)::int` }).where(and(eq(shifts.id, id), operatorId ? eq(shifts.operatorId, operatorId) : undefined, eq(shifts.status, 'IN_PROGRESS'))).returning({ id: shifts.id, status: shifts.status, actualEndAt: shifts.actualEndAt, effectiveMinutes: shifts.effectiveMinutes });
      if (!row) throw new NotFoundException('Shift not found or not in progress');
      await this.db.db.update(breaks).set({ status: 'COMPLETED', endedAt, durationMinutes: sql`greatest(0, round(extract(epoch from (${endedAt.toISOString()}::timestamptz - ${breaks.startedAt})) / 60))::int` }).where(and(eq(breaks.shiftId, id), eq(breaks.status, 'IN_PROGRESS')));
      await this.db.db.update(breaks).set({ status: 'CANCELLED', endedAt }).where(and(eq(breaks.shiftId, id), eq(breaks.status, 'PENDING')));
      await this.audit.record({ actorType: operatorId ? 'USER' : 'SYSTEM', actorUserId: operatorId, action: 'shift.ended', entityType: 'shift', entityId: row.id, result: 'SUCCESS', metadata: { shiftId: row.id, toStatus: row.status } });
      if (operatorId) await this.realtime.publishOperatorChanged(operatorId);
      return row;
    });
  }

  async listTemplates() { return this.db.db.select().from(shiftTemplates).where(eq(shiftTemplates.isActive, true)); }

  async createTemplate(input: ShiftTemplateInput, actorId: string) { const [row] = await this.db.db.insert(shiftTemplates).values(input).returning(); await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'shift_template.created', entityType: 'shift_template', entityId: row.id, result: 'SUCCESS' }); return row; }

  async createOverride(input: ShiftOverrideInput, actorId: string) {
    await this.assertActorCanManageOperator(actorId, input.operatorId);
    const [row] = await this.db.db.insert(shiftOverrides).values({ operatorId: input.operatorId, range: `[${input.validFrom},${input.validTo})`, type: input.type, reason: input.reason, approvedBy: actorId }).returning();
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'shift_override.created', entityType: 'shift_override', entityId: row.id, result: 'SUCCESS', metadata: { operatorId: input.operatorId, reason: input.reason } });
    return row;
  }

  async revokeOverride(id: string, actorId: string) {
    const [existing] = await this.db.db
      .select({ id: shiftOverrides.id, operatorId: shiftOverrides.operatorId })
      .from(shiftOverrides)
      .where(eq(shiftOverrides.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Shift override not found');
    await this.assertActorCanManageOperator(actorId, existing.operatorId);

    const [row] = await this.db.db
      .update(shiftOverrides)
      .set({ revokedAt: new Date(), revokedBy: actorId })
      .where(and(eq(shiftOverrides.id, id), isNull(shiftOverrides.revokedAt)))
      .returning({ id: shiftOverrides.id, operatorId: shiftOverrides.operatorId, revokedAt: shiftOverrides.revokedAt, revokedBy: shiftOverrides.revokedBy });
    if (!row) throw new ConflictException('Shift override is already revoked');
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'shift_override.revoked', entityType: 'shift_override', entityId: row.id, result: 'SUCCESS', metadata: { operatorId: row.operatorId } });
    return row;
  }

  async effectiveTime(from: string, to: string, operatorId?: string) {
    return this.db.db.select({ id: shifts.id, operatorId: shifts.operatorId, businessDate: shifts.businessDate, status: shifts.status, actualStartAt: shifts.actualStartAt, actualEndAt: shifts.actualEndAt, effectiveMinutes: shifts.effectiveMinutes }).from(shifts).where(and(gte(shifts.businessDate, from), lte(shifts.businessDate, to), operatorId ? eq(shifts.operatorId, operatorId) : undefined)).orderBy(shifts.businessDate);
  }

  private async assertActorCanManageOperator(actorId: string, operatorId: string): Promise<void> {
    const [actor] = await this.db.db.select({ role: roles.code }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, actorId)).limit(1);
    if (actor?.role === 'ADMIN' || actor?.role === 'DIRECTOR_OPERATIVO') return;
    if (actor?.role === 'COORDINADOR') {
      const [managed] = await this.db.db
        .select({ id: crewMembers.id })
        .from(crewMembers)
        .innerJoin(crews, eq(crews.id, crewMembers.crewId))
        .where(and(eq(crewMembers.userId, operatorId), eq(crews.coordinatorId, actorId), eq(crews.isActive, true), sql`${crewMembers.validRange} @> now()`))
        .limit(1);
      if (managed) return;
    }
    throw new ForbiddenException('Operator is outside the actor crew scope');
  }
}
