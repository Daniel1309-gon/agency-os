import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { JobsService } from '../../modules/jobs/jobs.service.js';
import { DurableJobService } from '../../modules/jobs/durable-job.service.js';
import { DurableJobRepository } from '../../modules/jobs/durable-job.repository.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { DrizzleEffectiveTimeRepository } from '../../modules/shifts/effective-time.drizzle-repository.js';
import { jobRuns } from '../../database/schema/index.js';
import { createTestContext, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let jobs: JobsService;

const JOB_NAMES = [
  'audit:partitions',
  'breaks:auto-close',
  'cafeteria:expire-orders',
  'sessions:reap',
  'shifts:materialize',
  'shifts:open-close',
];

const tick = () => (jobs as unknown as { schedulerTick(): Promise<void> }).schedulerTick();

beforeAll(async () => {
  ctx = await createTestContext();
  jobs = new JobsService(
    ctx.database,
    new RealtimeService(ctx.database),
    new DrizzleEffectiveTimeRepository(ctx.database),
    new DurableJobService(new DurableJobRepository(ctx.database)),
  );
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  vi.restoreAllMocks();
});

describe('durable scheduler', () => {
  it('runs every scheduled job once per interval and records it in job_runs', async () => {
    await tick();

    const runs = await ctx.db.select({ name: jobRuns.jobName, status: jobRuns.status }).from(jobRuns);
    expect(runs.map((run) => run.name).sort()).toEqual(JOB_NAMES.slice().sort());
    expect(runs.every((run) => run.status === 'SUCCEEDED')).toBe(true);

    // Segundo tick del mismo intervalo: la clave de corrida ya existe, no duplica.
    await tick();
    const after = await ctx.db.select({ id: jobRuns.id }).from(jobRuns);
    expect(after).toHaveLength(JOB_NAMES.length);
  });

  it('recovers a run left PROCESSING by a dead worker once the lease expires', async () => {
    const now = Date.now();
    // Intervalo pasado: la clave de corrida no choca con la del test anterior y
    // el job ya esta vencido frente a now() de PostgreSQL.
    vi.spyOn(Date, 'now').mockReturnValue(now - 120_000);
    await ctx.db.insert(jobRuns).values({
      jobName: 'sessions:reap',
      runKey: 'stale-worker-run',
      scheduledFor: new Date(now - 180_000),
      status: 'PROCESSING',
      attempts: 1,
      nextAttemptAt: new Date(now - 180_000),
      leaseExpiresAt: new Date(now - 60_000),
      claimedBy: 'dead-worker',
    });

    await tick();

    const [stale] = await ctx.db.select({ status: jobRuns.status, claimedBy: jobRuns.claimedBy }).from(jobRuns).where(eq(jobRuns.runKey, 'stale-worker-run'));
    expect(stale.status).toBe('SUCCEEDED');
    expect(stale.claimedBy).toBeNull();
  });

  it('records a failed attempt with backoff instead of losing it', async () => {
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow - 60_000);
    vi.spyOn(jobs as unknown as { expireOrders: () => Promise<void> }, 'expireOrders').mockRejectedValue(new Error('boom'));

    await tick();

    const [failed] = await ctx.db.select().from(jobRuns).where(eq(jobRuns.jobName, 'cafeteria:expire-orders'));
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toBe('boom');
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(realNow);
  });
});
