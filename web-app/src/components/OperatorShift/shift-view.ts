import type { BreakStatus, ShiftStatus } from '@agency-os/shared';

export interface ScheduledRange {
  from: Date;
  to: Date;
}

export function parseScheduledRange(value: string | null): ScheduledRange | null {
  if (!value || !/^[[(].+,.+[)\]]$/.test(value)) return null;
  const inner = value.slice(1, -1);
  const separator = inner.indexOf(',');
  if (separator < 1) return null;
  const from = new Date(inner.slice(0, separator).replace(/^"|"$/g, ''));
  const to = new Date(inner.slice(separator + 1).replace(/^"|"$/g, ''));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return null;
  return { from, to };
}

export function shiftStatusCopy(status: ShiftStatus): { label: string; tone: 'active' | 'available' | 'handoff' } {
  if (status === 'IN_PROGRESS') return { label: 'En curso', tone: 'active' };
  if (status === 'SCHEDULED') return { label: 'Programado', tone: 'handoff' };
  return { label: status === 'COMPLETED' ? 'Completado' : 'Cancelado', tone: 'available' };
}

export function breakStatusCopy(status: BreakStatus): { label: string; action: 'Iniciar break' | 'Finalizar break' | null } {
  if (status === 'PENDING') return { label: 'Programado', action: 'Iniciar break' };
  if (status === 'IN_PROGRESS') return { label: 'En curso', action: 'Finalizar break' };
  return { label: status === 'COMPLETED' ? 'Completado' : 'Cancelado', action: null };
}

export function formatLocalTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
