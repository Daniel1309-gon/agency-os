import { describe, expect, it } from 'vitest';
import type { OperatorStatusSnapshot } from '@agency-os/shared';
import { mergeOperatorStatuses, operatorStatusCopy } from './operator-status-view';

const status = (overrides: Partial<OperatorStatusSnapshot>): OperatorStatusSnapshot => ({
  operatorId: '11111111-1111-4111-8111-111111111111',
  fullName: 'Valentina Ríos',
  status: 'ONLINE',
  reason: 'SESSION_ACTIVE',
  changedAt: '2026-08-21T08:00:00.000Z',
  ...overrides,
});

describe('operator status view model', () => {
  it('gives every backend status a readable label and explanation', () => {
    expect(operatorStatusCopy('ONLINE')).toEqual({ label: 'Activo', explanation: 'Tiene una sesión operativa abierta.' });
    expect(operatorStatusCopy('BREAK')).toEqual({ label: 'En break', explanation: 'El descanso está registrado.' });
    expect(operatorStatusCopy('ALERT')).toEqual({ label: 'Alerta', explanation: 'Requiere seguimiento del coordinador.' });
    expect(operatorStatusCopy('OFFLINE')).toEqual({ label: 'Fuera de turno', explanation: 'No tiene una sesión operativa abierta.' });
  });

  it('merges live changes by operator and keeps the board alphabetic', () => {
    const first = status({ operatorId: '11111111-1111-4111-8111-111111111111', fullName: 'Valentina Ríos' });
    const second = status({ operatorId: '22222222-2222-4222-8222-222222222222', fullName: 'Ana Torres', status: 'OFFLINE', reason: 'NO_ACTIVE_SESSION' });
    const changed = { ...first, status: 'BREAK' as const, reason: 'BREAK_IN_PROGRESS' };

    expect(mergeOperatorStatuses([first, second], [changed])).toEqual([second, changed]);
  });
});
