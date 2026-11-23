import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { TableauService } from '../../modules/tableau/tableau.service.js';
import type { TableauClient, ViewDownload } from '../../modules/tableau/tableau.client.js';
import { etlRuns, etlStagingRows, outboxEvents, rocketchatChannels, tableauHourlyPoints, tableauViews, ttProfiles } from '../../database/schema/index.js';
import { createProfile, createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let service: TableauService;
/** What the fake Tableau answers next; a thrown error simulates an outage. */
let download: () => ViewDownload;
let downloads: string[];

beforeAll(async () => {
  ctx = await createTestContext();
  const client = {
    downloadViewData: async (viewId: string) => { downloads.push(viewId); return download(); },
    siteContentUrl: () => 'partnerdata',
  } as unknown as TableauClient;
  service = new TableauService(ctx.database, client);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  downloads = [];
});

const MAPPING = { profileId: 'ID Trusted User', sourceHour: 'Hour', points: 'Points' };
const csv = (lines: string[]): ViewDownload => ({ body: ['ID Trusted User,Hour,Points', ...lines].join('\n'), contentType: 'text/csv', siteId: 'site-luid' });

async function hourlyView(overrides: Partial<typeof tableauViews.$inferInsert> = {}) {
  const admin = await createUser(ctx, { role: 'ADMIN' });
  return service.createView({ name: 'Points hourly', siteId: 'site-luid', viewId: 'view-luid', sourceTimezone: 'America/Bogota', kind: 'POINTS_HOURLY', columnMapping: MAPPING, ...overrides } as never, admin.id);
}

async function profileWithRef(ref: string) {
  const profile = await createProfile(ctx);
  await ctx.db.update(ttProfiles).set({ externalRef: ref }).where(eq(ttProfiles.id, profile.id));
  return profile;
}

describe('TableauService (FR-19, decision #9)', () => {
  it('queues a run without calling Tableau; the worker executes it', async () => {
    const view = await hourlyView();
    download = () => csv([]);

    const queued = await service.run({ viewId: view.id, businessDate: '2026-08-04' });
    expect(queued).toMatchObject({ status: 'QUEUED' });
    expect(downloads).toEqual([]);

    await expect(service.processQueued()).resolves.toBe(1);
    expect(downloads).toEqual(['view-luid']);
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, queued!.id) })).toMatchObject({ status: 'SUCCESS', rowCount: 0 });
  });

  it('stages every row, promotes valid hours in UTC, skips totals and rejects what it cannot read', async () => {
    const view = await hourlyView();
    const profile = await profileWithRef('TU-1');
    download = () => csv([
      'TU-1,2026-08-04 06:00,12.5',
      'TU-1,2026-08-04 22:00,3',
      'Todo,,15.5',
      'TU-404,2026-08-04 06:00,1',
      'TU-1,04/08/2026 07:00,1',
      'TU-1,2026-08-04 08:00,$2.00',
    ]);
    const run = await service.run({ viewId: view.id, businessDate: '2026-08-04' });

    await service.processQueued();

    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, run!.id) })).toMatchObject({ status: 'PARTIAL', rowCount: 6, rejectedCount: 3, error: null });
    const staged = await ctx.db.select({ rowNumber: etlStagingRows.rowNumber, status: etlStagingRows.validationStatus, error: etlStagingRows.validationError }).from(etlStagingRows).orderBy(asc(etlStagingRows.rowNumber));
    expect(staged).toEqual([
      { rowNumber: 1, status: 'VALID', error: null },
      { rowNumber: 2, status: 'VALID', error: null },
      { rowNumber: 3, status: 'SKIPPED', error: 'Total row' },
      { rowNumber: 4, status: 'REJECTED', error: 'Unknown profile reference "TU-404"' },
      { rowNumber: 5, status: 'REJECTED', error: 'Hour is not an ISO date-time (YYYY-MM-DD HH:mm)' },
      { rowNumber: 6, status: 'REJECTED', error: 'Points are not a plain decimal number' },
    ]);
    const points = await ctx.db.select({ profileId: tableauHourlyPoints.profileId, sourceHour: tableauHourlyPoints.sourceHour, businessDate: tableauHourlyPoints.businessDate, points: tableauHourlyPoints.points }).from(tableauHourlyPoints).orderBy(asc(tableauHourlyPoints.sourceHour));
    expect(points).toEqual([
      { profileId: profile.id, sourceHour: new Date('2026-08-04T11:00:00Z'), businessDate: '2026-08-04', points: '12.5000' },
      // 22:00 in Bogota is 03:00Z the next day, but still the 4th in Bogota.
      { profileId: profile.id, sourceHour: new Date('2026-08-05T03:00:00Z'), businessDate: '2026-08-04', points: '3.0000' },
    ]);
  });

  it('sums several rows for the same profile and hour (one per SourceID) instead of failing the run', async () => {
    const view = await hourlyView();
    const profile = await profileWithRef('TU-1');
    download = () => csv(['TU-1,2026-08-04 10:00,5', 'TU-1,2026-08-04 10:00,7']);
    const run = await service.run({ viewId: view.id, businessDate: '2026-08-04' });

    await service.processQueued();

    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, run!.id) })).toMatchObject({ status: 'SUCCESS', rowCount: 2, rejectedCount: 0 });
    expect(await ctx.db.select().from(etlStagingRows)).toHaveLength(2);
    const [point] = await ctx.db.select().from(tableauHourlyPoints);
    expect(point).toMatchObject({ profileId: profile.id, sourceHour: new Date('2026-08-04T15:00:00Z'), points: '12.0000' });
    expect((point.rawRow as { sourceRows: unknown[] }).sourceRows).toHaveLength(2);
  });

  it('stores the database reason, not the failed SQL and its row values, when the run cannot be written', async () => {
    const view = await hourlyView();
    await profileWithRef('TU-1');
    download = () => csv(['TU-1,2026-08-04 10:00,99999999999999']);
    const run = await service.run({ viewId: view.id, businessDate: '2026-08-04' });

    await service.processQueued();

    const failed = await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, run!.id) });
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed?.error).toMatch(/^Database rejected the run: /);
    expect(failed?.error).not.toMatch(/insert into|TU-1/i);
  });

  it('re-executing a run updates in place: no duplicated staging rows or points', async () => {
    const view = await hourlyView();
    await profileWithRef('TU-1');
    download = () => csv(['TU-1,2026-08-04 06:00,12.5']);
    const run = await service.run({ viewId: view.id, businessDate: '2026-08-04' });
    await service.processQueued();

    download = () => csv(['TU-1,2026-08-04 06:00,20']);
    await expect(service.requeue(run!.id)).resolves.toMatchObject({ status: 'QUEUED' });
    await service.processQueued();

    expect(await ctx.db.select().from(etlStagingRows)).toHaveLength(1);
    const points = await ctx.db.select({ points: tableauHourlyPoints.points }).from(tableauHourlyPoints);
    expect(points).toEqual([{ points: '20.0000' }]);
  });

  it('fails the run with a clear message when the mapped columns are no longer in the view', async () => {
    const view = await hourlyView();
    download = () => ({ body: 'Profile,Hour,Points\nTU-1,2026-08-04 06:00,1', contentType: 'text/csv', siteId: 'site-luid' });
    const run = await service.run({ viewId: view.id, businessDate: '2026-08-04' });

    await service.processQueued();

    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, run!.id) })).toMatchObject({ status: 'FAILED', error: 'View columns changed: mapped columns not found (profileId=ID Trusted User)' });
    expect(await ctx.db.select().from(etlStagingRows)).toHaveLength(0);
  });

  it('refuses a view registered for another site than the one the PAT signs in to', async () => {
    const view = await hourlyView({ siteId: 'other-site' });
    download = () => csv([]);
    const run = await service.run({ viewId: view.id, businessDate: '2026-08-04' });

    await service.processQueued();

    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, run!.id) })).toMatchObject({ status: 'FAILED', error: 'View is registered for site other-site, but the PAT signed in to site site-luid' });
  });

  it('queues a FAILED run again when it is requested again, and returns a finished one untouched', async () => {
    const view = await hourlyView();
    download = () => { throw new Error('Tableau view data returned HTTP 503'); };
    const first = await service.run({ viewId: view.id, businessDate: '2026-08-04' });
    await service.processQueued();
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, first!.id) })).toMatchObject({ status: 'FAILED', error: 'Tableau view data returned HTTP 503' });

    download = () => csv([]);
    await expect(service.run({ viewId: view.id, businessDate: '2026-08-04' })).resolves.toMatchObject({ id: first!.id, status: 'QUEUED', error: null });
    await service.processQueued();
    await expect(service.run({ viewId: view.id, businessDate: '2026-08-04' })).resolves.toMatchObject({ id: first!.id, status: 'SUCCESS' });
    expect(downloads).toHaveLength(2);
  });

  it('claims a RUNNING run whose worker died, and leaves a fresh one alone', async () => {
    const view = await hourlyView();
    download = () => csv([]);
    const [stale] = await ctx.db.insert(etlRuns).values({ viewId: view.id, businessDate: '2026-08-03', status: 'RUNNING', startedAt: new Date(Date.now() - 31 * 60_000) }).returning();
    await ctx.db.insert(etlRuns).values({ viewId: view.id, businessDate: '2026-08-04', status: 'RUNNING' });

    await expect(service.processQueued()).resolves.toBe(1);
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, stale.id) })).toMatchObject({ status: 'SUCCESS' });
  });

  it('gives the worker role what the ETL needs and still no DELETE', async () => {
    const { rows } = await ctx.pool.query<Record<string, boolean>>(`
      SELECT
        has_table_privilege('agency_worker', 'public.tableau_views', 'SELECT') AS views_read,
        has_table_privilege('agency_worker', 'public.tt_profiles', 'SELECT') AS profiles_read,
        has_table_privilege('agency_worker', 'public.etl_runs', 'UPDATE') AS runs_update,
        has_table_privilege('agency_worker', 'public.etl_staging_rows', 'INSERT') AS staging_insert,
        has_table_privilege('agency_worker', 'public.tableau_hourly_points', 'UPDATE') AS points_update,
        has_table_privilege('agency_worker', 'public.etl_staging_rows', 'DELETE') AS staging_delete,
        has_table_privilege('agency_worker', 'public.tableau_views', 'UPDATE') AS views_update`);
    expect(rows[0]).toEqual({ views_read: true, profiles_read: true, runs_update: true, staging_insert: true, points_update: true, staging_delete: false, views_update: false });
  });

  it('queues yesterday only at/after each view schedule (default 09:15 Bogota) idempotently under agency_worker (A9)', async () => {
    const view = await hourlyView();
    expect(view).toMatchObject({ scheduleTime: '09:15', scheduleTimezone: 'America/Bogota', freshnessSlaMinutes: 120 });

    // 09:14 Bogota = 14:14 UTC -> too early
    const before = new Date('2026-11-23T14:14:00.000Z');
    // 09:15 Bogota = 14:15 UTC -> due for yesterday (2026-11-22)
    const atSchedule = new Date('2026-11-23T14:15:00.000Z');

    await ctx.database.withRequestContext('', 'JOB', async () => {
      await ctx.database.db.execute(sql`SET LOCAL ROLE agency_worker`);
      expect(await service.enqueueScheduledRuns(before)).toBe(0);
      expect(await service.enqueueScheduledRuns(atSchedule)).toBe(1);
      // Idempotent on second tick
      expect(await service.enqueueScheduledRuns(atSchedule)).toBe(0);
    });

    const runs = await service.runs({ viewId: view.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ viewId: view.id, businessDate: '2026-11-22', status: 'QUEUED' });
  });

  it('reports freshness SLA status and emits deduplicated ALERTS outbox events on failure and staleness (A9)', async () => {
    const view = await hourlyView({ scheduleTime: '09:15', freshnessSlaMinutes: 60 });
    await ctx.db.insert(rocketchatChannels).values({
      purpose: 'ALERTS',
      type: 'GROUP',
      rcRoomId: 'room-alerts-1',
      name: 'alertas-etl',
      isActive: true,
    });

    // 09:45 Bogota = 14:45 UTC (before 10:15 SLA deadline) -> not stale yet
    const beforeSla = await service.freshness(new Date('2026-11-23T14:45:00.000Z'));
    expect(beforeSla).toHaveLength(1);
    expect(beforeSla[0]).toMatchObject({ viewId: view.id, expectedBusinessDate: '2026-11-22', isStale: false, staleReason: null });

    // 10:20 Bogota = 15:20 UTC (past 10:15 SLA deadline) -> stale, emits 1 alert only
    const afterSla = new Date('2026-11-23T15:20:00.000Z');
    const staleReport = await service.freshness(afterSla);
    expect(staleReport[0]).toMatchObject({ isStale: true, staleReason: 'No run queued for expected date' });

    await ctx.database.withRequestContext('', 'JOB', async () => {
      await ctx.database.db.execute(sql`SET LOCAL ROLE agency_worker`);
      expect(await service.checkStaleAlerts(afterSla)).toBe(1);
      expect(await service.checkStaleAlerts(afterSla)).toBe(0);
    });

    // FAILED run emits exactly 1 alert stamped via etl_runs.alerted_at
    download = () => { throw new Error('Tableau 503'); };
    const failedRun = await service.run({ viewId: view.id, businessDate: '2026-11-22' });
    await service.processQueued();
    const afterFail = await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, failedRun!.id) });
    expect(afterFail?.alertedAt).toBeTruthy();

    // Postgres returns rows in no guaranteed order without ORDER BY.
    const alerts = await ctx.db.select({ aggregateType: outboxEvents.aggregateType, eventType: outboxEvents.eventType }).from(outboxEvents).orderBy(asc(outboxEvents.aggregateType));
    expect(alerts).toEqual([
      { aggregateType: 'tableau_etl_run', eventType: 'rocketchat.message.send' },
      { aggregateType: 'tableau_freshness', eventType: 'rocketchat.message.send' },
    ]);

    // Updating per-view schedule preserves existing mapping
    const updated = await service.updateView(view.id, { scheduleTime: '08:30', freshnessSlaMinutes: 90 });
    expect(updated).toMatchObject({ scheduleTime: '08:30', freshnessSlaMinutes: 90, columnMapping: MAPPING });
  });

  it('sends one alert per active ALERTS channel, deduplicated even when two workers check at once', async () => {
    const view = await hourlyView({ scheduleTime: '09:15', freshnessSlaMinutes: 60 });
    const channels = await ctx.db.insert(rocketchatChannels).values([
      { purpose: 'ALERTS', type: 'GROUP', rcRoomId: 'room-alerts-1', name: 'alertas-etl', isActive: true },
      { purpose: 'ALERTS', type: 'GROUP', rcRoomId: 'room-alerts-2', name: 'alertas-direccion', isActive: true },
    ]).returning({ id: rocketchatChannels.id });
    const afterSla = new Date('2026-11-23T15:20:00.000Z');
    const workerCheck = () => ctx.database.withRequestContext('', 'JOB', async () => {
      await ctx.database.db.execute(sql`SET LOCAL ROLE agency_worker`);
      return service.checkStaleAlerts(afterSla);
    });

    const sent = await Promise.all([workerCheck(), workerCheck()]);
    expect(sent[0] + sent[1]).toBe(2);
    expect(await workerCheck()).toBe(0);

    download = () => { throw new Error('Tableau 503'); };
    const failedRun = await service.run({ viewId: view.id, businessDate: '2026-11-22' });
    await service.processQueued();

    // No thread id: the dispatcher would send `sourceMessageId` to Rocket.Chat as `tmid`.
    const rows = await ctx.db.select({ aggregateType: outboxEvents.aggregateType, aggregateId: outboxEvents.aggregateId, channelId: sql<string>`${outboxEvents.payload}->>'channelId'`, threadId: sql<string | null>`${outboxEvents.payload}->>'sourceMessageId'` }).from(outboxEvents);
    const key = (row: (typeof rows)[number]) => `${row.aggregateType}|${row.channelId}`;
    const alerts = rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const channelIds = channels.map((channel) => channel.id).sort();
    expect(alerts).toEqual([
      ...channelIds.map((channelId) => ({ aggregateType: 'tableau_etl_run', aggregateId: failedRun!.id, channelId, threadId: null })),
      ...channelIds.map((channelId) => ({ aggregateType: 'tableau_freshness', aggregateId: view.id, channelId, threadId: null })),
    ]);
  });

  it('persists raw CSV artifacts on failure and reprocesses offline without hitting Tableau again (A9)', async () => {
    const view = await hourlyView();
    const profile = await profileWithRef('TU-99');
    const rawBody = 'ProfileRef,Hour,Points\nTU-99,2026-11-22 10:00,18.25';
    download = () => ({ body: rawBody, contentType: 'text/csv', siteId: 'site-luid' });

    const queued = await service.run({ viewId: view.id, businessDate: '2026-11-22' });
    await service.processQueued();
    expect(downloads).toHaveLength(1);

    const failed = await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, queued!.id) });
    expect(failed).toMatchObject({
      status: 'FAILED',
      rawCsv: rawBody,
      rawCsvBytes: Buffer.byteLength(rawBody, 'utf8'),
    });
    expect(failed?.checksum).toBeTruthy();

    // runs() metadata listing omits rawCsv payload while exposing rawCsvBytes
    const listed = await service.runs({ viewId: view.id });
    expect('rawCsv' in listed[0]).toBe(false);
    expect(listed[0].rawCsvBytes).toBe(Buffer.byteLength(rawBody, 'utf8'));

    // Fix column mapping and reprocess offline: zero extra Tableau downloads
    await service.updateView(view.id, { columnMapping: { profileId: 'ProfileRef', sourceHour: 'Hour', points: 'Points' } });
    const reprocessed = await service.reprocess(queued!.id);
    expect(reprocessed).toMatchObject({ status: 'SUCCESS', rowCount: 1, rejectedCount: 0 });
    expect(downloads).toHaveLength(1);

    const points = await ctx.db.select({ profileId: tableauHourlyPoints.profileId, points: tableauHourlyPoints.points }).from(tableauHourlyPoints);
    expect(points).toEqual([{ profileId: profile.id, points: '18.2500' }]);

    // Run without stored raw CSV refuses offline reprocess with 409
    const [emptyRun] = await ctx.db.insert(etlRuns).values({ viewId: view.id, businessDate: '2026-11-21', status: 'FAILED' }).returning();
    await expect(service.reprocess(emptyRun.id)).rejects.toThrow(ConflictException);
  });
});
