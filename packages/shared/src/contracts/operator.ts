import { z } from 'zod';

const mutableSessionStatusSchema = z.enum(['LAUNCHING', 'ACTIVE', 'ERROR', 'CLOSED']);

export const sessionCreateSchema = z.object({
  profileId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  chromeProfileDir: z.string().trim().min(1).max(160),
}).strict();

export const sessionPatchSchema = z.object({
  status: mutableSessionStatusSchema,
  version: z.number().int().positive(),
  errorCode: z.string().max(80).optional(),
  errorDetail: z.string().max(500).optional(),
}).strict();

export const sessionCloseSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export const metricEventSchema = z.object({
  dedupeKey: z.string().trim().min(1).max(200),
  profileId: z.string().uuid(),
  eventType: z.string().trim().min(1).max(80),
  points: z.number().finite().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()).default({}),
}).strict();

export const metricBatchSchema = z.object({
  events: z.array(metricEventSchema).min(1).max(500),
}).strict();

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;
export type SessionPatchInput = z.infer<typeof sessionPatchSchema>;
export type SessionCloseInput = z.infer<typeof sessionCloseSchema>;
export type MetricEventInput = z.infer<typeof metricEventSchema>;
export type MetricBatchInput = z.infer<typeof metricBatchSchema>;
