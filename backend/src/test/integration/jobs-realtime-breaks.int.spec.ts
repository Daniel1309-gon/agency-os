import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { JobsService } from '../../modules/jobs/jobs.service.js';
import type { RealtimeService } from '../../modules/realtime/realtime.service.js';
import type { EffectiveTimeRepository } from '../../modules/shifts/effective-time.port.js';
import { breaks, cafeteriaOrders, outboxEvents, shifts } from '../../database/schema/index.js';
import {
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let publishCafeteriaOrderChanged: ReturnType<typeof vi.fn>;
let publishOperatorChanged: ReturnType<typeof vi.fn>;
let jobs: JobsService;

const asWorker = <T>(work: () => Promise<T>): Promise<T> =>
  ctx.database.transaction(async () => {
    await ctx.database.db.execute(sql`SET LOCAL ROLE agency_worker`);
    return work();
  });

beforeAll(async () => {
  ctx = await createTestContext();
  publishCafeteriaOrderChanged = vi.fn(async () => undefined);
  publishOperatorChanged = vi.fn(async () => undefined);
  const realtime = {
    publishCafeteriaOrderChanged,
    publishOperatorChanged,
  } as unknown as RealtimeService;
  const effectiveTime = { settle: vi.fn(async () => undefined) } as unknown as EffectiveTimeRepository;
  jobs = new JobsService(ctx.database, realtime, effectiveTime);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  publishCafeteriaOrderChanged.mockClear();
  publishOperatorChanged.mockClear();
});

describe('JobsService cafeteria:expire-orders realtime publish (S3)', () => {
  it('expires overdue READY orders under agency_worker and publishes cafeteria.order.changed for each expired order', async () => {
    const operator = await createUser(ctx);
    const [overdue] = await ctx.db
      .insert(cafeteriaOrders)
      .values({
        operatorId: operator.id,
        status: 'READY',
        totalCop: '9000.00',
        pickupDeadlineAt: new Date(Date.now() - 60_000),
        idempotencyKey: 'exp-overdue',
      })
      .returning({ id: cafeteriaOrders.id });
    const [stillValid] = await ctx.db
      .insert(cafeteriaOrders)
      .values({
        operatorId: operator.id,
        status: 'READY',
        totalCop: '5000.00',
        pickupDeadlineAt: new Date(Date.now() + 10 * 60_000),
        idempotencyKey: 'exp-valid',
      })
      .returning({ id: cafeteriaOrders.id });

    await asWorker(() => (jobs as unknown as { expireOrders: () => Promise<void> }).expireOrders());

    const rows = await ctx.db.select({ id: cafeteriaOrders.id, status: cafeteriaOrders.status }).from(cafeteriaOrders);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: overdue.id, status: 'EXPIRED' },
        { id: stillValid.id, status: 'READY' },
      ]),
    );
    expect(publishCafeteriaOrderChanged).toHaveBeenCalledTimes(1);
    expect(publishCafeteriaOrderChanged).toHaveBeenCalledWith(overdue.id);
  });
});

