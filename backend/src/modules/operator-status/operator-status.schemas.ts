import { z } from 'zod';
export const operatorStatusSchema = z.object({ status: z.enum(['ONLINE', 'BREAK', 'ALERT', 'OFFLINE']), reason: z.string().max(500).optional() });
export type OperatorStatusInput = z.infer<typeof operatorStatusSchema>;
