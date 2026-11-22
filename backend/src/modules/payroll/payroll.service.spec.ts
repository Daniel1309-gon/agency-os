import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service.js';
import { createFakeDatabase, type FakeDatabase } from '../../test/support/fake-db.js';

const PERIOD = '11111111-1111-1111-1111-111111111111';
const OPERATOR = '22222222-2222-2222-2222-222222222222';
const PROFILE = '33333333-3333-3333-3333-333333333333';
const ACTOR = '44444444-4444-4444-4444-444444444444';

const openPeriod = {
  id: PERIOD,
  status: 'OPEN',
  startsOn: '2026-08-01',
  endsOn: '2026-08-31',
  defaultPointsToCopRate: '12.5000',
};

function harness(): { service: PayrollService; db: FakeDatabase } {
  const db = createFakeDatabase();
  return { service: new PayrollService(db.service), db };
}

/** Ultima linea de nomina escrita, sea insert o upsert. */
function lastLine(db: FakeDatabase): Record<string, string> {
  return db.inserted('payroll_lines').at(-1) as Record<string, string>;
}

describe('PayrollService.compute', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
    h.db.stub('payroll_periods').findFirst(openPeriod);
  });

  it('multiplies points by rate for gross, and gross by commission for net', async () => {
    h.db.stub('points_ledger').select([{ operatorId: OPERATOR, points: '1000.0000' }]);
    h.db.stub('operator_compensation').findFirst({ commissionRate: '0.3000', pointsToCopRate: '10.0000' });

    const result = await h.service.compute(PERIOD, ACTOR);

    expect(result).toEqual({ periodId: PERIOD, linesComputed: 1 });
    expect(lastLine(h.db)).toMatchObject({ grossCop: '10000.00', netCop: '3000.00' });
  });

  it('snapshots the commission and the rate onto the line', async () => {
    // Decision #13: cambiar la comision manana no puede reescribir lo ya liquidado.
    h.db.stub('points_ledger').select([{ operatorId: OPERATOR, points: '500.0000' }]);
    h.db.stub('operator_compensation').findFirst({ commissionRate: '0.4500', pointsToCopRate: '8.0000' });

    await h.service.compute(PERIOD, ACTOR);

    expect(lastLine(h.db)).toMatchObject({
      periodId: PERIOD,
      operatorId: OPERATOR,
      pointsTotal: '500.0000',
      commissionRateSnapshot: '0.4500',
      pointsToCopRateSnapshot: '8.0000',
      status: 'DRAFT',
    });
  });

  it('refuses to compute when the operator has no compensation row', async () => {
    h.db.stub('points_ledger').select([{ operatorId: OPERATOR, points: '100.0000' }]);
    h.db.stub('operator_compensation').findFirst(undefined);

    // FR-29: the commission is individual. Neither an invented discount nor an
    // assumed 100%: the administrator configures it before payroll runs.
    await expect(h.service.compute(PERIOD, ACTOR)).rejects.toThrow(`Compensation is not configured for operators: ${OPERATOR}`);
    expect(h.db.inserted('payroll_lines')).toHaveLength(0);
  });

  it('rounds money to two decimals, and derives net from the already rounded gross', async () => {
    h.db.stub('points_ledger').select([{ operatorId: OPERATOR, points: '333.3333' }]);
    h.db.stub('operator_compensation').findFirst({ commissionRate: '0.3333', pointsToCopRate: '3.0000' });

    await h.service.compute(PERIOD, ACTOR);
    const line = lastLine(h.db);

    // 333.3333 x 3 = 999.9999, que redondea a 1000.00; el neto sale de ese
    // 1000.00 ya redondeado, no de 999.9999. El redondeo se compone a
    // proposito, para que la linea cuadre con lo que el operador ve.
    expect(line.grossCop).toBe('1000.00');
    expect(line.netCop).toBe('333.30');
    expect(line.grossCop.split('.')[1]).toHaveLength(2);
    expect(line.pointsTotal).toBe('333.3333');
  });

  it('computes a line per operator', async () => {
    h.db.stub('points_ledger').select([
      { operatorId: OPERATOR, points: '10.0000' },
      { operatorId: ACTOR, points: '20.0000' },
    ]);
    h.db.stub('operator_compensation').findFirst({ commissionRate: '1.0000', pointsToCopRate: '2.0000' });

    const result = await h.service.compute(PERIOD, ACTOR);

    expect(result.linesComputed).toBe(2);
    expect(h.db.inserted('payroll_lines')).toHaveLength(2);
  });

  it('refuses to compute a period that is not OPEN', async () => {
    for (const status of ['LOCKED', 'CLOSED', 'PAID']) {
      const local = harness();
      local.db.stub('payroll_periods').findFirst({ ...openPeriod, status });
      await expect(local.service.compute(PERIOD, ACTOR)).rejects.toThrow(ConflictException);
      expect(local.db.inserted('payroll_lines')).toHaveLength(0);
    }
  });

  it('rejects an unknown period', async () => {
    const local = harness();
    local.db.stub('payroll_periods').findFirst(undefined);
    await expect(local.service.compute(PERIOD, ACTOR)).rejects.toThrow(NotFoundException);
  });
});

