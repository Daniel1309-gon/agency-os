import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ShiftsService } from '../../modules/shifts/shifts.service.js';
import { BreaksService } from '../../modules/breaks/breaks.service.js';
import { CrewsService } from '../../modules/crews/crews.service.js';
import { AdminService } from '../../modules/admin/admin.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { JobsService } from '../../modules/jobs/jobs.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { DevicesService } from '../../modules/devices/devices.service.js';
import { ProfilesService } from '../../modules/profiles/profiles.service.js';
import { auditLog, breaks, crewMembers, crews as crewRows, outboxEvents, profileAssignments, shiftTemplates, shifts } from '../../database/schema/index.js';
import { createDevice, createProfile, createTestContext, createUser, destroyTestContext, halfOpen, isoOffset, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

/**
 * Estos servicios traducen constraints de Postgres a 409. La traduccion solo se
 * puede comprobar contra Postgres: con un doble, el catch nunca se ejecuta.
 */

let ctx: TestContext;
let shiftsService: ShiftsService;
let breaksService: BreaksService;
let crews: CrewsService;
let admin: AdminService;
let jobs: JobsService;
let devicesService: DevicesService;
let profilesService: ProfilesService;

beforeAll(async () => {
  ctx = await createTestContext();
  const realtime = new RealtimeService(ctx.database);
  shiftsService = new ShiftsService(ctx.database, new AuditService(ctx.database), realtime);
  breaksService = new BreaksService(ctx.database, new AuditService(ctx.database), realtime);
  crews = new CrewsService(ctx.database, new AuditService(ctx.database));
  admin = new AdminService(ctx.database, ctx.config, new AuditService(ctx.database));
  jobs = new JobsService(ctx.database, ctx.redis, realtime);
  devicesService = new DevicesService(ctx.database, new AuditService(ctx.database));
  profilesService = new ProfilesService(ctx.database, new AuditService(ctx.database));
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('ShiftsService', () => {
  it('limits coordinators to operators in their current crews', async () => {
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const managed = await createUser(ctx);
    const outsider = await createUser(ctx);
    const [crew] = await ctx.db.insert(crewRows).values({ name: 'Managed shifts', coordinatorId: coordinator.id }).returning({ id: crewRows.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)) });

    await expect(shiftsService.create({ operatorId: managed.id, businessDate: '2026-08-17', scheduledFrom: isoOffset(-30), scheduledTo: isoOffset(30) }, coordinator.id)).resolves.toMatchObject({ operatorId: managed.id });
    await expect(shiftsService.create({ operatorId: outsider.id, businessDate: '2026-08-17', scheduledFrom: isoOffset(-30), scheduledTo: isoOffset(30) }, coordinator.id)).rejects.toThrow('outside the actor crew scope');
  });

  it('turns an overlapping shift into a 409', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const shift = { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) };

    await shiftsService.create(shift, actor.id);
    const error = await shiftsService.create(shift, actor.id).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('allows back to back shifts and rejects an inverted window', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const boundary = isoOffset(60);

    await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: boundary },
      actor.id,
    );
    await expect(
      shiftsService.create({ operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: boundary, scheduledTo: isoOffset(180) }, actor.id),
    ).resolves.toBeDefined();

    await expect(
      shiftsService.create({ operatorId: operator.id, businessDate: '2026-08-05', scheduledFrom: isoOffset(300), scheduledTo: isoOffset(240) }, actor.id),
    ).rejects.toThrow(ConflictException);
  });

  it('records the effective minutes when the shift closes', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) },
      actor.id,
    );

    await shiftsService.start(shift.id, operator.id);
    expect(await shiftsService.current(operator.id)).toMatchObject({ id: shift.id, status: 'IN_PROGRESS' });

    await ctx.db.update(shifts).set({ actualStartAt: new Date(Date.now() - 45 * 60_000) }).where(eq(shifts.id, shift.id));
    const closed = await shiftsService.end(shift.id, operator.id);

    expect(closed.status).toBe('COMPLETED');
    expect(closed.effectiveMinutes).toBe(45);
  });

  it('creates scheduled breaks together with the shift and stores their assigned time', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const scheduledFrom = isoOffset(-60);
    const scheduledTo = isoOffset(60);
    const scheduledAt = isoOffset(15);

    const shift = await shiftsService.create({
      operatorId: operator.id,
      businessDate: '2026-08-04',
      scheduledFrom,
      scheduledTo,
      breaks: [{ type: 'REST', scheduledAt }],
    }, actor.id);

    const rows = await ctx.db.select().from(breaks).where(eq(breaks.shiftId, shift.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'REST', status: 'PENDING' });
    expect(rows[0].scheduledAt?.toISOString()).toBe(scheduledAt);
  });

  it('refuses to start a shift twice or to close one that never started', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) },
      actor.id,
    );

    await expect(shiftsService.end(shift.id, operator.id)).rejects.toThrow(NotFoundException);
    await shiftsService.start(shift.id, operator.id);
    await expect(shiftsService.start(shift.id, operator.id)).rejects.toThrow(NotFoundException);
  });

  it('does not let one operator start another operator shift', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const intruder = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) },
      actor.id,
    );

    await expect(shiftsService.start(shift.id, intruder.id)).rejects.toThrow(NotFoundException);
  });

  it('does not let an operator start a future shift early', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(60), scheduledTo: isoOffset(120) },
      actor.id,
    );

    await expect(shiftsService.start(shift.id, operator.id)).rejects.toThrow(NotFoundException);
  });
});

