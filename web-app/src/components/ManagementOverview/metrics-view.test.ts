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
});
