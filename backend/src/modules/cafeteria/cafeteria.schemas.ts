import { z } from 'zod';

export const productSchema = z.object({ sku: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(160), description: z.string().max(1000).optional(), category: z.string().trim().min(1).max(80), priceCop: z.number().positive().max(10_000_000), prepMinutes: z.number().int().nonnegative().max(1440).optional(), pickupDeadlineMinutes: z.number().int().positive().max(1440).default(30), imageUri: z.string().url().optional() });
export const productUpdateSchema = productSchema.partial().extend({ isAvailable: z.boolean().optional() });
export const orderSchema = z.object({ items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(20), notes: z.string().max(300).optional() })).min(1).max(30), notes: z.string().max(1000).optional() });
export const orderStatusSchema = z.object({ status: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']), cancelReason: z.string().max(500).optional() });
export type ProductInput = z.infer<typeof productSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