describe('BreaksService', () => {
  async function shiftWithBreak(): Promise<{ operatorId: string; shiftId: string; breakId: string }> {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) },
      actor.id,
    );
    const [row] = await ctx.db.insert(breaks).values({ shiftId: shift.id, type: 'SCHEDULED', status: 'PENDING' }).returning({ id: breaks.id });
    await shiftsService.start(shift.id, operator.id);
    return { operatorId: operator.id, shiftId: shift.id, breakId: row.id };
  }

  it('measures the break from start to end', async () => {
    const s = await shiftWithBreak();
    await breaksService.start(s.breakId, s.operatorId);
    await ctx.db.update(breaks).set({ startedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(breaks.id, s.breakId));

    const ended = await breaksService.end(s.breakId, s.operatorId);
    expect(ended).toMatchObject({ status: 'COMPLETED', durationMinutes: 20 });
  });

  it('refuses to start a break twice or to end one that never started', async () => {
    const s = await shiftWithBreak();
    await expect(breaksService.end(s.breakId, s.operatorId)).rejects.toThrow(NotFoundException);
    await breaksService.start(s.breakId, s.operatorId);
    await expect(breaksService.start(s.breakId, s.operatorId)).rejects.toThrow(ConflictException);
  });

  it('does not let an operator take somebody else break', async () => {
    const s = await shiftWithBreak();
    const intruder = await createUser(ctx);
    await expect(breaksService.start(s.breakId, intruder.id)).rejects.toThrow(ConflictException);
    expect(await breaksService.list(s.shiftId, intruder.id)).toHaveLength(0);
  });

  it('allows at most one active break per operator', async () => {
    const s = await shiftWithBreak();
    const [second] = await ctx.db.insert(breaks).values({ shiftId: s.shiftId, type: 'REST', status: 'PENDING' }).returning({ id: breaks.id });

    await breaksService.start(s.breakId, s.operatorId);
    await expect(breaksService.start(second.id, s.operatorId)).rejects.toThrow(ConflictException);
  });

  it('closes an active break and cancels pending breaks when the shift ends', async () => {
    const s = await shiftWithBreak();
    await breaksService.start(s.breakId, s.operatorId);
    const [pending] = await ctx.db.insert(breaks).values({ shiftId: s.shiftId, type: 'REST', status: 'PENDING' }).returning({ id: breaks.id });

    await shiftsService.end(s.shiftId, s.operatorId);

    const rows = await ctx.db.select({ id: breaks.id, status: breaks.status, endedAt: breaks.endedAt }).from(breaks).where(eq(breaks.shiftId, s.shiftId));
    expect(rows.find((row) => row.id === s.breakId)).toMatchObject({ status: 'COMPLETED' });
    expect(rows.find((row) => row.id === s.breakId)?.endedAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.id === pending.id)).toMatchObject({ status: 'CANCELLED' });
  });

  it('emits one durable reminder for an upcoming scheduled break', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const shift = await shiftsService.create({
      operatorId: operator.id,
      businessDate: '2026-08-04',
      scheduledFrom: isoOffset(-60),
      scheduledTo: isoOffset(60),
      breaks: [{ type: 'REST', scheduledAt: isoOffset(5) }],
    }, actor.id);

    await (jobs as unknown as { notifyUpcomingBreaks(): Promise<void> }).notifyUpcomingBreaks();
    await (jobs as unknown as { notifyUpcomingBreaks(): Promise<void> }).notifyUpcomingBreaks();

    const [scheduled] = await ctx.db.select({ notifiedAt: breaks.notifiedAt }).from(breaks).where(eq(breaks.shiftId, shift.id));
    const events = await ctx.db.select({ eventType: outboxEvents.eventType, aggregateId: outboxEvents.aggregateId }).from(outboxEvents);
    expect(scheduled.notifiedAt).toBeInstanceOf(Date);
    expect(events).toEqual([{ eventType: 'break.reminder', aggregateId: expect.any(String) }]);
  });
});

