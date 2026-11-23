import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { competitions, competitionParticipants, goals, operatorCompensation, payrollAdjustments, payrollLines, payrollPeriods, pointsLedger, users } from '../../database/schema/index.js';
import type { AdjustmentInput, CompetitionInput, GoalInput, PeriodCreateInput, PointsAdjustmentInput } from './payroll.schemas.js';

interface PricedSegment {
  operatorId: string;
  points: string;
  compensationId: string | null;
  commissionRate: string | null;
  pointsToCopRate: string | null;
  lastDate: string;
}

function groupByOperator(segments: PricedSegment[]): Map<string, PricedSegment[]> {
  const grouped = new Map<string, PricedSegment[]>();
  for (const segment of segments) grouped.set(segment.operatorId, [...(grouped.get(segment.operatorId) ?? []), segment]);
  return grouped;
}

/**
 * Money is rounded per segment exactly as a single-rate line is: gross to two
 * decimals first, then net from that rounded gross. The line snapshots the
 * compensation of the latest priced day. `missing` is true when points that do not
 * net to zero fall on a day without a compensation in force.
 */
function priceSegments(segments: PricedSegment[]) {
  let points = 0;
  let commissioned = 0;
  let gross = 0;
  let net = 0;
  let missing = false;
  let latest: PricedSegment | undefined;
  for (const segment of segments) {
    const value = Number(segment.points);
    points += value;
    if (!segment.compensationId || segment.commissionRate === null || segment.pointsToCopRate === null) {
      if (value !== 0) missing = true;
      continue;
    }
    const commission = Number(segment.commissionRate);
    const segmentGross = Number((value * Number(segment.pointsToCopRate)).toFixed(2));
    commissioned += value * commission;
    gross += segmentGross;
    net += Number((segmentGross * commission).toFixed(2));
    if (!latest || segment.lastDate > latest.lastDate) latest = segment;
  }
  return {
    missing: missing || !latest,
    pointsTotal: points.toFixed(4),
    commissionedPoints: commissioned.toFixed(4),
    grossCop: gross.toFixed(2),
    netCop: net.toFixed(2),
    commissionRate: latest?.commissionRate ?? '0',
    pointsToCopRate: latest?.pointsToCopRate ?? '0',
  };
}

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
    const byOperator = groupByOperator(await this.pricedSegments(period));
    // FR-29: the commission is individual. Paying an operator without one at an
    // assumed 100% overpays silently, so the whole computation is refused instead.
    const missing = [...byOperator].filter(([, segments]) => priceSegments(segments).missing).map(([operatorId]) => operatorId);
    if (missing.length) throw new ConflictException(`Compensation is not configured for operators: ${missing.join(', ')}`);
    for (const [operatorId, segments] of byOperator) {
      const priced = priceSegments(segments);
      const line = { pointsTotal: priced.pointsTotal, commissionRateSnapshot: priced.commissionRate, pointsToCopRateSnapshot: priced.pointsToCopRate, grossCop: priced.grossCop, netCop: priced.netCop };
      await this.db.db.insert(payrollLines).values({ periodId, operatorId, ...line, status: 'DRAFT', computedAt: new Date(), computedBy: actorId }).onConflictDoUpdate({ target: [payrollLines.periodId, payrollLines.operatorId], set: { ...line, computedAt: new Date(), computedBy: actorId, version: sql`${payrollLines.version} + 1` } });
    }
    return { periodId, linesComputed: byOperator.size };
  }

  /**
   * FR-28: the operator sees their points and COP after their commission, live from
   * the ledger. Raw points, gross COP, the rate and the commission never leave here.
   * Without `periodId` it reports the period covering today in Bogota.
   */
  async summary(operatorId: string, periodId?: string) {
    const period = periodId
      ? await this.db.db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) })
      : await this.db.db.query.payrollPeriods.findFirst({ where: sql`(now() at time zone 'America/Bogota')::date between ${payrollPeriods.startsOn} and ${payrollPeriods.endsOn}`, orderBy: desc(payrollPeriods.startsOn) });
    if (!period) {
      if (periodId) throw new NotFoundException('Payroll period not found');
      return { periodId: null, points: '0.0000', netCop: '0.00', compensationConfigured: false };
    }
    const segments = await this.pricedSegments(period, operatorId);
    const unpaid = { periodId: period.id, points: '0.0000', netCop: '0.00', compensationConfigured: false };
    if (!segments.length) return (await this.compensationFor(operatorId, period.endsOn)) ? { ...unpaid, compensationConfigured: true } : unpaid;
    const priced = priceSegments(segments);
    if (priced.missing) return unpaid;
    return { periodId: period.id, points: priced.commissionedPoints, netCop: priced.netCop, compensationConfigured: true };
  }

  /**
   * Ledger points of the period grouped by the compensation in force on each shift
   * business date (start of that day in Bogota). operator_compensation forbids
   * overlapping ranges, so every ledger row joins at most one compensation; a
   * mid-period change prices each day with its own rate and commission.
   */
  private pricedSegments(period: { startsOn: string; endsOn: string }, operatorId?: string): Promise<PricedSegment[]> {
    return this.db.db
      .select({
        operatorId: pointsLedger.operatorId,
        points: sql<string>`coalesce(sum(${pointsLedger.points}), 0)`,
        compensationId: operatorCompensation.id,
        commissionRate: operatorCompensation.commissionRate,
        pointsToCopRate: operatorCompensation.pointsToCopRate,
        lastDate: sql<string>`max(${pointsLedger.shiftBusinessDate})::text`,
      })
      .from(pointsLedger)
      .leftJoin(operatorCompensation, and(eq(operatorCompensation.operatorId, pointsLedger.operatorId), sql`${operatorCompensation.validRange} @> (${pointsLedger.shiftBusinessDate}::timestamp at time zone 'America/Bogota')`))
      .where(and(gte(pointsLedger.shiftBusinessDate, period.startsOn), lte(pointsLedger.shiftBusinessDate, period.endsOn), operatorId ? eq(pointsLedger.operatorId, operatorId) : undefined))
      .groupBy(pointsLedger.operatorId, operatorCompensation.id, operatorCompensation.commissionRate, operatorCompensation.pointsToCopRate);
  }

  /** Compensation in force at the end of the period, or now if the period has not ended yet. */
  private compensationFor(operatorId: string, endsOn: string) {
    return this.db.db.query.operatorCompensation.findFirst({
      where: and(eq(operatorCompensation.operatorId, operatorId), sql`${operatorCompensation.validRange} @> least(now(), ((${endsOn}::date + 1)::timestamp at time zone 'America/Bogota') - interval '1 microsecond')`),
      orderBy: desc(operatorCompensation.createdAt),
    });
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
