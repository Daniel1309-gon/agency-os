type Status = 'active' | 'available' | 'handoff' | 'online' | 'break' | 'offline';

interface StatusPillProps {
  status: Status;
  label?: string;
}

const defaultLabels: Record<Status, string> = {
  active: 'Sesión activa',
  available: 'Disponible',
  handoff: 'En relevo',
  online: 'En línea',
  break: 'En pausa',
  offline: 'Fuera de turno',
};

export function StatusPill({ status, label }: StatusPillProps) {
  return <span className={`status-pill status-pill--${status}`}><i aria-hidden="true" />{label ?? defaultLabels[status]}</span>;
}
