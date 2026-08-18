import { describe, expect, it } from 'vitest';
import { normalizeRocketChatWebhook, stripBotTrigger } from './bot-webhook.js';

const payload = {
  token: 'webhook-token',
  user_id: 'rocket-user',
  channel_id: 'rocket-room',
  message_id: 'rocket-message',
  timestamp: '2026-08-18T15:00:00.000Z',
  text: 'ayuda ¿cómo consulto mi turno?',
  trigger_word: 'ayuda',
};

describe('Rocket.Chat webhook boundary', () => {
  it('normalizes the native outgoing integration payload', () => {
    expect(normalizeRocketChatWebhook(payload)).toEqual({
      token: 'webhook-token',
      userId: 'rocket-user',
      roomId: 'rocket-room',
      messageId: 'rocket-message',
      timestamp: new Date('2026-08-18T15:00:00.000Z'),
      text: 'ayuda ¿cómo consulto mi turno?',
      triggerWord: 'ayuda',
    });
  });

  it('rejects malformed native payloads without throwing at the webhook boundary', () => {
    expect(normalizeRocketChatWebhook({ ...payload, channel_id: undefined })).toBeUndefined();
  });

  it('removes only the configured trigger at the beginning', () => {
    expect(stripBotTrigger('  ayuda ¿qué puedes hacer?', 'ayuda')).toBe('¿qué puedes hacer?');
    expect(stripBotTrigger('ayudante ¿qué puedes hacer?', 'ayuda')).toBeUndefined();
    expect(stripBotTrigger('¿qué puedes hacer?', 'ayuda')).toBeUndefined();
  });
});
