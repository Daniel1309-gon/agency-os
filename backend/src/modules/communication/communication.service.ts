import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { notifications, rocketchatChannels, scheduledMessages } from '../../database/schema/index.js';
import type { ChannelInput, MessageInput, ScheduledMessageInput } from './communication.schemas.js';

@Injectable()
export class CommunicationService {
  constructor(private readonly db: DatabaseService, private readonly outbox: OutboxService) {}
  async channels() { return this.db.db.select().from(rocketchatChannels).where(eq(rocketchatChannels.isActive, true)); }
  async createChannel(input: ChannelInput) { const [row] = await this.db.db.insert(rocketchatChannels).values(input).returning(); return row; }
  async message(input: MessageInput, actorId: string) { const outboxId = await this.outbox.enqueue('rocketchat.message.send', 'message', undefined, { ...input, actorId }); return { queued: true, outboxId }; }
  async schedule(input: ScheduledMessageInput, actorId: string) { const [row] = await this.db.db.insert(scheduledMessages).values({ ...input, channelId: input.channelId, targetUserId: input.targetUserId, scheduledFor: new Date(input.scheduledFor), recurrenceRule: input.recurrenceRule, createdBy: actorId }).returning({ id: scheduledMessages.id, status: scheduledMessages.status, scheduledFor: scheduledMessages.scheduledFor }); return row; }
  async scheduled(actorId?: string) { return this.db.db.select({ id: scheduledMessages.id, channelId: scheduledMessages.channelId, targetUserId: scheduledMessages.targetUserId, body: scheduledMessages.body, scheduledFor: scheduledMessages.scheduledFor, recurrenceRule: scheduledMessages.recurrenceRule, status: scheduledMessages.status, sentAt: scheduledMessages.sentAt, attempts: scheduledMessages.attempts, lastError: scheduledMessages.lastError, createdBy: scheduledMessages.createdBy }).from(scheduledMessages).where(actorId ? eq(scheduledMessages.createdBy, actorId) : undefined).orderBy(desc(scheduledMessages.scheduledFor)); }
  async cancelScheduled(id: string, actorId: string) { const [row] = await this.db.db.update(scheduledMessages).set({ status: 'CANCELLED' }).where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.createdBy, actorId), eq(scheduledMessages.status, 'PENDING'))).returning({ id: scheduledMessages.id, status: scheduledMessages.status }); if (!row) throw new NotFoundException('Scheduled message not found or already processed'); return row; }
  async userNotifications(userId: string) { return this.db.db.select().from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)); }
  async readNotification(id: string, userId: string) { const [row] = await this.db.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id, readAt: notifications.readAt }); if (!row) throw new NotFoundException('Notification not found'); return row; }
}
