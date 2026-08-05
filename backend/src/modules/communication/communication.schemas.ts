import { z } from 'zod';
export const channelSchema = z.object({ crewId: z.string().uuid().optional(), rcRoomId: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(160), type: z.enum(['CHANNEL', 'GROUP', 'DM']), purpose: z.enum(['CREW', 'ALERTS', 'GENERAL', 'BOT']) });
const messageFields = z.object({ channelId: z.string().uuid().optional(), targetUserId: z.string().uuid().optional(), body: z.string().trim().min(1).max(4000) });
export const messageSchema = messageFields.refine((value) => Boolean(value.channelId) !== Boolean(value.targetUserId), 'Exactly one message target is required');
export const scheduledMessageSchema = messageFields.extend({ scheduledFor: z.string().datetime({ offset: true }), recurrenceRule: z.string().max(300).optional() }).refine((value) => Boolean(value.channelId) !== Boolean(value.targetUserId), 'Exactly one message target is required');
export type ChannelInput = z.infer<typeof channelSchema>;
export type MessageInput = z.infer<typeof messageSchema>;
export type ScheduledMessageInput = z.infer<typeof scheduledMessageSchema>;
