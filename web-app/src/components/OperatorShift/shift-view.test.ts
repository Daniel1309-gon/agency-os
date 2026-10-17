import { describe, expect, it } from 'vitest';
import { breakStatusCopy, parseScheduledRange } from './shift-view';

describe('operator shift view model', () => {
  it('parses PostgreSQL timestamp ranges returned by the API', () => {
    const range = parseScheduledRange('["2026-08-21 11:05:00+00","2026-08-21 19:05:00+00")');

    expect(range?.from.toISOString()).toBe('2026-08-21T11:05:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-08-21T19:05:00.000Z');
  });

  it('returns no range for an absent or malformed schedule', () => {
    expect(parseScheduledRange(null)).toBeNull();
    expect(parseScheduledRange('not-a-range')).toBeNull();
  });

  it('maps break states to safe operator actions', () => {
    expect(breakStatusCopy('PENDING')).toEqual({ label: 'Programado', action: 'Iniciar break' });
    expect(breakStatusCopy('IN_PROGRESS')).toEqual({ label: 'En curso', action: 'Finalizar break' });
    expect(breakStatusCopy('COMPLETED')).toEqual({ label: 'Completado', action: null });
    expect(breakStatusCopy('CANCELLED')).toEqual({ label: 'Cancelado', action: null });
  });
});
