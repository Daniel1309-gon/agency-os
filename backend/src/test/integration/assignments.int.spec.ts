import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AssignmentsService } from '../../modules/assignments/assignments.service.js';
import { profileSessions } from '../../database/schema/index.js';
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

beforeAll(async () => {
  ctx = await createTestContext();
  assignments = new AssignmentsService(ctx.database);
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

  it('refuses a device that is not enrolled to the operator', async () => {
    const s = await ready();
    const intruder = await createUser(ctx);
    const foreign = await createDevice(ctx, { operatorId: intruder.id });

    await expect(
      assignments.openSession({ profileId: s.profileId, assignmentId: s.assignmentId, chromeProfileDir: 'P' }, s.operatorId, foreign.token),
    ).rejects.toThrow(ForbiddenException);
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
});
