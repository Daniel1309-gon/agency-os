import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { etlRuns, etlStagingRows, outboxEvents, rocketchatChannels, tableauHourlyPoints, tableauViews, ttProfiles } from '../../database/schema/index.js';
import type { TableauRunInput, TableauRunsQueryInput, TableauViewInput, TableauViewUpdateInput } from './tableau.schemas.js';
import { TableauClient } from './tableau.client.js';
import { calendarDateIn, isTotalLabel, parseCsv, parsePoints, parseSourceHour, zonedWallTimeToUtc } from './tableau-parse.js';

/** A RUNNING run older than this lost its worker and is claimed again. */
const STALE_RUN_MINUTES = 30;
const ACTIVE = ['QUEUED', 'RUNNING'];
const POINTS_HOURLY_COLUMNS = ['profileId', 'sourceHour', 'points'] as const;

function previousCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function scheduledInstantUtc(calendarDate: string, scheduleTime: string, timeZone: string): Date | undefined {
  const [year, month, day] = calendarDate.split('-').map(Number);
  const [hour, minute] = scheduleTime.split(':').map(Number);
  return zonedWallTimeToUtc({ year, month, day, hour, minute, second: 0 }, timeZone);
}

/**
 * The stored error is read by administrators. A failed query's message embeds the
 * SQL and its parameters (raw rows), so only the database's own reason is kept.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown Tableau ETL error';
  const cause = (error as { cause?: unknown }).cause;
  if (error.message.startsWith('Failed query') && cause instanceof Error) return `Database rejected the run: ${cause.message}`;
  return error.message;
}

type StagedRow = { rowNumber: number; rawRow: Record<string, string>; validationStatus: 'VALID' | 'REJECTED' | 'SKIPPED'; validationError?: string };

@Injectable()
export class TableauService {
  constructor(private readonly db: DatabaseService, private readonly client: TableauClient) {}

  async listViews() {
    return this.db.db
      .select({
        id: tableauViews.id,
        name: tableauViews.name,
        siteId: tableauViews.siteId,
        viewId: tableauViews.viewId,
        sourceTimezone: tableauViews.sourceTimezone,
        kind: tableauViews.kind,
        isActive: tableauViews.isActive,
        scheduleTime: tableauViews.scheduleTime,
        scheduleTimezone: tableauViews.scheduleTimezone,
        freshnessSlaMinutes: tableauViews.freshnessSlaMinutes,
        columnMapping: tableauViews.columnMapping,
      })
      .from(tableauViews);
  }

  async createView(input: TableauViewInput, actorId: string) {
    const [row] = await this.db.db
      .insert(tableauViews)
      .values({ ...input, createdBy: actorId })
      .returning({
        id: tableauViews.id,
        name: tableauViews.name,
        kind: tableauViews.kind,
        scheduleTime: tableauViews.scheduleTime,
        scheduleTimezone: tableauViews.scheduleTimezone,
        freshnessSlaMinutes: tableauViews.freshnessSlaMinutes,
      });
    return row;
  }

  async updateView(id: string, input: TableauViewUpdateInput) {
    const current = await this.db.db.query.tableauViews.findFirst({ where: eq(tableauViews.id, id) });
    if (!current) throw new NotFoundException('Tableau view not found');
    const nextKind = input.kind ?? current.kind;
    const nextMapping = input.columnMapping ?? current.columnMapping ?? {};
    if (nextKind === 'POINTS_HOURLY' && !POINTS_HOURLY_COLUMNS.every((key) => nextMapping[key])) {
      throw new ConflictException(`a POINTS_HOURLY view must map ${POINTS_HOURLY_COLUMNS.join(', ')}`);
    }
    const [row] = await this.db.db
      .update(tableauViews)
      .set(input)
      .where(eq(tableauViews.id, id))
      .returning({
        id: tableauViews.id,
        name: tableauViews.name,
        kind: tableauViews.kind,
        isActive: tableauViews.isActive,
        scheduleTime: tableauViews.scheduleTime,
        scheduleTimezone: tableauViews.scheduleTimezone,
        freshnessSlaMinutes: tableauViews.freshnessSlaMinutes,
        columnMapping: tableauViews.columnMapping,
      });
    return row;
  }

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
    const [row] = await this.db.db.update(etlRuns).set({ status: 'QUEUED', error: null, finishedAt: null, alertedAt: null }).where(and(eq(etlRuns.id, runId), notInArray(etlRuns.status, ACTIVE))).returning();
    if (row) return row;
    const current = await this.db.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, runId) });
    if (!current) throw new NotFoundException('ETL run not found');
    return current;
  }

  async runs(query?: string | Partial<TableauRunsQueryInput>) {
    const filters: { viewId?: string; limit?: number } = typeof query === 'string' ? { viewId: query } : (query ?? {});
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    return this.db.db
      .select({
        id: etlRuns.id,
        viewId: etlRuns.viewId,
        businessDate: etlRuns.businessDate,
        status: etlRuns.status,
        startedAt: etlRuns.startedAt,
        finishedAt: etlRuns.finishedAt,
        rowCount: etlRuns.rowCount,
        rejectedCount: etlRuns.rejectedCount,
        error: etlRuns.error,
        checksum: etlRuns.checksum,
        rawCsvBytes: etlRuns.rawCsvBytes,
        alertedAt: etlRuns.alertedAt,
      })
      .from(etlRuns)
      .where(filters.viewId ? eq(etlRuns.viewId, filters.viewId) : undefined)
      .orderBy(desc(etlRuns.startedAt))
      .limit(limit);
  }

  /** Worker scheduler: queues yesterday's business date once per active view once its local schedule time is reached. */
  async enqueueScheduledRuns(now = new Date()): Promise<number> {
    const views = await this.db.db
      .select({
        id: tableauViews.id,
        scheduleTime: tableauViews.scheduleTime,
        scheduleTimezone: tableauViews.scheduleTimezone,
      })
      .from(tableauViews)
      .where(eq(tableauViews.isActive, true));
    let queued = 0;
    for (const view of views) {
      const today = calendarDateIn(now, view.scheduleTimezone);
      const scheduledAt = scheduledInstantUtc(today, view.scheduleTime, view.scheduleTimezone);
      if (!scheduledAt || now.getTime() < scheduledAt.getTime()) continue;
      const expectedDate = previousCalendarDate(today);
      const inserted = await this.db.db
        .insert(etlRuns)
        .values({ viewId: view.id, businessDate: expectedDate, status: 'QUEUED' })
        .onConflictDoNothing({ target: [etlRuns.viewId, etlRuns.businessDate] })
        .returning({ id: etlRuns.id });
      queued += inserted.length;
    }
    return queued;
  }

  /** Reports per-view ETL freshness against each view's daily schedule and SLA. */
  async freshness(now = new Date()) {
    const views = await this.db.db
      .select({
        id: tableauViews.id,
        name: tableauViews.name,
        kind: tableauViews.kind,
        scheduleTime: tableauViews.scheduleTime,
        scheduleTimezone: tableauViews.scheduleTimezone,
        freshnessSlaMinutes: tableauViews.freshnessSlaMinutes,
      })
      .from(tableauViews)
      .where(eq(tableauViews.isActive, true));
    if (!views.length) return [];

    const viewIds = views.map((view) => view.id);
    const runRows = await this.db.db
      .select({
        id: etlRuns.id,
        viewId: etlRuns.viewId,
        businessDate: etlRuns.businessDate,
        status: etlRuns.status,
        rowCount: etlRuns.rowCount,
        rejectedCount: etlRuns.rejectedCount,
        checksum: etlRuns.checksum,
        finishedAt: etlRuns.finishedAt,
        error: etlRuns.error,
      })
      .from(etlRuns)
      .where(inArray(etlRuns.viewId, viewIds))
      .orderBy(desc(etlRuns.businessDate), desc(etlRuns.startedAt));

    const latestByView = new Map<string, (typeof runRows)[number]>();
    const byViewAndDate = new Map<string, (typeof runRows)[number]>();
    for (const row of runRows) {
      if (!row.viewId) continue;
      if (!latestByView.has(row.viewId)) latestByView.set(row.viewId, row);
      const key = `${row.viewId}|${row.businessDate}`;
      if (!byViewAndDate.has(key)) byViewAndDate.set(key, row);
    }

    return views.map((view) => {
      const today = calendarDateIn(now, view.scheduleTimezone);
      const expectedBusinessDate = previousCalendarDate(today);
      const scheduledAt = scheduledInstantUtc(today, view.scheduleTime, view.scheduleTimezone);
      const slaDeadline = scheduledAt ? new Date(scheduledAt.getTime() + view.freshnessSlaMinutes * 60_000) : undefined;
      const expectedRun = byViewAndDate.get(`${view.id}|${expectedBusinessDate}`) ?? null;
      const latestRun = latestByView.get(view.id) ?? null;

      let isStale = false;
      let staleReason: string | null = null;
      if (expectedRun?.status === 'FAILED') {
        isStale = true;
        staleReason = expectedRun.error ?? 'Run failed';
      } else if (slaDeadline && now.getTime() >= slaDeadline.getTime()) {
        if (!expectedRun) {
          isStale = true;
          staleReason = 'No run queued for expected date';
        } else if (ACTIVE.includes(expectedRun.status)) {
          isStale = true;
          staleReason = 'Run still in progress past freshness SLA';
        }
      } else if (latestRun?.status === 'FAILED') {
        isStale = true;
        staleReason = latestRun.error ?? 'Latest run failed';
      }

      return {
        viewId: view.id,
        name: view.name,
        kind: view.kind,
        scheduleTime: view.scheduleTime,
        scheduleTimezone: view.scheduleTimezone,
        freshnessSlaMinutes: view.freshnessSlaMinutes,
        expectedBusinessDate,
        slaDeadlineAt: slaDeadline?.toISOString() ?? null,
        latestRun,
        isStale,
        staleReason,
      };
    });
  }

  /** Worker alerts: emits a deduplicated Rocket.Chat ALERTS outbox event for views that missed their freshness SLA. */
  async checkStaleAlerts(now = new Date()): Promise<number> {
    const statuses = await this.freshness(now);
    let sent = 0;
    for (const item of statuses) {
      if (!item.isStale || !item.staleReason) continue;
      // FAILED runs emit their own deduplicated alert via etl_runs.alerted_at on execution.
      if (item.latestRun?.status === 'FAILED' && item.latestRun.businessDate === item.expectedBusinessDate) continue;
      const dedupeKey = `tableau-stale:${item.viewId}:${item.expectedBusinessDate}`;
      const existing = await this.db.db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(and(eq(outboxEvents.aggregateType, 'tableau_freshness'), eq(outboxEvents.aggregateId, item.viewId), sql`${outboxEvents.payload}->>'alertKey' = ${dedupeKey}`))
        .limit(1);
      if (existing.length) continue;
      sent += await this.enqueueAlertsChannel(
        'tableau_freshness',
        item.viewId,
        `[Tableau ETL] Vista "${item.name}" venció su SLA de frescura (${item.expectedBusinessDate}): ${item.staleReason}`,
        dedupeKey,
      );
    }
    return sent;
  }

  private async enqueueRunAlert(runId: string, viewName: string, businessDate: string, status: 'FAILED' | 'PARTIAL', detail: string): Promise<void> {
    const [claimed] = await this.db.db
      .update(etlRuns)
      .set({ alertedAt: new Date() })
      .where(and(eq(etlRuns.id, runId), isNull(etlRuns.alertedAt)))
      .returning({ id: etlRuns.id });
    if (!claimed) return;
    await this.enqueueAlertsChannel(
      'tableau_etl_run',
      runId,
      `[Tableau ETL] Corrida ${status} en "${viewName}" (${businessDate}): ${detail}`,
      `tableau-run:${runId}:${status}`,
    );
  }

  /**
   * One outbox row per active ALERTS channel, deduplicated by `alertKey` + channel
   * (index `outbox_alert_key_unique`): a concurrent worker that already enqueued the
   * same alert makes the insert a no-op. `sourceMessageId` must stay unset: the
   * dispatcher sends it to Rocket.Chat as the thread id of a real message.
   */
  private async enqueueAlertsChannel(aggregateType: string, aggregateId: string, body: string, alertKey: string): Promise<number> {
    const channels = await this.db.db
      .select({ id: rocketchatChannels.id })
      .from(rocketchatChannels)
      .where(and(eq(rocketchatChannels.purpose, 'ALERTS'), eq(rocketchatChannels.isActive, true)));
    if (!channels.length) return 0;
    const inserted = await this.db.db
      .insert(outboxEvents)
      .values(
        channels.map((channel) => ({
          eventType: 'rocketchat.message.send',
          aggregateType,
          aggregateId,
          payload: { channelId: channel.id, body, alertKey },
        })),
      )
      .onConflictDoNothing()
      .returning({ id: outboxEvents.id });
    return inserted.length;
  }

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

  /** Worker only. Downloads the view, persists the raw CSV artifact, stages every row, and promotes valid hourly points. */
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
      return await this.ingestCsv(run, view, download.body);
    } catch (error) {
      const message = describeFailure(error);
      await this.db.db.update(etlRuns).set({ status: 'FAILED', error: message, finishedAt: new Date() }).where(eq(etlRuns.id, runId));
      await this.enqueueRunAlert(runId, view.name, run.businessDate, 'FAILED', message);
      return { runId, status: 'FAILED' as const, error: message };
    }
  }

  /** Re-runs parsing, staging, and promotion from the stored raw CSV artifact without calling Tableau. */
  async reprocess(runId: string) {
    const [claimed] = await this.db.db
      .update(etlRuns)
      .set({ status: 'RUNNING', startedAt: new Date(), finishedAt: null, error: null, alertedAt: null })
      .where(and(eq(etlRuns.id, runId), notInArray(etlRuns.status, ACTIVE), sql`${etlRuns.rawCsv} IS NOT NULL`))
      .returning();
    if (!claimed) {
      const current = await this.db.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, runId) });
      if (!current) throw new NotFoundException('ETL run not found');
      if (ACTIVE.includes(current.status)) throw new ConflictException('ETL run is currently queued or running');
      throw new ConflictException('No raw CSV artifact stored for this run');
    }
    if (!claimed.viewId) throw new NotFoundException('Tableau view not found');
    const view = await this.db.db.query.tableauViews.findFirst({ where: eq(tableauViews.id, claimed.viewId) });
    if (!view) throw new NotFoundException('Tableau view not found');
    return this.ingestCsv(claimed, view, claimed.rawCsv!);
  }

  private async ingestCsv(run: typeof etlRuns.$inferSelect, view: typeof tableauViews.$inferSelect, csvBody: string) {
    const runId = run.id;
    const checksum = createHash('sha256').update(csvBody).digest('hex');
    const rawCsvBytes = Buffer.byteLength(csvBody, 'utf8');
    // Persist the raw CSV artifact immediately so mapping/validation fixes can reprocess offline without hitting Tableau again.
    await this.db.db.update(etlRuns).set({ rawCsv: csvBody, rawCsvBytes, checksum }).where(eq(etlRuns.id, runId));
    try {
      const { headers, rows } = parseCsv(csvBody);
      const mapping = view.columnMapping ?? {};
      const missing = Object.entries(mapping).filter(([, column]) => !headers.includes(column)).map(([key, column]) => `${key}=${column}`);
      if (missing.length) throw new Error(`View columns changed: mapped columns not found (${missing.join(', ')})`);

      const isHourly = view.kind === 'POINTS_HOURLY';
      const refs = isHourly ? [...new Set(rows.map((row) => row[mapping.profileId]?.trim()).filter((value): value is string => Boolean(value) && !isTotalLabel(value!)))] : [];
      const profiles = refs.length ? await this.db.db.select({ id: ttProfiles.id, externalRef: ttProfiles.externalRef }).from(ttProfiles).where(inArray(ttProfiles.externalRef, refs)) : [];
      const profileByRef = new Map(profiles.map((profile) => [profile.externalRef, profile.id]));

      const staged: StagedRow[] = [];
      // One profile can have several SourceIDs, so a flat sheet may carry several rows
      // for the same profile and hour: they are summed into a single hourly point.
      const hourly = new Map<string, { profileId: string; sourceHour: Date; points: number; sourceRows: Record<string, string>[] }>();
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
        const key = `${profileId}|${sourceHour.toISOString()}`;
        const entry = hourly.get(key) ?? { profileId, sourceHour, points: 0, sourceRows: [] };
        entry.points += value;
        entry.sourceRows.push(rawRow);
        hourly.set(key, entry);
      });

      const points = [...hourly.values()].map((entry) => ({ viewId: view.id, profileId: entry.profileId, sourceHour: entry.sourceHour, businessDate: calendarDateIn(entry.sourceHour, 'America/Bogota'), points: entry.points.toFixed(4), rawRow: { sourceRows: entry.sourceRows }, etlRunId: runId }));
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
        await tx.update(etlRuns).set({ status, rowCount: rows.length, rejectedCount: rejected, checksum, rawCsvBytes, error: null, finishedAt: new Date() }).where(eq(etlRuns.id, runId));
      });
      if (status === 'PARTIAL') {
        await this.enqueueRunAlert(runId, view.name, run.businessDate, 'PARTIAL', `${rejected} de ${rows.length} filas rechazadas`);
      }
      return { runId, status, rowCount: rows.length, rejectedCount: rejected, checksum, rawCsvBytes };
    } catch (error) {
      const message = describeFailure(error);
      await this.db.db.update(etlRuns).set({ status: 'FAILED', error: message, finishedAt: new Date() }).where(eq(etlRuns.id, runId));
      await this.enqueueRunAlert(runId, view.name, run.businessDate, 'FAILED', message);
      return { runId, status: 'FAILED' as const, error: message };
    }
  }

  /** Views may be registered by site LUID or by content URL; both identify the same site. */
  private siteContentUrlHint(): string {
    return this.client.siteContentUrl();
  }
}