describe('JobsService', () => {
  it('materializes one overnight shift from an active crew template and is idempotent', async () => {
    const operator = await createUser(ctx);
    const [crew] = await ctx.db.insert(crewRows).values({ name: 'Night crew' }).returning({ id: crewRows.id });
    await ctx.db.insert(crewMembers).values({
      crewId: crew.id,
      userId: operator.id,
      validRange: halfOpen(new Date('2026-08-23T00:00:00.000Z'), new Date('2026-08-25T00:00:00.000Z')),
    });
    const [template] = await ctx.db.insert(shiftTemplates).values({
      name: 'Sunday night',
      crewId: crew.id,
      startTime: '22:05:00',
      endTime: '06:05:00',
      crossesMidnight: true,
      weekdays: [0],
      breakMinutes: 0,
      validFrom: '2026-08-23',
      isActive: true,
    }).returning({ id: shiftTemplates.id });

    await expect((jobs as unknown as { materializeShifts(businessDate: string): Promise<number> }).materializeShifts('2026-08-23')).resolves.toBe(1);
    await expect((jobs as unknown as { materializeShifts(businessDate: string): Promise<number> }).materializeShifts('2026-08-23')).resolves.toBe(0);

    const rows = await ctx.db.select({ operatorId: shifts.operatorId, businessDate: shifts.businessDate, scheduledRange: shifts.scheduledRange, status: shifts.status }).from(shifts).where(eq(shifts.templateId, template.id));
    expect(rows).toEqual([{
      operatorId: operator.id,
      businessDate: '2026-08-23',
      scheduledRange: '["2026-08-24 03:05:00+00","2026-08-24 11:05:00+00")',
      status: 'SCHEDULED',
    }]);
  });

  it('closes a shift exactly at its upper boundary and finalizes its breaks', async () => {
    const operator = await createUser(ctx);
    const start = new Date('2026-08-23T06:05:00.000Z');
    const end = new Date('2026-08-23T14:05:00.000Z');
    const [missedShift] = await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: '2026-08-22',
      scheduledRange: halfOpen(new Date('2026-08-22T22:05:00.000Z'), start),
      status: 'SCHEDULED',
    }).returning({ id: shifts.id });
    const [shift] = await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: '2026-08-23',
      scheduledRange: halfOpen(start, end),
      status: 'IN_PROGRESS',
      actualStartAt: start,
    }).returning({ id: shifts.id });
    const [breakRow] = await ctx.db.insert(breaks).values({
      shiftId: shift.id,
      type: 'REST',
      status: 'IN_PROGRESS',
      startedAt: new Date('2026-08-23T13:00:00.000Z'),
    }).returning({ id: breaks.id });

    await (jobs as unknown as { closeExpiredShifts(at: Date): Promise<void> }).closeExpiredShifts(end);

    const [closedShift] = await ctx.db.select({ status: shifts.status, actualEndAt: shifts.actualEndAt, effectiveMinutes: shifts.effectiveMinutes }).from(shifts).where(eq(shifts.id, shift.id));
    expect(closedShift).toMatchObject({ status: 'COMPLETED', actualEndAt: end, effectiveMinutes: 480 });
    const [missed] = await ctx.db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, missedShift.id));
    expect(missed.status).toBe('MISSED');
    const [closedBreak] = await ctx.db.select({ status: breaks.status, endedAt: breaks.endedAt, durationMinutes: breaks.durationMinutes }).from(breaks).where(eq(breaks.id, breakRow.id));
    expect(closedBreak).toMatchObject({ status: 'COMPLETED', endedAt: end, durationMinutes: 65 });
  });
});

