import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RecurrenceRule } from '@agency-os/shared';
import { DatabaseService } from '../../database/database.service.js';
import { outboxEvents, rocketchatChannels, scheduledMessages, users } from '../../database/schema/index.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { businessDateInBogota, nextOccurrenceAt, occurrencesUpTo } from '../jobs/shift-schedule.js';
import { RocketChatClient } from './rocketchat.client.js';
import { ConfigService } from '../../config/config.service.js';
import { parseStoredRecurrence } from './communication.schemas.js';

const messagePayload = z.object({ channelId: z.string().uuid().optional(), targetUserId: z.string().uuid().optional(), roomId: z.string().min(1).optional(), body: z.string().min(1).max(4000), scheduledMessageId: z.string().uuid().optional(), sourceMessageId: z.string().trim().min(1).max(160).optional() }).refine((value) => [value.channelId, value.targetUserId, value.roomId].filter(Boolean).length === 1);

const RECURRENCE_GRACE_MS = 60 * 60 * 1000;

type ScheduledMessageRow = typeof scheduledMessages.$inferSelect;

function skipReason(occurrences: Date[]): string {
  const first = businessDateInBogota(occurrences[0]);
  const last = businessDateInBogota(occurrences[occurrences.length - 1]);
  const range = first === last ? first : `${first} a ${last}`;
  const noun = occurrences.length === 1 ? 'ocurrencia omitida' : 'ocurrencias omitidas';
  return `${occurrences.length} ${noun} (${range}) por retraso del worker`;
}

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
      const now = new Date();
      const result = await this.db.db.execute(sql`SELECT id FROM scheduled_messages WHERE status = 'PENDING' AND scheduled_for <= now() ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 25`);
      for (const raw of result.rows) {
        const id = String((raw as { id: string }).id);
        const [message] = await this.db.db.select().from(scheduledMessages).where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.status, 'PENDING'))).limit(1);
        if (!message) continue;
        const rule = parseStoredRecurrence(message.recurrenceRule);
        if (rule) {
          await this.advanceSeries(message, rule, now);
          continue;
        }
        const [queued] = await this.db.db.update(scheduledMessages).set({ status: 'QUEUED', attempts: sql`${scheduledMessages.attempts} + 1` }).where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.status, 'PENDING'))).returning();
        if (queued) await this.enqueueOccurrence(queued);
      }
    });
  }

  /**
   * Una serie recurrente tiene una sola fila PENDING: la próxima ocurrencia.
   * Cuando el worker llega tarde, esa fila resume lo perdido en una sola fila
   * SKIPPED (nunca ráfagas de envíos) y, si la ocurrencia más reciente todavía
   * está dentro de la gracia, se envía esa y se deja la siguiente programada.
   */
  private async advanceSeries(message: ScheduledMessageRow, rule: RecurrenceRule, now: Date): Promise<void> {
    const due = occurrencesUpTo(message.scheduledFor, now, rule);
    // El SELECT filtra con el now() de Postgres y esto usa el reloj de la app: si la
    // app va atrasada, la ocurrencia todavía no venció aquí. Queda PENDING y la toma
    // el próximo tick; lanzar revertiría el lote completo.
    if (!due.length) return;
    const latest = due[due.length - 1];
    const fresh = now.getTime() - latest.getTime() <= RECURRENCE_GRACE_MS ? latest : null;
    const skipped = fresh ? due.slice(0, -1) : due;
    const next = nextOccurrenceAt(latest, rule);

    if (skipped.length === 0) {
      const [queued] = await this.db.db.update(scheduledMessages).set({ status: 'QUEUED', attempts: sql`${scheduledMessages.attempts} + 1` }).where(and(eq(scheduledMessages.id, message.id), eq(scheduledMessages.status, 'PENDING'))).returning();
      if (queued) await this.enqueueOccurrence(queued);
    } else {
      await this.db.db.update(scheduledMessages).set({ status: 'SKIPPED', lastError: skipReason(skipped) }).where(and(eq(scheduledMessages.id, message.id), eq(scheduledMessages.status, 'PENDING')));
      if (fresh) {
        const [rescheduled] = await this.db.db.insert(scheduledMessages).values({ ...this.seriesFields(message), scheduledFor: fresh, status: 'QUEUED', attempts: 1 }).returning();
        if (rescheduled) await this.enqueueOccurrence(rescheduled);
      }
    }
    if (next) await this.db.db.insert(scheduledMessages).values({ ...this.seriesFields(message), scheduledFor: next, status: 'PENDING', attempts: 0 });
  }

  private seriesFields(message: ScheduledMessageRow) {
    return { channelId: message.channelId, targetUserId: message.targetUserId, body: message.body, recurrenceRule: message.recurrenceRule, createdBy: message.createdBy };
  }

  private async enqueueOccurrence(message: ScheduledMessageRow): Promise<void> {
    await this.db.db.insert(outboxEvents).values({
      eventType: 'rocketchat.message.send',
      aggregateType: 'scheduled_message',
      aggregateId: message.id,
      payload: { ...(message.channelId ? { channelId: message.channelId } : { targetUserId: message.targetUserId }), body: message.body, scheduledMessageId: message.id },
    });
  }

  private async dispatch(event: typeof outboxEvents.$inferSelect): Promise<void> {
    try {
      if (event.eventType === 'rocketchat.message.send') {
        const payload = messagePayload.parse(event.payload);
        const roomId = await this.resolveRoom(payload);
        await this.rocketchat.sendMessage(roomId, payload.body, `agency-outbox-${event.id}`, payload.sourceMessageId);
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
