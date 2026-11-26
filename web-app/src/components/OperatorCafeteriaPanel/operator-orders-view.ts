import type { CafeteriaOrder, CafeteriaOrderStatus } from '@agency-os/shared';

const statusCopy: Record<CafeteriaOrderStatus, { label: string; inProgress: boolean }> = {
  PLACED: { label: 'Recibido', inProgress: true },
  ACCEPTED: { label: 'Aceptado', inProgress: true },
  PREPARING: { label: 'En preparación', inProgress: true },
  READY: { label: 'Listo para recoger', inProgress: true },
  DELIVERED: { label: 'Entregado', inProgress: false },
  CANCELLED: { label: 'Cancelado', inProgress: false },
  EXPIRED: { label: 'Expirado', inProgress: false },
};

export function operatorOrderStatusCopy(status: CafeteriaOrderStatus): { label: string; inProgress: boolean } {
  return statusCopy[status];
}

/** Mirrors the backend rule: an operator may withdraw their order only before the kitchen accepts it. */
export function canOperatorCancel(order: CafeteriaOrder): boolean {
  return order.status === 'PLACED';
}

export function pickupCopy(order: CafeteriaOrder): string | null {
  if (order.status !== 'READY' || !order.pickupDeadlineAt) return null;
  const time = new Date(order.pickupDeadlineAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' });
  return `Retíralo antes de las ${time}`;
}

export function recentOrders(orders: CafeteriaOrder[], limit: number): CafeteriaOrder[] {
  return [...orders].sort((left, right) => right.placedAt.localeCompare(left.placedAt)).slice(0, limit);
}
