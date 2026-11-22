import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { PayrollService } from '../../modules/payroll/payroll.service.js';
import { auditLog, operatorAccountEntries, operatorCompensation, payrollPeriods, pointsLedger } from '../../database/schema/index.js';
import {
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';
import { PG, expectRejectedBy } from '../support/pg-errors.js';

let ctx: TestContext;
let payroll: PayrollService;

beforeAll(async () => {
  ctx = await createTestContext();
  payroll = new PayrollService(ctx.database, new AuditService(ctx.database));
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

const PERIOD = { name: 'Agosto 2026', startsOn: '2026-08-01', endsOn: '2026-08-31', defaultPointsToCopRate: 10 };

async function ledger(operatorId: string, profileId: string, businessDate: string, points: string): Promise<void> {
  await ctx.db.insert(pointsLedger).values({
    operatorId,
    profileId,
    businessDate,
    shiftBusinessDate: businessDate,
    points,
    source: 'TABLEAU_ETL',
  });
}

/** Compensation in force for the whole test period (August 2026) and beyond. */
async function compensate(operatorId: string, adminId: string, commissionRate = '1.0000', pointsToCopRate = '10.0000'): Promise<void> {
  await ctx.db.insert(operatorCompensation).values({
    operatorId,
    commissionRate,
    pointsToCopRate,
    validRange: halfOpen('2026-07-01T05:00:00Z', '2027-01-01T05:00:00Z'),
    createdBy: adminId,
  });
}

describe('PayrollService.compute against a real ledger', () => {
  it('sums only the rows inside the period', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);

    await ledger(operator.id, profile.id, '2026-08-01', '100.0000');
    await ledger(operator.id, profile.id, '2026-08-31', '50.0000');
    await ledger(operator.id, profile.id, '2026-07-31', '999.0000');
    await ledger(operator.id, profile.id, '2026-09-01', '999.0000');

    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);

    expect(line.pointsTotal).toBe('150.0000');
    expect(line.grossCop).toBe('1500.00');
  });

  it('nets a reversal out instead of rewriting the original row', async () => {
    // Decision #12: el ledger es append-only; una correccion es una fila negativa.
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);

    await ledger(operator.id, profile.id, '2026-08-10', '200.0000');
    await payroll.addPointsAdjustment(
      { operatorId: operator.id, profileId: profile.id, businessDate: '2026-08-10', points: -80, reason: 'doble conteo' },
      admin.id,
    );

    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);

    expect(line.pointsTotal).toBe('120.0000');
    const rows = await ctx.db.select({ id: pointsLedger.id }).from(pointsLedger).where(eq(pointsLedger.operatorId, operator.id));
    expect(rows).toHaveLength(2);
  });

  it('applies the compensation in force and snapshots it on the line', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id, '0.3500', '20.0000');

    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);

    expect(line).toMatchObject({
      commissionRateSnapshot: '0.3500',
      pointsToCopRateSnapshot: '20.0000',
      grossCop: '2000.00',
      netCop: '700.00',
    });
  });

  it('refuses to compute when an operator has no compensation in force, instead of assuming 100%', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const paid = await createUser(ctx);
    const unpaid = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(paid.id, admin.id, '0.3500', '20.0000');
    // Only a compensation that had already expired before the period ended.
    await ctx.db.insert(operatorCompensation).values({
      operatorId: unpaid.id,
      commissionRate: '0.1000',
      pointsToCopRate: '99.0000',
      validRange: halfOpen('2026-06-01T05:00:00Z', '2026-07-01T05:00:00Z'),
      createdBy: admin.id,
    });

    await ledger(paid.id, profile.id, '2026-08-05', '100.0000');
    await ledger(unpaid.id, profile.id, '2026-08-05', '100.0000');

    await expect(payroll.compute(period.id, admin.id)).rejects.toThrow(new RegExp(`Compensation is not configured for operators: ${unpaid.id}$`));
    // Nothing is written for anyone: a partial payroll would look complete.
    expect(await payroll.lines(period.id)).toHaveLength(0);
  });

  it('pays an operator whose compensation ended mid-period, without blocking anyone else', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const leaver = await createUser(ctx);
    const stayer = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    // Left on 2026-08-21 (Bogota): the compensation covers the days actually worked.
    await ctx.db.insert(operatorCompensation).values({ operatorId: leaver.id, commissionRate: '0.5000', pointsToCopRate: '10.0000', validRange: halfOpen('2026-07-01T05:00:00Z', '2026-08-21T05:00:00Z'), createdBy: admin.id });
    await compensate(stayer.id, admin.id);
    await ledger(leaver.id, profile.id, '2026-08-10', '100.0000');
    await ledger(stayer.id, profile.id, '2026-08-10', '10.0000');

    await expect(payroll.compute(period.id, admin.id)).resolves.toMatchObject({ linesComputed: 2 });
    const lines = await payroll.lines(period.id);
    expect(lines.find((line) => line.operatorId === leaver.id)).toMatchObject({ commissionRateSnapshot: '0.5000', grossCop: '1000.00', netCop: '500.00' });
  });

  it('does not block payroll for an operator without compensation whose points net to zero', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const reversed = await createUser(ctx);
    const paid = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(paid.id, admin.id);
    // Points recorded and fully reversed for someone who never had a compensation.
    await ledger(reversed.id, profile.id, '2026-08-10', '10.0000');
    await ledger(reversed.id, profile.id, '2026-08-12', '-10.0000');
    await ledger(paid.id, profile.id, '2026-08-10', '5.0000');

    // Nothing is payable to the reversed operator, so no line is written for them.
    await expect(payroll.compute(period.id, admin.id)).resolves.toMatchObject({ linesComputed: 1 });
    expect((await payroll.lines(period.id)).map((line) => line.operatorId)).toEqual([paid.id]);
    await expect(payroll.summary(reversed.id, period.id)).resolves.toEqual({ periodId: period.id, points: '0.0000', netCop: '0.00', compensationConfigured: false });
  });

  it('prices each day with the compensation in force that day when it changes mid-period', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await ctx.db.insert(operatorCompensation).values([
      { operatorId: operator.id, commissionRate: '0.3000', pointsToCopRate: '10.0000', validRange: halfOpen('2026-07-01T05:00:00Z', '2026-08-16T05:00:00Z'), createdBy: admin.id },
      { operatorId: operator.id, commissionRate: '0.5000', pointsToCopRate: '20.0000', validRange: halfOpen('2026-08-16T05:00:00Z', '2027-01-01T05:00:00Z'), createdBy: admin.id },
    ]);
    await ledger(operator.id, profile.id, '2026-08-10', '100.0000');
    await ledger(operator.id, profile.id, '2026-08-20', '100.0000');

    await payroll.compute(period.id, admin.id);

    // 100 x 10 x 0.3 = 300 and 100 x 20 x 0.5 = 1000. The line snapshots the latest compensation.
    expect((await payroll.lines(period.id))[0]).toMatchObject({ pointsTotal: '200.0000', grossCop: '3000.00', netCop: '1300.00', commissionRateSnapshot: '0.5000', pointsToCopRateSnapshot: '20.0000' });
    await expect(payroll.summary(operator.id, period.id)).resolves.toEqual({ periodId: period.id, points: '80.0000', netCop: '1300.00', compensationConfigured: true });
  });

  it('applies the compensation in force when the period ended, not the one in force today', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await ctx.db.insert(operatorCompensation).values([
      { operatorId: operator.id, commissionRate: '0.3000', pointsToCopRate: '10.0000', validRange: halfOpen('2026-07-01T05:00:00Z', '2026-10-01T05:00:00Z'), createdBy: admin.id },
      { operatorId: operator.id, commissionRate: '0.9000', pointsToCopRate: '50.0000', validRange: halfOpen('2026-10-01T05:00:00Z', '2027-01-01T05:00:00Z'), createdBy: admin.id },
    ]);

    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);

    expect((await payroll.lines(period.id))[0]).toMatchObject({ commissionRateSnapshot: '0.3000', pointsToCopRateSnapshot: '10.0000', netCop: '300.00' });
  });

  it('recomputing updates the line in place and bumps its version', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);

    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);
    await ledger(operator.id, profile.id, '2026-08-06', '25.0000');
    await payroll.compute(period.id, admin.id);

    const lines = await payroll.lines(period.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].pointsTotal).toBe('125.0000');
    expect(lines[0].version).toBe(1);
  });

  it('computes one line per operator', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const first = await createUser(ctx);
    const second = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(first.id, admin.id);
    await compensate(second.id, admin.id);

    await ledger(first.id, profile.id, '2026-08-05', '10.0000');
    await ledger(second.id, profile.id, '2026-08-05', '30.0000');

    const result = await payroll.compute(period.id, admin.id);
    expect(result.linesComputed).toBe(2);
    expect((await payroll.lines(period.id)).map((line) => line.pointsTotal).sort()).toEqual(['10.0000', '30.0000']);
  });
});

