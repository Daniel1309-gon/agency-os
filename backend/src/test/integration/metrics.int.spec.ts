import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { MetricsService } from '../../modules/metrics/metrics.service.js';
import { metricEvents, profileAssignments, profileDailyMetrics, profileSessions } from '../../database/schema/index.js';
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

  it('ranks profiles by response rate without dividing by zero', async () => {
    const busy = await createProfile(ctx, { displayName: 'Ana' });
    const idle = await createProfile(ctx, { displayName: 'Bea' });
    await ctx.db.insert(profileDailyMetrics).values([
      { profileId: busy.id, businessDate: '2026-08-04', source: 'EXTENSION', messagesSent: 100, responses: 40 },
      { profileId: idle.id, businessDate: '2026-08-04', source: 'EXTENSION', messagesSent: 0, responses: 0 },
    ]);

    const ranking = await metrics.ranking();
    expect(ranking).toHaveLength(2);
    expect(Number(ranking[0].responseRate)).toBeCloseTo(0.4, 4);
    expect(Number(ranking[1].responseRate)).toBe(0);
  });
});
