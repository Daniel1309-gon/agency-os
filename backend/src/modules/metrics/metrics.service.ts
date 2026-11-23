import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { cafeteriaOrders, crewMembers, crews, metricEvents, metricReconciliation, profileAssignments, profileDailyMetrics, profileSessions, shifts, ttProfiles } from '../../database/schema/index.js';
import type { MetricBatchInput, MetricQueryInput, RankingQueryInput, ReconciliationQueryInput } from './metrics.schemas.js';

type MetricsActor = Pick<AccessTokenClaims, 'sub' | 'role'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGlobalAudience = (user?: MetricsActor): boolean => !user || user.role === 'ADMIN' || user.role === 'DIRECTOR_OPERATIVO';

@Injectable()
export class MetricsService {
  constructor(private readonly db: DatabaseService) {}

  async ingest(input: MetricBatchInput, operatorId: string, sessionId?: string) {
    if (sessionId !== undefined) {
      if (!UUID_PATTERN.test(sessionId)) throw new BadRequestException('Invalid x-session-id header');
      const [session] = await this.db.db
        .select({ id: profileSessions.id, profileId: profileSessions.profileId })
        .from(profileSessions)
        .where(and(eq(profileSessions.id, sessionId), eq(profileSessions.operatorId, operatorId)))
        .limit(1);
      if (!session) throw new ForbiddenException('Session does not belong to this operator');
      if (input.events.some((event) => event.profileId !== session.profileId)) {
        throw new ForbiddenException('Metric event profile does not match session profile');
      }
    }

    const distinctPairs = new Map<string, { profileId: string; occurredAt: string }>();
    for (const event of input.events) {
      distinctPairs.set(`${event.profileId}|${event.occurredAt}`, { profileId: event.profileId, occurredAt: event.occurredAt });
    }
    const pairs = [...distinctPairs.values()];
    if (pairs.length) {
      const valueTuples = sql.join(
        pairs.map((pair) => sql`(${pair.profileId}::uuid, ${pair.occurredAt}::timestamptz)`),
        sql`, `,
      );
      const ownership = await this.db.db.execute(sql`
        SELECT count(*)::int AS matched
        FROM (VALUES ${valueTuples}) AS p(profile_id, occurred_at)
        WHERE EXISTS (
          SELECT 1
          FROM ${profileAssignments} a
          WHERE a.operator_id = ${operatorId}::uuid
            AND a.profile_id = p.profile_id
            AND a.status IN ('ACTIVE', 'ENDED')
            AND a.valid_range @> p.occurred_at
        )
      `);
      const matched = Number((ownership.rows[0] as { matched?: number } | undefined)?.matched ?? 0);
      if (matched !== pairs.length) {
        throw new ForbiddenException('Operator does not hold an assignment for this profile at event time');
      }
    }

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

  private bogotaDayRange(businessDateColumn: AnyPgColumn): SQL {
    return sql`tstzrange((${businessDateColumn}::text || ' 00:00:00-05')::timestamptz, ((${businessDateColumn} + 1)::text || ' 00:00:00-05')::timestamptz, '[)')`;
  }

  private bogotaWindowRange(from?: string, to?: string): SQL {
    const lower = from ? sql`${`${from}T00:00:00-05:00`}::timestamptz` : sql`NULL::timestamptz`;
    const upper = to
      ? (() => {
          const [year, month, day] = to.split('-').map(Number);
          const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
          return sql`${`${next}T00:00:00-05:00`}::timestamptz`;
        })()
      : sql`NULL::timestamptz`;
    return sql`(tstzrange(${lower}, ${upper}, '[)') * tstzrange(NULL, now(), '(]'))`;
  }

  private profileScope(user: MetricsActor | undefined, profileIdColumn: AnyPgColumn, businessDateColumn: AnyPgColumn): SQL | undefined {
    if (isGlobalAudience(user)) return undefined;
    const dayRange = this.bogotaDayRange(businessDateColumn);
    if (user!.role === 'COORDINADOR') {
      return sql`exists (
        select 1 from ${profileAssignments} assignment
        inner join ${crewMembers} member on member.user_id = assignment.operator_id
        inner join ${crews} crew on crew.id = member.crew_id
        where assignment.profile_id = ${profileIdColumn}
          and assignment.status in ('ACTIVE', 'ENDED')
          and lower(assignment.valid_range) <= now()
          and assignment.valid_range && ${dayRange}
          and member.valid_range && (assignment.valid_range * ${dayRange})
          and crew.coordinator_id = ${user!.sub}
          and crew.is_active = true
      )`;
    }
    return sql`(
      exists (
        select 1 from ${profileAssignments} current_assignment
        where current_assignment.profile_id = ${profileIdColumn}
          and current_assignment.operator_id = ${user!.sub}
          and current_assignment.status = 'ACTIVE'
          and current_assignment.valid_range @> now()
      )
      and exists (
        select 1 from ${profileAssignments} day_assignment
        where day_assignment.profile_id = ${profileIdColumn}
          and day_assignment.operator_id = ${user!.sub}
          and day_assignment.status in ('ACTIVE', 'ENDED')
          and lower(day_assignment.valid_range) <= now()
          and day_assignment.valid_range && ${dayRange}
      )
    )`;
  }

  private async assertProfileInAudience(profileId: string, user: MetricsActor, from?: string, to?: string): Promise<void> {
    if (isGlobalAudience(user)) return;
    const windowRange = this.bogotaWindowRange(from, to);
    const scope = user.role === 'COORDINADOR'
      ? sql`exists (
          select 1 from ${profileAssignments} assignment
          inner join ${crewMembers} member on member.user_id = assignment.operator_id
          inner join ${crews} crew on crew.id = member.crew_id
          where assignment.profile_id = ${ttProfiles.id}
            and assignment.status in ('ACTIVE', 'ENDED')
            and lower(assignment.valid_range) <= now()
            and assignment.valid_range && ${windowRange}
            and member.valid_range && (assignment.valid_range * ${windowRange})
            and crew.coordinator_id = ${user.sub}
            and crew.is_active = true
        )`
      : sql`exists (
          select 1 from ${profileAssignments} assignment
          where assignment.profile_id = ${ttProfiles.id}
            and assignment.operator_id = ${user.sub}
            and assignment.status = 'ACTIVE'
            and assignment.valid_range @> now()
        )`;
    const [allowed] = await this.db.db.select({ id: ttProfiles.id }).from(ttProfiles).where(and(eq(ttProfiles.id, profileId), scope)).limit(1);
    if (!allowed) throw new ForbiddenException('Profile is outside your audience scope');
  }

  async profiles(from?: string, to?: string, profileId?: string, user?: MetricsActor, limit = 200) {
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const scope = this.profileScope(user, profileDailyMetrics.profileId, profileDailyMetrics.businessDate);
    const filters = [eq(profileDailyMetrics.source, 'EXTENSION')];
    if (from) filters.push(gte(profileDailyMetrics.businessDate, from));
    if (to) filters.push(lte(profileDailyMetrics.businessDate, to));
    if (profileId) filters.push(eq(profileDailyMetrics.profileId, profileId));
    if (scope) filters.push(scope);
    return this.db.db
      .select({ profileId: profileDailyMetrics.profileId, displayName: ttProfiles.displayName, businessDate: profileDailyMetrics.businessDate, points: profileDailyMetrics.points, messagesSent: profileDailyMetrics.messagesSent, responses: profileDailyMetrics.responses, responseRate: profileDailyMetrics.responseRate, source: profileDailyMetrics.source })
      .from(profileDailyMetrics)
      .innerJoin(ttProfiles, eq(ttProfiles.id, profileDailyMetrics.profileId))
      .where(and(...filters))
      .orderBy(asc(profileDailyMetrics.businessDate), asc(ttProfiles.displayName))
      .limit(boundedLimit);
  }

  /** FR-28 / A7: operator-safe activity view over currently assigned profiles without raw points or commission leakage. */
  async operatorProfiles(user: MetricsActor, query: Partial<MetricQueryInput> = {}) {
    const boundedLimit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    const scope = this.profileScope({ sub: user.sub, role: 'OPERADOR' }, profileDailyMetrics.profileId, profileDailyMetrics.businessDate)!;
    const filters = [eq(profileDailyMetrics.source, 'EXTENSION'), scope];
    if (query.from) filters.push(gte(profileDailyMetrics.businessDate, query.from));
    if (query.to) filters.push(lte(profileDailyMetrics.businessDate, query.to));
    if (query.profileId) filters.push(eq(profileDailyMetrics.profileId, query.profileId));
    return this.db.db
      .select({
        profileId: profileDailyMetrics.profileId,
        displayName: ttProfiles.displayName,
        businessDate: profileDailyMetrics.businessDate,
        messagesSent: profileDailyMetrics.messagesSent,
        responses: profileDailyMetrics.responses,
        responseRate: profileDailyMetrics.responseRate,
        icebreakersSent: profileDailyMetrics.icebreakersSent,
        icebreakersReplied: profileDailyMetrics.icebreakersReplied,
      })
      .from(profileDailyMetrics)
      .innerJoin(ttProfiles, eq(ttProfiles.id, profileDailyMetrics.profileId))
      .where(and(...filters))
      .orderBy(desc(profileDailyMetrics.businessDate), asc(ttProfiles.displayName))
      .limit(boundedLimit);
  }

  async ranking(query: Partial<RankingQueryInput> = {}, user?: MetricsActor) {
    const boundedLimit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const scope = this.profileScope(user, profileDailyMetrics.profileId, profileDailyMetrics.businessDate);
    const filters = [eq(profileDailyMetrics.source, 'EXTENSION')];
    if (query.from) filters.push(gte(profileDailyMetrics.businessDate, query.from));
    if (query.to) filters.push(lte(profileDailyMetrics.businessDate, query.to));
    if (scope) filters.push(scope);
    // La expresion se repite en el ORDER BY en vez de ordenar por `response_rate`:
    // Drizzle no emite alias para las columnas seleccionadas (mapea por posicion),
    // asi que ese nombre lo resolvia Postgres contra la columna homonima de
    // profile_daily_metrics — sin agrupar — y la consulta moria con un 42803.
    const responseRate = sql<number>`coalesce(sum(${profileDailyMetrics.responses})::numeric / nullif(sum(${profileDailyMetrics.messagesSent}), 0), 0)`;
    return this.db.db
      .select({
        profileId: profileDailyMetrics.profileId,
        displayName: ttProfiles.displayName,
        points: sql<string>`coalesce(sum(${profileDailyMetrics.points}), 0)::text`,
        messagesSent: sql<number>`coalesce(sum(${profileDailyMetrics.messagesSent}), 0)::int`,
        responses: sql<number>`coalesce(sum(${profileDailyMetrics.responses}), 0)::int`,
        responseRate,
      })
      .from(profileDailyMetrics)
      .innerJoin(ttProfiles, eq(ttProfiles.id, profileDailyMetrics.profileId))
      .where(and(...filters))
      .groupBy(profileDailyMetrics.profileId, ttProfiles.displayName)
      .orderBy(sql`${responseRate} DESC`, asc(ttProfiles.displayName))
      .limit(boundedLimit);
  }

  async timeseries(profileId: string, from?: string, to?: string, user?: MetricsActor, limit = 180) {
    if (!UUID_PATTERN.test(profileId)) throw new BadRequestException('Invalid profileId');
    if (user) await this.assertProfileInAudience(profileId, user, from, to);
    const boundedLimit = Math.min(Math.max(limit, 1), 732);
    const scope = this.profileScope(user, profileDailyMetrics.profileId, profileDailyMetrics.businessDate);
    const filters = [eq(profileDailyMetrics.profileId, profileId)];
    if (from) filters.push(gte(profileDailyMetrics.businessDate, from));
    if (to) filters.push(lte(profileDailyMetrics.businessDate, to));
    if (scope) filters.push(scope);
    return this.db.db
      .select({ businessDate: profileDailyMetrics.businessDate, source: profileDailyMetrics.source, points: profileDailyMetrics.points, messagesSent: profileDailyMetrics.messagesSent, responses: profileDailyMetrics.responses, responseRate: profileDailyMetrics.responseRate, icebreakersSent: profileDailyMetrics.icebreakersSent, icebreakersReplied: profileDailyMetrics.icebreakersReplied })
      .from(profileDailyMetrics)
      .where(and(...filters))
      .orderBy(asc(profileDailyMetrics.businessDate), asc(profileDailyMetrics.source))
      .limit(boundedLimit);
  }

  async reconciliation(query?: string | Partial<ReconciliationQueryInput>, user?: MetricsActor) {
    const filtersObj: Partial<ReconciliationQueryInput> = typeof query === 'string' ? { date: query } : (query ?? {});
    const boundedLimit = Math.min(Math.max(filtersObj.limit ?? 100, 1), 200);
    const scope = this.profileScope(user, metricReconciliation.profileId, metricReconciliation.businessDate);
    const filters: SQL[] = [];
    if (filtersObj.date) filters.push(eq(metricReconciliation.businessDate, filtersObj.date));
    if (filtersObj.from) filters.push(gte(metricReconciliation.businessDate, filtersObj.from));
    if (filtersObj.to) filters.push(lte(metricReconciliation.businessDate, filtersObj.to));
    if (scope) filters.push(scope);
    return this.db.db
      .select({
        id: metricReconciliation.id,
        profileId: metricReconciliation.profileId,
        displayName: ttProfiles.displayName,
        businessDate: metricReconciliation.businessDate,
        extensionPoints: metricReconciliation.extensionPoints,
        tableauPoints: metricReconciliation.tableauPoints,
        differencePoints: metricReconciliation.differencePoints,
        tolerancePoints: metricReconciliation.tolerancePoints,
        status: metricReconciliation.status,
        details: metricReconciliation.details,
        createdAt: metricReconciliation.createdAt,
      })
      .from(metricReconciliation)
      .innerJoin(ttProfiles, eq(ttProfiles.id, metricReconciliation.profileId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(metricReconciliation.businessDate), asc(ttProfiles.displayName))
      .limit(boundedLimit);
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

    const [online] = await this.db.db.select({ value: count(sql`distinct ${profileSessions.operatorId}`) }).from(profileSessions).where(and(operatorSessionScope, inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE'])));
    const [activeSessions] = await this.db.db.select({ value: count() }).from(profileSessions).where(and(operatorSessionScope, inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE'])));
    const [scheduled] = await this.db.db.select({ value: count(sql`distinct ${shifts.operatorId}`) }).from(shifts).where(and(shiftScope, sql`${shifts.scheduledRange} @> now()`, inArray(shifts.status, ['SCHEDULED', 'IN_PROGRESS'])));
    const [covered] = await this.db.db.select({ value: count(sql`distinct ${shifts.operatorId}`) }).from(shifts).where(and(shiftScope, sql`${shifts.scheduledRange} @> now()`, eq(shifts.status, 'IN_PROGRESS'), sql`exists (select 1 from ${profileSessions} session where session.operator_id = ${shifts.operatorId} and session.status in ('LAUNCHING', 'ACTIVE'))`));
    const [pendingOrders] = await this.db.db.select({ value: count() }).from(cafeteriaOrders).where(and(orderScope, inArray(cafeteriaOrders.status, ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'])));
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
