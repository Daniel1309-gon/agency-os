import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { competitions, competitionParticipants, goals, operatorCompensation, payrollAdjustments, payrollLines, payrollPeriods, pointsLedger, users } from '../../database/schema/index.js';
import type { AdjustmentInput, CompetitionInput, GoalInput, PeriodCreateInput, PointsAdjustmentInput } from './payroll.schemas.js';

@Injectable()
export class PayrollService {
  constructor(private readonly db: DatabaseService) {}

  async createPeriod(input: PeriodCreateInput, actorId: string) {
    if (input.startsOn > input.endsOn) throw new ConflictException('Period end must be after start');
    const [row] = await this.db.db.insert(payrollPeriods).values({ ...input, defaultPointsToCopRate: input.defaultPointsToCopRate.toString(), createdBy: actorId }).returning();
    return row;
  }

  async listPeriods() { return this.db.db.select().from(payrollPeriods).orderBy(asc(payrollPeriods.startsOn)); }

  async compute(periodId: string, actorId: string) {
    const period = await this.db.db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) });
    if (!period) throw new NotFoundException('Payroll period not found');
    if (period.status !== 'OPEN') throw new ConflictException('Payroll period is not open');
    const totals = await this.db.db.select({ operatorId: pointsLedger.operatorId, points: sql<string>`coalesce(sum(${pointsLedger.points}), 0)` }).from(pointsLedger).where(and(gte(pointsLedger.shiftBusinessDate, period.startsOn), lte(pointsLedger.shiftBusinessDate, period.endsOn))).groupBy(pointsLedger.operatorId);
    for (const total of totals) {
      const compensation = await this.db.db.query.operatorCompensation.findFirst({ where: and(eq(operatorCompensation.operatorId, total.operatorId), sql`${operatorCompensation.validRange} @> now()`) });
      const commission = compensation?.commissionRate ?? '1';
      const rate = compensation?.pointsToCopRate ?? period.defaultPointsToCopRate;
      const gross = (Number(total.points) * Number(rate)).toFixed(2);
      const net = (Number(gross) * Number(commission)).toFixed(2);
      await this.db.db.insert(payrollLines).values({ periodId, operatorId: total.operatorId, pointsTotal: total.points, commissionRateSnapshot: commission, pointsToCopRateSnapshot: rate, grossCop: gross, netCop: net, status: 'DRAFT', computedAt: new Date(), computedBy: actorId }).onConflictDoUpdate({ target: [payrollLines.periodId, payrollLines.operatorId], set: { pointsTotal: total.points, commissionRateSnapshot: commission, pointsToCopRateSnapshot: rate, grossCop: gross, netCop: net, computedAt: new Date(), computedBy: actorId, version: sql`${payrollLines.version} + 1` } });
    }
    return { periodId, linesComputed: totals.length };
  }

  async summary(operatorId: string, periodId?: string) {
    const filters = [eq(pointsLedger.operatorId, operatorId)];
    if (periodId) {
      const period = await this.db.db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) });
      if (!period) throw new NotFoundException('Payroll period not found');
      filters.push(gte(pointsLedger.shiftBusinessDate, period.startsOn), lte(pointsLedger.shiftBusinessDate, period.endsOn));
    }
    const [points] = await this.db.db.select({ points: sql<string>`coalesce(sum(${pointsLedger.points}), 0)` }).from(pointsLedger).where(and(...filters));
    const [line] = await this.db.db.select({ netCop: payrollLines.netCop, grossCop: payrollLines.grossCop }).from(payrollLines).where(and(eq(payrollLines.operatorId, operatorId), periodId ? eq(payrollLines.periodId, periodId) : undefined)).orderBy(sql`${payrollLines.createdAt} DESC`).limit(1);
    return { points: points?.points ?? '0', netCop: line?.netCop ?? '0', grossCop: line?.grossCop ?? '0' };
  }

  async setStatus(periodId: string, status: 'LOCKED' | 'CLOSED', actorId: string) {
    const expected = status === 'LOCKED' ? 'OPEN' : 'LOCKED';
    const [row] = await this.db.db.update(payrollPeriods).set(status === 'LOCKED' ? { status, lockedAt: new Date() } : { status, closedAt: new Date() }).where(and(eq(payrollPeriods.id, periodId), eq(payrollPeriods.status, expected))).returning({ id: payrollPeriods.id, status: payrollPeriods.status });
    if (!row) throw new ConflictException(`Period must be ${expected}`);
    return row;
  }

  async adjustment(lineId: string, input: AdjustmentInput, actorId: string) {
    const line = await this.db.db.query.payrollLines.findFirst({ where: eq(payrollLines.id, lineId) });
    if (!line) throw new NotFoundException('Payroll line not found');
    const [row] = await this.db.db.insert(payrollAdjustments).values({ lineId, type: input.type, amountCop: input.amountCop.toFixed(2), reason: input.reason, createdBy: actorId }).returning({ id: payrollAdjustments.id, amountCop: payrollAdjustments.amountCop, type: payrollAdjustments.type });
    return row;
  }

  async lines(periodId: string) { return this.db.db.select({ id: payrollLines.id, periodId: payrollLines.periodId, operatorId: payrollLines.operatorId, pointsTotal: payrollLines.pointsTotal, commissionRateSnapshot: payrollLines.commissionRateSnapshot, pointsToCopRateSnapshot: payrollLines.pointsToCopRateSnapshot, grossCop: payrollLines.grossCop, netCop: payrollLines.netCop, status: payrollLines.status, version: payrollLines.version, computedAt: payrollLines.computedAt }).from(payrollLines).where(eq(payrollLines.periodId, periodId)).orderBy(asc(payrollLines.operatorId)); }

  async createGoal(input: GoalInput) { const [row] = await this.db.db.insert(goals).values({ scope: input.scope, operatorId: input.operatorId, crewId: input.crewId, periodId: input.periodId, targetPoints: input.targetPoints.toFixed(4), bonusType: input.bonusType, bonusCop: input.bonusCop?.toFixed(2), tiers: input.tiers ?? [] }).returning(); return row; }
  async listGoals(periodId?: string) { return this.db.db.select().from(goals).where(periodId ? eq(goals.periodId, periodId) : undefined); }
  async goalProgress(operatorId: string, periodId: string) {
    const period = await this.db.db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) });
    if (!period) throw new NotFoundException('Payroll period not found');
    const [points] = await this.db.db.select({ value: sql<string>`coalesce(sum(${pointsLedger.points}),0)` }).from(pointsLedger).where(and(eq(pointsLedger.operatorId, operatorId), gte(pointsLedger.shiftBusinessDate, period.startsOn), lte(pointsLedger.shiftBusinessDate, period.endsOn)));
    const target = await this.db.db.select({ target: goals.targetPoints }).from(goals).where(and(eq(goals.periodId, periodId), eq(goals.operatorId, operatorId), eq(goals.scope, 'OPERATOR'), eq(goals.isActive, true))).limit(1);
    const value = Number(points?.value ?? '0'); const targetValue = Number(target[0]?.target ?? '0');
    return { operatorId, periodId, points: points?.value ?? '0', targetPoints: target[0]?.target ?? '0', progressPercent: targetValue ? Math.min(100, value / targetValue * 100) : null };
  }

  async addPointsAdjustment(input: PointsAdjustmentInput, actorId: string) {
    const [row] = await this.db.db.insert(pointsLedger).values({ operatorId: input.operatorId, profileId: input.profileId, businessDate: input.businessDate, shiftBusinessDate: input.businessDate, points: input.points.toFixed(4), source: 'MANUAL_ADJUSTMENT', attributionMethod: 'MANUAL', attributionBasis: { reason: input.reason, actorId }, referenceId: input.referenceId }).returning({ id: pointsLedger.id, operatorId: pointsLedger.operatorId, points: pointsLedger.points, source: pointsLedger.source, businessDate: pointsLedger.businessDate });
    return row;
  }

  async createCompetition(input: CompetitionInput, actorId: string) { const [row] = await this.db.db.insert(competitions).values({ ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), createdBy: actorId }).returning(); return row; }
  async listCompetitions() { return this.db.db.select().from(competitions).orderBy(desc(competitions.startsAt)); }
  async leaderboard(competitionId: string) { return this.db.db.select({ operatorId: competitionParticipants.operatorId, currentValue: competitionParticipants.currentValue, finalRank: competitionParticipants.finalRank, awardedCop: competitionParticipants.awardedCop }).from(competitionParticipants).where(eq(competitionParticipants.competitionId, competitionId)).orderBy(desc(competitionParticipants.currentValue)); }
}
