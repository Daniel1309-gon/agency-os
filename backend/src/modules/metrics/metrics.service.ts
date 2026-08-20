import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { cafeteriaOrders, crewMembers, crews, metricEvents, metricReconciliation, profileDailyMetrics, profileSessions, shifts, ttProfiles } from '../../database/schema/index.js';
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

  async operations(user: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const operatorSessionScope = user.role === 'ADMIN' || user.role === 'DIRECTOR_OPERATIVO'
      ? undefined
      : user.role === 'COORDINADOR'
        ? sql`exists (select 1 from ${crewMembers} member inner join ${crews} crew on crew.id = member.crew_id where member.user_id = ${profileSessions.operatorId} and member.valid_range @> now() and crew.coordinator_id = ${user.sub} and crew.is_active = true)`
        : eq(profileSessions.operatorId, user.sub);
    const shiftScope = user.role === 'ADMIN' || user.role === 'DIRECTOR_OPERATIVO'
      ? undefined
      : user.role === 'COORDINADOR'
        ? sql`exists (select 1 from ${crewMembers} member inner join ${crews} crew on crew.id = member.crew_id where member.user_id = ${shifts.operatorId} and member.valid_range @> now() and crew.coordinator_id = ${user.sub} and crew.is_active = true)`
        : eq(shifts.operatorId, user.sub);
    const orderScope = user.role === 'ADMIN' || user.role === 'DIRECTOR_OPERATIVO'
      ? undefined
      : user.role === 'COORDINADOR'
        ? sql`exists (select 1 from ${crewMembers} member inner join ${crews} crew on crew.id = member.crew_id where member.user_id = ${cafeteriaOrders.operatorId} and member.valid_range @> now() and crew.coordinator_id = ${user.sub} and crew.is_active = true)`
        : eq(cafeteriaOrders.operatorId, user.sub);

    const [[online], [activeSessions], [scheduled], [covered], [pendingOrders]] = await Promise.all([
      this.db.db.select({ value: count(sql`distinct ${profileSessions.operatorId}`) }).from(profileSessions).where(and(operatorSessionScope, inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE']))),
      this.db.db.select({ value: count() }).from(profileSessions).where(and(operatorSessionScope, inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE']))),
      this.db.db.select({ value: count(sql`distinct ${shifts.operatorId}`) }).from(shifts).where(and(shiftScope, sql`${shifts.scheduledRange} @> now()`, inArray(shifts.status, ['SCHEDULED', 'IN_PROGRESS']))),
      this.db.db.select({ value: count(sql`distinct ${shifts.operatorId}`) }).from(shifts).where(and(shiftScope, sql`${shifts.scheduledRange} @> now()`, eq(shifts.status, 'IN_PROGRESS'), sql`exists (select 1 from ${profileSessions} session where session.operator_id = ${shifts.operatorId} and session.status in ('LAUNCHING', 'ACTIVE'))`)),
      this.db.db.select({ value: count() }).from(cafeteriaOrders).where(and(orderScope, inArray(cafeteriaOrders.status, ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']))),
    ]);
    return {
      operatorsOnline: Number(online?.value ?? 0),
      operatorsScheduled: Number(scheduled?.value ?? 0),
      activeSessions: Number(activeSessions?.value ?? 0),
      coveredShifts: Number(covered?.value ?? 0),
      pendingOrders: Number(pendingOrders?.value ?? 0),
      measuredAt: new Date().toISOString(),
    };
  }
}
