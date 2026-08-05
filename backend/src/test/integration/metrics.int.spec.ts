import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { MetricsService } from '../../modules/metrics/metrics.service.js';
import { metricEvents, profileDailyMetrics } from '../../database/schema/index.js';
import { createProfile, createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

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

describe('decision #15 — metric ingestion is idempotent', () => {
  it('accepts a batch once and ignores the retry', async () => {
    // Criterio de entrega de PLAN.md §9: la extension reintenta ante caida de
    // red, y los puntos son dinero.
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
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
