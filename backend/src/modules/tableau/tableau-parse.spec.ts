import { describe, expect, it } from 'vitest';
import { isTotalLabel, isValidTimeZone, parseCsv, parsePoints, parseSourceHour } from './tableau-parse.js';

describe('parseCsv', () => {
  it('strips the BOM, keeps quoted commas and quotes, and skips blank lines', () => {
    const { headers, rows } = parseCsv('﻿Profile,Hour,Points\r\n"A, B",2026-08-04 06:00,"1""5"\r\n\r\nC,2026-08-04 07:00,2\n');

    expect(headers).toEqual(['Profile', 'Hour', 'Points']);
    expect(rows).toEqual([
      { Profile: 'A, B', Hour: '2026-08-04 06:00', Points: '1"5' },
      { Profile: 'C', Hour: '2026-08-04 07:00', Points: '2' },
    ]);
  });
});

describe('isTotalLabel', () => {
  it('recognises the grand-total rows Tableau adds, in Spanish and English', () => {
    for (const label of ['Todo', 'All', ' total ', 'Grand Total', 'Total general']) expect(isTotalLabel(label)).toBe(true);
    expect(isTotalLabel('TU-1234')).toBe(false);
  });
});

describe('parsePoints', () => {
  it('accepts plain decimals only and rejects currency or thousands separators', () => {
    expect(parsePoints('12.5')).toBe(12.5);
    expect(parsePoints(' -3 ')).toBe(-3);
    for (const value of ['$2.00', '-$0.89', '1,234.5', '1.234,5', '', 'abc']) expect(parsePoints(value)).toBeUndefined();
  });
});

describe('parseSourceHour', () => {
  it('reads ISO wall time in the view timezone (Bogota is UTC-5 all year)', () => {
    expect(parseSourceHour('2026-08-04 06:00', 'America/Bogota')?.toISOString()).toBe('2026-08-04T11:00:00.000Z');
    expect(parseSourceHour('2026-08-04T22:00:00', 'America/Bogota')?.toISOString()).toBe('2026-08-05T03:00:00.000Z');
    expect(parseSourceHour('2026-08-04 06:00', 'UTC')?.toISOString()).toBe('2026-08-04T06:00:00.000Z');
  });

  it('applies daylight saving time for zones that have it', () => {
    expect(parseSourceHour('2026-01-15 09:00', 'America/New_York')?.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(parseSourceHour('2026-07-15 09:00', 'America/New_York')?.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('takes an explicit offset as is, whatever the view timezone', () => {
    expect(parseSourceHour('2026-08-04T06:00:00Z', 'America/Bogota')?.toISOString()).toBe('2026-08-04T06:00:00.000Z');
    expect(parseSourceHour('2026-08-04T06:00:00-05:00', 'UTC')?.toISOString()).toBe('2026-08-04T11:00:00.000Z');
  });

  it('rejects day/month orders it cannot disambiguate, and impossible values', () => {
    for (const value of ['04/08/2026 06:00', '8/4/2026 6:00 AM', '2026-08-04', '2026-13-04 06:00', '2026-08-04 24:00', '2026-02-31 10:00', '2026-02-31T10:00:00Z', '2026-04-31 06:00', '']) {
      expect(parseSourceHour(value, 'America/Bogota')).toBeUndefined();
    }
  });
});

describe('parseSourceHour around daylight saving changes', () => {
  it('rejects a wall time that does not exist (spring gap) or exists twice (autumn overlap)', () => {
    expect(parseSourceHour('2026-03-08 02:30', 'America/New_York')).toBeUndefined();
    expect(parseSourceHour('2026-11-01 01:30', 'America/New_York')).toBeUndefined();
    // The hours next to the change are unambiguous and still accepted.
    expect(parseSourceHour('2026-03-08 03:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(parseSourceHour('2026-11-01 02:30', 'America/New_York')?.toISOString()).toBe('2026-11-01T07:30:00.000Z');
  });

  it('accepts every hour of a day in Bogota, which has no daylight saving', () => {
    for (let hour = 0; hour < 24; hour += 1) expect(parseSourceHour(`2026-08-04 ${String(hour).padStart(2, '0')}:00`, 'America/Bogota')).toBeDefined();
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects anything else', () => {
    expect(isValidTimeZone('America/Bogota')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
