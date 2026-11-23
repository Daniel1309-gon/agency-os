import { z } from 'zod';

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine(isValidCalendarDate, 'Invalid calendar date');

const productFields = z.object({ sku: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(160), description: z.string().max(1000).optional(), category: z.string().trim().min(1).max(80), priceCop: z.number().positive().max(10_000_000), prepMinutes: z.number().int().nonnegative().max(1440).optional(), pickupDeadlineMinutes: z.number().int().positive().max(1440).optional(), imageUri: z.string().url().optional() });
export const productSchema = productFields.extend({ pickupDeadlineMinutes: z.number().int().positive().max(1440).default(30) });
// Built from the fields without defaults: zod 4 applies .default() inside .partial(),
// which would reset pickupDeadlineMinutes to 30 on every PATCH that omits it.
export const productUpdateSchema = productFields.partial().extend({ isAvailable: z.boolean().optional() });
export const orderSchema = z.object({ items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(20), notes: z.string().max(300).optional() })).min(1).max(30), notes: z.string().max(1000).optional() });
export const orderStatusSchema = z.object({ status: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']), cancelReason: z.string().max(500).optional() });
export const orderListQuerySchema = z.object({
  status: z.enum(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'EXPIRED']).optional(),
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: '`from` must be on or before `to`', path: ['to'] });
export type ProductInput = z.infer<typeof productSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
export type OrderListQueryInput = z.infer<typeof orderListQuerySchema>;
