import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { etlRuns, etlStagingRows, tableauHourlyPoints, tableauViews, ttProfiles } from '../../database/schema/index.js';
import type { TableauRunInput, TableauViewInput } from './tableau.schemas.js';
import { TableauClient } from './tableau.client.js';
import { calendarDateIn, isTotalLabel, parseCsv, parsePoints, parseSourceHour } from './tableau-parse.js';

/** A RUNNING run older than this lost its worker and is claimed again. */
const STALE_RUN_MINUTES = 30;
const ACTIVE = ['QUEUED', 'RUNNING'];

type StagedRow = { rowNumber: number; rawRow: Record<string, string>; validationStatus: 'VALID' | 'REJECTED' | 'SKIPPED'; validationError?: string };

@Injectable()
export class TableauService {
  constructor(private readonly db: DatabaseService, private readonly client: TableauClient) {}

  async listViews() { return this.db.db.select({ id: tableauViews.id, name: tableauViews.name, siteId: tableauViews.siteId, viewId: tableauViews.viewId, sourceTimezone: tableauViews.sourceTimezone, kind: tableauViews.kind, isActive: tableauViews.isActive, columnMapping: tableauViews.columnMapping }).from(tableauViews); }

  async createView(input: TableauViewInput, actorId: string) { const [row] = await this.db.db.insert(tableauViews).values({ ...input, createdBy: actorId }).returning({ id: tableauViews.id, name: tableauViews.name, kind: tableauViews.kind }); return row; }

  /**
   * Queues the run of a view for a business date. The API never calls Tableau: the
   * worker does, because it is the only process holding the PAT. Re-requesting a
   * finished run returns it; a FAILED one is queued again.
   */
  async run(input: TableauRunInput) {
    const existing = await this.db.db.query.etlRuns.findFirst({ where: and(eq(etlRuns.viewId, input.viewId), eq(etlRuns.businessDate, input.businessDate)) });
    if (existing) return existing.status === 'FAILED' ? this.requeue(existing.id) : existing;
    const view = await this.db.db.query.tableauViews.findFirst({ where: and(eq(tableauViews.id, input.viewId), eq(tableauViews.isActive, true)) });
    if (!view) throw new NotFoundException('Tableau view not found');
    const [row] = await this.db.db.insert(etlRuns).values({ viewId: input.viewId, businessDate: input.businessDate, status: 'QUEUED' }).onConflictDoNothing().returning();
    return row ?? this.db.db.query.etlRuns.findFirst({ where: and(eq(etlRuns.viewId, input.viewId), eq(etlRuns.businessDate, input.businessDate)) });
  }

