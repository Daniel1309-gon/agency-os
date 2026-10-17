/**
 * FR-17. Formula del tiempo efectivo, version 1:
 *
 *   segmentos = (turno aprobado ∩ sesiones validas) − descansos
 *
 * donde `turno aprobado` es el rango programado unido a los overrides vigentes que lo tocan,
 * y las tres familias se unifican antes de operar para que solapamientos no cuenten dos veces.
 *
 * Vive en un `.port.ts` porque el modulo jobs tambien cierra turnos y necesita exactamente la
 * misma cuenta: dos copias de esta formula fue justamente el defecto que OPS-07 corrige.
 */
export const EFFECTIVE_TIME_FORMULA_VERSION = 1;

export interface Interval {
  start: Date;
  end: Date;
}

export interface EffectiveTimeInput {
  approved: Interval[];
  sessions: Interval[];
  breaks: Interval[];
}

export interface ShiftTimeInputs extends EffectiveTimeInput {
  shiftId: string;
  operatorId: string;
}

export const EFFECTIVE_TIME_REPOSITORY = Symbol('EFFECTIVE_TIME_REPOSITORY');

export interface EffectiveTimeReportQuery {
  from: string;
  to: string;
  operatorId?: string;
  crewId?: string;
  page: number;
  pageSize: number;
}

export interface EffectiveTimeReportScope {
  actorId: string;
  role: string;
}

export interface EffectiveTimeReportRow {
  id: string;
  operatorId: string;
  businessDate: string;
  status: string;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  effectiveMinutes: number | null;
}

export interface EffectiveTimeReport {
  items: EffectiveTimeReportRow[];
  page: number;
  pageSize: number;
  total: number;
  totalMinutes: number;
  byOperator: Array<{ operatorId: string; shifts: number; minutes: number }>;
  formulaVersion: number;
}

export interface EffectiveTimeRepository {
  /** Intervalos crudos de cada turno, con los tramos abiertos cerrados en `closedAt`. */
  loadShiftInputs(shiftIds: string[], closedAt: Date): Promise<ShiftTimeInputs[]>;
  /** Calcula y persiste `effective_minutes` de cada turno. Devuelve lo liquidado por turno. */
  settle(shiftIds: string[], closedAt: Date): Promise<Map<string, number>>;
  report(query: EffectiveTimeReportQuery, scope: EffectiveTimeReportScope): Promise<EffectiveTimeReport>;
}

function union(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((item) => item.end.getTime() > item.start.getTime())
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) last.end = current.end;
      continue;
    }
    merged.push({ start: current.start, end: current.end });
  }
  return merged;
}

function intersect(left: Interval[], right: Interval[]): Interval[] {
  const result: Interval[] = [];
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    const start = Math.max(left[a].start.getTime(), right[b].start.getTime());
    const end = Math.min(left[a].end.getTime(), right[b].end.getTime());
    if (start < end) result.push({ start: new Date(start), end: new Date(end) });
    if (left[a].end.getTime() <= right[b].end.getTime()) a += 1;
    else b += 1;
  }
  return result;
}

function subtract(from: Interval[], removed: Interval[]): Interval[] {
  let remaining = from;
  for (const cut of removed) {
    const next: Interval[] = [];
    for (const piece of remaining) {
      if (cut.end.getTime() <= piece.start.getTime() || cut.start.getTime() >= piece.end.getTime()) {
        next.push(piece);
        continue;
      }
      if (cut.start.getTime() > piece.start.getTime()) next.push({ start: piece.start, end: cut.start });
      if (cut.end.getTime() < piece.end.getTime()) next.push({ start: cut.end, end: piece.end });
    }
    remaining = next;
  }
  return remaining;
}

/** Tramos trabajados, disjuntos y ordenados. Su suma es exactamente `effectiveMinutes`. */
export function effectiveTimeSegments(input: EffectiveTimeInput): Interval[] {
  return subtract(intersect(union(input.approved), union(input.sessions)), union(input.breaks));
}

/**
 * Se redondea una sola vez sobre el total. Redondear cada tramo haria que partir una sesion
 * en dos cambiara el resultado, y nomina necesita que la cuenta sea reproducible.
 */
export function effectiveMinutes(input: EffectiveTimeInput): number {
  const milliseconds = effectiveTimeSegments(input).reduce((sum, segment) => sum + (segment.end.getTime() - segment.start.getTime()), 0);
  return Math.round(milliseconds / 60_000);
}
