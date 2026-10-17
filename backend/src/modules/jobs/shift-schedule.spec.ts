import { describe, expect, it } from 'vitest';
import { businessDateInBogota, buildScheduledRange, nextOccurrenceAt, occurrencesUpTo, shiftBusinessDate, weekdayForBusinessDate } from './shift-schedule.js';

const BOGOTA_CLOCK = (at: Date) => at.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour12: false });

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

  it('moves the business date across a month boundary', () => {
    expect(shiftBusinessDate('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('rejects an overnight flag that would create a day-plus shift', () => {
    expect(() => buildScheduledRange('2026-08-23', '06:05', '14:05', true)).toThrow('crosses midnight');
  });
});

describe('message recurrence', () => {
  const start = new Date('2026-09-23T14:05:00.000Z');

  it('keeps the Bogota wall clock for a daily series', () => {
    const next = nextOccurrenceAt(start, { frequency: 'DAILY' });

    expect(next?.toISOString()).toBe('2026-09-24T14:05:00.000Z');
    expect(BOGOTA_CLOCK(next!)).toBe('09:05:00');
  });

  it('jumps to the next selected weekday for a weekly series', () => {
    const wednesday = new Date('2026-09-23T14:05:00.000Z');

    expect(weekdayForBusinessDate(businessDateInBogota(wednesday))).toBe(3);
    expect(nextOccurrenceAt(wednesday, { frequency: 'WEEKLY', weekdays: [1] })?.toISOString()).toBe('2026-09-28T14:05:00.000Z');
    expect(nextOccurrenceAt(wednesday, { frequency: 'WEEKLY', weekdays: [3] })?.toISOString()).toBe('2026-09-30T14:05:00.000Z');
  });

  it('picks the weekday in Bogota time, not the UTC one', () => {
    const lateWednesday = new Date('2026-09-24T03:05:00.000Z');

    expect(weekdayForBusinessDate(businessDateInBogota(lateWednesday))).toBe(3);
    expect(nextOccurrenceAt(lateWednesday, { frequency: 'WEEKLY', weekdays: [3] })?.toISOString()).toBe('2026-10-01T03:05:00.000Z');
  });

  it('treats until as an inclusive local date', () => {
    expect(nextOccurrenceAt(start, { frequency: 'DAILY', until: '2026-09-24' })?.toISOString()).toBe('2026-09-24T14:05:00.000Z');
    expect(nextOccurrenceAt(start, { frequency: 'DAILY', until: '2026-09-23' })).toBeNull();
    const lateNight = new Date('2026-09-23T03:05:00.000Z');
    expect(nextOccurrenceAt(lateNight, { frequency: 'DAILY', until: '2026-09-23' })?.toISOString()).toBe('2026-09-24T03:05:00.000Z');
    expect(nextOccurrenceAt(lateNight, { frequency: 'DAILY', until: '2026-09-22' })).toBeNull();
  });

  it('enumerates every missed occurrence up to now', () => {
    const occurrences = occurrencesUpTo(new Date('2026-09-20T14:05:00.000Z'), start, { frequency: 'DAILY' });

    expect(occurrences.map((occurrence) => occurrence.toISOString())).toEqual([
      '2026-09-20T14:05:00.000Z',
      '2026-09-21T14:05:00.000Z',
      '2026-09-22T14:05:00.000Z',
      '2026-09-23T14:05:00.000Z',
    ]);
  });

  it('stops a weekly series when no selected weekday is reachable before until', () => {
    expect(nextOccurrenceAt(start, { frequency: 'WEEKLY', weekdays: [0], until: '2026-09-26' })).toBeNull();
  });
});
