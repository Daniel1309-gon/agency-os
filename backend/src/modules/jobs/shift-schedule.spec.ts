import { describe, expect, it } from 'vitest';
import { businessDateInBogota, buildScheduledRange, weekdayForBusinessDate } from './shift-schedule.js';

describe('shift schedule', () => {
  it('uses the Bogota business date instead of the UTC date', () => {
    expect(businessDateInBogota(new Date('2026-08-24T04:59:59.000Z'))).toBe('2026-08-23');
    expect(businessDateInBogota(new Date('2026-08-24T05:00:00.000Z'))).toBe('2026-08-24');
  });

  it('builds a regular 06:05–14:05 shift in UTC', () => {
    expect(buildScheduledRange('2026-08-23', '06:05', '14:05', false))
      .toBe('[2026-08-23T11:05:00.000Z,2026-08-23T19:05:00.000Z)');
  });

  it('keeps the start business date when a 22:05 shift crosses midnight and month', () => {
    expect(buildScheduledRange('2026-08-31', '22:05', '06:05', true))
      .toBe('[2026-09-01T03:05:00.000Z,2026-09-01T11:05:00.000Z)');
  });

  it('uses the existing template weekday convention where Sunday is zero', () => {
    expect(weekdayForBusinessDate('2026-08-23')).toBe(0);
  });

  it('rejects an overnight flag that would create a day-plus shift', () => {
    expect(() => buildScheduledRange('2026-08-23', '06:05', '14:05', true)).toThrow('crosses midnight');
  });
});
