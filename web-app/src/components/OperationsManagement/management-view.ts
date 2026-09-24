import type { AssignmentRecord, UserSummary } from '@agency-os/shared';

/** Bogotá es UTC−5 fijo, sin horario de verano; el backend aplica la misma regla en `jobs/shift-schedule.ts`. */
const BOGOTA_OFFSET = '-05:00';
const BOGOTA_OFFSET_MS = 5 * 3_600_000;

export interface AssignmentScheduleInput {
  fromDate: string;
  toDate: string;
  weekdays: number[];
  dailyFrom: string;
  dailyTo: string;
}

export interface AssignmentWindow {
  validFrom: string;
  validTo: string;
}

function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('La fecha del período no es válida.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('La fecha del período no es válida.');
  return date;
}

function parseClock(value: string): number {
  const minutes = clockMinutes(value, false);
  if (minutes === null) throw new Error('La hora del tramo no es válida.');
  return minutes;
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Minutos desde medianoche, o null si la hora no se puede interpretar. */
export function clockMinutes(value: string, allowSeconds = true): number | null {
  const pattern = allowSeconds ? /^(\d{2}):(\d{2})(?::\d{2})?$/ : /^(\d{2}):(\d{2})$/;
  const match = pattern.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 1439 ? null : minutes;
}

/** Fecha de calendario de Bogotá, como la esperan los inputs `type="date"`. */
export function localDateString(date: Date = new Date()): string {
  return toLocalDateTime(date).slice(0, 10);
}

/** Día de la semana (0 domingo) de una fecha de calendario, sin pasar por la zona del navegador. */
export function calendarWeekday(value: string): number {
  return parseCalendarDate(value).getUTCDay();
}

/** Orden de presentación lunes → domingo. La API usa 0 para domingo. */
export const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
] as const;

/** Expands Bogota wall-clock recurrence into the concrete UTC windows the API stores. */
export function buildAssignmentWindows(input: AssignmentScheduleInput): AssignmentWindow[] {
  const from = parseCalendarDate(input.fromDate);
  const to = parseCalendarDate(input.toDate);
  if (from.getTime() > to.getTime()) throw new Error('El inicio del período debe ser anterior al fin.');
  const weekdays = [...new Set(input.weekdays)];
  if (!weekdays.length) throw new Error('Selecciona al menos un día de la semana.');
  if (weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)) throw new Error('El día de la semana no es válido.');
  const fromMinutes = parseClock(input.dailyFrom);
  const toMinutes = parseClock(input.dailyTo);
  if (fromMinutes === toMinutes) throw new Error('La hora de inicio y fin deben ser distintas.');

  const windows: AssignmentWindow[] = [];
  for (const date = new Date(from); date.getTime() <= to.getTime(); date.setUTCDate(date.getUTCDate() + 1)) {
    if (!weekdays.includes(date.getUTCDay())) continue;
    const startDate = calendarDate(date);
    const endDate = toMinutes < fromMinutes
      ? calendarDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)))
      : startDate;
    windows.push({
      validFrom: new Date(`${startDate}T${input.dailyFrom}:00${BOGOTA_OFFSET}`).toISOString(),
      validTo: new Date(`${endDate}T${input.dailyTo}:00${BOGOTA_OFFSET}`).toISOString(),
    });
  }
  if (!windows.length) throw new Error('No hay fechas que coincidan con los días seleccionados.');
  return windows;
}

export function canManage(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}

