/**
 * Strict parsing of Tableau CSV rows. Anything ambiguous is rejected with a reason
 * instead of guessed: a wrong guess in payroll data is silent, a rejection is visible.
 */

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const table: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell.length > 0)) table.push(row);
      row = [];
    } else value += char;
  }
  if (value.length || row.length) { row.push(value); if (row.some((cell) => cell.length > 0)) table.push(row); }
  const headers = (table.shift() ?? []).map((header) => header.trim());
  return { headers, rows: table.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))) };
}

/** Grand-total rows Tableau adds to a summary ("Todo" is the Spanish "All"). */
export function isTotalLabel(value: string): boolean {
  return /^(todo|all|total|grand total|total general)$/i.test(value.trim());
}

/** Plain decimal only: currency symbols and thousands separators are rejected until the client confirms the format. */
export function parsePoints(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * An hour mark from the worksheet. An ISO value with offset is taken as is; an ISO
 * value without offset is wall time in `timeZone`. Any other shape (dd/mm/yyyy,
 * mm/dd/yyyy, 12-hour clocks) is rejected: dd/mm and mm/dd cannot be told apart.
 */
export function parseSourceHour(value: string, timeZone: string): Date | undefined {
  const trimmed = value.trim();
  if (ISO_WITH_OFFSET.test(trimmed)) {
    const parsed = new Date(trimmed.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const match = ISO_LOCAL.exec(trimmed);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  return zonedWallTimeToUtc({ year, month, day, hour, minute, second }, timeZone);
}

interface WallTime { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** Converts wall time in an IANA zone to UTC. Two passes settle the offset across a DST change. */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date | undefined {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass += 1) guess = asUtc - offsetMs(new Date(guess), timeZone);
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? undefined : result;
}

function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const wallAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function calendarDateIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
