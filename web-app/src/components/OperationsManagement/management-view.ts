import type { UserSummary } from '@agency-os/shared';

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
