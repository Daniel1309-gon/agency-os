import { AUDIT_ACTIONS, isAuditAction } from '@agency-os/shared';

const auditActorLabels: Record<string, string> = {
  USER: 'Usuario',
  DEVICE: 'Dispositivo',
  JOB: 'Proceso',
  SYSTEM: 'Sistema',
  ANONYMOUS: 'Anónimo',
};

const auditResultLabels: Record<string, string> = {
  SUCCESS: 'Exitoso',
  DENIED: 'Denegado',
  FAILURE: 'Fallido',
};

const forbiddenMetadataKeys = new Set(['password', 'contrasena', 'contraseña', 'secret', 'plaintext', 'credential', 'token', 'ciphertext', 'nonce', 'tag', 'aad', 'kek', 'dek', 'authorization', 'passwordhash', 'accesstoken', 'refreshtoken', 'devicetoken']);

export function auditActionLabel(action: string): string {
  return isAuditAction(action) ? AUDIT_ACTIONS[action].label : action;
}

export function auditActorLabel(actorType: string): string {
  return auditActorLabels[actorType] ?? actorType;
}

export function auditResultLabel(result: string): string {
  return auditResultLabels[result] ?? result;
}

function safeMetadataEntries(metadata: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(metadata).filter(([key, value]) => {
    const normalized = key.toLocaleLowerCase().replaceAll('_', '').replaceAll('-', '');
    return !forbiddenMetadataKeys.has(normalized) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
  });
}

export function formatMetadata(metadata: Record<string, unknown>): string {
  const entries = safeMetadataEntries(metadata);
  if (!entries.length) return 'Sin detalles adicionales';
  return entries.map(([key, value]) => `${key}: ${typeof value === 'boolean' ? (value ? 'sí' : 'no') : String(value)}`).join(' · ');
}

export function isDeviceOnline(lastSeenAt: string | null, now = new Date()): boolean {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt);
  return !Number.isNaN(lastSeen.getTime()) && now.getTime() - lastSeen.getTime() <= 15 * 60_000;
}

export function scopeLabel(scope: string): string {
  return { ALL: 'Toda la operación', ROLE: 'Rol específico', USER: 'Usuario específico' }[scope] ?? scope;
}

export function formatSecurityDate(value: string | null): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
