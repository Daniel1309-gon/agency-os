import { describe, expect, it } from 'vitest';
import { canManage, formatRange, toIsoDateTime } from './management-view';

describe('operations management view helpers', () => {
  it('allows wildcard permissions and rejects permissions outside the session', () => {
    expect(canManage(['*'], 'users.create')).toBe(true);
    expect(canManage(['users.read'], 'users.create')).toBe(false);
    expect(canManage(['users.create'], 'users.create')).toBe(true);
  });

  it('formats a postgres timestamp range for the operational tables', () => {
    expect(formatRange('[2026-08-27T06:05:00.000Z,2026-08-27T14:05:00.000Z)')).toMatch(/05/);
    expect(formatRange('["2026-08-27 06:05:00+00","2026-08-27 14:05:00+00")')).toMatch(/05/);
    expect(formatRange('["2000-01-01 00:00:00+00","2100-01-01 00:00:00+00")')).toBe('Vigencia abierta');
    expect(formatRange(null)).toBe('Rango no disponible');
  });

  it('converts a local datetime input to an ISO timestamp and rejects invalid values', () => {
    expect(toIsoDateTime('2026-08-27T06:05')).toMatch(/2026-08-27T/);
    expect(() => toIsoDateTime('not-a-date')).toThrow('La fecha y hora no son válidas.');
  });
});
