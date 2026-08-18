import { z } from 'zod';
export { botWebhookSchema, normalizeRocketChatWebhook, stripBotTrigger } from './bot-webhook.js';
export type { BotWebhookInput } from './bot-webhook.js';
export const channelSchema = z.object({ crewId: z.string().uuid().optional(), rcRoomId: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(160), type: z.enum(['CHANNEL', 'GROUP', 'DM']), purpose: z.enum(['CREW', 'ALERTS', 'GENERAL', 'BOT']) });
const messageFields = z.object({ channelId: z.string().uuid().optional(), targetUserId: z.string().uuid().optional(), body: z.string().trim().min(1).max(4000) });
export const messageSchema = messageFields.refine((value) => Boolean(value.channelId) !== Boolean(value.targetUserId), 'Exactly one message target is required');
export const scheduledMessageSchema = messageFields.extend({
  scheduledFor: z.string().datetime({ offset: true }),
  recurrenceRule: z.never({ message: 'Recurring messages are not supported in Delivery 1' }).optional(),
}).refine((value) => Boolean(value.channelId) !== Boolean(value.targetUserId), 'Exactly one message target is required');
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
