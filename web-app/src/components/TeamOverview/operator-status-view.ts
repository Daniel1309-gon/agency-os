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

export function mergeOperatorStatuses(current: OperatorStatusSnapshot[], incoming: OperatorStatusSnapshot[]): OperatorStatusSnapshot[] {
  const byOperator = new Map(current.map((item) => [item.operatorId, item]));
  for (const item of incoming) byOperator.set(item.operatorId, item);
  return [...byOperator.values()].sort((left, right) => left.fullName.localeCompare(right.fullName, 'es'));
}
