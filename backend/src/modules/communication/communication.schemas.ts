import { z } from 'zod';
import { recurrenceRuleSchema, type RecurrenceRule } from '@agency-os/shared';
export { botWebhookSchema, normalizeRocketChatWebhook, stripBotTrigger } from './bot-webhook.js';
export type { BotWebhookInput } from './bot-webhook.js';
export const channelSchema = z.object({ crewId: z.string().uuid().optional(), rcRoomId: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(160), type: z.enum(['CHANNEL', 'GROUP', 'DM']), purpose: z.enum(['CREW', 'ALERTS', 'GENERAL', 'BOT']) });
const messageFields = z.object({ channelId: z.string().uuid().optional(), targetUserId: z.string().uuid().optional(), body: z.string().trim().min(1).max(4000) });
export const messageSchema = messageFields.refine((value) => Boolean(value.channelId) !== Boolean(value.targetUserId), 'Exactly one message target is required');
export const scheduledMessageSchema = messageFields.extend({
  scheduledFor: z.string().datetime({ offset: true }),
  recurrenceRule: recurrenceRuleSchema.optional(),
}).refine((value) => Boolean(value.channelId) !== Boolean(value.targetUserId), 'Exactly one message target is required')
  .refine((value) => {
    // La primera ocurrencia es `scheduledFor`: tiene que caer en un dia elegido y no
    // despues de `until`. Bogota es UTC-5 fijo, sin horario de verano.
    const rule = value.recurrenceRule;
    if (!rule) return true;
    const local = new Date(new Date(value.scheduledFor).getTime() - 5 * 3_600_000);
    if (rule.until && local.toISOString().slice(0, 10) > rule.until) return false;
    return rule.frequency !== 'WEEKLY' || Boolean(rule.weekdays?.includes(local.getUTCDay()));
  }, 'The first occurrence must fall on a selected weekday and not after until');

/**
 * Regla guardada como JSON en `scheduled_messages.recurrence_rule`. Un valor
 * ilegible se trata como mensaje puntual: la fila sigue siendo un mensaje que
 * alguien programó y perderlo en silencio sería peor que enviarlo una vez.
 */
export function parseStoredRecurrence(value: string | null): RecurrenceRule | null {
  if (!value) return null;
  try {
    return recurrenceRuleSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export const botKnowledgeSchema = z.object({
  version: z.number().int().positive(),
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(4000),
  keywords: z.array(z.string().trim().min(2).max(80)).min(1).max(30),
  crewIds: z.array(z.string().uuid()).max(50).default([]),
}).strict();
export const botKnowledgeFileSchema = botKnowledgeSchema.extend({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
});
export type ChannelInput = z.infer<typeof channelSchema>;
export type MessageInput = z.infer<typeof messageSchema>;
export type ScheduledMessageInput = z.infer<typeof scheduledMessageSchema>;
export type BotKnowledgeInput = z.input<typeof botKnowledgeSchema>;
export type BotKnowledge = z.output<typeof botKnowledgeSchema>;
export type BotKnowledgeFile = z.output<typeof botKnowledgeFileSchema>;
