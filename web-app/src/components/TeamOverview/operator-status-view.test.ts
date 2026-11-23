import { describe, expect, it } from 'vitest';
import type { OperatorStatusSnapshot } from '@agency-os/shared';
import { applyOperatorSnapshot, mergeOperatorStatuses, operatorStatusCopy } from './operator-status-view';

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

  it('ignores out-of-order incremental updates with a lower seq (OPS-04)', () => {
    const newer = status({ status: 'BREAK', reason: 'BREAK_IN_PROGRESS', seq: 200 });
    const stale = status({ status: 'ONLINE', reason: 'SESSION_ACTIVE', seq: 150 });

    expect(mergeOperatorStatuses([newer], [stale])).toEqual([newer]);
  });

  it('keeps newer per-operator state when a stale snapshot arrives out of order (OPS-04)', () => {
    const newer = status({ status: 'BREAK', reason: 'BREAK_IN_PROGRESS', seq: 200 });
    const staleSnapshot = [status({ status: 'ONLINE', reason: 'SESSION_ACTIVE', seq: 100 })];

    expect(applyOperatorSnapshot([newer], staleSnapshot)).toEqual([newer]);
  });

  it('replaces state when a newer snapshot arrives and drops removed operators (OPS-04)', () => {
    const removed = status({ operatorId: '22222222-2222-4222-8222-222222222222', fullName: 'Ana Torres', seq: 100 });
    const current = status({ status: 'ONLINE', seq: 100 });
    const nextSnapshot = [status({ status: 'OFFLINE', reason: 'NO_ACTIVE_SESSION', seq: 300 })];

    expect(applyOperatorSnapshot([removed, current], nextSnapshot)).toEqual(nextSnapshot);
  });
});
