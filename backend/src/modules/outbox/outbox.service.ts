import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { outboxEvents } from '../../database/schema/index.js';

@Injectable()
export class OutboxService {
  constructor(private readonly db: DatabaseService) {}

  async enqueue(eventType: string, aggregateType: string, aggregateId: string | undefined, payload: Record<string, unknown>): Promise<number> {
    const [row] = await this.db.db.insert(outboxEvents).values({ eventType, aggregateType, aggregateId, payload }).returning({ id: outboxEvents.id });
    return row.id;
  }

  async claim(limit = 50) {
    return this.db.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT id FROM outbox_events WHERE status IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ${limit}`);
      const ids = rows.rows.map((row) => Number((row as { id: string }).id));
      if (!ids.length) return [];
      await tx.update(outboxEvents).set({ status: 'PROCESSING', attempts: sql`${outboxEvents.attempts} + 1`, nextAttemptAt: new Date(Date.now() + 60_000) }).where(sql`${outboxEvents.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
      return tx.select().from(outboxEvents).where(sql`${outboxEvents.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    });
  }

  async markSent(id: number) { await this.db.db.update(outboxEvents).set({ status: 'SENT', processedAt: new Date() }).where(eq(outboxEvents.id, id)); }
  async markFailed(id: number, error: string, attempts: number, dead = false) { const delaySeconds = Math.min(900, 2 ** Math.min(attempts, 9)); await this.db.db.update(outboxEvents).set({ status: dead ? 'DEAD' : 'FAILED', lastError: error.slice(0, 1000), nextAttemptAt: new Date(Date.now() + delaySeconds * 1000) }).where(eq(outboxEvents.id, id)); }
}
