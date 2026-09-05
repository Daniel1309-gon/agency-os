import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { outboxEvents } from '../../database/schema/index.js';

@Injectable()
export class OutboxService {
  private readonly workerId = `worker-${randomUUID()}`;

  constructor(private readonly db: DatabaseService) {}

  async enqueue(eventType: string, aggregateType: string, aggregateId: string | undefined, payload: Record<string, unknown>): Promise<number> {
    const [row] = await this.db.db.insert(outboxEvents).values({ eventType, aggregateType, aggregateId, payload }).returning({ id: outboxEvents.id });
    return row.id;
  }

  async claim(limit = 50) {
    return this.db.db.transaction(async (tx) => {
      const leaseToken = randomUUID();
      const rows = await tx.execute(sql`SELECT id FROM outbox_events
        WHERE next_attempt_at <= now()
          AND (status IN ('PENDING', 'FAILED') OR (status = 'PROCESSING' AND lease_expires_at <= now()))
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}`);
      const ids = rows.rows.map((row) => Number((row as { id: string }).id));
      if (!ids.length) return [];
      const leaseExpiresAt = new Date(Date.now() + 60_000);
      const idsCondition = sql`${outboxEvents.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
      await tx.update(outboxEvents).set({ status: 'PROCESSING', attempts: sql`${outboxEvents.attempts} + 1`, nextAttemptAt: leaseExpiresAt, claimedBy: this.workerId, leaseToken, leaseExpiresAt }).where(idsCondition);
      return tx.select().from(outboxEvents).where(sql`${idsCondition} AND ${eq(outboxEvents.claimedBy, this.workerId)} AND ${eq(outboxEvents.leaseToken, leaseToken)}`);
    });
  }

  async markSent(id: number, leaseToken?: string | null): Promise<boolean> {
    const rows = await this.db.db.update(outboxEvents)
      .set({ status: 'SENT', processedAt: new Date(), claimedBy: null, leaseToken: null, leaseExpiresAt: null })
      .where(sql`${eq(outboxEvents.id, id)} AND ${leaseToken ? eq(outboxEvents.leaseToken, leaseToken) : sql`true`} AND ${eq(outboxEvents.status, 'PROCESSING')}`)
      .returning({ id: outboxEvents.id });
    return rows.length > 0;
  }

  async markFailed(id: number, error: string, attempts: number, dead = false, leaseToken?: string | null): Promise<boolean> {
    const delaySeconds = Math.min(900, 2 ** Math.min(attempts, 9));
    const rows = await this.db.db.update(outboxEvents)
      .set({ status: dead ? 'DEAD' : 'FAILED', lastError: error.slice(0, 1000), nextAttemptAt: new Date(Date.now() + delaySeconds * 1000), claimedBy: null, leaseToken: null, leaseExpiresAt: null })
      .where(sql`${eq(outboxEvents.id, id)} AND ${leaseToken ? eq(outboxEvents.leaseToken, leaseToken) : sql`true`} AND ${eq(outboxEvents.status, 'PROCESSING')}`)
      .returning({ id: outboxEvents.id });
    return rows.length > 0;
  }
}