  /** Queues an existing run again (after a fix to the mapping, or a failure). A queued or running run is left alone. */
  async requeue(runId: string) {
    const [row] = await this.db.db.update(etlRuns).set({ status: 'QUEUED', error: null, finishedAt: null }).where(and(eq(etlRuns.id, runId), notInArray(etlRuns.status, ACTIVE))).returning();
    if (row) return row;
    const current = await this.db.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, runId) });
    if (!current) throw new NotFoundException('ETL run not found');
    return current;
  }

  async runs(viewId?: string) { return this.db.db.select().from(etlRuns).where(viewId ? eq(etlRuns.viewId, viewId) : undefined).orderBy(desc(etlRuns.startedAt)); }

  /** Worker only: claims queued runs (and stale running ones) and executes them one by one. */
  async processQueued(limit = 4): Promise<number> {
    const claimed = await this.db.db.execute(sql`
      UPDATE etl_runs SET status = 'RUNNING', started_at = now()
      WHERE id IN (
        SELECT id FROM etl_runs
        WHERE status = 'QUEUED' OR (status = 'RUNNING' AND started_at < now() - make_interval(mins => ${STALE_RUN_MINUTES}))
        ORDER BY started_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING id`);
    for (const row of claimed.rows) await this.execute(String((row as { id: string }).id));
    return claimed.rows.length;
  }

  /** Worker only. Downloads the view, stages every row, and promotes valid hourly points. */
  async execute(runId: string) {
    const run = await this.db.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, runId) });
    if (!run || !run.viewId) throw new NotFoundException('ETL run not found');
    const view = await this.db.db.query.tableauViews.findFirst({ where: eq(tableauViews.id, run.viewId) });
    if (!view) throw new NotFoundException('Tableau view not found');
    try {
      const download = await this.client.downloadViewData(view.viewId);
      if (view.siteId !== download.siteId && view.siteId !== this.siteContentUrlHint()) {
        throw new Error(`View is registered for site ${view.siteId}, but the PAT signed in to site ${download.siteId}`);
      }
      const checksum = createHash('sha256').update(download.body).digest('hex');
      const { headers, rows } = parseCsv(download.body);
      const mapping = view.columnMapping ?? {};
      const missing = Object.entries(mapping).filter(([, column]) => !headers.includes(column)).map(([key, column]) => `${key}=${column}`);
      if (missing.length) throw new Error(`View columns changed: mapped columns not found (${missing.join(', ')})`);

      const isHourly = view.kind === 'POINTS_HOURLY';
      const refs = isHourly ? [...new Set(rows.map((row) => row[mapping.profileId]?.trim()).filter((value): value is string => Boolean(value) && !isTotalLabel(value!)))] : [];
      const profiles = refs.length ? await this.db.db.select({ id: ttProfiles.id, externalRef: ttProfiles.externalRef }).from(ttProfiles).where(inArray(ttProfiles.externalRef, refs)) : [];
      const profileByRef = new Map(profiles.map((profile) => [profile.externalRef, profile.id]));

      const staged: StagedRow[] = [];
      const points: Array<typeof tableauHourlyPoints.$inferInsert> = [];
      rows.forEach((rawRow, index) => {
        const rowNumber = index + 1;
        if (!isHourly) return staged.push({ rowNumber, rawRow, validationStatus: 'VALID' });
        const ref = rawRow[mapping.profileId]?.trim() ?? '';
        if (isTotalLabel(ref)) return staged.push({ rowNumber, rawRow, validationStatus: 'SKIPPED', validationError: 'Total row' });
        const profileId = profileByRef.get(ref);
        const sourceHour = parseSourceHour(rawRow[mapping.sourceHour] ?? '', view.sourceTimezone);
        const value = parsePoints(rawRow[mapping.points] ?? '');
        const error = !profileId ? `Unknown profile reference "${ref}"` : !sourceHour ? 'Hour is not an ISO date-time (YYYY-MM-DD HH:mm)' : value === undefined ? 'Points are not a plain decimal number' : undefined;
        if (error || !profileId || !sourceHour || value === undefined) return staged.push({ rowNumber, rawRow, validationStatus: 'REJECTED', validationError: error });
        staged.push({ rowNumber, rawRow, validationStatus: 'VALID' });
        points.push({ viewId: view.id, profileId, sourceHour, businessDate: calendarDateIn(sourceHour, 'America/Bogota'), points: value.toFixed(4), rawRow, etlRunId: runId });
      });

      const rejected = staged.filter((row) => row.validationStatus === 'REJECTED').length;
      const status = rejected ? 'PARTIAL' : 'SUCCESS';
      await this.db.db.transaction(async (tx) => {
        for (let start = 0; start < staged.length; start += 500) {
          await tx.insert(etlStagingRows).values(staged.slice(start, start + 500).map((row) => ({ etlRunId: runId, ...row }))).onConflictDoUpdate({
            target: [etlStagingRows.etlRunId, etlStagingRows.rowNumber],
            set: { rawRow: sql`excluded.raw_row`, validationStatus: sql`excluded.validation_status`, validationError: sql`excluded.validation_error` },
          });
        }
        for (let start = 0; start < points.length; start += 500) {
          await tx.insert(tableauHourlyPoints).values(points.slice(start, start + 500)).onConflictDoUpdate({
            target: [tableauHourlyPoints.viewId, tableauHourlyPoints.profileId, tableauHourlyPoints.sourceHour],
            set: { points: sql`excluded.points`, rawRow: sql`excluded.raw_row`, etlRunId: sql`excluded.etl_run_id`, businessDate: sql`excluded.business_date` },
          });
        }
        await tx.update(etlRuns).set({ status, rowCount: rows.length, rejectedCount: rejected, checksum, error: null, finishedAt: new Date() }).where(eq(etlRuns.id, runId));
      });
      return { runId, status, rowCount: rows.length, rejectedCount: rejected, checksum };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Tableau ETL error';
      await this.db.db.update(etlRuns).set({ status: 'FAILED', error: message, finishedAt: new Date() }).where(eq(etlRuns.id, runId));
      return { runId, status: 'FAILED' as const, error: message };
    }
  }

  /** Views may be registered by site LUID or by content URL; both identify the same site. */
  private siteContentUrlHint(): string {
    return this.client.siteContentUrl();
  }
}
