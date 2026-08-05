import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { etlRuns, etlStagingRows, tableauHourlyPoints, tableauViews, ttProfiles } from '../../database/schema/index.js';
import type { TableauRunInput, TableauViewInput } from './tableau.schemas.js';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value.length || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? ''])));
}

@Injectable()
export class TableauService {
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService) {}

  async listViews() { return this.db.db.select({ id: tableauViews.id, name: tableauViews.name, siteId: tableauViews.siteId, viewId: tableauViews.viewId, sourceTimezone: tableauViews.sourceTimezone, kind: tableauViews.kind, isActive: tableauViews.isActive, columnMapping: tableauViews.columnMapping }).from(tableauViews); }

  async createView(input: TableauViewInput, actorId: string) { const [row] = await this.db.db.insert(tableauViews).values({ ...input, createdBy: actorId }).returning({ id: tableauViews.id, name: tableauViews.name, kind: tableauViews.kind }); return row; }

  async run(input: TableauRunInput) {
    const existing = await this.db.db.query.etlRuns.findFirst({ where: and(eq(etlRuns.viewId, input.viewId), eq(etlRuns.businessDate, input.businessDate)) });
    if (existing) return existing;
    const view = await this.db.db.query.tableauViews.findFirst({ where: and(eq(tableauViews.id, input.viewId), eq(tableauViews.isActive, true)) });
    if (!view) throw new NotFoundException('Tableau view not found');
    const [row] = await this.db.db.insert(etlRuns).values({ viewId: input.viewId, businessDate: input.businessDate, status: 'RUNNING' }).returning();
    void this.execute(row.id);
    return row;
  }

  async runs(viewId?: string) { return this.db.db.select().from(etlRuns).where(viewId ? eq(etlRuns.viewId, viewId) : undefined).orderBy(desc(etlRuns.startedAt)); }

  async finish(runId: string, status: 'SUCCESS' | 'PARTIAL' | 'FAILED', rowCount: number, rejectedCount: number, error?: string) { const [row] = await this.db.db.update(etlRuns).set({ status, rowCount, rejectedCount, error, finishedAt: new Date() }).where(eq(etlRuns.id, runId)).returning(); if (!row) throw new ConflictException('ETL run not found'); return row; }

  async execute(runId: string) {
    const run = await this.db.db.query.etlRuns.findFirst({ where: eq(etlRuns.id, runId) });
    if (!run || !run.viewId) throw new NotFoundException('ETL run not found');
    const view = await this.db.db.query.tableauViews.findFirst({ where: eq(tableauViews.id, run.viewId) });
    if (!view) throw new NotFoundException('Tableau view not found');
    const baseUrl = this.config.get('TABLEAU_API_BASE_URL');
    const token = this.config.get('TABLEAU_AUTH_TOKEN');
    if (!baseUrl || !token) return this.finish(runId, 'FAILED', 0, 0, 'Tableau ETL is not configured: TABLEAU_API_BASE_URL and TABLEAU_AUTH_TOKEN are required');
    try {
      const url = new URL(`${baseUrl.replace(/\/$/, '')}/sites/${encodeURIComponent(view.siteId)}/views/${encodeURIComponent(view.viewId)}/data`);
      url.searchParams.set('maxAge', '1');
      const response = await fetch(url, { headers: { 'X-Tableau-Auth': token, Accept: 'text/csv' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Tableau returned HTTP ${response.status}`);
      const body = await response.text();
      const checksum = createHash('sha256').update(body).digest('hex');
      const rows = parseCsv(body);
      const mapping = view.columnMapping ?? {};
      let rejected = 0;
      await this.db.db.transaction(async (tx) => {
        for (let index = 0; index < rows.length; index += 1) {
          const rawRow = rows[index];
          const profileValue = mapping.profileId ? rawRow[mapping.profileId] : undefined;
          const sourceHourValue = mapping.sourceHour ? rawRow[mapping.sourceHour] : undefined;
          const pointsValue = mapping.points ? rawRow[mapping.points] : undefined;
          const profile = profileValue ? await tx.query.ttProfiles.findFirst({ where: sql`${ttProfiles.id}::text = ${profileValue} OR ${ttProfiles.externalRef} = ${profileValue}` }) : undefined;
          const sourceHour = sourceHourValue ? new Date(sourceHourValue) : undefined;
          const points = pointsValue === undefined ? undefined : Number(pointsValue);
          const valid = view.kind !== 'POINTS_HOURLY' || Boolean(profile && sourceHour && !Number.isNaN(sourceHour.getTime()) && points !== undefined && Number.isFinite(points));
          if (!valid) rejected += 1;
          await tx.insert(etlStagingRows).values({ etlRunId: runId, rowNumber: index + 1, rawRow, validationStatus: valid ? 'VALID' : 'REJECTED', validationError: valid ? undefined : 'Missing or invalid profileId/sourceHour/points mapping' });
          if (valid && view.kind === 'POINTS_HOURLY' && profile && sourceHour && points !== undefined) {
            await tx.insert(tableauHourlyPoints).values({ viewId: view.id, profileId: profile.id, sourceHour, businessDate: run.businessDate, points: points.toFixed(4), rawRow, etlRunId: runId }).onConflictDoUpdate({ target: [tableauHourlyPoints.viewId, tableauHourlyPoints.profileId, tableauHourlyPoints.sourceHour], set: { points: points.toFixed(4), rawRow, etlRunId: runId, businessDate: run.businessDate } });
          }
        }
        await tx.update(etlRuns).set({ status: rejected ? 'PARTIAL' : 'SUCCESS', rowCount: rows.length, rejectedCount: rejected, checksum, finishedAt: new Date() }).where(eq(etlRuns.id, runId));
      });
      return { runId, status: rejected ? 'PARTIAL' : 'SUCCESS', rowCount: rows.length, rejectedCount: rejected, checksum };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Tableau ETL error';
      await this.finish(runId, 'FAILED', 0, 0, message);
      return { runId, status: 'FAILED', error: message };
    }
  }
}
