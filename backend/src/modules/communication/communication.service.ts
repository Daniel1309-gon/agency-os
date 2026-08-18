import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { crewMembers, crews, notifications, rocketchatChannels, scheduledMessages } from '../../database/schema/index.js';
import type { ChannelInput, MessageInput, ScheduledMessageInput } from './communication.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';

type ChatActor = Pick<AccessTokenClaims, 'sub' | 'role'>;

@Injectable()
export class CommunicationService {
  constructor(private readonly db: DatabaseService, private readonly outbox: OutboxService, private readonly audit: AuditService) {}

  async channels(actor: ChatActor) {
    if (this.isGlobal(actor)) return this.db.db.select().from(rocketchatChannels).where(eq(rocketchatChannels.isActive, true));
    if (actor.role === 'COORDINADOR') {
      return this.db.db.select().from(rocketchatChannels).where(and(
        eq(rocketchatChannels.isActive, true),
        or(
          isNull(rocketchatChannels.crewId),
          sql`exists (select 1 from ${crews} where ${crews.id} = ${rocketchatChannels.crewId} and ${crews.coordinatorId} = ${actor.sub} and ${crews.isActive} = true)`,
        ),
      ));
    }
    return this.db.db.select().from(rocketchatChannels).where(and(eq(rocketchatChannels.isActive, true), isNull(rocketchatChannels.crewId)));
  }

