import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { TableauService } from '../../modules/tableau/tableau.service.js';
import type { TableauClient, ViewDownload } from '../../modules/tableau/tableau.client.js';
import { etlRuns, etlStagingRows, tableauHourlyPoints, tableauViews, ttProfiles } from '../../database/schema/index.js';
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
});
