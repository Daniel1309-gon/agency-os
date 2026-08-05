import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ShiftsService } from '../../modules/shifts/shifts.service.js';
import { BreaksService } from '../../modules/breaks/breaks.service.js';
import { CrewsService } from '../../modules/crews/crews.service.js';
import { AdminService } from '../../modules/admin/admin.service.js';
import { breaks, shifts } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, isoOffset, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

/**
 * Estos servicios traducen constraints de Postgres a 409. La traduccion solo se
 * puede comprobar contra Postgres: con un doble, el catch nunca se ejecuta.
 */

let ctx: TestContext;
let shiftsService: ShiftsService;
let breaksService: BreaksService;
let crews: CrewsService;
let admin: AdminService;

beforeAll(async () => {
  ctx = await createTestContext();
  shiftsService = new ShiftsService(ctx.database);
  breaksService = new BreaksService(ctx.database);
  crews = new CrewsService(ctx.database);
  admin = new AdminService(ctx.database, ctx.config);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('ShiftsService', () => {
  it('turns an overlapping shift into a 409', async () => {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
    const operator = await createUser(ctx);
    const shift = { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) };

    await shiftsService.create(shift, actor.id);
    const error = await shiftsService.create(shift, actor.id).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('allows back to back shifts and rejects an inverted window', async () => {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
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
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
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

  it('refuses to start a shift twice or to close one that never started', async () => {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
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
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
    const operator = await createUser(ctx);
    const intruder = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) },
      actor.id,
    );

    await expect(shiftsService.start(shift.id, intruder.id)).rejects.toThrow(NotFoundException);
  });
});

describe('BreaksService', () => {
  async function shiftWithBreak(): Promise<{ operatorId: string; shiftId: string; breakId: string }> {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
    const operator = await createUser(ctx);
    const shift = await shiftsService.create(
      { operatorId: operator.id, businessDate: '2026-08-04', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60) },
      actor.id,
    );
    const [row] = await ctx.db.insert(breaks).values({ shiftId: shift.id, type: 'SCHEDULED', status: 'PENDING' }).returning({ id: breaks.id });
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
});

describe('CrewsService', () => {
  it('turns an overlapping crew membership into a 409', async () => {
    const operator = await createUser(ctx);
    const alpha = await crews.create({ name: 'Alpha' });
    const beta = await crews.create({ name: 'Beta' });
    const window = { userId: operator.id, validFrom: isoOffset(-60), validTo: isoOffset(600) };

    await crews.addMember(alpha.id, window);
    const error = await crews.addMember(beta.id, window).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('closes the membership window on removal, so the operator can move crew', async () => {
    const operator = await createUser(ctx);
    const alpha = await crews.create({ name: 'Alpha' });
    const beta = await crews.create({ name: 'Beta' });

    await crews.addMember(alpha.id, { userId: operator.id, validFrom: isoOffset(-60), validTo: isoOffset(600) });
    await crews.remove(alpha.id, operator.id);

    await expect(crews.addMember(beta.id, { userId: operator.id, validFrom: isoOffset(1), validTo: isoOffset(600) })).resolves.toBeDefined();
  });

  it('rejects removing somebody who is not a current member', async () => {
    const operator = await createUser(ctx);
    const alpha = await crews.create({ name: 'Alpha' });
    await expect(crews.remove(alpha.id, operator.id)).rejects.toThrow(NotFoundException);
  });
});

describe('AdminService', () => {
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
