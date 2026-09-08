import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import { outboxEvents, rocketchatChannels, scheduledMessages, users } from '../../database/schema/index.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RocketChatClient } from './rocketchat.client.js';
import { ConfigService } from '../../config/config.service.js';

const messagePayload = z.object({ channelId: z.string().uuid().optional(), targetUserId: z.string().uuid().optional(), roomId: z.string().min(1).optional(), body: z.string().min(1).max(4000), scheduledMessageId: z.string().uuid().optional(), sourceMessageId: z.string().trim().min(1).max(160).optional() }).refine((value) => [value.channelId, value.targetUserId, value.roomId].filter(Boolean).length === 1);
const breakPayload = z.object({ breakId: z.string().uuid(), operatorId: z.string().uuid(), scheduledAt: z.string().optional() });

class PermanentDeliveryError extends Error {}

@Injectable()
export class CommunicationWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private tickPromise?: Promise<void>;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly rocketchat: RocketChatClient,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('DATABASE_RUNTIME_ROLE') !== 'worker') return;
    this.timer = setInterval(() => this.startTick(), 1_000);
    this.startTick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.tickPromise;
  }

  private startTick(): void {
    if (this.tickPromise) return;
    this.tickPromise = this.tick()
      .catch((error) => this.logger.error('Outbox worker tick failed', { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => { this.tickPromise = undefined; });
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.enqueueDueScheduled();
      const events = await this.outbox.claim(25);
      await Promise.all(events.map((event) => this.dispatch(event)));
    } finally {
      this.running = false;
    }
  }

  private async enqueueDueScheduled(): Promise<void> {
    await this.db.transaction(async () => {
      const result = await this.db.db.execute(sql`SELECT id FROM scheduled_messages WHERE status = 'PENDING' AND scheduled_for <= now() ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 25`);
      for (const raw of result.rows) {
        const id = String((raw as { id: string }).id);
        const [message] = await this.db.db.update(scheduledMessages).set({ status: 'QUEUED', attempts: sql`${scheduledMessages.attempts} + 1` }).where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.status, 'PENDING'), lte(scheduledMessages.scheduledFor, new Date()))).returning();
        if (!message) continue;
        await this.db.db.insert(outboxEvents).values({
          eventType: 'rocketchat.message.send',
          aggregateType: 'scheduled_message',
          aggregateId: message.id,
          payload: { ...(message.channelId ? { channelId: message.channelId } : { targetUserId: message.targetUserId }), body: message.body, scheduledMessageId: message.id },
        });
      }
    });
  }

  private async dispatch(event: typeof outboxEvents.$inferSelect): Promise<void> {
    try {
      if (event.eventType === 'rocketchat.message.send') {
        const payload = messagePayload.parse(event.payload);
        const roomId = await this.resolveRoom(payload);
        await this.rocketchat.sendMessage(roomId, payload.body, `agency-outbox-${event.id}`, payload.sourceMessageId);
      } else if (event.eventType === 'break.reminder') {
        const payload = breakPayload.parse(event.payload);
        const [user] = await this.db.db.select({ roomId: users.rocketchatDirectRoomId }).from(users).where(eq(users.id, payload.operatorId)).limit(1);
        if (!user?.roomId) throw new PermanentDeliveryError('Operator has no Rocket.Chat direct room mapping');
        await this.rocketchat.sendMessage(user.roomId, `Tu break programado comienza a las ${payload.scheduledAt ?? 'hora asignada'}.`, `agency-outbox-${event.id}`);
      } else {
        throw new PermanentDeliveryError(`Unsupported outbox event ${event.eventType}`);
      }
      const markedSent = await this.outbox.markSent(event.id, event.leaseToken);
      if (markedSent && event.eventType === 'rocketchat.message.send') {
        const payload = messagePayload.parse(event.payload);
        if (payload.scheduledMessageId) await this.db.db.update(scheduledMessages).set({ status: 'SENT', sentAt: new Date(), lastError: null }).where(eq(scheduledMessages.id, payload.scheduledMessageId));
      }
    } catch (error) {
      const permanent = error instanceof PermanentDeliveryError || event.attempts >= 8;
      const message = error instanceof Error ? error.message : 'Unknown delivery error';
      const scheduledMessageId = typeof event.payload === 'object' && event.payload !== null && typeof event.payload.scheduledMessageId === 'string'
        ? event.payload.scheduledMessageId
        : undefined;
      const markedFailed = await this.outbox.markFailed(event.id, message, event.attempts, permanent, event.leaseToken);
      if (markedFailed && scheduledMessageId) {
        await this.db.db.update(scheduledMessages).set({ status: permanent ? 'FAILED' : 'QUEUED', attempts: event.attempts, lastError: message.slice(0, 1000) }).where(eq(scheduledMessages.id, scheduledMessageId));
      }
      this.logger.warn('Outbox delivery failed', { eventId: event.id, eventType: event.eventType, attempts: event.attempts, permanent, error: message });
    }
  }

  private async resolveRoom(payload: z.infer<typeof messagePayload>): Promise<string> {
    if (payload.roomId) return payload.roomId;
    if (payload.channelId) {
      const [channel] = await this.db.db.select({ roomId: rocketchatChannels.rcRoomId }).from(rocketchatChannels).where(and(eq(rocketchatChannels.id, payload.channelId), eq(rocketchatChannels.isActive, true))).limit(1);
      if (!channel) throw new PermanentDeliveryError('Rocket.Chat channel mapping not found');
      return channel.roomId;
    }
    const [user] = await this.db.db.select({ roomId: users.rocketchatDirectRoomId }).from(users).where(eq(users.id, payload.targetUserId!)).limit(1);
    if (!user?.roomId) throw new PermanentDeliveryError('Rocket.Chat direct room mapping not found');
    return user.roomId;
  }
}
