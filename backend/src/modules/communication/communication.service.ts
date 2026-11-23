import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { crewMembers, crews, notifications, rocketchatChannels, scheduledMessages, users } from '../../database/schema/index.js';
import type { ChannelInput, ChannelUpdateInput, MessageInput, ScheduledMessageInput } from './communication.schemas.js';
import { parseStoredRecurrence } from './communication.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { RocketChatClient } from './rocketchat.client.js';

type ChatActor = Pick<AccessTokenClaims, 'sub' | 'role'>;

@Injectable()
export class CommunicationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Optional() private readonly rocketchat?: RocketChatClient,
  ) {}

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
        // ALERTS and BOT channels receive system-wide routing (ETL alerts, bot replies).
        if (input.purpose !== 'CREW') throw new ForbiddenException('Coordinator can only manage CREW-purpose channels');
      } else {
        // Global channels (no crew) carry agency-wide routing: only global roles map them.
        throw new ForbiddenException(input.crewId ? 'Role cannot manage crew channels' : 'Role cannot create global channels');
      }
    }
    const [row] = await this.db.db.insert(rocketchatChannels).values(input).returning();
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'rocketchat.channel.created', entityType: 'rocketchat_channel', entityId: row.id, result: 'SUCCESS', metadata: { crewId: input.crewId } });
    return row;
  }

  async updateChannel(id: string, input: ChannelUpdateInput, actor: ChatActor) {
    const updates: Partial<typeof rocketchatChannels.$inferInsert> = {};
    if (input.crewId !== undefined) updates.crewId = input.crewId;
    if (input.name !== undefined) updates.name = input.name;
    if (input.purpose !== undefined) updates.purpose = input.purpose;
    if (input.isActive !== undefined) updates.isActive = input.isActive;
    if (Object.keys(updates).length === 0) throw new BadRequestException('At least one channel field is required');

    const [existing] = await this.db.db.select().from(rocketchatChannels).where(eq(rocketchatChannels.id, id)).limit(1);
    if (!existing) throw new NotFoundException('Rocket.Chat channel mapping not found');

    if (!this.isGlobal(actor)) {
      if (actor.role !== 'COORDINADOR') {
        throw new ForbiddenException('Role cannot manage crew channels');
      }
      if (!existing.crewId || !(await this.managesCrew(actor.sub, existing.crewId))) {
        throw new ForbiddenException('Coordinator cannot manage this crew channel');
      }
      // ALERTS and BOT channels receive system-wide routing (ETL alerts, bot replies).
      if (existing.purpose !== 'CREW' || (input.purpose !== undefined && input.purpose !== 'CREW')) {
        throw new ForbiddenException('Coordinator can only manage CREW-purpose channels');
      }
      if (input.crewId !== undefined && input.crewId !== existing.crewId) {
        if (!input.crewId || !(await this.managesCrew(actor.sub, input.crewId))) {
          throw new ForbiddenException('Coordinator cannot reassign channel outside managed crews');
        }
      }
    }

    if (input.crewId) {
      const [crew] = await this.db.db.select({ id: crews.id }).from(crews).where(eq(crews.id, input.crewId)).limit(1);
      if (!crew) throw new NotFoundException('Crew not found');
    }

    const [row] = await this.db.db.update(rocketchatChannels).set(updates).where(eq(rocketchatChannels.id, id)).returning();
    await this.audit.record({
      actorType: 'USER',
      actorUserId: actor.sub,
      action: 'rocketchat.channel.updated',
      entityType: 'rocketchat_channel',
      entityId: row.id,
      result: 'SUCCESS',
      metadata: { crewId: row.crewId, status: row.isActive ? 'ACTIVE' : 'INACTIVE' },
    });
    return row;
  }

  /**
   * ADR 0010 (#1–#3): detect-only membership drift scan.
   * Compares active crew members in Agency OS against Rocket.Chat room members
   * without invoking any invite/kick/admin API.
   */
  async channelDrift(id: string, actor: ChatActor) {
    const [channel] = await this.db.db.select().from(rocketchatChannels).where(eq(rocketchatChannels.id, id)).limit(1);
    if (!channel) throw new NotFoundException('Rocket.Chat channel mapping not found');

    if (!this.isGlobal(actor)) {
      if (actor.role !== 'COORDINADOR' || !channel.crewId || !(await this.managesCrew(actor.sub, channel.crewId))) {
        throw new ForbiddenException('Coordinator cannot inspect drift for this channel');
      }
    }

    if (!channel.crewId) throw new BadRequestException('Channel is not linked to a crew');
    if (channel.type === 'DM') throw new BadRequestException('Drift scan applies only to GROUP or CHANNEL rooms');
    if (!this.rocketchat) throw new ConflictException('Rocket.Chat client is unavailable');

    const [crew] = await this.db.db
      .select({ id: crews.id, coordinatorRcUserId: users.rocketchatUserId })
      .from(crews)
      .leftJoin(users, eq(users.id, crews.coordinatorId))
      .where(eq(crews.id, channel.crewId))
      .limit(1);
    if (!crew) throw new NotFoundException('Crew not found');

    const activeMembers = await this.db.db
      .select({ userId: users.id, fullName: users.fullName, rocketchatUserId: users.rocketchatUserId })
      .from(crewMembers)
      .innerJoin(users, eq(users.id, crewMembers.userId))
      .where(and(eq(crewMembers.crewId, channel.crewId), eq(users.status, 'ACTIVE'), sql`${crewMembers.validRange} @> now()`));

    const rcMembers = await this.rocketchat.listRoomMembers(channel.rcRoomId, channel.type as 'GROUP' | 'CHANNEL');
    const rcById = new Map(rcMembers.map((member) => [member.id, member]));
    const expectedRcIds = new Set<string>();
    const missingInRocketChat: Array<{ userId: string; fullName: string; rocketchatUserId: string }> = [];
    const unlinkedCrewMembers: Array<{ userId: string; fullName: string }> = [];
    let inSyncCount = 0;

    for (const member of activeMembers) {
      if (!member.rocketchatUserId) {
        unlinkedCrewMembers.push({ userId: member.userId, fullName: member.fullName });
        continue;
      }
      expectedRcIds.add(member.rocketchatUserId);
      if (rcById.has(member.rocketchatUserId)) {
        inSyncCount += 1;
      } else {
        missingInRocketChat.push({
          userId: member.userId,
          fullName: member.fullName,
          rocketchatUserId: member.rocketchatUserId,
        });
      }
    }

    const ignoredRcIds = new Set<string>();
    const botUserId = this.rocketchat.botUserId();
    if (botUserId) ignoredRcIds.add(botUserId);
    if (crew.coordinatorRcUserId) ignoredRcIds.add(crew.coordinatorRcUserId);

    const unexpectedInRocketChat = rcMembers
      .filter((member) => !expectedRcIds.has(member.id) && !ignoredRcIds.has(member.id))
      .map((member) => ({ rocketchatUserId: member.id, username: member.username, name: member.name }))
      .sort((left, right) => left.rocketchatUserId.localeCompare(right.rocketchatUserId));

    missingInRocketChat.sort((left, right) => left.fullName.localeCompare(right.fullName));
    unlinkedCrewMembers.sort((left, right) => left.fullName.localeCompare(right.fullName));

    const driftCount = missingInRocketChat.length + unlinkedCrewMembers.length + unexpectedInRocketChat.length;
    await this.audit.record({
      actorType: 'USER',
      actorUserId: actor.sub,
      action: 'rocketchat.channel.drift_scanned',
      entityType: 'rocketchat_channel',
      entityId: channel.id,
      result: 'SUCCESS',
      metadata: { crewId: channel.crewId, count: driftCount },
    });

    return {
      channelId: channel.id,
      crewId: channel.crewId,
      rcRoomId: channel.rcRoomId,
      roomType: channel.type,
      checkedAt: new Date().toISOString(),
      inSyncCount,
      driftCount,
      missingInRocketChat,
      unlinkedCrewMembers,
      unexpectedInRocketChat,
    };
  }

  async message(input: MessageInput, actor: ChatActor) {
    await this.assertTargetAllowed(input, actor);
    const outboxId = await this.outbox.enqueue('rocketchat.message.send', 'message', undefined, { ...input, actorId: actor.sub });
    return { queued: true, outboxId };
  }

  async schedule(input: ScheduledMessageInput, actor: ChatActor) {
    await this.assertTargetAllowed(input, actor);
    const [row] = await this.db.db.insert(scheduledMessages).values({ channelId: input.channelId, targetUserId: input.targetUserId, body: input.body, scheduledFor: new Date(input.scheduledFor), recurrenceRule: input.recurrenceRule ? JSON.stringify(input.recurrenceRule) : null, createdBy: actor.sub }).returning({ id: scheduledMessages.id, status: scheduledMessages.status, scheduledFor: scheduledMessages.scheduledFor });
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'rocketchat.message.scheduled', entityType: 'scheduled_message', entityId: row.id, result: 'SUCCESS', metadata: { recurrence: input.recurrenceRule?.frequency ?? null } });
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
    const rows = await this.db.db.select({ id: scheduledMessages.id, channelId: scheduledMessages.channelId, targetUserId: scheduledMessages.targetUserId, body: scheduledMessages.body, scheduledFor: scheduledMessages.scheduledFor, recurrenceRule: scheduledMessages.recurrenceRule, status: scheduledMessages.status, sentAt: scheduledMessages.sentAt, attempts: scheduledMessages.attempts, lastError: scheduledMessages.lastError, createdBy: scheduledMessages.createdBy }).from(scheduledMessages).where(scope).orderBy(desc(scheduledMessages.scheduledFor));
    return rows.map((row) => ({ ...row, recurrenceRule: parseStoredRecurrence(row.recurrenceRule) }));
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
