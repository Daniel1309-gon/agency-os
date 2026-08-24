import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AssignmentsService } from '../../modules/assignments/assignments.service.js';
import { ProfilesService } from '../../modules/profiles/profiles.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { JobsService } from '../../modules/jobs/jobs.service.js';
import { auditLog, crewMembers, crews, profileAssignments, profileSessions, shifts } from '../../database/schema/index.js';
import { assignedProfileSchema } from '@agency-os/shared';
import {
  createDevice,
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  isoOffset,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let assignments: AssignmentsService;
let profiles: ProfilesService;
let jobs: JobsService;

beforeAll(async () => {
  ctx = await createTestContext();
  assignments = new AssignmentsService(ctx.database, new AuditService(ctx.database), new RealtimeService(ctx.database));
  profiles = new ProfilesService(ctx.database, new AuditService(ctx.database));
  jobs = new JobsService(ctx.database, ctx.redis, new RealtimeService(ctx.database));
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

const NOW_WINDOW = () => ({ validFrom: isoOffset(-60), validTo: isoOffset(60) });

describe('AssignmentsService.create', () => {
  it('returns assigned profiles that conform to the shared operator response contract', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const validFrom = isoOffset(-60);
    const validTo = isoOffset(60);
    const [shift] = await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: new Date().toISOString().slice(0, 10),
      scheduledRange: halfOpen(validFrom, validTo),
      createdBy: admin.id,
    }).returning({ id: shifts.id });
    await assignments.create({ profileId: profile.id, operatorId: operator.id, shiftId: shift.id, validFrom, validTo }, admin.id);

    const [assigned] = await profiles.assignedTo(operator.id);

    expect(assignedProfileSchema.safeParse(assigned)).toMatchObject({ success: true });
    expect(assigned).toMatchObject({ shiftId: shift.id });
  });

  it('assigns an active profile to an active operator', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);

    const row = await assignments.create({ profileId: profile.id, operatorId: operator.id, ...NOW_WINDOW() }, admin.id);
    expect(row).toMatchObject({ profileId: profile.id, operatorId: operator.id });
  });

  it('turns the exclusion constraint into a 409, not a 500', async () => {
    // Criterio de entrega de PLAN.md §9: dos operadores sobre el mismo perfil.
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const first = await createUser(ctx);
    const second = await createUser(ctx);
    const profile = await createProfile(ctx);

    await assignments.create({ profileId: profile.id, operatorId: first.id, ...NOW_WINDOW() }, admin.id);

    const error = await assignments
      .create({ profileId: profile.id, operatorId: second.id, ...NOW_WINDOW() }, admin.id)
      .catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('allows the handover: the next shift starts where the previous one ends', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const morning = await createUser(ctx);
    const afternoon = await createUser(ctx);
    const profile = await createProfile(ctx);
    const boundary = isoOffset(60);

    await assignments.create({ profileId: profile.id, operatorId: morning.id, validFrom: isoOffset(-60), validTo: boundary }, admin.id);
    await expect(
      assignments.create({ profileId: profile.id, operatorId: afternoon.id, validFrom: boundary, validTo: isoOffset(180) }, admin.id),
    ).resolves.toBeDefined();
  });

  it('closes the previous assignment and session at an exact contiguous handoff', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const morning = await createUser(ctx);
    const afternoon = await createUser(ctx);
    const profile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: morning.id });
    const boundary = isoOffset(60);
    const first = await assignments.create({ profileId: profile.id, operatorId: morning.id, validFrom: isoOffset(-60), validTo: boundary }, admin.id);
    const session = await assignments.openSession({ profileId: profile.id, assignmentId: first.id, chromeProfileDir: 'Profile 1' }, morning.id, device.token);
    await assignments.updateSession(session.id, { status: 'ACTIVE' }, morning.id, device.token);

    const second = await assignments.create({ profileId: profile.id, operatorId: afternoon.id, validFrom: boundary, validTo: isoOffset(180) }, admin.id);

    const [previous] = await ctx.db.select({ status: profileAssignments.status, endReason: profileAssignments.endReason, endedAt: profileAssignments.endedAt }).from(profileAssignments).where(eq(profileAssignments.id, first.id));
    const [closedSession] = await ctx.db.select({ status: profileSessions.status, endReason: profileSessions.endReason, endedAt: profileSessions.endedAt }).from(profileSessions).where(eq(profileSessions.id, session.id));
    expect(second).toMatchObject({ operatorId: afternoon.id });
    expect(previous).toMatchObject({ status: 'ENDED', endReason: 'HANDOFF', endedAt: new Date(boundary) });
    expect(closedSession).toMatchObject({ status: 'CLOSED', endReason: 'SHIFT_ENDED', endedAt: new Date(boundary) });
  });

  it('does not let a coordinator hand off an operator outside their crew scope', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const incoming = await createUser(ctx);
    const outgoing = await createUser(ctx);
    const profile = await createProfile(ctx);
    const [crew] = await ctx.db.insert(crews).values({ name: 'Incoming crew', coordinatorId: coordinator.id }).returning({ id: crews.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: incoming.id, validRange: halfOpen(isoOffset(-60), isoOffset(180)) });
    const boundary = isoOffset(60);
    const first = await assignments.create({ profileId: profile.id, operatorId: outgoing.id, validFrom: isoOffset(-60), validTo: boundary }, admin.id);

    await expect(
      assignments.create({ profileId: profile.id, operatorId: incoming.id, validFrom: boundary, validTo: isoOffset(180) }, coordinator.id),
    ).rejects.toThrow(ForbiddenException);

    const [previous] = await ctx.db.select({ status: profileAssignments.status }).from(profileAssignments).where(eq(profileAssignments.id, first.id));
    expect(previous).toEqual({ status: 'ACTIVE' });
  });

  it('rejects a window that ends before it starts', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);

    await expect(
      assignments.create({ profileId: profile.id, operatorId: operator.id, validFrom: isoOffset(60), validTo: isoOffset(-60) }, admin.id),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a retired profile or a disabled operator', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const disabled = await createUser(ctx, { status: 'DISABLED' });
    const active = await createProfile(ctx);
    const paused = await createProfile(ctx, { status: 'PAUSED' });

    await expect(assignments.create({ profileId: paused.id, operatorId: operator.id, ...NOW_WINDOW() }, admin.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(assignments.create({ profileId: active.id, operatorId: disabled.id, ...NOW_WINDOW() }, admin.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('only assigns users with the OPERADOR role', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const profile = await createProfile(ctx);

    await expect(
      assignments.create({ profileId: profile.id, operatorId: coordinator.id, ...NOW_WINDOW() }, admin.id),
    ).rejects.toThrow(ConflictException);
  });

  it('limits coordinators to operators in their current crews', async () => {
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const managed = await createUser(ctx);
    const outsider = await createUser(ctx);
    const managedProfile = await createProfile(ctx);
    const outsiderProfile = await createProfile(ctx);
    const [crew] = await ctx.db.insert(crews).values({ name: 'Managed crew', coordinatorId: coordinator.id }).returning({ id: crews.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: managed.id, validRange: halfOpen(isoOffset(-60), isoOffset(60)) });

    await expect(assignments.create({ profileId: managedProfile.id, operatorId: managed.id, ...NOW_WINDOW() }, coordinator.id)).resolves.toMatchObject({ operatorId: managed.id });
    await expect(assignments.create({ profileId: outsiderProfile.id, operatorId: outsider.id, ...NOW_WINDOW() }, coordinator.id)).rejects.toThrow('outside the actor crew scope');
    await expect(assignments.history({ page: 1, pageSize: 10 }, coordinator.id)).resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ operatorId: managed.id })] });
  });

  it('requires an assignment linked to a shift to match its operator and window', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const other = await createUser(ctx);
    const profile = await createProfile(ctx);
    const validFrom = isoOffset(-60);
    const validTo = isoOffset(60);
    const [shift] = await ctx.db
      .insert(shifts)
      .values({
        operatorId: other.id,
        businessDate: '2026-08-17',
        scheduledRange: `[${validFrom},${validTo})`,
        createdBy: admin.id,
      })
      .returning({ id: shifts.id });

    await expect(
      assignments.create({ profileId: profile.id, operatorId: operator.id, shiftId: shift.id, validFrom, validTo }, admin.id),
    ).rejects.toThrow(ConflictException);

    await ctx.db.update(shifts).set({ operatorId: operator.id }).where(eq(shifts.id, shift.id));
    await expect(
      assignments.create({ profileId: profile.id, operatorId: operator.id, shiftId: shift.id, validFrom: isoOffset(-120), validTo }, admin.id),
    ).rejects.toThrow(ConflictException);
  });

  it('lets a different authorized actor end an assignment and exposes paginated history', async () => {
    const creator = await createUser(ctx, { role: 'ADMIN' });
    const closer = await createUser(ctx, { role: 'DIRECTOR_OPERATIVO' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const row = await assignments.create({ profileId: profile.id, operatorId: operator.id, ...NOW_WINDOW() }, creator.id);

    await expect(assignments.end(row.id, closer.id)).resolves.toEqual({ id: row.id });
    const history = await assignments.history({ page: 1, pageSize: 10, operatorId: operator.id }, closer.id);
    expect(history).toMatchObject({ page: 1, pageSize: 10, total: 1 });
    expect(history.items[0]).toMatchObject({ id: row.id, status: 'ENDED', operatorId: operator.id });
    const audit = await ctx.db
      .select({ action: auditLog.action, actorUserId: auditLog.actorUserId })
      .from(auditLog)
      .where(eq(auditLog.entityId, row.id));
    expect(audit).toEqual([
      { action: 'assignment.created', actorUserId: creator.id },
      { action: 'assignment.ended', actorUserId: closer.id },
    ]);
  });
});

