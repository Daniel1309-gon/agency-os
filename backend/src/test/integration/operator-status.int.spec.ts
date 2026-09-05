import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { AssignmentsService } from '../../modules/assignments/assignments.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import type { Server } from 'socket.io';
import { OperatorStatusService } from '../../modules/operator-status/operator-status.service.js';
import { ShiftsService } from '../../modules/shifts/shifts.service.js';
import { breaks, crews, crewMembers, operatorCurrentStatus } from '../../database/schema/index.js';
import {
  createDevice,
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  isoOffset,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let assignments: AssignmentsService;
let shiftsService: ShiftsService;
let status: OperatorStatusService;
let emitted: Array<{ event: string; payload: { operatorId: string; status: string } }>;

beforeAll(async () => {
  ctx = await createTestContext();
  const realtime = new RealtimeService(ctx.database);
  emitted = [];
  realtime.attach({
    to: vi.fn(() => ({ emit: (event: string, payload: { operatorId: string; status: string }) => emitted.push({ event, payload }) })),
  } as unknown as Server);
  assignments = new AssignmentsService(ctx.database, new AuditService(ctx.database), realtime);
  shiftsService = new ShiftsService(ctx.database, new AuditService(ctx.database), realtime);
  status = new OperatorStatusService(ctx.database, realtime);
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
    const scheduledFrom = isoOffset(-60);
    const scheduledTo = isoOffset(60);
    const shift = await shiftsService.create({
      operatorId: operator.id,
      businessDate: '2026-08-17',
      scheduledFrom,
      scheduledTo,
    }, admin.id);
    const assignment = await assignments.create({
      profileId: profile.id,
      operatorId: operator.id,
      shiftId: shift.id,
      validFrom: scheduledFrom,
      validTo: scheduledTo,
    }, admin.id);
    const session = await assignments.openSession({ profileId: profile.id, assignmentId: assignment.id, chromeProfileDir: 'Profile 1' }, operator.id, device.token);
    const active = await assignments.updateSession(session.id, { status: 'ACTIVE', version: session.version }, operator.id, device.token);
    expect(emitted.at(-1)).toMatchObject({ event: 'operator.status.changed', payload: { operatorId: operator.id, status: 'ONLINE' } });

    let [row] = await status.list({ sub: admin.id, role: 'ADMIN' });
    expect(row).toMatchObject({ operatorId: operator.id, status: 'ONLINE' });

    await ctx.db.insert(breaks).values({ shiftId: shift.id, type: 'LUNCH', status: 'IN_PROGRESS', startedAt: new Date() });
    [row] = await status.list({ sub: admin.id, role: 'ADMIN' });
    expect(row.status).toBe('BREAK');

    await ctx.db.insert(operatorCurrentStatus).values({ operatorId: operator.id, status: 'ALERT', reason: 'LOGIN_FAILED', changedAt: new Date() });
    [row] = await status.list({ sub: admin.id, role: 'ADMIN' });
    expect(row).toMatchObject({ status: 'ALERT', reason: 'LOGIN_FAILED' });

    await ctx.db.delete(operatorCurrentStatus).where(eq(operatorCurrentStatus.operatorId, operator.id));
    await ctx.db.update(breaks).set({ status: 'COMPLETED', endedAt: new Date() }).where(and(eq(breaks.shiftId, shift.id), eq(breaks.status, 'IN_PROGRESS')));
    await assignments.closeSession(session.id, active.version, operator.id, device.token);
    [row] = await status.list({ sub: admin.id, role: 'ADMIN' });
    expect(row.status).toBe('OFFLINE');
  });

  it('limits a coordinator snapshot to operators in the coordinator current crew', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const inScope = await createUser(ctx, { role: 'OPERADOR', email: 'inside@agency.test' });
    const outOfScope = await createUser(ctx, { role: 'OPERADOR', email: 'outside@agency.test' });
    const [crew] = await ctx.db.insert(crews).values({
      name: 'Cuadrilla de prueba',
      coordinatorId: coordinator.id,
      isActive: true,
      createdBy: admin.id,
      updatedBy: admin.id,
    }).returning({ id: crews.id });
    await ctx.db.insert(crewMembers).values({
      crewId: crew.id,
      userId: inScope.id,
      validRange: halfOpen(isoOffset(-60), isoOffset(60)),
    });
    await ctx.db.insert(operatorCurrentStatus).values([
      { operatorId: inScope.id, status: 'ONLINE', reason: 'SESSION_ACTIVE', changedAt: new Date() },
      { operatorId: outOfScope.id, status: 'ALERT', reason: 'LOGIN_FAILED', changedAt: new Date() },
    ]);

    const snapshot = await status.list({ sub: coordinator.id, role: 'COORDINADOR' });

    expect(snapshot.map((row) => row.operatorId)).toEqual([inScope.id]);
  });
});