describe('JobsService break-ending notice (A11, FR-16)', () => {
  it('stamps breaks.notified_at and enqueues one Rocket.Chat DM 5 minutes before the 20-minute cap under agency_worker', async () => {
    const now = new Date();
    const operatorWarning = await createUser(ctx);
    const operatorEarly = await createUser(ctx);
    const operatorExpired = await createUser(ctx);

    const makeShiftAndBreak = async (operatorId: string, minutesAgo: number) => {
      const [shift] = await ctx.db
        .insert(shifts)
        .values({
          operatorId,
          businessDate: '2026-11-22',
          scheduledRange: halfOpen(new Date(now.getTime() - 2 * 3_600_000), new Date(now.getTime() + 6 * 3_600_000)),
          actualStartAt: new Date(now.getTime() - 2 * 3_600_000),
          status: 'IN_PROGRESS',
        })
        .returning({ id: shifts.id });
      const [brk] = await ctx.db
        .insert(breaks)
        .values({
          shiftId: shift.id,
          type: 'BREAK_1',
          startedAt: new Date(now.getTime() - minutesAgo * 60_000),
          status: 'IN_PROGRESS',
        })
        .returning({ id: breaks.id });
      return brk;
    };

    const warningBreak = await makeShiftAndBreak(operatorWarning.id, 16);
    const earlyBreak = await makeShiftAndBreak(operatorEarly.id, 5);
    const expiredBreak = await makeShiftAndBreak(operatorExpired.id, 21);

    await asWorker(() => (jobs as unknown as { autoCloseBreaks: () => Promise<void> }).autoCloseBreaks());

    const [warnAfter] = await ctx.db.select({ status: breaks.status, notifiedAt: breaks.notifiedAt }).from(breaks).where(eq(breaks.id, warningBreak.id));
    const [earlyAfter] = await ctx.db.select({ status: breaks.status, notifiedAt: breaks.notifiedAt }).from(breaks).where(eq(breaks.id, earlyBreak.id));
    const [expiredAfter] = await ctx.db.select({ status: breaks.status, notifiedAt: breaks.notifiedAt }).from(breaks).where(eq(breaks.id, expiredBreak.id));

    expect(warnAfter?.status).toBe('IN_PROGRESS');
    expect(warnAfter?.notifiedAt).toBeInstanceOf(Date);
    expect(earlyAfter).toEqual({ status: 'IN_PROGRESS', notifiedAt: null });
    expect(expiredAfter?.status).toBe('COMPLETED');
    expect(expiredAfter?.notifiedAt).toBeNull();

    const queued = await ctx.db.select({ eventType: outboxEvents.eventType, aggregateType: outboxEvents.aggregateType, aggregateId: outboxEvents.aggregateId, payload: outboxEvents.payload }).from(outboxEvents);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      eventType: 'rocketchat.message.send',
      aggregateType: 'break',
      aggregateId: warningBreak.id,
      payload: {
        targetUserId: operatorWarning.id,
        body: expect.stringContaining('min'),
      },
    });

    // Running again must not duplicate the notice.
    await asWorker(() => (jobs as unknown as { autoCloseBreaks: () => Promise<void> }).autoCloseBreaks());
    expect(await ctx.db.select({ id: outboxEvents.id }).from(outboxEvents)).toHaveLength(1);
  });

  it('never notifies a break at/past 20m or with null startedAt, and notifies at exact 15m using Postgres now()', async () => {
    const operatorAt15 = await createUser(ctx);
    const operatorAt20 = await createUser(ctx);
    const operatorNull = await createUser(ctx);
    const now = new Date();
    const mkShift = async (operatorId: string) => {
      const [s] = await ctx.db
        .insert(shifts)
        .values({
          operatorId,
          businessDate: '2026-11-22',
          scheduledRange: halfOpen(new Date(now.getTime() - 2 * 3_600_000), new Date(now.getTime() + 6 * 3_600_000)),
          actualStartAt: new Date(now.getTime() - 2 * 3_600_000),
          status: 'IN_PROGRESS',
        })
        .returning({ id: shifts.id });
      return s;
    };
    const s15 = await mkShift(operatorAt15.id);
    const s20 = await mkShift(operatorAt20.id);
    const sNull = await mkShift(operatorNull.id);

    await ctx.db.execute(sql`INSERT INTO breaks (shift_id, type, started_at, status) VALUES (${s15.id}, 'BREAK_1', now() - interval '15 minutes', 'IN_PROGRESS')`);
    await ctx.db.execute(sql`INSERT INTO breaks (shift_id, type, started_at, status) VALUES (${s20.id}, 'BREAK_1', now() - interval '20 minutes', 'IN_PROGRESS')`);
    await ctx.db.insert(breaks).values({ shiftId: sNull.id, type: 'BREAK_1', startedAt: null, status: 'IN_PROGRESS' });

    await asWorker(() => (jobs as unknown as { autoCloseBreaks: () => Promise<void> }).autoCloseBreaks());

    const queued = await ctx.db.select({ payload: outboxEvents.payload }).from(outboxEvents);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ targetUserId: operatorAt15.id });
    const [closed20] = await ctx.db
      .select({ status: breaks.status, notifiedAt: breaks.notifiedAt })
      .from(breaks)
      .where(eq(breaks.shiftId, s20.id));
    expect(closed20).toEqual({ status: 'COMPLETED', notifiedAt: null });
  });
});
