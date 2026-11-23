import type { CafeteriaOrder, CafeteriaOrderStatus } from '@agency-os/shared';

export interface CafeteriaProductFormValues {
  sku: string;
  name: string;
  category: string;
  description: string;
  priceCop: string;
  prepMinutes: string;
  pickupDeadlineMinutes: string;
}

export interface CreateCafeteriaProductPayload {
  sku: string;
  name: string;
  category: string;
  description?: string;
  priceCop: number;
  prepMinutes?: number;
  pickupDeadlineMinutes: number;
}

export interface UpdateCafeteriaProductPayload {
  name?: string;
  category?: string;
  priceCop?: number;
  prepMinutes?: number;
  pickupDeadlineMinutes?: number;
  isAvailable?: boolean;
}

export interface SalesTopItem {
  name: string;
  quantity: number;
  revenueCop: number;
}

export interface CafeteriaSalesSummary {
  totalOrders: number;
  deliveredCount: number;
  deliveredTotalCop: number;
  averageTicketCop: number;
  cancelledCount: number;
  expiredCount: number;
  inProgressCount: number;
  topItems: SalesTopItem[];
}

const ORDER_STATUS_LABELS: Record<CafeteriaOrderStatus, string> = {
  PLACED: 'Recibido',
  ACCEPTED: 'Aceptado',
  PREPARING: 'En preparación',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
};

export function cafeteriaOrderStatusLabel(status: CafeteriaOrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

export function formatCafeteriaCop(value: string | number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value));
}

export function buildCreateProductPayload(values: CafeteriaProductFormValues): CreateCafeteriaProductPayload {
  const sku = values.sku.trim();
  const name = values.name.trim();
  const category = values.category.trim();
  if (!sku) throw new Error('El SKU es obligatorio.');
  if (!name) throw new Error('El nombre del producto es obligatorio.');
  if (!category) throw new Error('La categoría es obligatoria.');

  const priceCop = Number(values.priceCop);
  if (!Number.isFinite(priceCop) || priceCop <= 0 || priceCop > 10_000_000) {
    throw new Error('El precio debe ser un número positivo en COP.');
  }

  const pickupDeadlineMinutes = values.pickupDeadlineMinutes.trim() === '' ? 30 : Number(values.pickupDeadlineMinutes);
  if (!Number.isInteger(pickupDeadlineMinutes) || pickupDeadlineMinutes < 1 || pickupDeadlineMinutes > 1440) {
    throw new Error('El límite de retiro debe ser un entero entre 1 y 1440 minutos.');
  }

  const payload: CreateCafeteriaProductPayload = { sku, name, category, priceCop, pickupDeadlineMinutes };
  const description = values.description.trim();
  if (description) payload.description = description;
  if (values.prepMinutes.trim() !== '') {
    const prepMinutes = Number(values.prepMinutes);
    if (!Number.isInteger(prepMinutes) || prepMinutes < 0 || prepMinutes > 1440) {
      throw new Error('El tiempo de preparación debe ser un entero entre 0 y 1440 minutos.');
    }
    payload.prepMinutes = prepMinutes;
  }
  return payload;
}

export function buildSalesOrdersQuery(filters: { from?: string; to?: string; status?: string; limit?: number }): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.status) params.set('status', filters.status);
  params.set('limit', String(filters.limit ?? 500));
  return `/cafeteria/orders?${params.toString()}`;
}

export function summarizeCafeteriaSales(orders: readonly CafeteriaOrder[]): CafeteriaSalesSummary {
  let deliveredCount = 0;
  let deliveredTotalCop = 0;
  let cancelledCount = 0;
  let expiredCount = 0;
  let inProgressCount = 0;
  const itemTotals = new Map<string, SalesTopItem>();

  for (const order of orders) {
    if (order.status === 'DELIVERED') {
      deliveredCount += 1;
      deliveredTotalCop += Number(order.totalCop);
      for (const item of order.items) {
        const current = itemTotals.get(item.productNameSnapshot) ?? { name: item.productNameSnapshot, quantity: 0, revenueCop: 0 };
        current.quantity += item.quantity;
        current.revenueCop += Number(item.lineTotalCop);
        itemTotals.set(item.productNameSnapshot, current);
      }
    } else if (order.status === 'CANCELLED') {
      cancelledCount += 1;
    } else if (order.status === 'EXPIRED') {
      expiredCount += 1;
    } else {
      inProgressCount += 1;
    }
  }

  const topItems = [...itemTotals.values()]
    .sort((left, right) => right.quantity - left.quantity || right.revenueCop - left.revenueCop || left.name.localeCompare(right.name))
    .slice(0, 5);

  return {
    totalOrders: orders.length,
    deliveredCount,
    deliveredTotalCop,
    averageTicketCop: deliveredCount ? deliveredTotalCop / deliveredCount : 0,
    cancelledCount,
    expiredCount,
    inProgressCount,
    topItems,
  };
}
