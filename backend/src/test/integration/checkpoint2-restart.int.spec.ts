import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { AssignmentsService } from '../../modules/assignments/assignments.service.js';
import { BreaksService } from '../../modules/breaks/breaks.service.js';
import { JobsService } from '../../modules/jobs/jobs.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { ShiftsService } from '../../modules/shifts/shifts.service.js';
import { DrizzleEffectiveTimeRepository } from '../../modules/shifts/effective-time.drizzle-repository.js';
import { breaks, profileAssignments, profileSessions, shiftTemplates, shifts } from '../../database/schema/index.js';
import { createDevice, createProfile, createTestContext, createUser, destroyTestContext, isoOffset, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

/**
 * Checkpoint 2 exige el recorrido operativo "con una API reiniciada". Reiniciar aqui significa
 * tirar el proceso entero de aplicacion: pool de Postgres, cliente de Redis, el AsyncLocalStorage
 * que ata las transacciones y todas las instancias de servicio. Lo que sobreviva tiene que estar
 * en Postgres o en Redis, no en memoria.
 *
 * El pool crudo del contexto (`ctx.pool`, `ctx.db`) no se reinicia: es el canal de observacion
 * de la prueba, no la API.
 */
let ctx: TestContext;

interface ApiInstance {
  shifts: ShiftsService;
  breaks: BreaksService;
  assignments: AssignmentsService;
  jobs: JobsService;
  stop(): Promise<void>;
}

async function bootApi(): Promise<ApiInstance> {
  const database = new DatabaseService(ctx.config, ctx.logger);
  await database.onModuleInit();
  const redis = new RedisService(ctx.config);
  const realtime = new RealtimeService(database);
  const audit = new AuditService(database);
  const effectiveTime = new DrizzleEffectiveTimeRepository(database);
  return {
    shifts: new ShiftsService(database, audit, realtime, effectiveTime),
    breaks: new BreaksService(database, audit, realtime),
    assignments: new AssignmentsService(database, audit, realtime),
    jobs: new JobsService(database, realtime, effectiveTime),
    async stop() {
      await database.onModuleDestroy();
      await redis.onModuleDestroy();
    },
  };
}

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('Checkpoint 2 — the operational journey survives an API restart', () => {
  it('resumes the shift, the break and the handover after the process is replaced', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const morning = await createUser(ctx);
    const afternoon = await createUser(ctx);
    const profile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: morning.id });
    const handoverAt = isoOffset(60);

    // ---- Instancia A: arranque de turno, perfil abierto, break en curso ----
    let api = await bootApi();
    const shift = await api.shifts.create(
      { operatorId: morning.id, businessDate: '2026-08-23', scheduledFrom: isoOffset(-120), scheduledTo: handoverAt, breaks: [{ type: 'REST', scheduledAt: isoOffset(-30) }] },
      admin.id,
    );
    await api.shifts.start(shift.id, morning.id);

    const assignment = await api.assignments.create({ profileId: profile.id, operatorId: morning.id, validFrom: isoOffset(-120), validTo: handoverAt }, admin.id);
    const session = await api.assignments.openSession({ profileId: profile.id, assignmentId: assignment.id, chromeProfileDir: 'Profile 1' }, morning.id, device.id);
    const active = await api.assignments.updateSession(session.id, { status: 'ACTIVE', version: session.version }, morning.id, device.id);

    const [pending] = await api.breaks.list(shift.id, morning.id);
    const started = await api.breaks.start(pending.id, morning.id);
    expect(started).toMatchObject({ status: 'IN_PROGRESS' });

    // Se retrasan sesion y break para que el turno tenga tramos de verdad y la resta del
    // descanso sea observable. Sin esto el recorrido dura segundos y todo redondea a cero.
    await ctx.db.update(profileSessions).set({ startedAt: new Date(Date.now() - 90 * 60_000) }).where(eq(profileSessions.id, session.id));
    await ctx.db.update(breaks).set({ startedAt: new Date(Date.now() - 20 * 60_000) }).where(eq(breaks.id, started.id));

    // ---- El reinicio ----
    await api.stop();
    api = await bootApi();

    // El break abierto por la instancia anterior se cierra desde la nueva.
    const ended = await api.breaks.end(started.id, morning.id);
    expect(ended).toMatchObject({ status: 'COMPLETED' });

    // La sesion abierta antes del reinicio sigue viva y acepta el siguiente CAS: la version
    // no vivia en memoria del proceso.
    const beat = await api.assignments.updateSession(session.id, { status: 'ACTIVE', version: active.version }, morning.id, device.id);
    expect(beat.version).toBe(active.version + 1);

    // El relevo contiguo no produce un 409 espurio pese al cambio de proceso.
    const next = await api.assignments.create({ profileId: profile.id, operatorId: afternoon.id, validFrom: handoverAt, validTo: isoOffset(180) }, admin.id);
    expect(next).toMatchObject({ operatorId: afternoon.id });

    const [previousAssignment] = await ctx.db.select({ status: profileAssignments.status, endReason: profileAssignments.endReason }).from(profileAssignments).where(eq(profileAssignments.id, assignment.id));
    const [closedSession] = await ctx.db.select({ status: profileSessions.status, endReason: profileSessions.endReason }).from(profileSessions).where(eq(profileSessions.id, session.id));
    expect(previousAssignment).toMatchObject({ status: 'ENDED', endReason: 'HANDOFF' });
    expect(closedSession).toMatchObject({ status: 'CLOSED', endReason: 'SHIFT_ENDED' });

    // El turno liquida tiempo efectivo con la sesion y el break que cruzaron el reinicio.
    const closed = await api.shifts.end(shift.id, morning.id);
    const [sessionRow] = await ctx.db.select({ startedAt: profileSessions.startedAt, endedAt: profileSessions.endedAt }).from(profileSessions).where(eq(profileSessions.id, session.id));
    const [breakRow] = await ctx.db.select({ startedAt: breaks.startedAt, endedAt: breaks.endedAt }).from(breaks).where(eq(breaks.id, started.id));
    // El descanso quedo dentro de la sesion, asi que el tiempo efectivo es exactamente la
    // sesion menos el descanso. Se calcula desde los instantes reales para que el reloj del
    // test no introduzca deriva.
    const workedMs = (sessionRow.endedAt as Date).getTime() - sessionRow.startedAt.getTime();
    const restedMs = (breakRow.endedAt as Date).getTime() - (breakRow.startedAt as Date).getTime();
    expect(closed.status).toBe('COMPLETED');
    expect(closed.effectiveMinutes).toBe(Math.round((workedMs - restedMs) / 60_000));
    expect(closed.effectiveMinutes).toBeGreaterThan(60);

    await api.stop();
  });

  it('keeps two concurrent requests to a restarted API from both winning', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });

    let api = await bootApi();
    const shift = await api.shifts.create(
      { operatorId: operator.id, businessDate: '2026-08-23', scheduledFrom: isoOffset(-60), scheduledTo: isoOffset(60), breaks: [{ type: 'REST', scheduledAt: isoOffset(-30) }] },
      admin.id,
    );
    await api.shifts.start(shift.id, operator.id);
    const assignment = await api.assignments.create({ profileId: profile.id, operatorId: operator.id, validFrom: isoOffset(-60), validTo: isoOffset(60) }, admin.id);
    const session = await api.assignments.openSession({ profileId: profile.id, assignmentId: assignment.id, chromeProfileDir: 'Profile 1' }, operator.id, device.id);

    await api.stop();
    api = await bootApi();

    // Dos heartbeats con la misma version: el CAS vive en Postgres, asi que el proceso nuevo
    // sigue dejando ganar a uno solo.
    const beats = await Promise.allSettled([
      api.assignments.updateSession(session.id, { status: 'ACTIVE', version: session.version }, operator.id, device.id),
      api.assignments.updateSession(session.id, { status: 'ACTIVE', version: session.version }, operator.id, device.id),
    ]);
    expect(beats.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    // Dos cierres de turno concurrentes: uno completa, el otro no encuentra turno en curso.
    const [pending] = await api.breaks.list(shift.id, operator.id);
    await api.breaks.start(pending.id, operator.id);
    const ends = await Promise.allSettled([api.shifts.end(shift.id, operator.id), api.shifts.end(shift.id, operator.id)]);
    const fulfilled = ends.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(ends.some((result) => result.status === 'rejected' && (result.reason instanceof NotFoundException || result.reason instanceof ConflictException))).toBe(true);

    const [row] = await ctx.db.select({ status: shifts.status, effectiveMinutes: shifts.effectiveMinutes }).from(shifts).where(eq(shifts.id, shift.id));
    expect(row.status).toBe('COMPLETED');
    expect(row.effectiveMinutes).not.toBeNull();

    await api.stop();
  });

  it('lets a fresh instance close the shifts the previous one left expired', async () => {
    // El cierre automatico no depende de que sobreviva el proceso que abrio el turno.
    const operator = await createUser(ctx);
    const start = new Date(Date.now() - 120 * 60_000);
    const end = new Date(Date.now() - 60 * 60_000);

    let api = await bootApi();
    const [shift] = await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: '2026-08-23',
      scheduledRange: `[${start.toISOString()},${end.toISOString()})`,
      status: 'IN_PROGRESS',
      actualStartAt: start,
    }).returning({ id: shifts.id });
    await ctx.db.insert(breaks).values({ shiftId: shift.id, type: 'REST', status: 'IN_PROGRESS', startedAt: new Date(end.getTime() - 20 * 60_000) });
    await api.stop();

    api = await bootApi();
    await (api.jobs as unknown as { closeExpiredShifts(at: Date): Promise<void> }).closeExpiredShifts(end);

    const [closed] = await ctx.db.select({ status: shifts.status, effectiveMinutes: shifts.effectiveMinutes }).from(shifts).where(eq(shifts.id, shift.id));
    expect(closed.status).toBe('COMPLETED');
    // Sin sesion de perfil el turno liquida cero: el reinicio no cambia la formula de FR-17.
    expect(closed.effectiveMinutes).toBe(0);

    await api.stop();
  });

  it('recovers an unmaterialized previous business date after an API restart', async () => {
    const operator = await createUser(ctx);
    await ctx.db.insert(shiftTemplates).values({
      name: 'Night recovery',
      startTime: '22:05:00',
      endTime: '06:05:00',
      crossesMidnight: true,
      weekdays: [1],
      breakMinutes: 0,
      validFrom: '2026-08-01',
      isActive: true,
    });

    let api = await bootApi();
    await api.stop();
    api = await bootApi();

    const materializeBacklog = (api.jobs as unknown as { materializeShiftBacklog(at: Date): Promise<number> }).materializeShiftBacklog;
    const recoveryAt = new Date('2026-09-01T12:00:00.000Z');
    await expect(materializeBacklog.call(api.jobs, recoveryAt)).resolves.toBe(1);
    await expect(materializeBacklog.call(api.jobs, recoveryAt)).resolves.toBe(0);

    const rows = await ctx.db.select({ operatorId: shifts.operatorId, businessDate: shifts.businessDate, scheduledRange: shifts.scheduledRange, status: shifts.status }).from(shifts);
    expect(rows).toEqual([{
      operatorId: operator.id,
      businessDate: '2026-08-31',
      scheduledRange: '["2026-09-01 03:05:00+00","2026-09-01 11:05:00+00")',
      status: 'SCHEDULED',
    }]);

    await api.stop();
  });

  it('closes a handed-off overdue shift and break at their scheduled boundaries', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const morning = await createUser(ctx);
    const afternoon = await createUser(ctx);
    const profile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: morning.id });
    const start = new Date(Date.now() - 30 * 60_000);
    const boundary = new Date(Date.now() + 60 * 60_000);
    const recovery = new Date(boundary.getTime() + 45 * 60_000);
    const breakScheduledAt = new Date(boundary.getTime() - 30 * 60_000);
    const breakStartedAt = new Date(boundary.getTime() - 15 * 60_000);

    let api = await bootApi();
    const [shift] = await ctx.db.insert(shifts).values({
      operatorId: morning.id,
      businessDate: '2026-09-09',
      scheduledRange: `[${start.toISOString()},${boundary.toISOString()})`,
      status: 'IN_PROGRESS',
      actualStartAt: start,
    }).returning({ id: shifts.id });
    const [activeBreak] = await ctx.db.insert(breaks).values({
      shiftId: shift.id,
      type: 'REST',
      scheduledAt: breakScheduledAt,
      status: 'IN_PROGRESS',
      startedAt: breakStartedAt,
    }).returning({ id: breaks.id });

    const outgoing = await api.assignments.create({ profileId: profile.id, operatorId: morning.id, validFrom: start.toISOString(), validTo: boundary.toISOString() }, admin.id);
    const session = await api.assignments.openSession({ profileId: profile.id, assignmentId: outgoing.id, chromeProfileDir: 'Profile 1' }, morning.id, device.id);
    await api.assignments.updateSession(session.id, { status: 'ACTIVE', version: session.version }, morning.id, device.id);
    await ctx.db.update(profileSessions).set({ startedAt: start, lastHeartbeatAt: start }).where(eq(profileSessions.id, session.id));

    // El relevo exacto cierra la sesión en el borde programado; el worker se ejecuta 45 min tarde.
    await api.assignments.create({ profileId: profile.id, operatorId: afternoon.id, validFrom: boundary.toISOString(), validTo: new Date(boundary.getTime() + 120 * 60_000).toISOString() }, admin.id);
    await api.stop();

    api = await bootApi();
    await (api.jobs as unknown as { closeExpiredShifts(at: Date): Promise<void> }).closeExpiredShifts(recovery);

    const [closedShift] = await ctx.db.select({ status: shifts.status, actualEndAt: shifts.actualEndAt, effectiveMinutes: shifts.effectiveMinutes }).from(shifts).where(eq(shifts.id, shift.id));
    const [closedBreak] = await ctx.db.select({ scheduledAt: breaks.scheduledAt, endedAt: breaks.endedAt, durationMinutes: breaks.durationMinutes, status: breaks.status }).from(breaks).where(eq(breaks.id, activeBreak.id));
    const [closedSession] = await ctx.db.select({ endedAt: profileSessions.endedAt, endReason: profileSessions.endReason }).from(profileSessions).where(eq(profileSessions.id, session.id));

    expect(closedShift).toMatchObject({ status: 'COMPLETED', actualEndAt: boundary, effectiveMinutes: 75 });
    expect(closedBreak).toMatchObject({ status: 'COMPLETED', scheduledAt: breakScheduledAt, endedAt: boundary, durationMinutes: 15 });
    expect(closedSession).toMatchObject({ endedAt: boundary, endReason: 'SHIFT_ENDED' });

    await api.stop();
  });
});
