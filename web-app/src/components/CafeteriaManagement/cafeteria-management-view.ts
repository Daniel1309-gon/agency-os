import type { CafeteriaOrderStatus } from '@agency-os/shared';

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

export interface CafeteriaProductEditValues {
  category: string;
  priceCop: string;
  prepMinutes: string;
  pickupDeadlineMinutes: string;
}

/** Inline row edit: category, price, preparation and pickup deadline (S3, FR-32). An empty preparation keeps the stored value. */
export function buildUpdateProductPayload(values: CafeteriaProductEditValues): UpdateCafeteriaProductPayload {
  const category = values.category.trim();
  if (!category) throw new Error('La categoría es obligatoria.');
  const priceCop = Number(values.priceCop);
  if (!values.priceCop.trim() || !Number.isFinite(priceCop) || priceCop <= 0) throw new Error('El precio debe ser un número positivo en COP.');
  const pickupDeadlineMinutes = Number(values.pickupDeadlineMinutes);
  if (!Number.isInteger(pickupDeadlineMinutes) || pickupDeadlineMinutes < 1 || pickupDeadlineMinutes > 1440) throw new Error('El límite de retiro debe ser un entero entre 1 y 1440 minutos.');
  const payload: UpdateCafeteriaProductPayload = { category, priceCop, pickupDeadlineMinutes };
  if (values.prepMinutes.trim()) {
    const prepMinutes = Number(values.prepMinutes);
    if (!Number.isInteger(prepMinutes) || prepMinutes < 0 || prepMinutes > 1440) throw new Error('La preparación debe ser un entero entre 0 y 1440 minutos.');
    payload.prepMinutes = prepMinutes;
  }
  return payload;
}

/** Rows requested for the history table; the closure KPIs come from the server summary. */
export const SALES_HISTORY_LIMIT = 500;

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
  params.set('limit', String(filters.limit ?? SALES_HISTORY_LIMIT));
  return `/cafeteria/orders?${params.toString()}`;
}

export function buildSalesSummaryQuery(filters: { from: string; to: string }): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  return `/cafeteria/sales/summary?${params.toString()}`;
}

/** The history table hit the server limit, so older orders in the range are not listed. */
export function isSalesHistoryTruncated(rowCount: number, limit: number = SALES_HISTORY_LIMIT): boolean {
  return rowCount >= limit;
}
