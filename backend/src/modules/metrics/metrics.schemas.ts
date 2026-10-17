import { z } from 'zod';
export { metricBatchSchema, type MetricBatchInput } from '@agency-os/shared';

export const metricQuerySchema = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), profileId: z.string().uuid().optional() });
