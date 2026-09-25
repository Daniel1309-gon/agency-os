import type { RecurrenceRule } from '@agency-os/shared';

const BOGOTA_TIME_ZONE = 'America/Bogota';
const BOGOTA_UTC_OFFSET_MINUTES = 5 * 60;
const DAY_MS = 86_400_000;

function parseDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid business date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid business date: ${value}`);
  }
  return { year, month, day };
}

function parseClock(value: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`Invalid shift time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Invalid shift time: ${value}`);
  return { hour, minute, second };
}

function clockMinutes(clock: { hour: number; minute: number; second: number }): number {
  return clock.hour * 60 + clock.minute + clock.second / 60;
}

function addDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() };
}

export function shiftBusinessDate(businessDate: string, days: number): string {
  const shifted = addDays(parseDate(businessDate), days);
  return [shifted.year, String(shifted.month).padStart(2, '0'), String(shifted.day).padStart(2, '0')].join('-');
}

function toUtc(date: { year: number; month: number; day: number }, clock: { hour: number; minute: number; second: number }): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, clock.hour, clock.minute, clock.second) + BOGOTA_UTC_OFFSET_MINUTES * 60_000);
}

/**
 * Templates store local wall-clock times for the fixed America/Bogota business
 * calendar. Colombia has no DST, so this conversion remains deterministic and
 * avoids silently using the Windows/runner timezone.
 */
export function buildScheduledRange(businessDate: string, startTime: string, endTime: string, crossesMidnight: boolean): string {
  const date = parseDate(businessDate);
  const start = parseClock(startTime);
  const end = parseClock(endTime);
  const startsAt = clockMinutes(start);
  const endsAt = clockMinutes(end);
  if (crossesMidnight ? endsAt >= startsAt : endsAt <= startsAt) {
    throw new Error(`Invalid shift window: crosses midnight must match the local clock order`);
  }
  const endsOn = crossesMidnight ? addDays(date, 1) : date;
  return `[${toUtc(date, start).toISOString()},${toUtc(endsOn, end).toISOString()})`;
}

export function weekdayForBusinessDate(businessDate: string): number {
  const date = parseDate(businessDate);
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function businessDateInBogota(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function withinUntil(at: Date, rule: RecurrenceRule): boolean {
  return !rule.until || businessDateInBogota(at) <= rule.until;
}

/**
 * Siguiente ocurrencia de una serie, o null cuando termina (`until`, fecha
 * local inclusiva, o regla semanal sin día alcanzable). Bogotá no tiene horario
 * de verano, así que sumar días conserva la hora local de la ocurrencia previa.
 */
export function nextOccurrenceAt(from: Date, rule: RecurrenceRule): Date | null {
  if (rule.frequency === 'DAILY') {
    const next = new Date(from.getTime() + DAY_MS);
    return withinUntil(next, rule) ? next : null;
  }
  const weekdays = rule.weekdays ?? [];
  for (let days = 1; days <= 7; days += 1) {
    const candidate = new Date(from.getTime() + days * DAY_MS);
    if (!weekdays.includes(weekdayForBusinessDate(businessDateInBogota(candidate)))) continue;
    return withinUntil(candidate, rule) ? candidate : null;
  }
  return null;
}

/** Ocurrencias vencidas de una serie, en orden, desde `first` (ya vencida) hasta `now`. */
export function occurrencesUpTo(first: Date, now: Date, rule: RecurrenceRule): Date[] {
  const occurrences: Date[] = [];
  for (let cursor: Date | null = first; cursor && cursor.getTime() <= now.getTime(); cursor = nextOccurrenceAt(cursor, rule)) {
    occurrences.push(cursor);
  }
  return occurrences;
}
