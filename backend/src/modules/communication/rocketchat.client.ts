import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../../config/config.service.js';

const responseSchema = z.object({ success: z.boolean().optional(), message: z.object({ _id: z.string().optional() }).optional(), error: z.string().optional(), errorType: z.string().optional() }).passthrough();

@Injectable()
export class RocketChatClient {
  constructor(private readonly config: ConfigService) {}

  async sendMessage(roomId: string, body: string, idempotencyKey: string): Promise<void> {
    const baseUrl = this.config.get('ROCKETCHAT_BASE_URL');
    const token = this.config.get('ROCKETCHAT_TOKEN');
    const userId = this.config.get('ROCKETCHAT_USER_ID');
    if (!baseUrl || !token || !userId) throw new Error('Rocket.Chat delivery is not configured');
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/chat.sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auth-token': token, 'x-user-id': userId },
      body: JSON.stringify({ message: { rid: roomId, msg: body, _id: idempotencyKey } }),
      signal: AbortSignal.timeout(8_000),
    });
    const raw = await response.json().catch(() => ({}));
    const parsed = responseSchema.safeParse(raw);
    const duplicate = parsed.success && `${parsed.data.error ?? ''} ${parsed.data.errorType ?? ''}`.toLowerCase().includes('duplicate');
    if ((!response.ok || !parsed.success || parsed.data.success === false) && !duplicate) {
      throw new Error(`Rocket.Chat rejected the message (${response.status})`);
    }
  }
}
