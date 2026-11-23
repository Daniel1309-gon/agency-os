import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../../config/config.service.js';

const responseSchema = z.object({ success: z.boolean().optional(), message: z.object({ _id: z.string().optional() }).optional(), error: z.string().optional(), errorType: z.string().optional() }).passthrough();

const membersResponseSchema = z.object({
  success: z.boolean().optional(),
  members: z.array(z.object({
    _id: z.string(),
    username: z.string().optional(),
    name: z.string().optional(),
  }).passthrough()).default([]),
  total: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
}).passthrough();

export interface RocketChatRoomMember {
  id: string;
  username: string | null;
  name: string | null;
}

const MEMBERS_PAGE_SIZE = 100;
const MAX_MEMBER_PAGES = 50;

@Injectable()
export class RocketChatClient {
  constructor(private readonly config: ConfigService) {}

  botUserId(): string | undefined {
    const id = this.config.get('ROCKETCHAT_USER_ID');
    return id ? id : undefined;
  }

  /**
   * `threadMessageId` cuelga la respuesta del mensaje que la provoco. En el canal del bot
   * eso evita que la duda de una persona notifique a todo el canal: quien no sigue el hilo
   * no recibe nada.
   */
  async sendMessage(roomId: string, body: string, idempotencyKey: string, threadMessageId?: string): Promise<void> {
    const baseUrl = this.config.get('ROCKETCHAT_BASE_URL');
    const token = this.config.get('ROCKETCHAT_TOKEN');
    const userId = this.config.get('ROCKETCHAT_USER_ID');
    if (!baseUrl || !token || !userId) throw new Error('Rocket.Chat delivery is not configured');
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/chat.sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auth-token': token, 'x-user-id': userId },
      body: JSON.stringify({ message: { rid: roomId, msg: body, _id: idempotencyKey, ...(threadMessageId ? { tmid: threadMessageId } : {}) } }),
      signal: AbortSignal.timeout(8_000),
    });
    const raw = await response.json().catch(() => ({}));
    const parsed = responseSchema.safeParse(raw);
    const duplicate = parsed.success && `${parsed.data.error ?? ''} ${parsed.data.errorType ?? ''}`.toLowerCase().includes('duplicate');
    if ((!response.ok || !parsed.success || parsed.data.success === false) && !duplicate) {
      throw new Error(`Rocket.Chat rejected the message (${response.status})`);
    }
  }

  /**
   * ADR 0010 (#1–#3): read-only paginated membership listing for drift detection.
   * Private crew rooms use `groups.members`; public channels use `channels.members`.
   * Never invokes invite/kick/admin endpoints.
   */
  async listRoomMembers(roomId: string, roomType: 'GROUP' | 'CHANNEL'): Promise<RocketChatRoomMember[]> {
    const baseUrl = this.config.get('ROCKETCHAT_BASE_URL');
    const token = this.config.get('ROCKETCHAT_TOKEN');
    const userId = this.config.get('ROCKETCHAT_USER_ID');
    if (!baseUrl || !token || !userId) throw new Error('Rocket.Chat delivery is not configured');

    const endpoint = roomType === 'GROUP' ? 'groups.members' : 'channels.members';
    const members = new Map<string, RocketChatRoomMember>();
    let offset = 0;

    for (let page = 0; page < MAX_MEMBER_PAGES; page += 1) {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/${endpoint}?roomId=${encodeURIComponent(roomId)}&count=${MEMBERS_PAGE_SIZE}&offset=${offset}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'x-auth-token': token, 'x-user-id': userId },
        signal: AbortSignal.timeout(8_000),
      });
      const raw = await response.json().catch(() => ({}));
      const parsed = membersResponseSchema.safeParse(raw);
      if (!response.ok || !parsed.success || parsed.data.success === false) {
        throw new Error(`Rocket.Chat rejected ${endpoint} (${response.status})`);
      }
      for (const member of parsed.data.members) {
        members.set(member._id, { id: member._id, username: member.username ?? null, name: member.name ?? null });
      }
      offset += parsed.data.members.length;
      if (parsed.data.members.length < MEMBERS_PAGE_SIZE) break;
      if (parsed.data.total !== undefined && offset >= parsed.data.total) break;
    }
    return [...members.values()];
  }
}