/** Hora de pared de Bogotá (`YYYY-MM-DDTHH:mm` de un input `datetime-local`) a instante ISO. */
export function toIsoDateTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('La fecha y hora no son válidas.');
  const parsed = new Date(`${value.length === 16 ? `${value}:00` : value}${BOGOTA_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) throw new Error('La fecha y hora no son válidas.');
  return parsed.toISOString();
}

/** Instante a hora de pared de Bogotá, como la espera un input `datetime-local`. */
export function toLocalDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error('La fecha y hora no son válidas.');
  return new Date(date.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 16);
}

export function parseRange(range: string | null): { from: string; to: string } | null {
  if (!range) return null;
  const normalized = range.replaceAll('"', '');
  const match = /^\[([^,]+),([^\)]+)\)$/.exec(normalized);
  if (!match) return null;
  const parseTimestamp = (value: string) => new Date(value.trim().replace(/([+-]\d{2})$/, '$1:00'));
  const from = parseTimestamp(match[1]);
  const to = parseTimestamp(match[2]);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

export interface AssignmentGroup {
  id: string;
  profileId: string;
  operatorId: string;
  shiftId: string | null;
  status: string;
  endReason: string | null;
  records: AssignmentRecord[];
}

/** Día calendario de Bogotá del instante, en milisegundos UTC de medianoche. */
function localDay(value: string): number {
  return parseCalendarDate(localDateString(new Date(value))).getTime();
}

/** Collapses consecutive concrete windows for the table while keeping each record for actions. */
export function groupAssignmentRecords(records: AssignmentRecord[]): AssignmentGroup[] {
  const buckets = new Map<string, AssignmentRecord[]>();
  for (const record of records) {
    const parsed = parseRange(record.validRange);
    const start = parsed?.from ?? record.id;
    const key = [record.profileId, record.operatorId, record.shiftId ?? '', record.status, record.endReason ?? '', record.createdAt, parsed ? new Date(parsed.from).toISOString().slice(11, 16) : start].join('|');
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  }

  const groups: AssignmentGroup[] = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((left, right) => {
      const leftStart = parseRange(left.validRange)?.from ?? '';
      const rightStart = parseRange(right.validRange)?.from ?? '';
      return leftStart.localeCompare(rightStart);
    });
    let cluster: AssignmentRecord[] = [];
    const pushCluster = () => {
      if (!cluster.length) return;
      const first = cluster[0];
      groups.push({ id: first.id, profileId: first.profileId, operatorId: first.operatorId, shiftId: first.shiftId, status: first.status, endReason: first.endReason, records: cluster });
      cluster = [];
    };
    for (const record of sorted) {
      const previous = cluster.at(-1);
      const previousRange = previous ? parseRange(previous.validRange) : null;
      const currentRange = parseRange(record.validRange);
      if (previous && previousRange && currentRange && (localDay(currentRange.from) - localDay(previousRange.from)) / 86_400_000 > 7) pushCluster();
      cluster.push(record);
    }
    pushCluster();
  }
  return groups.sort((left, right) => (parseRange(right.records[0]?.validRange)?.from ?? '').localeCompare(parseRange(left.records[0]?.validRange)?.from ?? ''));
}

export function formatRange(range: string | null): string {
  const parsed = parseRange(range);
  if (!parsed) return 'Rango no disponible';
  const from = new Date(parsed.from);
  const to = new Date(parsed.to);
  if (from.getUTCFullYear() === 2000 && to.getUTCFullYear() === 2100) return 'Vigencia abierta';
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' };
  return `${from.toLocaleString('es-CO', options)} — ${to.toLocaleString('es-CO', options)}`;
}

export function canManageUser(user: UserSummary, permission: string): boolean {
  return canManage(user.permissions, permission);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface ShiftTemplateFormValues {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  validFrom: string;
  validTo: string;
  weekdays: number[];
  crewId?: string;
}

export interface ShiftTemplatePayload {
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  weekdays: number[];
  breakMinutes: number;
  validFrom: string;
  validTo?: string;
  crewId?: string;
}

/**
 * Arma el cuerpo de `POST /shift-templates`. Valida en el cliente lo que el
 * servidor no valida: la API acepta `validTo` anterior a `validFrom`, horas
 * incoherentes y devuelve 500 en vez de 400 por una hora malformada.
 * `crossesMidnight` se deduce de las horas en vez de preguntarlo.
 */
export function buildShiftTemplatePayload(values: ShiftTemplateFormValues): ShiftTemplatePayload {
  const name = values.name.trim();
  if (!name) throw new Error('El nombre de la plantilla es obligatorio.');
  if (name.length > 160) throw new Error('El nombre no puede superar 160 caracteres.');

  const startMinutes = clockMinutes(values.startTime, false);
  const endMinutes = clockMinutes(values.endTime, false);
  if (startMinutes === null || endMinutes === null) throw new Error('La hora de inicio y fin no son válidas.');
  if (startMinutes === endMinutes) throw new Error('La hora de inicio y fin deben ser distintas.');

  const weekdays = [...new Set(values.weekdays)].sort((left, right) => left - right);
  if (!weekdays.length) throw new Error('Selecciona al menos un día de la semana.');
  if (weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)) throw new Error('El día de la semana no es válido.');

  const breakMinutes = values.breakMinutes.trim() === '' ? 0 : Number(values.breakMinutes);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 480) throw new Error('El descanso debe ser un número entero entre 0 y 480 minutos.');

  const validFrom = parseCalendarDate(values.validFrom);
  if (values.validTo && parseCalendarDate(values.validTo).getTime() < validFrom.getTime()) throw new Error('La vigencia no puede terminar antes de empezar.');

  const payload: ShiftTemplatePayload = {
    name,
    startTime: values.startTime,
    endTime: values.endTime,
    crossesMidnight: endMinutes < startMinutes,
    weekdays,
    breakMinutes,
    validFrom: values.validFrom,
  };
  if (values.validTo) payload.validTo = values.validTo;
  if (values.crewId) payload.crewId = values.crewId;
  return payload;
}

const WEEKDAY_SHORT: Record<number, string> = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };

export function weekdaySummary(weekdays: number[]): string {
  const unique = [...new Set(weekdays)].sort((left, right) => left - right);
  if (!unique.length) return 'Sin días';
  if (unique.length === 7) return 'Todos los días';
  if (unique.length === 5 && unique.every((day) => day >= 1 && day <= 5)) return 'Lunes a viernes';
  if (unique.length === 6 && unique.every((day) => day >= 1 && day <= 6)) return 'Lunes a sábado';
  return WEEKDAYS.filter((day) => unique.includes(day.value)).map((day) => WEEKDAY_SHORT[day.value]).join(' · ');
}

/** "22:05–06:05 (+1 día)" — recorta los segundos que agrega la API. */
export function shiftTimeLabel(startTime: string, endTime: string, crossesMidnight: boolean): string {
  const short = (value: string) => value.slice(0, 5);
  return `${short(startTime)}–${short(endTime)}${crossesMidnight ? ' (+1 día)' : ''}`;
}

/** true cuando la hora final queda antes que la inicial. Tolera valores a medio escribir. */
export function crossesMidnightFrom(startTime: string, endTime: string): boolean {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  return start !== null && end !== null && end < start;
}


export interface CrewFormValues {
  name: string;
  coordinatorId: string;
}

export interface CrewPayload {
  name: string;
  coordinatorId?: string;
}

/**
 * Cuerpo de `POST /crews`. `coordinatorId` se omite cuando el actor es
 * coordinador: el servidor lo asigna solo y rechaza a cualquier otro.
 */
export function buildCrewPayload(values: CrewFormValues): CrewPayload {
  const name = values.name.trim();
  if (!name) throw new Error('El nombre de la cuadrilla es obligatorio.');
  if (name.length > 160) throw new Error('El nombre no puede superar 160 caracteres.');
  const payload: CrewPayload = { name };
  if (values.coordinatorId) payload.coordinatorId = values.coordinatorId;
  return payload;
}

export interface CrewMemberFormValues {
  userId: string;
  validFrom: string;
  validTo: string;
}

export interface CrewMemberPayload {
  userId: string;
  validFrom: string;
  validTo: string;
}

/** Colombia no tiene DST: la fecha se interpreta como medianoche de Bogotá. */
export function bogotaDayStart(date: string): string {
  return new Date(`${calendarDate(parseCalendarDate(date))}T00:00:00${BOGOTA_OFFSET}`).toISOString();
}

/**
 * Cuerpo de `POST /crews/{id}/members`. La API guarda `[from, to)`, así que la
 * fecha "hasta" que elige la persona se manda como el inicio del día siguiente:
 * si no, el último día elegido quedaría fuera de la vigencia.
 */
export function buildCrewMemberPayload(values: CrewMemberFormValues): CrewMemberPayload {
  if (!values.userId) throw new Error('Selecciona un operador.');
  const validFrom = bogotaDayStart(values.validFrom);
  const validTo = bogotaDayStart(calendarDate(new Date(parseCalendarDate(values.validTo).getTime() + 86_400_000)));
  if (new Date(validFrom).getTime() >= new Date(validTo).getTime()) throw new Error('La vigencia debe terminar el mismo día o después de empezar.');
  return { userId: values.userId, validFrom, validTo };
}

/**
 * "16 sept 2026 — 16 dic 2026" para las confirmaciones de la sesión. La API
 * guarda `[from, to)` en UTC, así que se muestra el último día incluido: sin
 * eso, restarle un día al fin exclusivo parecería un error de la aplicación.
 */
export function daySpanLabel(range: string | null): string {
  const parsed = parseRange(range);
  if (!parsed) return 'Vigencia no disponible';
  const bogotaDay = (value: Date) => value.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' });
  const lastIncludedDay = new Date(new Date(parsed.to).getTime() - 60_000);
  return `${bogotaDay(new Date(parsed.from))} — ${bogotaDay(lastIncludedDay)}`;
}
