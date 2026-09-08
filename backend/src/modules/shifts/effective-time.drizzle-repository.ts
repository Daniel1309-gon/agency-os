import { Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNotNull, isNull, lte, sql, sum } from 'drizzle-orm';

import { DatabaseService } from '../../database/database.service.js';
import { breaks, crewMembers, crews, profileSessions, shiftOverrides, shifts } from '../../database/schema/index.js';
import type {
  EffectiveTimeReport,
  EffectiveTimeReportQuery,
  EffectiveTimeReportScope,
  EffectiveTimeRepository,
  Interval,
  ShiftTimeInputs,
} from './effective-time.port.js';
import { EFFECTIVE_TIME_FORMULA_VERSION, effectiveMinutes } from './effective-time.port.js';

function overlaps(interval: Interval, window: Interval): boolean {
  return interval.start.getTime() < window.end.getTime() && interval.end.getTime() > window.start.getTime();
}

@Injectable()
export class DrizzleEffectiveTimeRepository implements EffectiveTimeRepository {
  constructor(private readonly database: DatabaseService) {}

  async loadShiftInputs(shiftIds: string[], closedAt: Date): Promise<ShiftTimeInputs[]> {
    if (!shiftIds.length) return [];
    const scheduled = await this.database.db
      .select({
        shiftId: shifts.id,
        operatorId: shifts.operatorId,
        from: sql<Date | null>`lower(${shifts.scheduledRange})`,
        to: sql<Date | null>`upper(${shifts.scheduledRange})`,
      })
      .from(shifts)
      .where(inArray(shifts.id, shiftIds));
    if (!scheduled.length) return [];

    // Un turno sin rango programado nunca fue aprobado para nada: su ventana es vacia y la
    // formula devuelve 0 sin necesidad de un caso especial mas abajo.
    const windows = new Map<string, Interval>();
    for (const row of scheduled) {
      if (row.from && row.to) windows.set(row.shiftId, { start: new Date(row.from), end: new Date(row.to) });
    }
    const operatorIds = [...new Set(scheduled.map((row) => row.operatorId))];
    const bounds = [...windows.values()];
    const earliest = bounds.length ? new Date(Math.min(...bounds.map((item) => item.start.getTime()))) : closedAt;
    const latest = bounds.length ? new Date(Math.max(...bounds.map((item) => item.end.getTime()), closedAt.getTime())) : closedAt;

    const [overrideRows, sessionRows, breakRows] = await Promise.all([
      this.database.db
        .select({ operatorId: shiftOverrides.operatorId, from: sql<Date>`lower(${shiftOverrides.range})`, to: sql<Date>`upper(${shiftOverrides.range})` })
        .from(shiftOverrides)
        .where(and(
          inArray(shiftOverrides.operatorId, operatorIds),
          isNull(shiftOverrides.revokedAt),
          sql`${shiftOverrides.range} && tstzrange(${earliest.toISOString()}::timestamptz, ${latest.toISOString()}::timestamptz)`,
        )),
      this.database.db
        .select({ operatorId: profileSessions.operatorId, startedAt: profileSessions.startedAt, endedAt: profileSessions.endedAt })
        .from(profileSessions)
        .where(and(
          inArray(profileSessions.operatorId, operatorIds),
          lte(profileSessions.startedAt, latest),
          sql`coalesce(${profileSessions.endedAt}, ${closedAt.toISOString()}::timestamptz) > ${earliest.toISOString()}::timestamptz`,
        )),
      this.database.db
        .select({ shiftId: breaks.shiftId, startedAt: breaks.startedAt, endedAt: breaks.endedAt })
        .from(breaks)
        .where(and(inArray(breaks.shiftId, shiftIds), isNotNull(breaks.startedAt))),
    ]);

    return scheduled.map((row) => {
      const window = windows.get(row.shiftId);
      const approved: Interval[] = window ? [window] : [];
      if (window) {
        for (const item of overrideRows) {
          if (item.operatorId !== row.operatorId) continue;
          const candidate = { start: new Date(item.from), end: new Date(item.to) };
          // Solo los overrides que tocan este turno lo extienden: un permiso de otro dia no
          // debe ampliar la ventana aprobada de hoy.
          if (overlaps(candidate, window)) approved.push(candidate);
        }
      }
      return {
        shiftId: row.shiftId,
        operatorId: row.operatorId,
        approved,
        sessions: sessionRows
          .filter((item) => item.operatorId === row.operatorId)
          .map((item) => ({ start: item.startedAt, end: item.endedAt ?? closedAt })),
        breaks: breakRows
          .filter((item) => item.shiftId === row.shiftId && item.startedAt)
          .map((item) => ({ start: item.startedAt as Date, end: item.endedAt ?? closedAt })),
      };
    });
  }

  async settle(shiftIds: string[], closedAt: Date): Promise<Map<string, number>> {
    const settled = new Map<string, number>();
    for (const input of await this.loadShiftInputs(shiftIds, closedAt)) {
      const minutes = effectiveMinutes(input);
      settled.set(input.shiftId, minutes);
      await this.database.db.update(shifts).set({ effectiveMinutes: minutes }).where(eq(shifts.id, input.shiftId));
    }
    return settled;
  }

  async report(query: EffectiveTimeReportQuery, scope: EffectiveTimeReportScope): Promise<EffectiveTimeReport> {
    const crewScope = (coordinatorId?: string) => sql`exists (
      select 1 from ${crewMembers}
      inner join ${crews} on ${crews.id} = ${crewMembers.crewId}
      where ${crewMembers.userId} = ${shifts.operatorId}
        and ${crewMembers.validRange} @> now()
        and ${crews.isActive} = true
        ${coordinatorId ? sql`and ${crews.coordinatorId} = ${coordinatorId}` : sql``}
        ${query.crewId ? sql`and ${crews.id} = ${query.crewId}` : sql``}
    )`;
    const visible = scope.role === 'ADMIN' || scope.role === 'DIRECTOR_OPERATIVO'
      ? (query.crewId ? crewScope() : undefined)
      : scope.role === 'COORDINADOR'
        ? crewScope(scope.actorId)
        : eq(shifts.operatorId, scope.actorId);
    const filter = and(
      gte(shifts.businessDate, query.from),
      lte(shifts.businessDate, query.to),
      query.operatorId ? eq(shifts.operatorId, query.operatorId) : undefined,
      visible,
    );

    const [items, [totals], byOperator] = await Promise.all([
      this.database.db
        .select({
          id: shifts.id,
          operatorId: shifts.operatorId,
          businessDate: shifts.businessDate,
          status: shifts.status,
          actualStartAt: shifts.actualStartAt,
          actualEndAt: shifts.actualEndAt,
          effectiveMinutes: shifts.effectiveMinutes,
        })
        .from(shifts)
        .where(filter)
        .orderBy(shifts.businessDate, shifts.id)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.database.db.select({ shiftCount: count(), minutes: sum(shifts.effectiveMinutes) }).from(shifts).where(filter),
      this.database.db
        .select({ operatorId: shifts.operatorId, shiftCount: count(), minutes: sum(shifts.effectiveMinutes) })
        .from(shifts)
        .where(filter)
        .groupBy(shifts.operatorId)
        .orderBy(shifts.operatorId),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: totals?.shiftCount ?? 0,
      totalMinutes: Number(totals?.minutes ?? 0),
      byOperator: byOperator.map((row) => ({ operatorId: row.operatorId, shifts: row.shiftCount, minutes: Number(row.minutes ?? 0) })),
      formulaVersion: EFFECTIVE_TIME_FORMULA_VERSION,
    };
  }
}
