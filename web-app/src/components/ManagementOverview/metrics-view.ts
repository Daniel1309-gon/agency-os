import type { RoleCode } from '../../types/roles';

export function defaultMetricsWindow(todayBogota: string, days = 7): { from: string; to: string } {
  const [year, month, day] = todayBogota.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return { from: start.toISOString().slice(0, 10), to: todayBogota };
}

export function buildMetricsRangeQuery(path: string, filters: { from?: string; to?: string; limit?: number }): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function formatResponseRate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return `${(parsed * 100).toFixed(1)}%`;
}

export function canViewGlobalReconciliation(role: RoleCode): boolean {
  return role === 'ADMIN' || role === 'DIRECTOR_OPERATIVO';
}

export function reconciliationStatusLabel(status: string): string {
  if (status === 'OK') return 'En tolerancia';
  if (status === 'DIVERGENT') return 'Divergente';
  return status;
}