describe('payroll period lifecycle', () => {
  it('walks OPEN to LOCKED to CLOSED and refuses to skip or go back', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const period = await payroll.createPeriod(PERIOD, admin.id);

    await expect(payroll.setStatus(period.id, 'CLOSED', admin.id)).rejects.toThrow(ConflictException);
    await expect(payroll.setStatus(period.id, 'LOCKED', admin.id)).resolves.toMatchObject({ status: 'LOCKED' });
    await expect(payroll.setStatus(period.id, 'LOCKED', admin.id)).rejects.toThrow(ConflictException);
    await expect(payroll.setStatus(period.id, 'CLOSED', admin.id)).resolves.toMatchObject({ status: 'CLOSED' });
  });

  it('refuses to recompute a period that is no longer open', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await payroll.setStatus(period.id, 'LOCKED', admin.id);

    await expect(payroll.compute(period.id, admin.id)).rejects.toThrow(ConflictException);
  });

  it('lets the database, not the service, be the last word on a closed period', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await ctx.db.update(payrollPeriods).set({ status: 'CLOSED' }).where(eq(payrollPeriods.id, period.id));

    // El servicio no comprueba nada aqui: quien rechaza es el trigger
    // reject_write_on_closed_period, con ERRCODE = check_violation.
    const thrown = await expectRejectedBy(PG.checkViolation, () =>
      payroll.addPointsAdjustment(
        { operatorId: operator.id, profileId: profile.id, businessDate: '2026-08-10', points: 10, reason: 'tarde' },
        admin.id,
      ),
    );
    expect(String((thrown as { cause?: { message?: string } }).cause?.message)).toMatch(/payroll period closed/);
  });

  it('accepts a manual adjustment while the period is open', async () => {
    // `MANUAL_ADJUSTMENT` mide 17 caracteres: con la columna `source` en
    // varchar(16) esto moria con un 22001 y no habia forma de corregir puntos.
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await payroll.createPeriod(PERIOD, admin.id);

    await expect(
      payroll.addPointsAdjustment(
        { operatorId: operator.id, profileId: profile.id, businessDate: '2026-08-10', points: -25, reason: 'doble conteo' },
        admin.id,
      ),
    ).resolves.toMatchObject({ points: '-25.0000', source: 'MANUAL_ADJUSTMENT' });
  });
});

