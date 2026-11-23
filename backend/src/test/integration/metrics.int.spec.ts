import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { MetricsService } from '../../modules/metrics/metrics.service.js';
import { crewMembers, crews, metricEvents, metricReconciliation, profileAssignments, profileDailyMetrics, profileSessions } from '../../database/schema/index.js';
import { createDevice, createProfile, createTestContext, createUser, destroyTestContext, halfOpen, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let metrics: MetricsService;

beforeAll(async () => {
  ctx = await createTestContext();
  metrics = new MetricsService(ctx.database);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

const AT = '2026-08-04T10:00:00.000Z';

async function assign(
  operatorId: string,
  profileId: string,
  options: { start?: string; end?: string; status?: 'ACTIVE' | 'ENDED' | 'CANCELLED' } = {},
) {
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const [row] = await ctx.db
    .insert(profileAssignments)
    .values({
      operatorId,
      profileId,
      validRange: halfOpen(new Date(options.start ?? '2026-08-04T06:05:00.000Z'), new Date(options.end ?? '2026-08-04T14:05:00.000Z')),
      status: options.status ?? 'ACTIVE',
      assignedBy: admin.id,
    })
    .returning({ id: profileAssignments.id });
  return row;
}

describe('decision #15 — metric ingestion is idempotent', () => {
  it('accepts a batch once and ignores the retry', async () => {
    // Criterio de entrega de PLAN.md §9: la extension reintenta ante caida de
    // red, y los puntos son dinero.
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await assign(operator.id, profile.id);
    const batch = {
      events: [
        { dedupeKey: 'evt-1', profileId: profile.id, eventType: 'POINTS', points: 10, occurredAt: AT, payload: {} },
        { dedupeKey: 'evt-2', profileId: profile.id, eventType: 'POINTS', points: 5, occurredAt: AT, payload: {} },
      ],
    };

    await expect(metrics.ingest(batch, operator.id)).resolves.toEqual({ accepted: 2, ignored: 0 });
    await expect(metrics.ingest(batch, operator.id)).resolves.toEqual({ accepted: 0, ignored: 2 });

    const [total] = await ctx.db
      .select({ points: sql<string>`coalesce(sum(${metricEvents.points}), 0)` })
      .from(metricEvents)
      .where(eq(metricEvents.profileId, profile.id));
    expect(total.points).toBe('15.0000');
  });

  it('accepts the new events of a partially retried batch', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await assign(operator.id, profile.id);
    const event = (key: string) => ({ dedupeKey: key, profileId: profile.id, eventType: 'POINTS', points: 1, occurredAt: AT, payload: {} });

    await metrics.ingest({ events: [event('a'), event('b')] }, operator.id);
    await expect(metrics.ingest({ events: [event('b'), event('c')] }, operator.id)).resolves.toEqual({ accepted: 1, ignored: 1 });

    expect(await ctx.db.select({ id: metricEvents.id }).from(metricEvents)).toHaveLength(3);
  });

  it('treats the same key at a different instant as a different event', async () => {
    // La clave de deduplicacion es (dedupeKey, occurredAt): el mismo contador
    // leido en dos momentos son dos hechos, no un reintento.
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await assign(operator.id, profile.id);
    const at = (iso: string) => ({ dedupeKey: 'same', profileId: profile.id, eventType: 'POINTS', points: 1, occurredAt: iso, payload: {} });

    await metrics.ingest({ events: [at(AT)] }, operator.id);
    await expect(metrics.ingest({ events: [at('2026-08-04T11:00:00.000Z')] }, operator.id)).resolves.toEqual({
      accepted: 1,
      ignored: 0,
    });
  });

  it('keeps the raw payload and the operator that sent it', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await assign(operator.id, profile.id);
    await metrics.ingest(
      { events: [{ dedupeKey: 'evt-raw', profileId: profile.id, eventType: 'ICEBREAKER_SENT', occurredAt: AT, payload: { dom: '3 respuestas' } }] },
      operator.id,
    );

    const [row] = await ctx.db
      .select({ operatorId: metricEvents.operatorId, eventType: metricEvents.eventType, payload: metricEvents.payload, points: metricEvents.points })
      .from(metricEvents)
      .where(eq(metricEvents.dedupeKey, 'evt-raw'));
    expect(row).toMatchObject({ operatorId: operator.id, eventType: 'ICEBREAKER_SENT', payload: { dom: '3 respuestas' } });
    expect(row.points).toBeNull();
  });
});

describe('extension metrics ownership (A3)', () => {
  it('refuses events for a profile the operator did not hold at occurredAt or for a cancelled assignment', async () => {
    const operator = await createUser(ctx);
    const otherOperator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const cancelledProfile = await createProfile(ctx);
    await assign(otherOperator.id, profile.id);
    await assign(operator.id, cancelledProfile.id, { status: 'CANCELLED' });

    await expect(
      metrics.ingest({ events: [{ dedupeKey: 'unowned-1', profileId: profile.id, eventType: 'POINTS', points: 10, occurredAt: AT, payload: {} }] }, operator.id),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      metrics.ingest({ events: [{ dedupeKey: 'cancelled-1', profileId: cancelledProfile.id, eventType: 'POINTS', points: 10, occurredAt: AT, payload: {} }] }, operator.id),
    ).rejects.toThrow(ForbiddenException);

    expect(await ctx.db.select({ id: metricEvents.id }).from(metricEvents)).toHaveLength(0);
  });

  it('accepts buffered offline events from an ENDED assignment whose validRange covers occurredAt', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await assign(operator.id, profile.id, { status: 'ENDED' });

    await expect(
      metrics.ingest({ events: [{ dedupeKey: 'buffered-1', profileId: profile.id, eventType: 'POINTS', points: 4, occurredAt: AT, payload: {} }] }, operator.id),
    ).resolves.toEqual({ accepted: 1, ignored: 0 });
  });

  it('validates x-session-id format and ownership against operator and event profile', async () => {
    const operator = await createUser(ctx);
    const otherOperator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const otherProfile = await createProfile(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const ownAssignment = await assign(operator.id, profile.id);
    await assign(operator.id, otherProfile.id);
    const otherAssignment = await assign(otherOperator.id, profile.id, { start: '2026-08-04T14:05:00.000Z', end: '2026-08-04T22:05:00.000Z' });
    const [ownSession] = await ctx.db.insert(profileSessions).values({ assignmentId: ownAssignment.id, profileId: profile.id, operatorId: operator.id, deviceId: device.id, chromeProfileDir: 'Profile 1', status: 'ACTIVE' }).returning({ id: profileSessions.id });
    const [foreignSession] = await ctx.db.insert(profileSessions).values({ assignmentId: otherAssignment.id, profileId: profile.id, operatorId: otherOperator.id, deviceId: device.id, chromeProfileDir: 'Profile 1', status: 'CLOSED' }).returning({ id: profileSessions.id });
    const event = { dedupeKey: 'sess-1', profileId: profile.id, eventType: 'POINTS' as const, points: 2, occurredAt: AT, payload: {} };

    await expect(metrics.ingest({ events: [event] }, operator.id, 'not-a-uuid')).rejects.toThrow(BadRequestException);
    await expect(metrics.ingest({ events: [event] }, operator.id, foreignSession.id)).rejects.toThrow(ForbiddenException);
    await expect(
      metrics.ingest({ events: [{ ...event, dedupeKey: 'sess-mismatch', profileId: otherProfile.id }] }, operator.id, ownSession.id),
    ).rejects.toThrow(ForbiddenException);
    await expect(metrics.ingest({ events: [event] }, operator.id, ownSession.id)).resolves.toEqual({ accepted: 1, ignored: 0 });
  });

  it('rejects empty/whitespace x-session-id (400), unknown UUID (403), mixed batches atomically (403), and exclusive upper-bound timestamps (403)', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const otherProfile = await createProfile(ctx);
    await assign(operator.id, profile.id, { start: '2026-08-04T06:05:00.000Z', end: '2026-08-04T14:05:00.000Z' });
    const owned = { dedupeKey: 'mix-ok', profileId: profile.id, eventType: 'POINTS' as const, points: 3, occurredAt: AT, payload: {} };
    const unowned = { dedupeKey: 'mix-bad', profileId: otherProfile.id, eventType: 'POINTS' as const, points: 3, occurredAt: AT, payload: {} };

    await expect(metrics.ingest({ events: [owned] }, operator.id, '')).rejects.toThrow(BadRequestException);
    await expect(metrics.ingest({ events: [owned] }, operator.id, '   ')).rejects.toThrow(BadRequestException);
    await expect(metrics.ingest({ events: [owned] }, operator.id, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(ForbiddenException);
    await expect(metrics.ingest({ events: [owned, unowned] }, operator.id)).rejects.toThrow(ForbiddenException);
    await expect(
      metrics.ingest({ events: [{ ...owned, dedupeKey: 'at-upper', occurredAt: '2026-08-04T14:05:00.000Z' }] }, operator.id),
    ).rejects.toThrow(ForbiddenException);

    expect(await ctx.db.select({ id: metricEvents.id }).from(metricEvents)).toHaveLength(0);
  });
});

describe('metrics read models', () => {
  it('keeps the two sources apart instead of mixing them', async () => {
    // Decision #14: guardarlas juntas haria imposible detectar divergencia.
    const profile = await createProfile(ctx);
    await ctx.db.insert(profileDailyMetrics).values([
      { profileId: profile.id, businessDate: '2026-08-04', source: 'EXTENSION', points: '100.0000', messagesSent: 50, responses: 25 },
      { profileId: profile.id, businessDate: '2026-08-04', source: 'TABLEAU', points: '104.0000', messagesSent: 50, responses: 25 },
    ]);

    const extensionOnly = await metrics.profiles();
    expect(extensionOnly).toHaveLength(1);
    expect(extensionOnly[0]).toMatchObject({ source: 'EXTENSION', points: '100.0000' });

    // La serie por perfil si muestra ambas, para poder compararlas.
    expect(await metrics.timeseries(profile.id)).toHaveLength(2);
  });

  it('filters the profile view by date range', async () => {
    const profile = await createProfile(ctx);
    await ctx.db.insert(profileDailyMetrics).values([
      { profileId: profile.id, businessDate: '2026-08-01', source: 'EXTENSION', points: '10.0000' },
      { profileId: profile.id, businessDate: '2026-08-15', source: 'EXTENSION', points: '20.0000' },
      { profileId: profile.id, businessDate: '2026-09-01', source: 'EXTENSION', points: '30.0000' },
    ]);

    const august = await metrics.profiles('2026-08-01', '2026-08-31');
    expect(august.map((row) => row.points)).toEqual(['10.0000', '20.0000']);
  });

  it('ranks profiles by response rate without dividing by zero or double-counting TABLEAU rows', async () => {
    const busy = await createProfile(ctx, { displayName: 'Ana' });
    const idle = await createProfile(ctx, { displayName: 'Bea' });
    await ctx.db.insert(profileDailyMetrics).values([
      { profileId: busy.id, businessDate: '2026-08-04', source: 'EXTENSION', points: '50.0000', messagesSent: 100, responses: 40 },
      { profileId: busy.id, businessDate: '2026-08-04', source: 'TABLEAU', points: '50.0000', messagesSent: 100, responses: 40 },
      { profileId: idle.id, businessDate: '2026-08-04', source: 'EXTENSION', points: '0.0000', messagesSent: 0, responses: 0 },
    ]);

    const ranking = await metrics.ranking();
    expect(ranking).toHaveLength(2);
    expect(ranking[0]).toMatchObject({ profileId: busy.id, points: '50.0000', messagesSent: 100, responses: 40 });
    expect(Number(ranking[0].responseRate)).toBeCloseTo(0.4, 4);
    expect(Number(ranking[1].responseRate)).toBe(0);
  });
});

describe('metrics role audiences (A7 — FR-20 / MET-07)', () => {
  it('scopes COORDINADOR to profiles assigned to their active crew across profiles, ranking, timeseries, and reconciliation', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coord = await createUser(ctx, { role: 'COORDINADOR' });
    const inCrewOp = await createUser(ctx);
    const outCrewOp = await createUser(ctx);
    const inProfile = await createProfile(ctx, { displayName: 'Perfil Crew' });
    const outProfile = await createProfile(ctx, { displayName: 'Perfil Externo' });

    const [crew] = await ctx.db.insert(crews).values({ name: 'Cuadrilla Norte', coordinatorId: coord.id, isActive: true }).returning({ id: crews.id });
    const now = Date.now();
    const todayBogota = new Date(now - 5 * 3_600_000).toISOString().slice(0, 10);
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: inCrewOp.id, validRange: halfOpen(new Date(now - 3_600_000), new Date(now + 3_600_000)) });
    await assign(inCrewOp.id, inProfile.id, { start: new Date(now - 3_600_000).toISOString(), end: new Date(now + 3_600_000).toISOString() });
    await assign(outCrewOp.id, outProfile.id, { start: new Date(now - 3_600_000).toISOString(), end: new Date(now + 3_600_000).toISOString() });

    await ctx.db.insert(profileDailyMetrics).values([
      { profileId: inProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '80.0000', messagesSent: 50, responses: 20 },
      { profileId: outProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '120.0000', messagesSent: 60, responses: 30 },
    ]);
    await ctx.db.insert(metricReconciliation).values([
      { profileId: inProfile.id, businessDate: todayBogota, extensionPoints: '80.0000', tableauPoints: '80.0000', differencePoints: '0.0000', tolerancePoints: '1.0000', status: 'OK' },
      { profileId: outProfile.id, businessDate: todayBogota, extensionPoints: '120.0000', tableauPoints: '115.0000', differencePoints: '5.0000', tolerancePoints: '1.0000', status: 'DIVERGENT' },
    ]);

    const coordActor = { sub: coord.id, role: 'COORDINADOR' as const };
    const adminActor = { sub: admin.id, role: 'ADMIN' as const };

    expect((await metrics.profiles(undefined, undefined, undefined, coordActor)).map((r) => r.profileId)).toEqual([inProfile.id]);
    expect((await metrics.ranking({}, coordActor)).map((r) => r.profileId)).toEqual([inProfile.id]);
    expect((await metrics.reconciliation({}, coordActor)).map((r) => r.profileId)).toEqual([inProfile.id]);
    await expect(metrics.timeseries(inProfile.id, undefined, undefined, coordActor)).resolves.toHaveLength(1);
    await expect(metrics.timeseries(outProfile.id, undefined, undefined, coordActor)).rejects.toThrow(ForbiddenException);

    expect(await metrics.profiles(undefined, undefined, undefined, adminActor)).toHaveLength(2);
    expect(await metrics.ranking({}, adminActor)).toHaveLength(2);
    expect(await metrics.reconciliation({}, adminActor)).toHaveLength(2);
  });

  it('blocks COORDINADOR from future assignments, ended cross-crew profiles, transferred-operator history, inactive crews, former members, and CANCELLED assignments (S1)', async () => {
    const coord1 = await createUser(ctx, { role: 'COORDINADOR' });
    const coord2 = await createUser(ctx, { role: 'COORDINADOR' });
    const activeMember = await createUser(ctx);
    const formerMember = await createUser(ctx);
    const inactiveCrewOp = await createUser(ctx);
    const crew2Op = await createUser(ctx);

    const futureProfile = await createProfile(ctx, { displayName: 'Futuro' });
    const handedOverProfile = await createProfile(ctx, { displayName: 'Traspasado' });
    const transferredHistoryProfile = await createProfile(ctx, { displayName: 'HistorialCrew2' });
    const formerMemberProfile = await createProfile(ctx, { displayName: 'ExMiembro' });
    const inactiveCrewProfile = await createProfile(ctx, { displayName: 'CrewInactiva' });
    const cancelledProfile = await createProfile(ctx, { displayName: 'Cancelado' });

    const [crew1] = await ctx.db.insert(crews).values({ name: 'Crew 1', coordinatorId: coord1.id, isActive: true }).returning({ id: crews.id });
    const [inactiveCrew] = await ctx.db.insert(crews).values({ name: 'Crew Off', coordinatorId: coord1.id, isActive: false }).returning({ id: crews.id });
    const [crew2] = await ctx.db.insert(crews).values({ name: 'Crew 2', coordinatorId: coord2.id, isActive: true }).returning({ id: crews.id });

    const now = Date.now();
    const hour = 3_600_000;
    const day = 24 * hour;
    const todayBogota = new Date(now - 5 * hour).toISOString().slice(0, 10);

    await ctx.db.insert(crewMembers).values([
      { crewId: crew1.id, userId: activeMember.id, validRange: halfOpen(new Date(now - day), new Date(now + 7 * day)) },
      { crewId: crew2.id, userId: activeMember.id, validRange: halfOpen(new Date(now - 30 * day), new Date(now - 10 * day)) },
      { crewId: crew1.id, userId: formerMember.id, validRange: halfOpen(new Date(now - 10 * day), new Date(now - 2 * day)) },
      { crewId: inactiveCrew.id, userId: inactiveCrewOp.id, validRange: halfOpen(new Date(now - day), new Date(now + day)) },
      { crewId: crew2.id, userId: crew2Op.id, validRange: halfOpen(new Date(now - 30 * day), new Date(now + 7 * day)) },
    ]);

    await assign(activeMember.id, futureProfile.id, { start: new Date(now + 2 * day).toISOString(), end: new Date(now + 3 * day).toISOString(), status: 'ACTIVE' });
    await assign(activeMember.id, handedOverProfile.id, { start: new Date(now - 15 * day).toISOString(), end: new Date(now - 14 * day).toISOString(), status: 'ENDED' });
    await assign(crew2Op.id, handedOverProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'ACTIVE' });
    await assign(activeMember.id, transferredHistoryProfile.id, { start: new Date(now - 20 * day).toISOString(), end: new Date(now - 19 * day).toISOString(), status: 'ENDED' });
    await assign(crew2Op.id, transferredHistoryProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'ACTIVE' });
    await assign(formerMember.id, formerMemberProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'ACTIVE' });
    await assign(inactiveCrewOp.id, inactiveCrewProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'ACTIVE' });
    await assign(activeMember.id, cancelledProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'CANCELLED' });

    for (const profile of [futureProfile, handedOverProfile, transferredHistoryProfile, formerMemberProfile, inactiveCrewProfile, cancelledProfile]) {
      await ctx.db.insert(profileDailyMetrics).values({
        profileId: profile.id, businessDate: todayBogota, source: 'EXTENSION', points: '50.0000', messagesSent: 20, responses: 10,
      });
      await ctx.db.insert(metricReconciliation).values({
        profileId: profile.id, businessDate: todayBogota, extensionPoints: '50.0000', tableauPoints: '50.0000', differencePoints: '0.0000', tolerancePoints: '1.0000', status: 'OK',
      });
    }

    const coord1Actor = { sub: coord1.id, role: 'COORDINADOR' as const };
    expect(await metrics.profiles(todayBogota, todayBogota, undefined, coord1Actor)).toEqual([]);
    expect(await metrics.ranking({ from: todayBogota, to: todayBogota }, coord1Actor)).toEqual([]);
    expect(await metrics.reconciliation({ from: todayBogota, to: todayBogota }, coord1Actor)).toEqual([]);
    for (const profile of [futureProfile, handedOverProfile, transferredHistoryProfile, formerMemberProfile, inactiveCrewProfile, cancelledProfile]) {
      expect(await metrics.profiles(todayBogota, todayBogota, profile.id, coord1Actor)).toEqual([]);
      await expect(metrics.timeseries(profile.id, todayBogota, todayBogota, coord1Actor)).rejects.toThrow(ForbiddenException);
    }
  });

  it('returns only currently assigned profiles and days held by OPERADOR without exposing raw points, and executes under agency_app (S1, S2)', async () => {
    const operator = await createUser(ctx);
    const otherOp = await createUser(ctx);
    const activeProfile = await createProfile(ctx, { displayName: 'Activo' });
    const endedProfile = await createProfile(ctx, { displayName: 'Terminado' });
    const futureProfile = await createProfile(ctx, { displayName: 'FuturoOp' });
    const cancelledProfile = await createProfile(ctx, { displayName: 'CanceladoOp' });
    const otherProfile = await createProfile(ctx, { displayName: 'Ajeno' });
    const now = Date.now();
    const hour = 3_600_000;
    const todayBogota = new Date(now - 5 * hour).toISOString().slice(0, 10);

    await assign(operator.id, activeProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'ACTIVE' });
    await assign(otherOp.id, activeProfile.id, { start: '2026-10-01T10:00:00.000Z', end: '2026-10-01T18:00:00.000Z', status: 'ENDED' });
    await assign(operator.id, endedProfile.id, { start: new Date(now - 2 * hour).toISOString(), end: new Date(now - hour).toISOString(), status: 'ENDED' });
    await assign(operator.id, futureProfile.id, { start: new Date(now + hour).toISOString(), end: new Date(now + 2 * hour).toISOString(), status: 'ACTIVE' });
    await assign(operator.id, cancelledProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'CANCELLED' });
    await assign(otherOp.id, otherProfile.id, { start: new Date(now - hour).toISOString(), end: new Date(now + hour).toISOString(), status: 'ACTIVE' });

    await ctx.db.insert(profileDailyMetrics).values([
      { profileId: activeProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '99.0000', messagesSent: 40, responses: 16, icebreakersSent: 10, icebreakersReplied: 4 },
      { profileId: activeProfile.id, businessDate: todayBogota, source: 'TABLEAU', points: '101.0000', messagesSent: 40, responses: 16 },
      { profileId: activeProfile.id, businessDate: '2026-10-01', source: 'EXTENSION', points: '88.0000', messagesSent: 35, responses: 14 },
      { profileId: endedProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '50.0000', messagesSent: 20, responses: 5 },
      { profileId: futureProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '40.0000', messagesSent: 10, responses: 5 },
      { profileId: cancelledProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '40.0000', messagesSent: 10, responses: 5 },
      { profileId: otherProfile.id, businessDate: todayBogota, source: 'EXTENSION', points: '70.0000', messagesSent: 30, responses: 9 },
    ]);

    const rows = await ctx.database.withRequestContext(operator.id, 'OPERADOR', async () => {
      await ctx.database.db.execute(sql`SET LOCAL ROLE agency_app`);
      const foreignLookup = await metrics.operatorProfiles({ sub: operator.id, role: 'OPERADOR' }, { profileId: otherProfile.id });
      expect(foreignLookup).toEqual([]);
      return metrics.operatorProfiles({ sub: operator.id, role: 'OPERADOR' });
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profileId: activeProfile.id, businessDate: todayBogota, messagesSent: 40, responses: 16, icebreakersSent: 10, icebreakersReplied: 4 });
    expect('points' in rows[0]).toBe(false);
  });
});
