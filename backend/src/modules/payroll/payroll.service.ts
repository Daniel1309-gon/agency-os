import ExcelJS from 'exceljs';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { competitions, competitionParticipants, goals, operatorAccountEntries, operatorCompensation, payrollAdjustments, payrollLines, payrollPeriods, pointsLedger, users } from '../../database/schema/index.js';
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
 * net to zero fall on a day without a compensation in force. `payable` is false when
 * no day was priced at all (nothing to snapshot and nothing owed).
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
    missing,
    payable: Boolean(latest),
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
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async createPeriod(input: PeriodCreateInput, actorId: string) {
    if (input.startsOn > input.endsOn) throw new ConflictException('Period end must be after start');
    const [row] = await this.db.db.insert(payrollPeriods).values({ ...input, defaultPointsToCopRate: input.defaultPointsToCopRate.toString(), createdBy: actorId }).returning();
    return row;
  }

  async listPeriods() { return this.db.db.select().from(payrollPeriods).orderBy(asc(payrollPeriods.startsOn)); }

  /** Periods as the operator sees them (FR-28): name, range and status, never the default rate. */
  async myPeriods() {
    return this.db.db
      .select({ id: payrollPeriods.id, name: payrollPeriods.name, startsOn: payrollPeriods.startsOn, endsOn: payrollPeriods.endsOn, status: payrollPeriods.status })
      .from(payrollPeriods)
      .orderBy(desc(payrollPeriods.startsOn));
  }

  async compute(periodId: string, actorId: string) {
    const period = await this.db.db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) });
    if (!period) throw new NotFoundException('Payroll period not found');
    if (period.status !== 'OPEN') throw new ConflictException('Payroll period is not open');
    const byOperator = groupByOperator(await this.pricedSegments(period));
    // FR-29: the commission is individual. Paying an operator without one at an
    // assumed 100% overpays silently, so the whole computation is refused instead.
    const missing = [...byOperator].filter(([, segments]) => priceSegments(segments).missing).map(([operatorId]) => operatorId);
    if (missing.length) throw new ConflictException(`Compensation is not configured for operators: ${missing.join(', ')}`);
    const consumption = await this.cafeteriaConsumption(period);
    let linesComputed = 0;
    const computed: string[] = [];
    for (const operatorId of new Set([...byOperator.keys(), ...consumption.keys()])) {
      const priced = priceSegments(byOperator.get(operatorId) ?? []);
      const cafeteriaDebitCop = (consumption.get(operatorId) ?? 0).toFixed(2);
      let line: { pointsTotal: string; commissionRateSnapshot: string; pointsToCopRateSnapshot: string; grossCop: string; netCop: string; cafeteriaDebitCop: string };
      if (priced.payable) {
        line = { pointsTotal: priced.pointsTotal, commissionRateSnapshot: priced.commissionRate, pointsToCopRateSnapshot: priced.pointsToCopRate, grossCop: priced.grossCop, netCop: priced.netCop, cafeteriaDebitCop };
      } else if (consumption.has(operatorId)) {
        // FR-35: consumption without payable points still needs a line, or the debit
        // would never reach payroll. It carries the compensation in force at period end, if any.
        const compensation = await this.compensationFor(operatorId, period.endsOn);
        line = { pointsTotal: priced.pointsTotal, commissionRateSnapshot: compensation?.commissionRate ?? '0', pointsToCopRateSnapshot: compensation?.pointsToCopRate ?? '0', grossCop: '0.00', netCop: '0.00', cafeteriaDebitCop };
      } else {
        // Fully reversed points of an operator who never had a compensation: no line.
        continue;
      }
      linesComputed += 1;
      computed.push(operatorId);
      await this.db.db.insert(payrollLines).values({ periodId, operatorId, ...line, status: 'DRAFT', computedAt: new Date(), computedBy: actorId }).onConflictDoUpdate({ target: [payrollLines.periodId, payrollLines.operatorId], set: { ...line, computedAt: new Date(), computedBy: actorId, version: sql`${payrollLines.version} + 1` } });
    }
    // A draft line from an earlier compute whose operator now has nothing to pay or
    // deduct (points reversed, consumption refunded) would otherwise keep its old
    // amounts and reach the export. agency_app cannot DELETE, so it is zeroed.
    await this.db.db
      .update(payrollLines)
      .set({ pointsTotal: '0.0000', grossCop: '0.00', netCop: '0.00', cafeteriaDebitCop: '0.00', computedAt: new Date(), computedBy: actorId, version: sql`${payrollLines.version} + 1` })
      .where(and(
        eq(payrollLines.periodId, periodId),
        eq(payrollLines.status, 'DRAFT'),
        computed.length ? notInArray(payrollLines.operatorId, computed) : undefined,
        or(ne(payrollLines.pointsTotal, '0'), ne(payrollLines.grossCop, '0'), ne(payrollLines.netCop, '0'), ne(payrollLines.cafeteriaDebitCop, '0')),
      ));
    await this.audit?.record({ actorType: 'USER', actorUserId: actorId, action: 'payroll.period.computed', entityType: 'payroll_period', entityId: periodId, result: 'SUCCESS', metadata: { periodId, count: linesComputed } });
    return { periodId, linesComputed };
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
    if (priced.missing || !priced.payable) return unpaid;
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

  /**
   * FR-35: cafeteria debits net of refunds whose Bogota business date falls in the
   * period, per operator, as a positive amount to deduct.
   */
  private async cafeteriaConsumption(period: { startsOn: string; endsOn: string }): Promise<Map<string, number>> {
    const rows = await this.db.db
      .select({ operatorId: operatorAccountEntries.operatorId, total: sql<string>`coalesce(sum(${operatorAccountEntries.amountCop}), 0)` })
      .from(operatorAccountEntries)
      .where(and(inArray(operatorAccountEntries.entryType, ['DEBIT_CAFETERIA', 'CREDIT_REFUND']), gte(operatorAccountEntries.businessDate, period.startsOn), lte(operatorAccountEntries.businessDate, period.endsOn)))
      .groupBy(operatorAccountEntries.operatorId);
    // A debit fully refunded within the period nets to zero: nothing to deduct, no line.
    return new Map(rows.map((row) => [row.operatorId, -Number(row.total)] as const).filter(([, amount]) => amount !== 0));
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
    await this.audit?.record({ actorType: 'USER', actorUserId: actorId, action: 'payroll.period.status_changed', entityType: 'payroll_period', entityId: periodId, result: 'SUCCESS', metadata: { periodId, fromStatus: expected, toStatus: status } });
    return row;
  }

  async adjustment(lineId: string, input: AdjustmentInput, actorId: string) {
    const line = await this.db.db.query.payrollLines.findFirst({ where: eq(payrollLines.id, lineId) });
    if (!line) throw new NotFoundException('Payroll line not found');
    const [row] = await this.db.db.insert(payrollAdjustments).values({ lineId, type: input.type, amountCop: input.amountCop.toFixed(2), reason: input.reason, createdBy: actorId }).returning({ id: payrollAdjustments.id, amountCop: payrollAdjustments.amountCop, type: payrollAdjustments.type });
    await this.audit?.record({ actorType: 'USER', actorUserId: actorId, action: 'payroll.adjustment.created', entityType: 'payroll_line', entityId: lineId, result: 'SUCCESS', metadata: { periodId: line.periodId, operatorId: line.operatorId } });
    return row;
  }

  async lines(periodId: string) { return this.db.db.select({ id: payrollLines.id, periodId: payrollLines.periodId, operatorId: payrollLines.operatorId, pointsTotal: payrollLines.pointsTotal, commissionRateSnapshot: payrollLines.commissionRateSnapshot, pointsToCopRateSnapshot: payrollLines.pointsToCopRateSnapshot, grossCop: payrollLines.grossCop, netCop: payrollLines.netCop, cafeteriaDebitCop: payrollLines.cafeteriaDebitCop, status: payrollLines.status, version: payrollLines.version, computedAt: payrollLines.computedAt }).from(payrollLines).where(eq(payrollLines.periodId, periodId)).orderBy(asc(payrollLines.operatorId)); }

  /** FR-31: exports a payroll period with computed lines and summed adjustments as an .xlsx workbook. */
  async exportPeriodXlsx(periodId: string, actorId: string): Promise<{ filename: string; buffer: Buffer }> {
    const period = await this.db.db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) });
    if (!period) throw new NotFoundException('Payroll period not found');

    const rows = await this.db.db
      .select({
        id: payrollLines.id,
        fullName: users.fullName,
        email: users.email,
        pointsTotal: payrollLines.pointsTotal,
        pointsToCopRateSnapshot: payrollLines.pointsToCopRateSnapshot,
        commissionRateSnapshot: payrollLines.commissionRateSnapshot,
        grossCop: payrollLines.grossCop,
        netCop: payrollLines.netCop,
        cafeteriaDebitCop: payrollLines.cafeteriaDebitCop,
        status: payrollLines.status,
      })
      .from(payrollLines)
      .innerJoin(users, eq(users.id, payrollLines.operatorId))
      .where(eq(payrollLines.periodId, periodId))
      .orderBy(asc(users.fullName));

    const adjustmentsByLine = new Map<string, number>();
    if (rows.length) {
      const adjustmentSums = await this.db.db
        .select({
          lineId: payrollAdjustments.lineId,
          total: sql<string>`coalesce(sum(${payrollAdjustments.amountCop}), 0)`,
        })
        .from(payrollAdjustments)
        .where(inArray(payrollAdjustments.lineId, rows.map((row) => row.id)))
        .groupBy(payrollAdjustments.lineId);
      for (const item of adjustmentSums) adjustmentsByLine.set(item.lineId, Number(item.total));
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Agency OS';
    const exportedAt = new Date();
    workbook.created = exportedAt;
    const summarySheet = workbook.addWorksheet('Resumen');
    summarySheet.addRow(['Campo', 'Valor']);
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.addRow(['Periodo ID', period.id]);
    summarySheet.addRow(['Nombre', period.name]);
    summarySheet.addRow(['Inicio', period.startsOn]);
    summarySheet.addRow(['Fin', period.endsOn]);
    summarySheet.addRow(['Estado', period.status]);
    summarySheet.addRow(['Lineas', rows.length]);
    summarySheet.addRow(['Exportado', exportedAt.toISOString()]);

    const sheet = workbook.addWorksheet('Nomina');
    sheet.addRow([
      'Operador',
      'Correo',
      'Puntos',
      'Tasa COP',
      'Comision',
      'Bruto COP',
      'Neto COP',
      'Ajustes COP',
      'Cafeteria COP',
      'Total a Pagar COP',
      'Estado',
    ]);
    sheet.getRow(1).font = { bold: true };

    let totalPoints = 0;
    let totalGross = 0;
    let totalNet = 0;
    let totalAdjustments = 0;
    let totalCafeteria = 0;
    let totalPayable = 0;

    for (const row of rows) {
      const points = Number(row.pointsTotal);
      const rate = Number(row.pointsToCopRateSnapshot);
      const commission = Number(row.commissionRateSnapshot);
      const gross = Number(row.grossCop);
      const net = Number(row.netCop);
      const adjustments = Number((adjustmentsByLine.get(row.id) ?? 0).toFixed(2));
      const cafeteria = Number(row.cafeteriaDebitCop);
      // FR-35: the period cafeteria consumption is deducted from what is paid.
      const payable = Number((net + adjustments - cafeteria).toFixed(2));

      totalPoints += points;
      totalGross += gross;
      totalNet += net;
      totalAdjustments += adjustments;
      totalCafeteria += cafeteria;
      totalPayable += payable;

      sheet.addRow([
        row.fullName,
        row.email,
        points,
        rate,
        commission,
        gross,
        net,
        adjustments,
        cafeteria,
        payable,
        row.status,
      ]);
    }

    const summaryRow = sheet.addRow([
      'TOTAL',
      '',
      Number(totalPoints.toFixed(4)),
      '',
      '',
      Number(totalGross.toFixed(2)),
      Number(totalNet.toFixed(2)),
      Number(totalAdjustments.toFixed(2)),
      Number(totalCafeteria.toFixed(2)),
      Number(totalPayable.toFixed(2)),
      '',
    ]);
    summaryRow.font = { bold: true };

    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(raw as ArrayBuffer);
    await this.audit?.record({
      actorType: 'USER',
      actorUserId: actorId,
      action: 'payroll.exported',
      entityType: 'payroll_period',
      entityId: periodId,
      result: 'SUCCESS',
      metadata: { periodId, count: rows.length },
    });
    return { filename: `payroll-${period.startsOn}_${period.endsOn}.xlsx`, buffer };
  }

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
    await this.audit?.record({ actorType: 'USER', actorUserId: actorId, action: 'payroll.points_adjusted', entityType: 'user', entityId: input.operatorId, result: 'SUCCESS', metadata: { operatorId: input.operatorId, profileId: input.profileId, businessDate: input.businessDate } });
    return row;
  }

  async createCompetition(input: CompetitionInput, actorId: string) { const [row] = await this.db.db.insert(competitions).values({ ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), createdBy: actorId }).returning(); return row; }
  async listCompetitions() { return this.db.db.select().from(competitions).orderBy(desc(competitions.startsAt)); }
  async leaderboard(competitionId: string) { return this.db.db.select({ operatorId: competitionParticipants.operatorId, currentValue: competitionParticipants.currentValue, finalRank: competitionParticipants.finalRank, awardedCop: competitionParticipants.awardedCop }).from(competitionParticipants).where(eq(competitionParticipants.competitionId, competitionId)).orderBy(desc(competitionParticipants.currentValue)); }
}
