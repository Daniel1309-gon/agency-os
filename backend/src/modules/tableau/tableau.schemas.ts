import { z } from 'zod';

export const tableauViewSchema = z.object({ name: z.string().trim().min(1).max(160), siteId: z.string().trim().min(1).max(160), viewId: z.string().trim().min(1).max(320), sourceTimezone: z.string().trim().min(1).max(80).default('America/Bogota'), kind: z.enum(['POINTS_HOURLY', 'METRICS', 'PAYROLL', 'ICEBREAKERS']), columnMapping: z.record(z.string()).default({}) });
export const tableauRunSchema = z.object({ viewId: z.string().uuid(), businessDate: z.string().date() });
export type TableauViewInput = z.infer<typeof tableauViewSchema>;
export type TableauRunInput = z.infer<typeof tableauRunSchema>;
