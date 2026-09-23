import { describe, expect, it } from 'vitest';
import { buildScheduledMessagePayload, recurrenceLabel, scheduledStatusLabel } from './scheduled-messages-view';

const base = { channelId: '', targetUserId: '11111111-1111-1111-1111-111111111111', body: '  Aviso  ', scheduledFor: '2026-09-23T14:05', frequency: 'NONE' as const, weekdays: [], until: '' };

describe('scheduled message form', () => {
  it('builds a one-off message with a single target', () => {
    expect(buildScheduledMessagePayload(base)).toEqual({
      targetUserId: base.targetUserId,
      body: 'Aviso',
      scheduledFor: new Date('2026-09-23T14:05').toISOString(),
    });
  });

  it('rejects a missing or doubled target', () => {
    expect(() => buildScheduledMessagePayload({ ...base, targetUserId: '' })).toThrow('Elige un canal o un operador');
    expect(() => buildScheduledMessagePayload({ ...base, channelId: '22222222-2222-2222-2222-222222222222' })).toThrow('Elige un canal o un operador');
    expect(() => buildScheduledMessagePayload({ ...base, body: '   ' })).toThrow('no puede estar vacío');
  });

  it('adds the weekly rule only with the selected days, sorted and deduplicated', () => {
    const payload = buildScheduledMessagePayload({ ...base, frequency: 'WEEKLY', weekdays: [5, 1, 5], until: '2026-12-31' });

    expect(payload.recurrenceRule).toEqual({ frequency: 'WEEKLY', weekdays: [1, 5], until: '2026-12-31' });
    expect(() => buildScheduledMessagePayload({ ...base, frequency: 'WEEKLY' })).toThrow('al menos un día');
    expect(() => buildScheduledMessagePayload({ ...base, frequency: 'WEEKLY', weekdays: [1], until: '31/12/2026' })).toThrow('fecha límite');
  });

  it('omits weekdays for a daily rule', () => {
    expect(buildScheduledMessagePayload({ ...base, frequency: 'DAILY', weekdays: [3] }).recurrenceRule).toEqual({ frequency: 'DAILY' });
  });

  it('labels recurrence and status for the list', () => {
    expect(recurrenceLabel(null)).toBe('Una vez');
    expect(recurrenceLabel({ frequency: 'DAILY' })).toBe('Cada día');
    expect(recurrenceLabel({ frequency: 'WEEKLY', weekdays: [1, 3] })).toBe('Semanal · Lun · Mié');
    expect(scheduledStatusLabel('SKIPPED')).toBe('Omitido');
    expect(scheduledStatusLabel('CANCELLED')).toBe('Cancelado');
  });
});
