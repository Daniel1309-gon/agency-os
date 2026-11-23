import type { OperatorStatus, OperatorStatusSnapshot } from '@agency-os/shared';

export interface OperatorStatusCopy {
  label: string;
  explanation: string;
}

const copyByStatus: Record<OperatorStatus, OperatorStatusCopy> = {
  ONLINE: { label: 'Activo', explanation: 'Tiene una sesión operativa abierta.' },
  BREAK: { label: 'En break', explanation: 'El descanso está registrado.' },
  ALERT: { label: 'Alerta', explanation: 'Requiere seguimiento del coordinador.' },
  OFFLINE: { label: 'Fuera de turno', explanation: 'No tiene una sesión operativa abierta.' },
};

export function operatorStatusCopy(status: OperatorStatus): OperatorStatusCopy {
  return copyByStatus[status];
}

function isStale(existing: OperatorStatusSnapshot | undefined, incoming: OperatorStatusSnapshot): boolean {
  return existing?.seq !== undefined && incoming.seq !== undefined && incoming.seq < existing.seq;
}

export function mergeOperatorStatuses(current: OperatorStatusSnapshot[], incoming: OperatorStatusSnapshot[]): OperatorStatusSnapshot[] {
  const byOperator = new Map(current.map((item) => [item.operatorId, item]));
  for (const item of incoming) {
    if (!isStale(byOperator.get(item.operatorId), item)) byOperator.set(item.operatorId, item);
  }
  return [...byOperator.values()].sort((left, right) => left.fullName.localeCompare(right.fullName, 'es'));
}

export function applyOperatorSnapshot(current: OperatorStatusSnapshot[], snapshot: OperatorStatusSnapshot[]): OperatorStatusSnapshot[] {
  const existingByOperator = new Map(current.map((item) => [item.operatorId, item]));
  return snapshot
    .map((item) => {
      const existing = existingByOperator.get(item.operatorId);
      return isStale(existing, item) && existing ? existing : item;
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, 'es'));
}
