import { describe, expect, it } from 'vitest';
import { canExportPayroll, defaultExportFilename, formatPayrollCop, payrollLineRecordSchema, payrollPeriodRecordSchema, payrollStatusLabel } from './payroll-view';

describe('payroll management view model (A12)', () => {
  it('parses full period and line records returned by the payroll API', () => {
    const period = payrollPeriodRecordSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Noviembre 2026',
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
      status: 'OPEN',
      defaultPointsToCopRate: '100.0000',
      lockedAt: null,
      closedAt: null,
      paidAt: null,
      createdBy: '44444444-4444-4444-8444-444444444444',
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    expect(defaultExportFilename(period)).toBe('payroll-2026-11-01_2026-11-30.xlsx');
    expect(payrollStatusLabel(period.status)).toBe('Abierto');

    const line = payrollLineRecordSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      periodId: period.id,
      operatorId: '33333333-3333-4333-8333-333333333333',
      pointsTotal: '120.5000',
      commissionRateSnapshot: '0.4000',
      pointsToCopRateSnapshot: '100.0000',
      grossCop: '12050.00',
      netCop: '4820.00',
      cafeteriaDebitCop: '1500.00',
      status: 'DRAFT',
      version: 1,
      computedAt: '2026-11-22T18:00:00.000Z',
    });
    expect(line.cafeteriaDebitCop).toBe('1500.00');
  });

  it('gates Excel export strictly to wildcard or payroll.configure', () => {
    expect(canExportPayroll(['*'])).toBe(true);
    expect(canExportPayroll(['payroll.read', 'payroll.configure'])).toBe(true);
    expect(canExportPayroll(['payroll.read'])).toBe(false);
    expect(canExportPayroll([])).toBe(false);
  });

  it('formats COP currency amounts cleanly', () => {
    expect(formatPayrollCop('13500.00')).toMatch(/13[.,]500/);
  });
});
