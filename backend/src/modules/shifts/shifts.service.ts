import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, isPgError } from '../../database/pg-error.js';
import { shiftOverrides, shiftTemplates, shifts } from '../../database/schema/index.js';
import type { ShiftCreateInput, ShiftOverrideInput, ShiftTemplateInput } from './shifts.schemas.js';

function scheduledRange(from: string, to: string) {
  if (new Date(from).getTime() >= new Date(to).getTime()) throw new ConflictException('Shift end must be after start');
  return `[${from},${to})`;
}

@Injectable()
export class ShiftsService {
  constructor(private readonly db: DatabaseService) {}

  async create(input: ShiftCreateInput, actorId: string) {
    try {
      const [row] = await this.db.db.insert(shifts).values({ operatorId: input.operatorId, templateId: input.templateId, businessDate: input.businessDate, scheduledRange: scheduledRange(input.scheduledFrom, input.scheduledTo), notes: input.notes, createdBy: actorId }).returning({ id: shifts.id, operatorId: shifts.operatorId, businessDate: shifts.businessDate, scheduledRange: shifts.scheduledRange, status: shifts.status });
      return row;
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Operator already has an overlapping shift');
      throw error;
    }
  }

  async current(operatorId: string) {
    return this.db.db.query.shifts.findFirst({ where: and(eq(shifts.operatorId, operatorId), sql`${shifts.scheduledRange} @> now()`, eq(shifts.status, 'IN_PROGRESS')) });
  }

  async start(id: string, operatorId?: string) {
    const [row] = await this.db.db.update(shifts).set({ status: 'IN_PROGRESS', actualStartAt: new Date() }).where(and(eq(shifts.id, id), operatorId ? eq(shifts.operatorId, operatorId) : undefined, eq(shifts.status, 'SCHEDULED'))).returning({ id: shifts.id, status: shifts.status, actualStartAt: shifts.actualStartAt });
    if (!row) throw new NotFoundException('Shift not found or already started');
    return row;
  }

  async end(id: string, operatorId?: string) {
    const endedAt = new Date();
    const [row] = await this.db.db.update(shifts).set({ status: 'COMPLETED', actualEndAt: endedAt, effectiveMinutes: sql`greatest(0, extract(epoch from (${endedAt.toISOString()}::timestamptz - coalesce(${shifts.actualStartAt}, ${endedAt.toISOString()}::timestamptz))) / 60)::int` }).where(and(eq(shifts.id, id), operatorId ? eq(shifts.operatorId, operatorId) : undefined, eq(shifts.status, 'IN_PROGRESS'))).returning({ id: shifts.id, status: shifts.status, actualEndAt: shifts.actualEndAt, effectiveMinutes: shifts.effectiveMinutes });
    if (!row) throw new NotFoundException('Shift not found or not in progress');
    return row;
  }

  async listTemplates() { return this.db.db.select().from(shiftTemplates).where(eq(shiftTemplates.isActive, true)); }

  async createTemplate(input: ShiftTemplateInput) { const [row] = await this.db.db.insert(shiftTemplates).values(input).returning(); return row; }

  async createOverride(input: ShiftOverrideInput, actorId: string) {
    const [row] = await this.db.db.insert(shiftOverrides).values({ operatorId: input.operatorId, range: `[${input.validFrom},${input.validTo})`, type: input.type, reason: input.reason, approvedBy: actorId }).returning();
    return row;
  }

  async effectiveTime(from: string, to: string, operatorId?: string) {
    return this.db.db.select({ id: shifts.id, operatorId: shifts.operatorId, businessDate: shifts.businessDate, status: shifts.status, actualStartAt: shifts.actualStartAt, actualEndAt: shifts.actualEndAt, effectiveMinutes: shifts.effectiveMinutes }).from(shifts).where(and(gte(shifts.businessDate, from), lte(shifts.businessDate, to), operatorId ? eq(shifts.operatorId, operatorId) : undefined)).orderBy(shifts.businessDate);
  }
}
