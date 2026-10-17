import { z } from 'zod';

export const recurrenceFrequencySchema = z.enum(['DAILY', 'WEEKLY']);
export type RecurrenceFrequency = z.infer<typeof recurrenceFrequencySchema>;

/**
 * Recurrencia de un mensaje programado. La hora la aporta `scheduledFor`; la
 * regla solo dice cada cuánto se repite. `until` es una fecha local de Bogotá e
 * incluye ese día. Los días van en la convención de JavaScript (0 domingo).
 */
export const recurrenceRuleSchema = z.object({
  frequency: recurrenceFrequencySchema,
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: z.string().date().optional(),
}).strict().refine(
  (rule) => rule.frequency === 'DAILY' ? !rule.weekdays?.length : Boolean(rule.weekdays?.length),
  'WEEKLY recurrence requires at least one weekday',
);
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const scheduledMessageStatusSchema = z.enum(['PENDING', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED']);
export type ScheduledMessageStatus = z.infer<typeof scheduledMessageStatusSchema>;

export const channelRecordSchema = z.object({
  id: z.string().uuid(),
  crewId: z.string().uuid().nullable(),
  rcRoomId: z.string(),
  name: z.string(),
  type: z.enum(['CHANNEL', 'GROUP', 'DM']),
  purpose: z.enum(['CREW', 'ALERTS', 'GENERAL', 'BOT']),
  isActive: z.boolean(),
}).strict();
export type ChannelRecord = z.infer<typeof channelRecordSchema>;

export const scheduledMessageRecordSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  targetUserId: z.string().uuid().nullable(),
  body: z.string(),
  scheduledFor: z.string().datetime({ offset: true }),
  recurrenceRule: recurrenceRuleSchema.nullable(),
  status: scheduledMessageStatusSchema,
  sentAt: z.string().datetime({ offset: true }).nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
}).strict();
export type ScheduledMessageRecord = z.infer<typeof scheduledMessageRecordSchema>;
