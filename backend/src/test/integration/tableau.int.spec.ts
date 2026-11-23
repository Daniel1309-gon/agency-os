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
/** Runs while the fake download is in flight, e.g. another worker reclaiming the run. */
let duringDownload: (() => Promise<void>) | undefined;

beforeAll(async () => {
  ctx = await createTestContext();
  const client = {
    downloadViewData: async (viewId: string) => { downloads.push(viewId); await duringDownload?.(); return download(); },
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
  duringDownload = undefined;
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

  it('drops the result of a worker whose claim another worker took over', async () => {
    const view = await hourlyView();
    await profileWithRef('TU-1');
    const takeOver = async () => {
      // Another worker reclaims the run (stale RUNNING) while this one is downloading.
      await ctx.db.update(etlRuns).set({ startedAt: new Date(Date.now() + 60_000) }).where(eq(etlRuns.viewId, view.id));
    };

    download = () => csv(['TU-1,2026-11-22 06:00,5']);
    const succeeded = await service.run({ viewId: view.id, businessDate: '2026-11-22' });
    duringDownload = takeOver;
    await service.processQueued();
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, succeeded!.id) })).toMatchObject({ status: 'RUNNING', rawCsv: null, finishedAt: null });
    expect(await ctx.db.select().from(tableauHourlyPoints)).toEqual([]);
    expect(await ctx.db.select().from(etlStagingRows)).toEqual([]);

    // A failure seen by the superseded worker is not recorded either: the new owner decides.
    download = () => { throw new Error('Tableau 503'); };
    const failed = await service.run({ viewId: view.id, businessDate: '2026-11-21' });
    await service.processQueued();
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, failed!.id) })).toMatchObject({ status: 'RUNNING', error: null, alertedAt: null });

    // The worker that holds the claim still finishes normally.
    duringDownload = undefined;
    download = () => csv(['TU-1,2026-11-22 06:00,5']);
    await ctx.db.update(etlRuns).set({ status: 'QUEUED' }).where(eq(etlRuns.id, succeeded!.id));
    await service.processQueued();
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, succeeded!.id) })).toMatchObject({ status: 'SUCCESS', rowCount: 1 });
  });

  it('writes nothing for an execute call whose lease is not the current claim', async () => {
    const view = await hourlyView();
    await profileWithRef('TU-1');
    const [run] = await ctx.db.insert(etlRuns).values({ viewId: view.id, businessDate: '2026-11-20', status: 'RUNNING', startedAt: new Date('2026-11-23T10:00:00.000Z') }).returning();
    download = () => csv(['TU-1,2026-11-20 06:00,9']);

    await expect(service.execute(run.id, new Date('2026-11-23T09:00:00.000Z'))).resolves.toEqual({ runId: run.id, status: 'SUPERSEDED' });
    expect(await ctx.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, run.id) })).toMatchObject({ status: 'RUNNING', rawCsv: null, finishedAt: null });
    expect(await ctx.db.select().from(tableauHourlyPoints)).toEqual([]);
  });

  it('takes each view expected date from its own schedule timezone', async () => {
    // 2026-11-23T02:00Z is 2026-11-22 21:00 in Bogota (expects 11-21) and 2026-11-23 in UTC (expects 11-22).
    const bogota = await hourlyView({ name: 'Bogota', viewId: 'v-bog', scheduleTimezone: 'America/Bogota', scheduleTime: '00:30', freshnessSlaMinutes: 30 });
    const utc = await hourlyView({ name: 'UTC', viewId: 'v-utc', scheduleTimezone: 'UTC', scheduleTime: '00:30', freshnessSlaMinutes: 30 });
    await ctx.db.insert(etlRuns).values([
      { viewId: bogota.id, businessDate: '2026-11-21', status: 'SUCCESS' },
      { viewId: utc.id, businessDate: '2026-11-21', status: 'SUCCESS' },
    ]);

    const byId = new Map((await service.freshness(new Date('2026-11-23T02:00:00.000Z'))).map((item) => [item.viewId, item]));
    expect(byId.get(bogota.id)).toMatchObject({ expectedBusinessDate: '2026-11-21', isStale: false });
    expect(byId.get(utc.id)).toMatchObject({ expectedBusinessDate: '2026-11-22', isStale: true, staleReason: 'No run queued for expected date' });
  });

  it('reports the expected-date run and the latest run per view among a long history', async () => {
    const view = await hourlyView({ scheduleTime: '09:15', freshnessSlaMinutes: 60 });
    const other = await hourlyView({ name: 'Other', viewId: 'other-luid', scheduleTime: '09:15', freshnessSlaMinutes: 60 });
    const history = Array.from({ length: 40 }, (_, day) => ({ viewId: view.id, businessDate: `2026-10-${String(day % 31 + 1).padStart(2, '0')}`, status: 'SUCCESS' })).filter((row, index, all) => all.findIndex((r) => r.businessDate === row.businessDate) === index);
    await ctx.db.insert(etlRuns).values(history);
    await ctx.db.insert(etlRuns).values([
      { viewId: view.id, businessDate: '2026-11-22', status: 'SUCCESS' },
      { viewId: view.id, businessDate: '2026-11-23', status: 'FAILED', error: 'Tableau 503' },
      { viewId: other.id, businessDate: '2026-11-20', status: 'SUCCESS' },
    ]);

    const report = await service.freshness(new Date('2026-11-23T15:20:00.000Z'));
    const byView = new Map(report.map((item) => [item.viewId, item]));
    expect(byView.get(view.id)).toMatchObject({ expectedBusinessDate: '2026-11-22', isStale: false, latestRun: { businessDate: '2026-11-23', status: 'FAILED' } });
    expect(byView.get(other.id)).toMatchObject({ expectedBusinessDate: '2026-11-22', isStale: true, staleReason: 'No run queued for expected date', latestRun: { businessDate: '2026-11-20' } });
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

  it('re-ingesting a run with fewer rows supersedes its extra staging rows and leaves other runs untouched', async () => {
    const view = await hourlyView();
    const profile = await profileWithRef('TU-1');
    download = () => csv(['TU-1,2026-11-21 06:00,4']);
    const other = await service.run({ viewId: view.id, businessDate: '2026-11-21' });
    await service.processQueued();
    download = () => csv(['TU-1,2026-11-22 06:00,1', 'TU-1,2026-11-22 07:00,2']);
    const run = await service.run({ viewId: view.id, businessDate: '2026-11-22' });
    await service.processQueued();

    // The stored artifact is replaced by a shorter one (e.g. a trimmed export) and reprocessed.
    await ctx.db.update(etlRuns).set({ rawCsv: csv(['TU-1,2026-11-22 06:00,1']).body }).where(eq(etlRuns.id, run!.id));
    await expect(service.reprocess(run!.id)).resolves.toMatchObject({ status: 'SUCCESS', rowCount: 1 });

    const staged = await ctx.db.select({ rowNumber: etlStagingRows.rowNumber, status: etlStagingRows.validationStatus, error: etlStagingRows.validationError }).from(etlStagingRows).where(eq(etlStagingRows.etlRunId, run!.id)).orderBy(asc(etlStagingRows.rowNumber));
    expect(staged).toEqual([
      { rowNumber: 1, status: 'VALID', error: null },
      { rowNumber: 2, status: 'SKIPPED', error: 'Superseded by a later ingest of this run' },
    ]);
    const points = await ctx.db.select({ etlRunId: tableauHourlyPoints.etlRunId, sourceHour: tableauHourlyPoints.sourceHour, points: tableauHourlyPoints.points }).from(tableauHourlyPoints).where(eq(tableauHourlyPoints.profileId, profile.id)).orderBy(asc(tableauHourlyPoints.sourceHour));
    expect(points).toEqual([
      { etlRunId: other!.id, sourceHour: new Date('2026-11-21T11:00:00.000Z'), points: '4.0000' },
      { etlRunId: run!.id, sourceHour: new Date('2026-11-22T11:00:00.000Z'), points: '1.0000' },
      { etlRunId: run!.id, sourceHour: new Date('2026-11-22T12:00:00.000Z'), points: '0.0000' },
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

    // Reprocessing after a timezone fix moves the hour: the old hour of this run must not keep its points.
    await service.updateView(view.id, { sourceTimezone: 'UTC' });
    await expect(service.reprocess(queued!.id)).resolves.toMatchObject({ status: 'SUCCESS' });
    const moved = await ctx.db.select({ sourceHour: tableauHourlyPoints.sourceHour, points: tableauHourlyPoints.points }).from(tableauHourlyPoints).orderBy(asc(tableauHourlyPoints.sourceHour));
    expect(moved).toEqual([
      { sourceHour: new Date('2026-11-22T10:00:00.000Z'), points: '18.2500' },
      { sourceHour: new Date('2026-11-22T15:00:00.000Z'), points: '0.0000' },
    ]);

    // Run without stored raw CSV refuses offline reprocess with 409
    const [emptyRun] = await ctx.db.insert(etlRuns).values({ viewId: view.id, businessDate: '2026-11-21', status: 'FAILED' }).returning();
    await expect(service.reprocess(emptyRun.id)).rejects.toThrow(ConflictException);
  });
});
