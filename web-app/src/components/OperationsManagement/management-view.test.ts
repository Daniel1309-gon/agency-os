import { describe, expect, it } from 'vitest';
import { buildAssignmentWindows, buildCrewMemberPayload, buildCrewPayload, buildShiftTemplatePayload, canManage, crossesMidnightFrom, daySpanLabel, formatRange, groupAssignmentRecords, shiftTimeLabel, toIsoDateTime, weekdaySummary, type ShiftTemplateFormValues } from './management-view';
import type { AssignmentRecord } from '@agency-os/shared';

const validTemplate: ShiftTemplateFormValues = {
  name: '  Turno mañana  ',
  startTime: '06:05',
  endTime: '14:05',
  breakMinutes: '',
  validFrom: '2026-09-21',
  validTo: '',
  weekdays: [3, 1, 1],
};

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

describe('buildShiftTemplatePayload', () => {
  it('trims the name, dedupes and sorts weekdays and defaults the break to zero', () => {
    expect(buildShiftTemplatePayload(validTemplate)).toEqual({
      name: 'Turno mañana',
      startTime: '06:05',
      endTime: '14:05',
      crossesMidnight: false,
      weekdays: [1, 3],
      breakMinutes: 0,
      validFrom: '2026-09-21',
    });
  });

  it('omits validTo when the template has open-ended validity', () => {
    const payload = buildShiftTemplatePayload({ ...validTemplate, validTo: '' });

    expect(payload).not.toHaveProperty('validTo');
    expect(buildShiftTemplatePayload({ ...validTemplate, validTo: '2026-12-31' }).validTo).toBe('2026-12-31');
  });

  it('binds the template to a crew only when one is chosen', () => {
    expect(buildShiftTemplatePayload(validTemplate)).not.toHaveProperty('crewId');
    expect(buildShiftTemplatePayload({ ...validTemplate, crewId: 'crew-1' }).crewId).toBe('crew-1');
  });

  it('derives crossesMidnight from the hours instead of asking for it', () => {
    expect(buildShiftTemplatePayload({ ...validTemplate, startTime: '22:05', endTime: '06:05' }).crossesMidnight).toBe(true);
    expect(buildShiftTemplatePayload({ ...validTemplate, startTime: '06:05', endTime: '14:05' }).crossesMidnight).toBe(false);
    expect(crossesMidnightFrom('22:05', '06:05')).toBe(true);
    expect(crossesMidnightFrom('', '06:05')).toBe(false);
  });

  it('rejects the cases the API would swallow or answer with a 500', () => {
    expect(() => buildShiftTemplatePayload({ ...validTemplate, name: '   ' })).toThrow('nombre de la plantilla es obligatorio');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, name: 'x'.repeat(161) })).toThrow('160 caracteres');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, endTime: '06:05' })).toThrow('deben ser distintas');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, startTime: '99:99' })).toThrow('no son válidas');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, weekdays: [] })).toThrow('al menos un día');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, breakMinutes: '481' })).toThrow('entre 0 y 480');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, breakMinutes: '30.5' })).toThrow('entre 0 y 480');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, validFrom: '2026-02-30' })).toThrow('no es válida');
    expect(() => buildShiftTemplatePayload({ ...validTemplate, validTo: '2026-09-20' })).toThrow('no puede terminar antes');
  });
});

describe('crews and crew members', () => {
  it('trims the crew name and omits an empty coordinator', () => {
    expect(buildCrewPayload({ name: '  Cuadrilla Tarde ', coordinatorId: '' })).toEqual({ name: 'Cuadrilla Tarde' });
    expect(buildCrewPayload({ name: 'Cuadrilla Tarde', coordinatorId: 'abc' })).toEqual({ name: 'Cuadrilla Tarde', coordinatorId: 'abc' });
    expect(() => buildCrewPayload({ name: '   ', coordinatorId: '' })).toThrow('nombre de la cuadrilla es obligatorio');
    expect(() => buildCrewPayload({ name: 'x'.repeat(161), coordinatorId: '' })).toThrow('160 caracteres');
  });

  it('converts the inclusive end date to the exclusive range the API stores', () => {
    // Bogotá es UTC-5 sin DST: medianoche local = 05:00Z. El rango de la API es [from, to).
    expect(buildCrewMemberPayload({ userId: 'op-1', validFrom: '2026-09-16', validTo: '2026-12-16' })).toEqual({
      userId: 'op-1',
      validFrom: '2026-09-16T05:00:00.000Z',
      validTo: '2026-12-17T05:00:00.000Z',
    });
  });

  it('allows a single-day membership and rejects an inverted or unknown one', () => {
    expect(buildCrewMemberPayload({ userId: 'op-1', validFrom: '2026-09-16', validTo: '2026-09-16' }).validTo).toBe('2026-09-17T05:00:00.000Z');
    expect(() => buildCrewMemberPayload({ userId: 'op-1', validFrom: '2026-09-16', validTo: '2026-09-15' })).toThrow('mismo día o después');
    expect(() => buildCrewMemberPayload({ userId: '', validFrom: '2026-09-16', validTo: '2026-09-20' })).toThrow('Selecciona un operador');
    expect(() => buildCrewMemberPayload({ userId: 'op-1', validFrom: '2026-02-30', validTo: '2026-09-20' })).toThrow('no es válida');
  });

  it('labels a membership span showing the last included day', () => {
    // La API guarda [2026-09-16T05:00Z, 2026-12-17T05:00Z): el último día incluido es el 16 de diciembre.
    expect(daySpanLabel('["2026-09-16 05:00:00+00","2026-12-17 05:00:00+00")')).toMatch(/16/);
    expect(daySpanLabel('["2026-09-16 05:00:00+00","2026-12-17 05:00:00+00")')).toMatch(/dic/i);
    expect(daySpanLabel(null)).toBe('Vigencia no disponible');
  });
});

describe('shift template labels', () => {
  it('summarizes weekday selections for the compact rows', () => {
    expect(weekdaySummary([1, 2, 3, 4, 5])).toBe('Lunes a viernes');
    expect(weekdaySummary([1, 2, 3, 4, 5, 6])).toBe('Lunes a sábado');
    expect(weekdaySummary([0, 1, 2, 3, 4, 5, 6])).toBe('Todos los días');
    expect(weekdaySummary([3, 1, 5])).toBe('Lun · Mié · Vie');
    expect(weekdaySummary([])).toBe('Sin días');
  });

  it('shortens API timestamps and marks the overnight flag', () => {
    expect(shiftTimeLabel('06:05:00', '14:05:00', false)).toBe('06:05–14:05');
    expect(shiftTimeLabel('22:05:00', '06:05:00', true)).toBe('22:05–06:05 (+1 día)');
  });
});
