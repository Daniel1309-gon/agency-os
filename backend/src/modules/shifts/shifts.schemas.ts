import { z } from 'zod';

export const shiftCreateSchema = z.object({ operatorId: z.string().uuid(), businessDate: z.string().date(), scheduledFrom: z.string().datetime({ offset: true }), scheduledTo: z.string().datetime({ offset: true }), templateId: z.string().uuid().optional(), notes: z.string().max(1000).optional() });
export const shiftStateSchema = z.object({});
export const shiftTemplateSchema = z.object({ name: z.string().trim().min(1).max(160), crewId: z.string().uuid().optional(), startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), crossesMidnight: z.boolean().default(false), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), breakMinutes: z.number().int().nonnegative().max(480).default(0), validFrom: z.string().date(), validTo: z.string().date().optional() });
export const shiftOverrideSchema = z.object({ operatorId: z.string().uuid(), validFrom: z.string().datetime({ offset: true }), validTo: z.string().datetime({ offset: true }), type: z.string().trim().min(1).max(32), reason: z.string().trim().min(1).max(1000) }).refine((value) => value.validFrom < value.validTo, 'validTo must be after validFrom');
export const effectiveTimeQuerySchema = z.object({ from: z.string().date(), to: z.string().date(), operatorId: z.string().uuid().optional() });
export type ShiftCreateInput = z.infer<typeof shiftCreateSchema>;
export type ShiftTemplateInput = z.infer<typeof shiftTemplateSchema>;
export type ShiftOverrideInput = z.infer<typeof shiftOverrideSchema>;
export type EffectiveTimeQueryInput = z.infer<typeof effectiveTimeQuerySchema>;
