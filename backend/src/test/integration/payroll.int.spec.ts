import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PayrollService } from '../../modules/payroll/payroll.service.js';
import { operatorCompensation, payrollPeriods, pointsLedger } from '../../database/schema/index.js';
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
  payroll = new PayrollService(ctx.database);
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

describe('PayrollService.compute against a real ledger', () => {
  it('sums only the rows inside the period', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);

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
    await ctx.db.insert(operatorCompensation).values({
      operatorId: operator.id,
      commissionRate: '0.3500',
      pointsToCopRate: '20.0000',
      validRange: halfOpen(new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000)),
      createdBy: admin.id,
    });

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

  it('ignores a compensation row that is no longer in force', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await ctx.db.insert(operatorCompensation).values({
      operatorId: operator.id,
      commissionRate: '0.1000',
      pointsToCopRate: '99.0000',
      validRange: halfOpen(new Date(Date.now() - 172_800_000), new Date(Date.now() - 86_400_000)),
      createdBy: admin.id,
    });

    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);

    // Cae a la tasa por defecto del periodo, no a la comision vencida.
    expect(line).toMatchObject({ pointsToCopRateSnapshot: '10.0000', grossCop: '1000.00', netCop: '1000.00' });
  });

  it('recomputing updates the line in place and bumps its version', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);

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
  it('reports points and money but not the commission rate', async () => {
    // Criterio de entrega de PLAN.md §9.
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);
    await ctx.db.insert(operatorCompensation).values({
      operatorId: operator.id,
      commissionRate: '0.3500',
      pointsToCopRate: '20.0000',
      validRange: halfOpen(new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000)),
      createdBy: admin.id,
    });
    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);

    const summary = await payroll.summary(operator.id, period.id);

    expect(summary).toEqual({ points: '100.0000', netCop: '700.00', grossCop: '2000.00' });
    expect(JSON.stringify(summary)).not.toContain('0.3500');
  });

  it('only counts the operator own points', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const someone = await createUser(ctx);
    const profile = await createProfile(ctx);
    const period = await payroll.createPeriod(PERIOD, admin.id);

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
    await ledger(operator.id, profile.id, '2026-08-05', '100.0000');
    await payroll.compute(period.id, admin.id);
    const [line] = await payroll.lines(period.id);

    const adjustment = await payroll.adjustment(line.id, { type: 'PENALTY', amountCop: -50000, reason: 'llegada tarde' }, admin.id);
    expect(adjustment).toMatchObject({ type: 'PENALTY', amountCop: '-50000.00' });

    const [after] = await payroll.lines(period.id);
    expect(after.netCop).toBe(line.netCop);
  });
});