  async createChannel(input: ChannelInput, actor: ChatActor) {
    if (!this.isGlobal(actor)) {
      if (actor.role === 'COORDINADOR') {
        if (!input.crewId || !(await this.managesCrew(actor.sub, input.crewId))) throw new ForbiddenException('Coordinator cannot manage this crew channel');
      } else if (input.crewId) {
        throw new ForbiddenException('Role cannot manage crew channels');
      }
    }
    const [row] = await this.db.db.insert(rocketchatChannels).values(input).returning();
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'rocketchat.channel.created', entityType: 'rocketchat_channel', entityId: row.id, result: 'SUCCESS', metadata: { crewId: input.crewId } });
    return row;
  }

  async message(input: MessageInput, actor: ChatActor) {
    await this.assertTargetAllowed(input, actor);
    const outboxId = await this.outbox.enqueue('rocketchat.message.send', 'message', undefined, { ...input, actorId: actor.sub });
    return { queued: true, outboxId };
  }

  async schedule(input: ScheduledMessageInput, actor: ChatActor) {
    await this.assertTargetAllowed(input, actor);
    const [row] = await this.db.db.insert(scheduledMessages).values({ channelId: input.channelId, targetUserId: input.targetUserId, body: input.body, scheduledFor: new Date(input.scheduledFor), createdBy: actor.sub }).returning({ id: scheduledMessages.id, status: scheduledMessages.status, scheduledFor: scheduledMessages.scheduledFor });
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'rocketchat.message.scheduled', entityType: 'scheduled_message', entityId: row.id, result: 'SUCCESS' });
    return row;
  }
  async scheduled(actor: ChatActor) {
    const scope = this.isGlobal(actor)
      ? undefined
      : and(
          eq(scheduledMessages.createdBy, actor.sub),
          or(
            sql`exists (
              select 1 from rocketchat_channels channel
              where channel.id = ${scheduledMessages.channelId}
                and channel.is_active = true
                and (
                  channel.crew_id is null
                  or exists (
                    select 1 from crews crew
                    where crew.id = channel.crew_id
                      and crew.coordinator_id = ${actor.sub}
                      and crew.is_active = true
                  )
                )
            )`,
            sql`exists (
              select 1 from crew_members member
              inner join crews crew on crew.id = member.crew_id
              where member.user_id = ${scheduledMessages.targetUserId}
                and crew.coordinator_id = ${actor.sub}
                and crew.is_active = true
                and member.valid_range @> now()
            )`,
          ),
        );
    return this.db.db.select({ id: scheduledMessages.id, channelId: scheduledMessages.channelId, targetUserId: scheduledMessages.targetUserId, body: scheduledMessages.body, scheduledFor: scheduledMessages.scheduledFor, recurrenceRule: scheduledMessages.recurrenceRule, status: scheduledMessages.status, sentAt: scheduledMessages.sentAt, attempts: scheduledMessages.attempts, lastError: scheduledMessages.lastError, createdBy: scheduledMessages.createdBy }).from(scheduledMessages).where(scope).orderBy(desc(scheduledMessages.scheduledFor));
  }

  async cancelScheduled(id: string, actor: ChatActor) {
    const [message] = await this.db.db.select({ channelId: scheduledMessages.channelId, targetUserId: scheduledMessages.targetUserId, body: scheduledMessages.body }).from(scheduledMessages).where(and(eq(scheduledMessages.id, id), this.isGlobal(actor) ? undefined : eq(scheduledMessages.createdBy, actor.sub), eq(scheduledMessages.status, 'PENDING'))).limit(1);
    if (!message) throw new NotFoundException('Scheduled message not found or already processed');
    await this.assertTargetAllowed({ channelId: message.channelId ?? undefined, targetUserId: message.targetUserId ?? undefined, body: message.body }, actor);
    const [row] = await this.db.db.update(scheduledMessages).set({ status: 'CANCELLED' }).where(and(eq(scheduledMessages.id, id), this.isGlobal(actor) ? undefined : eq(scheduledMessages.createdBy, actor.sub), eq(scheduledMessages.status, 'PENDING'))).returning({ id: scheduledMessages.id, status: scheduledMessages.status });
    if (!row) throw new NotFoundException('Scheduled message not found or already processed');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'rocketchat.message.cancelled', entityType: 'scheduled_message', entityId: row.id, result: 'SUCCESS' });
    return row;
  }
  async userNotifications(userId: string) { return this.db.db.select().from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)); }
  async readNotification(id: string, userId: string) { const [row] = await this.db.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id, readAt: notifications.readAt }); if (!row) throw new NotFoundException('Notification not found'); return row; }

  private isGlobal(actor: ChatActor): boolean {
    return actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO';
  }

  private async managesCrew(coordinatorId: string, crewId: string): Promise<boolean> {
    const [managed] = await this.db.db.select({ id: crews.id }).from(crews).where(and(eq(crews.id, crewId), eq(crews.coordinatorId, coordinatorId), eq(crews.isActive, true))).limit(1);
    return Boolean(managed);
  }

  private async assertTargetAllowed(input: MessageInput | ScheduledMessageInput, actor: ChatActor): Promise<void> {
    if (this.isGlobal(actor)) return;
    if (input.channelId) {
      const [channel] = await this.db.db.select({ crewId: rocketchatChannels.crewId }).from(rocketchatChannels).where(and(eq(rocketchatChannels.id, input.channelId), eq(rocketchatChannels.isActive, true))).limit(1);
      if (!channel) throw new NotFoundException('Rocket.Chat channel mapping not found');
      if (!channel.crewId) return;
      if (actor.role === 'COORDINADOR' && await this.managesCrew(actor.sub, channel.crewId)) return;
      throw new ForbiddenException('Message target is outside the actor crew scope');
    }
    if (actor.role === 'COORDINADOR' && input.targetUserId) {
      const [member] = await this.db.db
        .select({ id: crewMembers.id })
        .from(crewMembers)
        .innerJoin(crews, eq(crews.id, crewMembers.crewId))
        .where(and(eq(crewMembers.userId, input.targetUserId), eq(crews.coordinatorId, actor.sub), eq(crews.isActive, true), sql`${crewMembers.validRange} @> now()`))
        .limit(1);
      if (member) return;
    }
    throw new ForbiddenException('Message target is outside the actor crew scope');
  }
}
