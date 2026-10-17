import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { jobRuns, outboxEvents, scheduledMessages } from '../../database/schema/index.js';

const REQUEUEABLE_STATUSES: readonly string[] = ['FAILED', 'DEAD'];

export type OutboxRequeueResult =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_REQUEUEABLE'; status: string }
  | { outcome: 'REQUEUED'; previousStatus: string; eventType: string; aggregateType: string };

/** Consultas de operacion del outbox (E1-05). Nunca devuelve `payload`: puede traer cuerpos de mensaje. */
@Injectable()
export class OutboxOpsRepository {
  constructor(private readonly database: DatabaseService) {}

  list(filters: { status?: string; eventType?: string; beforeId?: number; limit: number }) {
    return this.database.db
      .select({
        id: outboxEvents.id,
        eventType: outboxEvents.eventType,
        aggregateType: outboxEvents.aggregateType,
        aggregateId: outboxEvents.aggregateId,
        status: outboxEvents.status,
        attempts: outboxEvents.attempts,
        nextAttemptAt: outboxEvents.nextAttemptAt,
        lastError: outboxEvents.lastError,
        createdAt: outboxEvents.createdAt,
        processedAt: outboxEvents.processedAt,
      })
      .from(outboxEvents)
      .where(and(
        filters.status ? eq(outboxEvents.status, filters.status) : undefined,
        filters.eventType ? eq(outboxEvents.eventType, filters.eventType) : undefined,
        filters.beforeId ? lt(outboxEvents.id, filters.beforeId) : undefined,
      ))
      .orderBy(desc(outboxEvents.id))
      .limit(filters.limit);
  }

  async summary() {
    const byStatus = await this.database.db
      .select({ status: outboxEvents.status, count: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .groupBy(outboxEvents.status);
    const [oldest] = await this.database.db
      .select({ createdAt: sql<string | null>`min(${outboxEvents.createdAt})` })
      .from(outboxEvents)
      .where(inArray(outboxEvents.status, ['PENDING', 'FAILED']));
    // Los runs de jobs no se reencolan: la siguiente ventana del scheduler ya los repite.
    const failedJobs = await this.database.db
      .select({ id: jobRuns.id, jobName: jobRuns.jobName, runKey: jobRuns.runKey, status: jobRuns.status, attempts: jobRuns.attempts, lastError: jobRuns.lastError, scheduledFor: jobRuns.scheduledFor })
      .from(jobRuns)
      .where(inArray(jobRuns.status, ['FAILED', 'DEAD']))
      .orderBy(desc(jobRuns.scheduledFor))
      .limit(20);
    return { byStatus, oldestPendingAt: oldest?.createdAt ? new Date(oldest.createdAt) : null, failedJobs };
  }

  /**
   * Devuelve un evento FAILED o DEAD a PENDING con los intentos en cero. Si es un
   * mensaje programado, su fila vuelve a QUEUED y el worker la cierra al enviar.
   */
  async requeue(id: number): Promise<OutboxRequeueResult> {
    const [current] = await this.database.db
      .select({ status: outboxEvents.status, eventType: outboxEvents.eventType, aggregateType: outboxEvents.aggregateType, aggregateId: outboxEvents.aggregateId })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .for('update');
    if (!current) return { outcome: 'NOT_FOUND' };
    if (!REQUEUEABLE_STATUSES.includes(current.status)) return { outcome: 'NOT_REQUEUEABLE', status: current.status };
    await this.database.db
      .update(outboxEvents)
      .set({ status: 'PENDING', attempts: 0, nextAttemptAt: sql`now()`, claimedBy: null, leaseToken: null, leaseExpiresAt: null })
      .where(eq(outboxEvents.id, id));
    if (current.aggregateType === 'scheduled_message' && current.aggregateId) {
      await this.database.db
        .update(scheduledMessages)
        .set({ status: 'QUEUED' })
        .where(and(eq(scheduledMessages.id, current.aggregateId), eq(scheduledMessages.status, 'FAILED')));
    }
    return { outcome: 'REQUEUED', previousStatus: current.status, eventType: current.eventType, aggregateType: current.aggregateType };
  }
}
