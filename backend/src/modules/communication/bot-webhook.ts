import { z } from 'zod';

export const botWebhookSchema = z.object({
  token: z.string().trim().min(1).max(512),
  user_id: z.string().trim().min(1).max(160),
  channel_id: z.string().trim().min(1).max(160),
  message_id: z.string().trim().min(1).max(160),
  timestamp: z.coerce.date(),
  text: z.string().min(1).max(2000),
  trigger_word: z.string().trim().min(1).max(80),
}).strict();

export interface BotWebhookInput {
  token: string;
  userId: string;
  roomId: string;
  messageId: string;
  timestamp: Date;
  text: string;
  triggerWord: string;
}

export function normalizeRocketChatWebhook(payload: unknown): BotWebhookInput | undefined {
  const parsed = botWebhookSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return {
    token: parsed.data.token,
    userId: parsed.data.user_id,
    roomId: parsed.data.channel_id,
    messageId: parsed.data.message_id,
    timestamp: parsed.data.timestamp,
    text: parsed.data.text,
    triggerWord: parsed.data.trigger_word,
  };
}

export function stripBotTrigger(text: string, configuredTrigger: string): string | undefined {
  const trimmedText = text.trim();
  const trigger = configuredTrigger.trim();
  if (!trigger) return undefined;
  if (trimmedText.slice(0, trigger.length).toLocaleLowerCase() !== trigger.toLocaleLowerCase()) return undefined;
  const remainder = trimmedText.slice(trigger.length);
  if (remainder && !/^\s/.test(remainder)) return undefined;
  return remainder.trim();
}