describe('PayrollService period lifecycle', () => {
  it('rejects a period whose end is before its start', async () => {
    const { service } = harness();
    await expect(
      service.createPeriod(
        { name: 'Agosto', startsOn: '2026-08-31', endsOn: '2026-08-01', defaultPointsToCopRate: 12.5 },
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('only allows OPEN -> LOCKED and LOCKED -> CLOSED', async () => {
    const { service, db } = harness();
    db.stub('payroll_periods').returning([{ id: PERIOD, status: 'LOCKED' }]);
    await expect(service.setStatus(PERIOD, 'LOCKED', ACTOR)).resolves.toMatchObject({ status: 'LOCKED' });

    // El update filtra por el estado esperado; si no encuentra fila, la
    // transicion no era valida.
    const blocked = harness();
    blocked.db.stub('payroll_periods').returning([]);
    await expect(blocked.service.setStatus(PERIOD, 'CLOSED', ACTOR)).rejects.toThrow(/must be LOCKED/);
  });
});

describe('PayrollService.summary', () => {
  it('never exposes the commission rate, raw points or gross COP to the operator', async () => {
    // Criterio de entrega de PLAN.md §9 y FR-28.
    const { service, db } = harness();
    db.stub('payroll_periods').findFirst(openPeriod);
    db.stub('points_ledger').select([{ points: '1200.0000' }]);
    db.stub('operator_compensation').findFirst({ commissionRate: '0.3000', pointsToCopRate: '10.0000' });

    const summary = await service.summary(OPERATOR);

    expect(summary).toEqual({ periodId: PERIOD, points: '360.0000', netCop: '3600.00', compensationConfigured: true });
    expect(JSON.stringify(summary)).not.toMatch(/commission|grossCop|1200|12000/);
  });

  it('reports zeros instead of nulls when there is no current period', async () => {
    const { service, db } = harness();
    db.stub('payroll_periods').findFirst(undefined);

    await expect(service.summary(OPERATOR)).resolves.toEqual({ periodId: null, points: '0.0000', netCop: '0.00', compensationConfigured: false });
  });
});

describe('PayrollService.addPointsAdjustment', () => {
  it('writes a ledger row instead of mutating a balance', async () => {
    // Decision #12: las correcciones son filas nuevas, nunca reescrituras.
    const { service, db } = harness();
    db.stub('points_ledger').returning([{ id: 1, operatorId: OPERATOR, points: '-25.0000', source: 'MANUAL_ADJUSTMENT' }]);

    await service.addPointsAdjustment(
      { operatorId: OPERATOR, profileId: PROFILE, businessDate: '2026-08-04', points: -25, reason: 'doble conteo' },
      ACTOR,
    );

    expect(db.inserted('points_ledger')[0]).toMatchObject({
      operatorId: OPERATOR,
      points: '-25.0000',
      source: 'MANUAL_ADJUSTMENT',
      attributionMethod: 'MANUAL',
      attributionBasis: { reason: 'doble conteo', actorId: ACTOR },
    });
    expect(db.updated('points_ledger')).toHaveLength(0);
  });
});

describe('PayrollService.goalProgress', () => {
  it('caps progress at 100% and reports null when there is no goal', async () => {
    const { service, db } = harness();
    db.stub('payroll_periods').findFirst(openPeriod);
    db.stub('points_ledger').select([{ value: '1500.0000' }]);
    db.stub('goals').select([{ target: '1000.0000' }]);

    await expect(service.goalProgress(OPERATOR, PERIOD)).resolves.toMatchObject({ progressPercent: 100 });

    const without = harness();
    without.db.stub('payroll_periods').findFirst(openPeriod);
    without.db.stub('points_ledger').select([{ value: '1500.0000' }]);
    without.db.stub('goals').select([]);
    await expect(without.service.goalProgress(OPERATOR, PERIOD)).resolves.toMatchObject({ progressPercent: null });
  });
});
