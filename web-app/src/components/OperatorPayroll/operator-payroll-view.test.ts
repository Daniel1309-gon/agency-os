import { describe, expect, it } from 'vitest';
import { formatPeriodRange, payrollPeriodStatusCopy, summaryNotice } from './operator-payroll-view';

describe('operator payroll view model', () => {
  it('names every period status for the operator', () => {
    expect(payrollPeriodStatusCopy('OPEN')).toBe('En curso');
    expect(payrollPeriodStatusCopy('LOCKED')).toBe('En revisión');
    expect(payrollPeriodStatusCopy('CLOSED')).toBe('Liquidado');
    expect(payrollPeriodStatusCopy('PAID')).toBe('Pagado');
    expect(payrollPeriodStatusCopy('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('formats a period range from calendar dates without shifting the day', () => {
    expect(formatPeriodRange('2026-11-01', '2026-11-30')).toBe('1 nov 2026 – 30 nov 2026');
  });

  it('explains why there is nothing to show instead of showing zeros silently', () => {
    expect(summaryNotice({ periodId: null, points: '0.0000', netCop: '0.00', compensationConfigured: false }))
      .toBe('No hay un periodo de nómina en curso. Consulta con coordinación.');
    expect(summaryNotice({ periodId: 'p', points: '0.0000', netCop: '0.00', compensationConfigured: false }))
      .toBe('Tu comisión todavía no está configurada para este periodo. Consulta con coordinación.');
    expect(summaryNotice({ periodId: 'p', points: '35.0000', netCop: '700.00', compensationConfigured: true })).toBeNull();
  });
});