describe('AssignmentsService sessions', () => {
  async function ready(): Promise<{ operatorId: string; profileId: string; assignmentId: string; deviceToken: string }> {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const assignment = await assignments.create({ profileId: profile.id, operatorId: operator.id, ...NOW_WINDOW() }, admin.id);
    return { operatorId: operator.id, profileId: profile.id, assignmentId: assignment.id, deviceToken: device.token };
  }

  it('opens a session in LAUNCHING', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    expect(session).toMatchObject({ status: 'LAUNCHING' });
  });

  it('prepares a session without choosing a workstation for the operator', async () => {
    const s = await ready();
    const session = await assignments.prepareSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
    );

    const [stored] = await ctx.db
      .select({ deviceId: profileSessions.deviceId, status: profileSessions.status })
      .from(profileSessions)
      .where(eq(profileSessions.id, session.id));
    expect(stored).toEqual({ deviceId: null, status: 'LAUNCHING' });
  });

  it('turns the single-live-session index into a 409', async () => {
    const s = await ready();
    const input = { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' };
    await assignments.openSession(input, s.operatorId, s.deviceToken);

    const error = await assignments.openSession(input, s.operatorId, s.deviceToken).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('frees the profile once the session is closed', async () => {
    const s = await ready();
    const input = { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' };
    const first = await assignments.openSession(input, s.operatorId, s.deviceToken);

    await assignments.closeSession(first.id, s.operatorId, s.deviceToken);
    await expect(assignments.openSession(input, s.operatorId, s.deviceToken)).resolves.toBeDefined();

    const [closed] = await ctx.db
      .select({ status: profileSessions.status, endReason: profileSessions.endReason, endedAt: profileSessions.endedAt })
      .from(profileSessions)
      .where(eq(profileSessions.id, first.id));
    expect(closed).toMatchObject({ status: 'CLOSED', endReason: 'OPERATOR_CLOSED' });
    expect(closed.endedAt).toBeInstanceOf(Date);
  });

  it('closes the live session immediately when its assignment ends', async () => {
    const s = await ready();
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    await assignments.updateSession(session.id, { status: 'ACTIVE' }, s.operatorId, s.deviceToken);

    await assignments.end(s.assignmentId, admin.id);

    const [closed] = await ctx.db
      .select({ status: profileSessions.status, endReason: profileSessions.endReason, endedAt: profileSessions.endedAt })
      .from(profileSessions)
      .where(eq(profileSessions.id, session.id));
    expect(closed).toMatchObject({ status: 'CLOSED', endReason: 'ASSIGNMENT_ENDED' });
    expect(closed.endedAt).toBeInstanceOf(Date);
  });

  it('allows the operator to open a session from any approved office station', async () => {
    const s = await ready();
    const previousUser = await createUser(ctx);
    const sharedStation = await createDevice(ctx, { operatorId: previousUser.id });

    await expect(
      assignments.openSession({ profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 2' }, s.operatorId, sharedStation.token),
    ).resolves.toMatchObject({ status: 'LAUNCHING' });
  });

  it('refuses to open a session on an assignment that is not the operator own', async () => {
    const s = await ready();
    const other = await createUser(ctx);
    const otherDevice = await createDevice(ctx, { operatorId: other.id });

    await expect(
      assignments.openSession({ profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'P' }, other.id, otherDevice.token),
    ).rejects.toThrow(ForbiddenException);
  });

  it('records a heartbeat and an error state', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );

    const beat = await assignments.updateSession(session.id, { status: 'ACTIVE' }, s.operatorId, s.deviceToken);
    expect(beat.status).toBe('ACTIVE');
    expect(beat.lastHeartbeatAt).toBeInstanceOf(Date);

    await assignments.updateSession(
      session.id,
      { status: 'ERROR', errorCode: 'LOGIN_FAILED', errorDetail: 'TalkyTimes rechazo la credencial' },
      s.operatorId,
      s.deviceToken,
    );
    const [errored] = await ctx.db
      .select({ status: profileSessions.status, errorCode: profileSessions.errorCode })
      .from(profileSessions)
      .where(eq(profileSessions.id, session.id));
    expect(errored).toMatchObject({ status: 'ERROR', errorCode: 'LOGIN_FAILED' });
  });

  it('does not reopen a closed session through PATCH', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    await assignments.closeSession(session.id, s.operatorId, s.deviceToken);

    await expect(
      assignments.updateSession(session.id, { status: 'ACTIVE' }, s.operatorId, s.deviceToken),
    ).rejects.toThrow(ConflictException);
  });

  it('revalidates the assignment window before every session transition', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    await ctx.db
      .update(profileAssignments)
      .set({ validRange: `[${isoOffset(-120)},${isoOffset(-60)})` })
      .where(eq(profileAssignments.id, s.assignmentId));

    await expect(
      assignments.updateSession(session.id, { status: 'ACTIVE' }, s.operatorId, s.deviceToken),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not let one operator touch another operator session', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    const other = await createUser(ctx);
    const otherDevice = await createDevice(ctx, { operatorId: other.id });

    await expect(assignments.updateSession(session.id, { status: 'CLOSED' }, other.id, otherDevice.token)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('closes a LAUNCHING session that never reaches the extension handshake', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    await ctx.db.update(profileSessions).set({ startedAt: new Date(Date.now() - 121_000) }).where(eq(profileSessions.id, session.id));

    await (jobs as unknown as { reapSessions(): Promise<void> }).reapSessions();

    const [closed] = await ctx.db.select({ status: profileSessions.status, endReason: profileSessions.endReason }).from(profileSessions).where(eq(profileSessions.id, session.id));
    expect(closed).toEqual({ status: 'CLOSED', endReason: 'LAUNCH_TIMEOUT' });
  });

  it('closes a live session when its half-open assignment ends at the boundary', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    await assignments.updateSession(session.id, { status: 'ACTIVE' }, s.operatorId, s.deviceToken);
    await ctx.db.update(profileAssignments).set({ validRange: `[${new Date(Date.now() - 3_600_000).toISOString()},${new Date(Date.now() - 1_000).toISOString()})` }).where(eq(profileAssignments.id, s.assignmentId));

    await (jobs as unknown as { reapSessions(): Promise<void> }).reapSessions();

    const [closed] = await ctx.db.select({ status: profileSessions.status, endReason: profileSessions.endReason }).from(profileSessions).where(eq(profileSessions.id, session.id));
    expect(closed).toEqual({ status: 'CLOSED', endReason: 'ASSIGNMENT_ENDED' });
  });

  it('closes an ERROR session when its assignment window expires', async () => {
    const s = await ready();
    const session = await assignments.openSession(
      { profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'Profile 1' },
      s.operatorId,
      s.deviceToken,
    );
    await assignments.updateSession(session.id, { status: 'ERROR', errorCode: 'LOGIN_FAILED' }, s.operatorId, s.deviceToken);
    await ctx.db.update(profileAssignments).set({ validRange: `[${new Date(Date.now() - 3_600_000).toISOString()},${new Date(Date.now() - 1_000).toISOString()})` }).where(eq(profileAssignments.id, s.assignmentId));

    await (jobs as unknown as { reapSessions(): Promise<void> }).reapSessions();

    const [closed] = await ctx.db.select({ status: profileSessions.status, endReason: profileSessions.endReason }).from(profileSessions).where(eq(profileSessions.id, session.id));
    expect(closed).toEqual({ status: 'CLOSED', endReason: 'ASSIGNMENT_ENDED' });
  });
});
