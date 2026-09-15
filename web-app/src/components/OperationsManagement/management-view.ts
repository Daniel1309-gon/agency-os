import type { UserSummary } from '@agency-os/shared';

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
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
  if (!match || minutes > 1439) throw new Error('La hora del tramo no es válida.');
  return minutes;
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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
      validFrom: new Date(`${startDate}T${input.dailyFrom}:00-05:00`).toISOString(),
      validTo: new Date(`${endDate}T${input.dailyTo}:00-05:00`).toISOString(),
    });
  }
  if (!windows.length) throw new Error('No hay fechas que coincidan con los días seleccionados.');
  return windows;
}

export function canManage(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}

export function toIsoDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('La fecha y hora no son válidas.');
  return parsed.toISOString();
}

export function toLocalDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error('La fecha y hora no son válidas.');
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

export function formatRange(range: string | null): string {
  const parsed = parseRange(range);
  if (!parsed) return 'Rango no disponible';
  const from = new Date(parsed.from);
  const to = new Date(parsed.to);
  if (from.getUTCFullYear() === 2000 && to.getUTCFullYear() === 2100) return 'Vigencia abierta';
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  return `${from.toLocaleString('es-CO', options)} — ${to.toLocaleString('es-CO', options)}`;
}

export function canManageUser(user: UserSummary, permission: string): boolean {
  return canManage(user.permissions, permission);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
