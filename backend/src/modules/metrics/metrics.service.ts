import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { metricEvents, metricReconciliation, profileDailyMetrics, ttProfiles } from '../../database/schema/index.js';
import type { MetricBatchInput } from './metrics.schemas.js';

@Injectable()
export class MetricsService {
  constructor(private readonly db: DatabaseService) {}

  async ingest(input: MetricBatchInput, operatorId: string, sessionId?: string) {
    const rows = input.events.map((event) => ({
      dedupeKey: event.dedupeKey,
      profileId: event.profileId,
      operatorId,
      sessionId,
      eventType: event.eventType,
      points: event.points?.toString(),
      occurredAt: new Date(event.occurredAt),
      payload: event.payload,
    }));
    const inserted = await this.db.db.insert(metricEvents).values(rows).onConflictDoNothing({ target: [metricEvents.dedupeKey, metricEvents.occurredAt] }).returning({ id: metricEvents.id });
    return { accepted: inserted.length, ignored: rows.length - inserted.length };
  }

  async profiles(from?: string, to?: string, profileId?: string) {
    const filters = [eq(profileDailyMetrics.source, 'EXTENSION')];
    if (from) filters.push(gte(profileDailyMetrics.businessDate, from));
    if (to) filters.push(lte(profileDailyMetrics.businessDate, to));
    if (profileId) filters.push(eq(profileDailyMetrics.profileId, profileId));
    return this.db.db.select({ profileId: profileDailyMetrics.profileId, displayName: ttProfiles.displayName, businessDate: profileDailyMetrics.businessDate, points: profileDailyMetrics.points, messagesSent: profileDailyMetrics.messagesSent, responses: profileDailyMetrics.responses, responseRate: profileDailyMetrics.responseRate, source: profileDailyMetrics.source }).from(profileDailyMetrics).innerJoin(ttProfiles, eq(ttProfiles.id, profileDailyMetrics.profileId)).where(and(...filters)).orderBy(asc(profileDailyMetrics.businessDate));
  }

  async ranking() {
    // La expresion se repite en el ORDER BY en vez de ordenar por `response_rate`:
    // Drizzle no emite alias para las columnas seleccionadas (mapea por posicion),
    // asi que ese nombre lo resolvia Postgres contra la columna homonima de
    // profile_daily_metrics — sin agrupar — y la consulta moria con un 42803.
    const responseRate = sql<number>`coalesce(sum(${profileDailyMetrics.responses})::numeric / nullif(sum(${profileDailyMetrics.messagesSent}), 0), 0)`;
    return this.db.db.select({ profileId: profileDailyMetrics.profileId, displayName: ttProfiles.displayName, responseRate }).from(profileDailyMetrics).innerJoin(ttProfiles, eq(ttProfiles.id, profileDailyMetrics.profileId)).groupBy(profileDailyMetrics.profileId, ttProfiles.displayName).orderBy(sql`${responseRate} DESC`);
  }

  async timeseries(profileId: string, from?: string, to?: string) {
    const filters = [eq(profileDailyMetrics.profileId, profileId)];
    if (from) filters.push(gte(profileDailyMetrics.businessDate, from));
    if (to) filters.push(lte(profileDailyMetrics.businessDate, to));
    return this.db.db.select({ businessDate: profileDailyMetrics.businessDate, source: profileDailyMetrics.source, points: profileDailyMetrics.points, messagesSent: profileDailyMetrics.messagesSent, responses: profileDailyMetrics.responses, responseRate: profileDailyMetrics.responseRate, icebreakersSent: profileDailyMetrics.icebreakersSent, icebreakersReplied: profileDailyMetrics.icebreakersReplied }).from(profileDailyMetrics).where(and(...filters)).orderBy(asc(profileDailyMetrics.businessDate));
  }

  async reconciliation(date?: string) {
    return this.db.db.select({ id: metricReconciliation.id, profileId: metricReconciliation.profileId, businessDate: metricReconciliation.businessDate, extensionPoints: metricReconciliation.extensionPoints, tableauPoints: metricReconciliation.tableauPoints, differencePoints: metricReconciliation.differencePoints, tolerancePoints: metricReconciliation.tolerancePoints, status: metricReconciliation.status, details: metricReconciliation.details, createdAt: metricReconciliation.createdAt }).from(metricReconciliation).where(date ? eq(metricReconciliation.businessDate, date) : undefined).orderBy(asc(metricReconciliation.businessDate));
  }
}