describe('CrewsService', () => {
  it('turns an overlapping crew membership into a 409', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const principal = { sub: actor.id, role: 'ADMIN' };
    const operator = await createUser(ctx);
    const alpha = await crews.create({ name: 'Alpha' }, principal);
    const beta = await crews.create({ name: 'Beta' }, principal);
    const window = { userId: operator.id, validFrom: isoOffset(-60), validTo: isoOffset(600) };

    await crews.addMember(alpha.id, window, principal);
    const error = await crews.addMember(beta.id, window, principal).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('closes the membership window on removal, so the operator can move crew', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const principal = { sub: actor.id, role: 'ADMIN' };
    const operator = await createUser(ctx);
    const alpha = await crews.create({ name: 'Alpha' }, principal);
    const beta = await crews.create({ name: 'Beta' }, principal);

    await crews.addMember(alpha.id, { userId: operator.id, validFrom: isoOffset(-60), validTo: isoOffset(600) }, principal);
    await crews.remove(alpha.id, operator.id, principal);

    await expect(crews.addMember(beta.id, { userId: operator.id, validFrom: isoOffset(1), validTo: isoOffset(600) }, principal)).resolves.toBeDefined();
  });

  it('rejects removing somebody who is not a current member', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const principal = { sub: actor.id, role: 'ADMIN' };
    const operator = await createUser(ctx);
    const alpha = await crews.create({ name: 'Alpha' }, principal);
    await expect(crews.remove(alpha.id, operator.id, principal)).rejects.toThrow(NotFoundException);
  });

  it('prevents a coordinator from managing another coordinator crew', async () => {
    const first = await createUser(ctx, { role: 'COORDINADOR' });
    const second = await createUser(ctx, { role: 'COORDINADOR' });
    const operator = await createUser(ctx);
    const [foreignCrew] = await ctx.db.insert(crewRows).values({ name: 'Foreign', coordinatorId: second.id }).returning({ id: crewRows.id });

    await expect(crews.addMember(foreignCrew.id, { userId: operator.id, validFrom: isoOffset(-60), validTo: isoOffset(600) }, { sub: first.id, role: 'COORDINADOR' })).rejects.toThrow('outside the actor scope');
    await expect(crews.list({ sub: first.id, role: 'COORDINADOR' })).resolves.toEqual([]);
  });
});

