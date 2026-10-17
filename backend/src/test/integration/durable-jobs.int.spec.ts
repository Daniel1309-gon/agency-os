import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { DurableJobRepository } from '../../modules/jobs/durable-job.repository.js';
import { DurableJobService } from '../../modules/jobs/durable-job.service.js';
import { jobRuns } from '../../database/schema/index.js';
import { createTestContext, destroyTestContext, resetDatabase, type TestContext } from '../support/harness.js';

let context: TestContext;

beforeAll(async () => { context = await createTestContext(); });
afterAll(async () => { await destroyTestContext(context); });
beforeEach(async () => { await resetDatabase(context); });

describe('durable job claims', () => {
  it('deduplicates a run and fences a worker after lease reclaim', async () => {
    const repository = new DurableJobRepository(context.database);
    const firstWorker = new DurableJobService(repository);
    const secondWorker = new DurableJobService(repository);
    const runKey = `integration-${Date.now()}`;
    const scheduledFor = new Date(Date.now() - 1_000);

    await expect(firstWorker.enqueue('test:lease', runKey, scheduledFor)).resolves.toBe(true);
    await expect(firstWorker.enqueue('test:lease', runKey, scheduledFor)).resolves.toBe(false);

    const [first] = await firstWorker.claim();
    expect(first).toMatchObject({ jobName: 'test:lease', runKey, status: 'PROCESSING' });
    expect(first.leaseToken).toEqual(expect.any(String));

    await context.db.update(jobRuns).set({
      leaseExpiresAt: sql`now() - interval '1 second'`,
      nextAttemptAt: sql`now() - interval '1 second'`,
    }).where(eq(jobRuns.id, first.id));

    await expect(firstWorker.complete(first.id, first.leaseToken!)).resolves.toBe(false);
    await expect(firstWorker.fail(first.id, first.leaseToken!, 'expired worker', first.attempts, true)).resolves.toBe(false);
    const [second] = await secondWorker.claim();
    expect(second.id).toBe(first.id);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(firstWorker.complete(first.id, first.leaseToken!)).resolves.toBe(false);
    await expect(secondWorker.complete(second.id, second.leaseToken!)).resolves.toBe(true);
  });

  it('claims concurrently under the worker role and preserves a renewed lease', async () => {
    const repository = new DurableJobRepository(context.database);
    await repository.enqueue('test:concurrent', 'one', new Date(0));
    await repository.enqueue('test:concurrent', 'two', new Date(0));
    const asWorker = <T>(work: () => Promise<T>) => context.database.transaction(async () => {
      await context.database.db.execute(sql`SET LOCAL ROLE agency_worker`);
      return work();
    });
    const [first, second] = await Promise.all([
      asWorker(() => repository.claim(1, 'worker-a')),
      asWorker(() => repository.claim(1, 'worker-b')),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).not.toBe(second[0].id);
    const run = first[0];
    await context.db.update(jobRuns).set({
      nextAttemptAt: new Date(0),
      leaseExpiresAt: sql`now() + interval '5 seconds'`,
    }).where(eq(jobRuns.id, run.id));
    await expect(asWorker(() => repository.renew(run.id, run.leaseToken!))).resolves.toBe(true);
    await expect(asWorker(() => repository.claim(1, 'worker-c'))).resolves.toEqual([]);
    await expect(asWorker(() => repository.complete(run.id, run.leaseToken!))).resolves.toBe(true);
    await expect(asWorker(() => repository.fail(second[0].id, second[0].leaseToken!, 'synthetic failure', 1))).resolves.toBe(true);
  });
});
