import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleEffectiveTimeRepository } from '../../modules/shifts/effective-time.drizzle-repository.js';
import { eq } from 'drizzle-orm';
import { ShiftAccessService, type ShiftAccessClock } from '../../common/auth/shift-access.service.js';
import { shiftOverrides, shifts } from '../../database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { ShiftsService } from '../../modules/shifts/shifts.service.js';
import { createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let access: ShiftAccessService;
let shiftsService: ShiftsService;
let now = new Date('2026-08-23T06:05:00.000Z');

beforeAll(async () => {
  ctx = await createTestContext();
  const clock: ShiftAccessClock = { now: () => now };
  access = new ShiftAccessService(ctx.database, clock);
  shiftsService = new ShiftsService(ctx.database, new AuditService(ctx.database), new RealtimeService(ctx.database), new DrizzleEffectiveTimeRepository(ctx.database));
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  now = new Date('2026-08-23T06:05:00.000Z');
});

describe('ShiftAccessService boundaries', () => {
  it('accepts the lower boundary and rejects the upper boundary of a shift', async () => {
    const operator = await createUser(ctx);
    await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: '2026-08-23',
      scheduledRange: '[2026-08-23T06:05:00.000Z,2026-08-23T14:05:00.000Z)',
    });

    await expect(access.isWithinApprovedWindow(operator.id)).resolves.toBe(true);
    now = new Date('2026-08-23T14:05:00.000Z');
    await expect(access.isWithinApprovedWindow(operator.id)).resolves.toBe(false);
  });

  it('handles a cross-midnight override with the same half-open rule', async () => {
    const operator = await createUser(ctx);
    const approver = await createUser(ctx, { role: 'ADMIN' });
    await ctx.db.insert(shiftOverrides).values({
      operatorId: operator.id,
      range: '[2026-08-23T22:05:00.000Z,2026-08-24T06:05:00.000Z)',
      type: 'OVERTIME',
      reason: 'Night coverage',
      approvedBy: approver.id,
    });

    now = new Date('2026-08-23T23:00:00.000Z');
    await expect(access.isWithinApprovedWindow(operator.id)).resolves.toBe(true);
    now = new Date('2026-08-24T06:05:00.000Z');
    await expect(access.isWithinApprovedWindow(operator.id)).resolves.toBe(false);
  });

  it('stops authorizing an override after an explicit revocation', async () => {
    const operator = await createUser(ctx);
    const approver = await createUser(ctx, { role: 'ADMIN' });
    const override = await shiftsService.createOverride({
      operatorId: operator.id,
      validFrom: '2026-08-23T05:00:00.000Z',
      validTo: '2026-08-23T07:00:00.000Z',
      type: 'SPECIAL_PERMISSION',
      reason: 'Early coverage',
    }, approver.id);

    await expect(access.isWithinApprovedWindow(operator.id)).resolves.toBe(true);
    await shiftsService.revokeOverride(override.id, approver.id);
    await expect(access.isWithinApprovedWindow(operator.id)).resolves.toBe(false);

    const [stored] = await ctx.db.select({ revokedAt: shiftOverrides.revokedAt }).from(shiftOverrides).where(eq(shiftOverrides.id, override.id));
    expect(stored.revokedAt).toBeInstanceOf(Date);
  });
});