describe('AdminService', () => {
  it('limits a coordinator user directory to self and current crew members', async () => {
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const managed = await createUser(ctx);
    const outsider = await createUser(ctx);
    const [crew] = await ctx.db.insert(crewRows).values({ name: 'Managed users', coordinatorId: coordinator.id }).returning({ id: crewRows.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)) });

    const result = await admin.listUsers({ sub: coordinator.id, role: 'COORDINADOR' });

    expect(result.map((user) => user.id).sort()).toEqual([coordinator.id, managed.id].sort());
    expect(result.map((user) => user.id)).not.toContain(outsider.id);
  });

  it('limits coordinator audit reads to actors in their crew at event time', async () => {
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const managed = await createUser(ctx);
    const outsider = await createUser(ctx);
    const [crew] = await ctx.db.insert(crewRows).values({ name: 'Managed audit', coordinatorId: coordinator.id }).returning({ id: crewRows.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)) });
    await ctx.db.insert(auditLog).values([
      { actorType: 'USER', actorUserId: managed.id, action: 'scope.test', result: 'SUCCESS' },
      { actorType: 'USER', actorUserId: outsider.id, action: 'scope.test', result: 'SUCCESS' },
    ]);

    const rows = await admin.audit({ action: 'scope.test' }, { sub: coordinator.id, role: 'COORDINADOR' });

    expect(rows.data).toEqual([expect.objectContaining({ actorUserId: managed.id })]);
  });

  it('turns a duplicate email into a 409', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const input = { email: 'nueva@agency.test', fullName: 'Nueva', password: 'una-contrasena-inicial', roleCode: 'OPERADOR' };

    await admin.createUser(input, actor.id);
    const error = await admin.createUser(input, actor.id).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('creates the user forced to change password, and never returns the hash', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const created = await admin.createUser(
      { email: 'Nueva@Agency.test', fullName: 'Nueva', password: 'una-contrasena-inicial', roleCode: 'OPERADOR' },
      actor.id,
    );

    expect(created).toMatchObject({ email: 'nueva@agency.test', mustChangePassword: true });
    expect(Object.keys(created)).not.toContain('passwordHash');
  });

  it('turns an overlapping compensation range into a 409', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const input = { commissionRate: 0.3, pointsToCopRate: 10, maxConcurrentProfiles: 1, validFrom: isoOffset(-60), validTo: isoOffset(600) };

    await admin.addCompensation(operator.id, input, actor.id);
    const error = await admin.addCompensation(operator.id, { ...input, commissionRate: 0.4 }, actor.id).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('rejects an unknown role instead of creating a user without one', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    await expect(
      admin.createUser({ email: 'x@agency.test', fullName: 'X', password: 'una-contrasena', roleCode: 'NO_EXISTE' }, actor.id),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('Delivery 1 crew-scoped resources', () => {
  it('treats enrolled computers as shared office stations instead of crew-owned devices', async () => {
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const managed = await createUser(ctx);
    const outsider = await createUser(ctx);
    const [crew] = await ctx.db.insert(crewRows).values({ name: 'Managed devices', coordinatorId: coordinator.id }).returning({ id: crewRows.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)) });
    const ownDevice = await createDevice(ctx, { operatorId: managed.id });
    const foreignDevice = await createDevice(ctx, { operatorId: outsider.id });
    const actor = { sub: coordinator.id, role: 'COORDINADOR' };

    await expect(devicesService.list(actor)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ownDevice.id }),
      expect.objectContaining({ id: foreignDevice.id }),
    ]));
    await expect(devicesService.get(foreignDevice.id, actor)).resolves.toMatchObject({ id: foreignDevice.id });
    await expect(devicesService.create({ hostname: 'shared-host', label: 'Shared station' }, actor)).resolves.toMatchObject({ label: 'Shared station' });
  });

  it('shows profiles only through ownership or a current in-scope assignment', async () => {
    const adminUser = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const managed = await createUser(ctx);
    const outsider = await createUser(ctx);
    const [crew] = await ctx.db.insert(crewRows).values({ name: 'Managed profiles', coordinatorId: coordinator.id }).returning({ id: crewRows.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)) });
    const visible = await createProfile(ctx, { displayName: 'Visible' });
    const hidden = await createProfile(ctx, { displayName: 'Hidden' });
    await ctx.db.insert(profileAssignments).values([
      { profileId: visible.id, operatorId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)), status: 'ACTIVE', assignedBy: adminUser.id },
      { profileId: hidden.id, operatorId: outsider.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)), status: 'ACTIVE', assignedBy: adminUser.id },
    ]);

    const coordinatorView = await profilesService.list({ sub: coordinator.id, role: 'COORDINADOR' });
    const operatorView = await profilesService.list({ sub: managed.id, role: 'OPERADOR' });

    expect(coordinatorView.data.map((profile) => profile.id)).toEqual([visible.id]);
    expect(operatorView.data.map((profile) => profile.id)).toEqual([visible.id]);
    await expect(profilesService.get(hidden.id, { sub: coordinator.id, role: 'COORDINADOR' })).rejects.toThrow(NotFoundException);
  });
});
