import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { AssignmentsService } from '../../modules/assignments/assignments.service.js';
import { OperatorStatusService } from '../../modules/operator-status/operator-status.service.js';
import { ShiftsService } from '../../modules/shifts/shifts.service.js';
import { breaks, operatorCurrentStatus } from '../../database/schema/index.js';
import {
  createDevice,
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  isoOffset,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let assignments: AssignmentsService;
let shiftsService: ShiftsService;
let status: OperatorStatusService;

beforeAll(async () => {
  ctx = await createTestContext();
  assignments = new AssignmentsService(ctx.database);
  shiftsService = new ShiftsService(ctx.database);
  status = new OperatorStatusService(ctx.database);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('operator status projection', () => {
  it('derives ALERT over BREAK over ONLINE and falls back to OFFLINE', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx, { role: 'OPERADOR' });
    const profile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const shift = await shiftsService.create({
      operatorId: operator.id,
      businessDate: '2026-08-17',
      scheduledFrom: isoOffset(-60),
      scheduledTo: isoOffset(60),
    }, admin.id);
    const assignment = await assignments.create({
      profileId: profile.id,
      operatorId: operator.id,
      shiftId: shift.id,
      validFrom: isoOffset(-60),
      validTo: isoOffset(60),
    }, admin.id);
    const session = await assignments.openSession({ profileId: profile.id, assignmentId: assignment.id, chromeProfileDir: 'Profile 1' }, operator.id, device.token);
    await assignments.updateSession(session.id, { status: 'ACTIVE' }, operator.id, device.token);

    let [row] = await status.list();
    expect(row).toMatchObject({ operatorId: operator.id, status: 'ONLINE' });

    await ctx.db.insert(breaks).values({ shiftId: shift.id, type: 'LUNCH', status: 'IN_PROGRESS', startedAt: new Date() });
    [row] = await status.list();
    expect(row.status).toBe('BREAK');

    await ctx.db.insert(operatorCurrentStatus).values({ operatorId: operator.id, status: 'ALERT', reason: 'LOGIN_FAILED', changedAt: new Date() });
    [row] = await status.list();
    expect(row).toMatchObject({ status: 'ALERT', reason: 'LOGIN_FAILED' });

    await ctx.db.delete(operatorCurrentStatus).where(eq(operatorCurrentStatus.operatorId, operator.id));
    await ctx.db.update(breaks).set({ status: 'COMPLETED', endedAt: new Date() }).where(and(eq(breaks.shiftId, shift.id), eq(breaks.status, 'IN_PROGRESS')));
    await assignments.closeSession(session.id, operator.id, device.token);
    [row] = await status.list();
    expect(row.status).toBe('OFFLINE');
  });
});
