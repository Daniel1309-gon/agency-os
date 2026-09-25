import { and, eq, inArray, sql } from 'drizzle-orm';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { jobRuns } from '../../database/schema/index.js';

const LEASE_SECONDS = 55;
const MAX_CLAIM = 100;

@Injectable()
export class DurableJobRepository {
  constructor(private readonly db: DatabaseService) {}

  async enqueue(jobName: string, runKey: string, scheduledFor: Date): Promise<boolean> {
    const [row] = await this.db.db.insert(jobRuns)
      .values({ jobName, runKey, scheduledFor, nextAttemptAt: scheduledFor })
      .onConflictDoNothing({ target: [jobRuns.jobName, jobRuns.runKey] })
      .returning({ id: jobRuns.id });
    return Boolean(row);
  }

  async claim(limit: number, workerId: string): Promise<Array<typeof jobRuns.$inferSelect>> {
    const boundedLimit = Math.max(1, Math.min(MAX_CLAIM, Math.trunc(limit)));
    return this.db.transaction(async () => {
      const result = await this.db.db.execute(sql`SELECT id FROM job_runs
        WHERE next_attempt_at <= now()
          AND (status IN ('PENDING', 'FAILED') OR (status = 'PROCESSING' AND lease_expires_at <= now()))
        ORDER BY scheduled_for, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${boundedLimit}`);
      const ids = result.rows.map((row) => Number((row as { id: string | number }).id)).filter(Number.isSafeInteger);
      if (!ids.length) return [];
      return this.db.db.update(jobRuns)
        .set({
          status: 'PROCESSING',
          attempts: sql`${jobRuns.attempts} + 1`,
          nextAttemptAt: sql`now() + (${LEASE_SECONDS} * interval '1 second')`,
          claimedBy: workerId,
          leaseToken: sql`gen_random_uuid()`,
          leaseExpiresAt: sql`now() + (${LEASE_SECONDS} * interval '1 second')`,
          startedAt: sql`coalesce(${jobRuns.startedAt}, now())`,
        })
        .where(inArray(jobRuns.id, ids))
        .returning();
    });
  }

  async renew(id: number, leaseToken: string): Promise<boolean> {
    const rows = await this.db.db.update(jobRuns)
      .set({ leaseExpiresAt: sql`now() + (${LEASE_SECONDS} * interval '1 second')` })
      .where(and(eq(jobRuns.id, id), eq(jobRuns.status, 'PROCESSING'), eq(jobRuns.leaseToken, leaseToken), sql`${jobRuns.leaseExpiresAt} > now()`))
      .returning({ id: jobRuns.id });
    return rows.length > 0;
  }

  async complete(id: number, leaseToken: string): Promise<boolean> {
    const rows = await this.db.db.update(jobRuns)
      .set({ status: 'SUCCEEDED', finishedAt: sql`now()`, claimedBy: null, leaseToken: null, leaseExpiresAt: null, lastError: null })
      .where(and(eq(jobRuns.id, id), eq(jobRuns.status, 'PROCESSING'), eq(jobRuns.leaseToken, leaseToken), sql`${jobRuns.leaseExpiresAt} > now()`))
      .returning({ id: jobRuns.id });
    return rows.length > 0;
  }

  async fail(id: number, leaseToken: string, error: string, attempts: number, dead = false): Promise<boolean> {
    const delaySeconds = Math.min(900, 2 ** Math.min(Math.max(1, attempts), 9));
    const rows = await this.db.db.update(jobRuns)
      .set({
        status: dead ? 'DEAD' : 'FAILED',
        lastError: error.slice(0, 1000),
        nextAttemptAt: sql`now() + (${delaySeconds} * interval '1 second')`,
        claimedBy: null,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(jobRuns.id, id), eq(jobRuns.status, 'PROCESSING'), eq(jobRuns.leaseToken, leaseToken), sql`${jobRuns.leaseExpiresAt} > now()`))
      .returning({ id: jobRuns.id });
    return rows.length > 0;
  }
}