describe('what the operator can see of their own payroll', () => {
  it('reports points and COP after the commission, live, without raw points, gross COP, rate or commission', async () => {
    // FR-28 and PLAN.md §9: "No ve el total de puntos brutos ni el 100% si tiene un techo menor."
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id, '0.3500', '20.0000');
    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');

    // Live: no payroll computation has run yet.
    const summary = await payroll.summary(operator.id, period.id);

    expect(summary).toEqual({ periodId: period.id, points: '35.0000', netCop: '700.00', compensationConfigured: true });
    const body = JSON.stringify(summary);
    for (const hidden of ['100.0000', '2000.00', '0.3500', '20.0000', 'grossCop']) expect(body).not.toContain(hidden);
  });

  it('reports nothing payable while the operator has no compensation in force', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');

    await expect(payroll.summary(operator.id, period.id)).resolves.toEqual({ periodId: period.id, points: '0.0000', netCop: '0.00', compensationConfigured: false });
  });

  it('only counts the operator own points', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const someone = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);

    await ledger(operator.id, profile.id, '2026-08-05', '10.0000');
    await ledger(someone.id, profile.id, '2026-08-05', '5000.0000');

    await expect(payroll.summary(operator.id, period.id)).resolves.toMatchObject({ points: '10.0000' });
  });
});

describe('payroll adjustments', () => {
  it('records an adjustment against a line without editing the line', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);
    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);

    const adjustment = await payroll.adjustment(line.id, { type: 'PENALTY', amountCop: -50000, reason: 'llegada tarde' }, admin.id);
    expect(adjustment).toMatchObject({ type: 'PENALTY', amountCop: '-50000.00' });

    const [after] = await payroll.lines(period.id);
    expect(after.netCop).toBe(line.netCop);
  });
});

async function account(operatorId: string, entryType: string, amountCop: string, businessDate: string): Promise<void> {
  await ctx.db.insert(operatorAccountEntries).values({ operatorId, entryType, amountCop, referenceType: 'cafeteria_order', referenceId: randomUUID(), businessDate });
}

