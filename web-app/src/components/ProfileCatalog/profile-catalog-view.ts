import type { ProfileStatus } from '@agency-os/shared';

export function profileStatusCopy(status: ProfileStatus): { label: string; tone: 'active' | 'available' | 'handoff' } {
  if (status === 'ACTIVE') return { label: 'Activo', tone: 'active' };
  if (status === 'INACTIVE') return { label: 'Inactivo', tone: 'available' };
  return { label: status === 'SUSPENDED' ? 'Suspendido' : 'Retirado', tone: 'handoff' };
}

export function formatProfileDate(value: string): string {
  return new Date(value).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}
