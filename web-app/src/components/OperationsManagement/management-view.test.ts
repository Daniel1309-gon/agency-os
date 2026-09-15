import { describe, expect, it } from 'vitest';
import { buildAssignmentWindows, canManage, formatRange, groupAssignmentRecords, toIsoDateTime } from './management-view';
import type { AssignmentRecord } from '@agency-os/shared';

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

describe('buildAssignmentWindows', () => {
  it('expands selected weekdays inside an inclusive date period', () => {
    expect(buildAssignmentWindows({
      fromDate: '2026-09-21',
      toDate: '2026-10-30',
      weekdays: [1],
      dailyFrom: '06:05',
      dailyTo: '14:05',
    })).toEqual([
      { validFrom: '2026-09-21T11:05:00.000Z', validTo: '2026-09-21T19:05:00.000Z' },
      { validFrom: '2026-09-28T11:05:00.000Z', validTo: '2026-09-28T19:05:00.000Z' },
      { validFrom: '2026-10-05T11:05:00.000Z', validTo: '2026-10-05T19:05:00.000Z' },
      { validFrom: '2026-10-12T11:05:00.000Z', validTo: '2026-10-12T19:05:00.000Z' },
      { validFrom: '2026-10-19T11:05:00.000Z', validTo: '2026-10-19T19:05:00.000Z' },
      { validFrom: '2026-10-26T11:05:00.000Z', validTo: '2026-10-26T19:05:00.000Z' },
    ]);
  });

  it('moves the end to the next day for an overnight window', () => {
    expect(buildAssignmentWindows({
      fromDate: '2026-09-21',
      toDate: '2026-09-21',
      weekdays: [1],
      dailyFrom: '22:05',
      dailyTo: '06:05',
    })).toEqual([
      { validFrom: '2026-09-22T03:05:00.000Z', validTo: '2026-09-22T11:05:00.000Z' },
    ]);
  });

  it('rejects an empty weekday selection and equal times', () => {
    expect(() => buildAssignmentWindows({ fromDate: '2026-09-21', toDate: '2026-09-21', weekdays: [], dailyFrom: '06:05', dailyTo: '14:05' })).toThrow('Selecciona al menos un día');
    expect(() => buildAssignmentWindows({ fromDate: '2026-09-21', toDate: '2026-09-21', weekdays: [1], dailyFrom: '06:05', dailyTo: '06:05' })).toThrow('distintas');
  });
});

describe('groupAssignmentRecords', () => {
  it('shows a recurring window as one row while retaining concrete dates for actions', () => {
    const common = {
      profileId: '11111111-1111-4111-8111-111111111111',
      operatorId: '22222222-2222-4222-8222-222222222222',
      shiftId: null,
      status: 'ACTIVE',
      assignedBy: '33333333-3333-4333-8333-333333333333',
      endedAt: null,
      endReason: null,
      createdAt: '2026-09-01T12:00:00.000Z',
    } satisfies Omit<AssignmentRecord, 'id' | 'validRange'>;
    const rows = ['2026-09-21', '2026-09-28', '2026-10-05'].map((date, index) => ({
      ...common,
      id: `44444444-4444-4444-8444-44444444444${index + 1}`,
      validRange: `[${date}T11:05:00.000Z,${date}T19:05:00.000Z)`,
    }));

    const groups = groupAssignmentRecords(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].records).toHaveLength(3);
    expect(groups[0].records.map((record) => record.id)).toEqual(rows.map((record) => record.id));
  });
});
