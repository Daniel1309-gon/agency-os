import { describe, expect, it } from 'vitest';
import {
  buildMetricsRangeQuery,
  canViewGlobalReconciliation,
  defaultMetricsWindow,
  formatResponseRate,
  reconciliationStatusLabel,
} from './metrics-view';

describe('metrics dashboard view helpers (A7)', () => {
  it('computes calendar date windows cleanly across month boundaries', () => {
    expect(defaultMetricsWindow('2026-11-03', 7)).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    expect(defaultMetricsWindow('2026-11-23', 7)).toEqual({ from: '2026-11-17', to: '2026-11-23' });
  });

  it('builds range query strings cleanly', () => {
    expect(buildMetricsRangeQuery('/metrics/ranking', { from: '2026-11-17', to: '2026-11-23', limit: 100 }))
      .toBe('/metrics/ranking?from=2026-11-17&to=2026-11-23&limit=100');
    expect(buildMetricsRangeQuery('/metrics/reconciliation', {})).toBe('/metrics/reconciliation');
  });

  it('formats response rates and gates global reconciliation by role', () => {
    expect(formatResponseRate(0.4)).toBe('40.0%');
    expect(formatResponseRate('0.125')).toBe('12.5%');
    expect(formatResponseRate(null)).toBe('—');
    expect(canViewGlobalReconciliation('ADMIN')).toBe(true);
    expect(canViewGlobalReconciliation('DIRECTOR_OPERATIVO')).toBe(true);
    expect(canViewGlobalReconciliation('COORDINADOR')).toBe(false);
    expect(reconciliationStatusLabel('OK')).toBe('En tolerancia');
    expect(reconciliationStatusLabel('DIVERGENT')).toBe('Divergente');
  });

  it('handles leap-year, year boundaries, empty filters, and edge response rates safely', () => {
    expect(defaultMetricsWindow('2024-03-02', 7)).toEqual({ from: '2024-02-25', to: '2024-03-02' });
    expect(defaultMetricsWindow('2026-01-03', 7)).toEqual({ from: '2025-12-28', to: '2026-01-03' });
    expect(buildMetricsRangeQuery('/metrics/ranking', { from: '', to: '', limit: 100 })).toBe('/metrics/ranking?limit=100');
    expect(formatResponseRate(0)).toBe('0.0%');
    expect(formatResponseRate('0.40000000000000000000')).toBe('40.0%');
    expect(formatResponseRate('')).toBe('—');
    expect(formatResponseRate(Number.NaN)).toBe('—');
    expect(canViewGlobalReconciliation('OPERADOR')).toBe(false);
    expect(canViewGlobalReconciliation('CAFETERIA')).toBe(false);
  });
});
