import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { JobsService } from '../../modules/jobs/jobs.service.js';
import { DurableJobService } from '../../modules/jobs/durable-job.service.js';
import { DurableJobRepository } from '../../modules/jobs/durable-job.repository.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { DrizzleEffectiveTimeRepository } from '../../modules/shifts/effective-time.drizzle-repository.js';
import { jobRuns, profileAssignments, profileSessions, shiftTemplates, shifts, ttProfiles } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

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

  it('prevents duplicate execution and double session reaping across two concurrent workers (OPS-03)', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx, { role: 'OPERADOR' });
    const [profile] = await ctx.db
      .insert(ttProfiles)
      .values({ displayName: 'Concurrent Profile', loginEmail: 'ops03@example.test' })
      .returning({ id: ttProfiles.id });
    const now = Date.now();
    const activeRange = `[${new Date(now - 3_600_000).toISOString()},${new Date(now + 3_600_000).toISOString()})`;
    const [assignment] = await ctx.db
      .insert(profileAssignments)
      .values({
        profileId: profile.id,
        operatorId: operator.id,
        validRange: activeRange,
        status: 'ACTIVE',
        assignedBy: admin.id,
      })
      .returning({ id: profileAssignments.id });
    const [session] = await ctx.db
      .insert(profileSessions)
      .values({
        profileId: profile.id,
        operatorId: operator.id,
        assignmentId: assignment.id,
        chromeProfileDir: 'Profile 1',
        status: 'ACTIVE',
        version: 1,
        startedAt: new Date(now - 600_000),
        lastHeartbeatAt: new Date(now - 180_000),
      })
      .returning({ id: profileSessions.id });

    const makeWorker = () => new JobsService(
      ctx.database,
      new RealtimeService(ctx.database),
      new DrizzleEffectiveTimeRepository(ctx.database),
      new DurableJobService(new DurableJobRepository(ctx.database)),
    );
    const workerA = makeWorker();
    const workerB = makeWorker();
    const reapSpyA = vi.spyOn(workerA as unknown as { reapSessions: () => Promise<void> }, 'reapSessions');
    const reapSpyB = vi.spyOn(workerB as unknown as { reapSessions: () => Promise<void> }, 'reapSessions');

    await Promise.all([
      (workerA as unknown as { schedulerTick(): Promise<void> }).schedulerTick(),
      (workerB as unknown as { schedulerTick(): Promise<void> }).schedulerTick(),
    ]);

    const runs = await ctx.db
      .select({ name: jobRuns.jobName, status: jobRuns.status, attempts: jobRuns.attempts })
      .from(jobRuns);
    expect(runs).toHaveLength(JOB_NAMES.length);
    expect(runs.map((run) => run.name).sort()).toEqual(JOB_NAMES.slice().sort());
    expect(runs.every((run) => run.status === 'SUCCEEDED' && run.attempts === 1)).toBe(true);
    expect(reapSpyA.mock.calls.length + reapSpyB.mock.calls.length).toBe(1);

    const [reaped] = await ctx.db
      .select({ status: profileSessions.status, endReason: profileSessions.endReason, version: profileSessions.version })
      .from(profileSessions)
      .where(eq(profileSessions.id, session.id));
    expect(reaped).toEqual({ status: 'STALE', endReason: 'HEARTBEAT_TIMEOUT', version: 2 });
  });

  it('materializes :05 midnight-crossing shifts accurately across month-end, leap-day, and restart recovery (OPS-05)', async () => {
    const operator = await createUser(ctx, { role: 'OPERADOR' });
    await ctx.db.insert(shiftTemplates).values({
      name: 'Night :05',
      startTime: '22:05:00',
      endTime: '06:05:00',
      crossesMidnight: true,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      validFrom: '2026-01-01',
      isActive: true,
    });

    const materialize = (service: JobsService, at: Date) =>
      (service as unknown as { materializeShiftBacklog(at?: Date): Promise<number> }).materializeShiftBacklog(at);
    const closeExpired = (service: JobsService, at: Date) =>
      (service as unknown as { closeExpiredShifts(at?: Date): Promise<void> }).closeExpiredShifts(at);

    // Month-end boundary: 2026-11-30 (22:05 Bogota -> 06:05 Dec 1) and 2026-12-01.
    expect(await materialize(jobs, new Date('2026-12-01T10:00:00.000Z'))).toBe(2);
    // Leap-day boundary: 2028-02-28 -> 2028-02-29 -> 2028-03-01.
    expect(await materialize(jobs, new Date('2028-02-29T10:00:00.000Z'))).toBe(2);
    expect(await materialize(jobs, new Date('2028-03-01T10:00:00.000Z'))).toBe(1);

    // Worker restart recovery over the same leap-day window inserts zero duplicates.
    const restarted = new JobsService(
      ctx.database,
      new RealtimeService(ctx.database),
      new DrizzleEffectiveTimeRepository(ctx.database),
      new DurableJobService(new DurableJobRepository(ctx.database)),
    );
    expect(await materialize(restarted, new Date('2028-03-01T10:00:00.000Z'))).toBe(0);

    await closeExpired(restarted, new Date('2028-03-01T11:05:00.000Z'));

    const materialized = await ctx.db
      .select({
        operatorId: shifts.operatorId,
        businessDate: shifts.businessDate,
        status: shifts.status,
        startUtc: sql<Date>`lower(${shifts.scheduledRange})`,
        endUtc: sql<Date>`upper(${shifts.scheduledRange})`,
      })
      .from(shifts)
      .orderBy(asc(shifts.businessDate));

    expect(materialized.map((row) => ({
      operatorId: row.operatorId,
      businessDate: row.businessDate,
      status: row.status,
      startUtc: new Date(row.startUtc).toISOString(),
      endUtc: new Date(row.endUtc).toISOString(),
    }))).toEqual([
      { operatorId: operator.id, businessDate: '2026-11-30', status: 'MISSED', startUtc: '2026-12-01T03:05:00.000Z', endUtc: '2026-12-01T11:05:00.000Z' },
      { operatorId: operator.id, businessDate: '2026-12-01', status: 'MISSED', startUtc: '2026-12-02T03:05:00.000Z', endUtc: '2026-12-02T11:05:00.000Z' },
      { operatorId: operator.id, businessDate: '2028-02-28', status: 'MISSED', startUtc: '2028-02-29T03:05:00.000Z', endUtc: '2028-02-29T11:05:00.000Z' },
      { operatorId: operator.id, businessDate: '2028-02-29', status: 'MISSED', startUtc: '2028-03-01T03:05:00.000Z', endUtc: '2028-03-01T11:05:00.000Z' },
      { operatorId: operator.id, businessDate: '2028-03-01', status: 'SCHEDULED', startUtc: '2028-03-02T03:05:00.000Z', endUtc: '2028-03-02T11:05:00.000Z' },
    ]);
  });
});
