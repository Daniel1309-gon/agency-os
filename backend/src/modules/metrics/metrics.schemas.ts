import { z } from 'zod';

export const metricBatchSchema = z.object({
  events: z.array(z.object({
    dedupeKey: z.string().trim().min(1).max(200),
    profileId: z.string().uuid(),
    eventType: z.string().trim().min(1).max(80),
    points: z.number().finite().optional(),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.record(z.unknown()).default({}),
  })).min(1).max(500),
});

export const metricQuerySchema = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), profileId: z.string().uuid().optional() });
export type MetricBatchInput = z.infer<typeof metricBatchSchema>;