describe('cafeteria consumption in payroll (FR-35)', () => {
  it('deducts the period cafeteria debits net of refunds, and only those inside the period', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);
    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await account(operator.id, 'DEBIT_CAFETERIA', '-300.00', '2026-08-10');
    await account(operator.id, 'CREDIT_REFUND', '50.00', '2026-08-11');
    await account(operator.id, 'DEBIT_CAFETERIA', '-999.00', '2026-09-01');

    await payroll.compute(period.id, admin.id);

    // Earnings stay as computed (100 x 10 x 1 = 1000); the consumption is its own column.
    expect((await payroll.lines(period.id))[0]).toMatchObject({ netCop: '1000.00', cafeteriaDebitCop: '250.00' });
  });

  it('gives an operator with consumption but no points a line, so the debit is not lost', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await account(operator.id, 'DEBIT_CAFETERIA', '-12500.00', '2026-08-10');

    await expect(payroll.compute(period.id, admin.id)).resolves.toMatchObject({ linesComputed: 1 });
    expect((await payroll.lines(period.id))[0]).toMatchObject({ operatorId: operator.id, pointsTotal: '0.0000', grossCop: '0.00', netCop: '0.00', cafeteriaDebitCop: '12500.00' });
  });

  it('writes no line for an operator without points whose consumption was fully refunded', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await account(operator.id, 'DEBIT_CAFETERIA', '-3500.00', '2026-08-10');
    await account(operator.id, 'CREDIT_REFUND', '3500.00', '2026-08-11');

    await expect(payroll.compute(period.id, admin.id)).resolves.toMatchObject({ linesComputed: 0 });
    expect(await payroll.lines(period.id)).toHaveLength(0);
  });

  it('records a zero deduction when the operator consumed nothing', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id);
    await ledger(operator.id, profile.id, '2026-08-05', '10.0000');

    await payroll.compute(period.id, admin.id);

    expect((await payroll.lines(period.id))[0]).toMatchObject({ cafeteriaDebitCop: '0.00' });
  });
});

describe('payroll Excel export (FR-31)', () => {
  it('exports computed lines with summed adjustments and totals as a valid xlsx workbook and audits the export', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx, { email: 'laura@example.com' });
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await compensate(operator.id, admin.id, '0.4000', '100.0000');
    await ledger(operator.id, profile.id, '2026-08-05', '250.0000');
    await account(operator.id, 'DEBIT_CAFETERIA', '-2000.00', '2026-08-06');
    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);
    await payroll.adjustment(line.id, { type: 'BONUS', amountCop: 5000, reason: 'meta' }, admin.id);
    await payroll.adjustment(line.id, { type: 'PENALTY', amountCop: -1500, reason: 'tarde' }, admin.id);

    const exported = await payroll.exportPeriodXlsx(period.id, admin.id);
    expect(exported.filename).toBe('payroll-2026-08-01_2026-08-31.xlsx');
    expect(exported.buffer.byteLength).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const summarySheet = workbook.getWorksheet('Resumen');
    expect(summarySheet).toBeDefined();
    expect(summarySheet!.getRow(2).values).toEqual([undefined, 'Periodo ID', period.id]);
    expect(summarySheet!.getRow(3).values).toEqual([undefined, 'Nombre', PERIOD.name]);
    expect(summarySheet!.getRow(4).values).toEqual([undefined, 'Inicio', PERIOD.startsOn]);
    expect(summarySheet!.getRow(5).values).toEqual([undefined, 'Fin', PERIOD.endsOn]);
    expect(summarySheet!.getRow(6).values).toEqual([undefined, 'Estado', 'OPEN']);
    const sheet = workbook.getWorksheet('Nomina');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).values).toEqual([
      undefined,
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
    // 250 pts * 100 = 25000 gross; * 0.40 = 10000 net; + (5000 - 1500) - 2000 cafeteria = 11500 payable.
    expect(sheet!.getRow(2).values).toEqual([
      undefined,
      'Test laura@example.com',
      'laura@example.com',
      250,
      100,
      0.4,
      25000,
      10000,
      3500,
      2000,
      11500,
      'DRAFT',
    ]);
    expect(sheet!.getRow(3).values).toEqual([
      undefined,
      'TOTAL',
      '',
      250,
      '',
      '',
      25000,
      10000,
      3500,
      2000,
      11500,
      '',
    ]);

    const audits = await ctx.db
      .select({ action: auditLog.action, entityId: auditLog.entityId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.action, 'payroll.exported'));
    expect(audits).toEqual([{ action: 'payroll.exported', entityId: period.id, metadata: { periodId: period.id, count: 1 } }]);

    const allActions = (await ctx.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
    expect(allActions).toContain('payroll.period.computed');
    expect(allActions).toContain('payroll.adjustment.created');
  });

  it('throws NotFoundException when exporting a non-existent period', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await expect(payroll.exportPeriodXlsx('00000000-0000-4000-8000-000000000000', admin.id)).rejects.toThrow(NotFoundException);
  });
});
