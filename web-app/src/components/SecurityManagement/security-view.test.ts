import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditActorLabel, auditResultLabel, formatMetadata, isDeviceOnline, scopeLabel } from './security-view';

describe('security view helpers', () => {
  it('translates audit vocabulary without losing unknown actions', () => {
    expect(auditActionLabel('vault.credential.redeemed')).toBe('Credencial entregada');
    expect(auditActionLabel('new.future.action')).toBe('new.future.action');
    expect(auditActorLabel('DEVICE')).toBe('Dispositivo');
    expect(auditActorLabel('JOB')).toBe('Proceso');
    expect(auditResultLabel('DENIED')).toBe('Denegado');
  });

  it('formats only safe, compact metadata for the audit table', () => {
    expect(formatMetadata({ profileId: 'p-1', denyReason: 'NO_MATCH', password: 'never' })).toBe('profileId: p-1 · denyReason: NO_MATCH');
    expect(formatMetadata({ count: 2, reused: false })).toBe('count: 2 · reused: no');
    expect(formatMetadata({})).toBe('Sin detalles adicionales');
  });

  it('identifies recent device heartbeats and allowlist scopes', () => {
    const now = new Date('2026-08-28T15:00:00.000Z');
    expect(isDeviceOnline('2026-08-28T14:52:00.000Z', now)).toBe(true);
    expect(isDeviceOnline('2026-08-28T14:30:00.000Z', now)).toBe(false);
    expect(isDeviceOnline(null, now)).toBe(false);
    expect(scopeLabel('ALL')).toBe('Toda la operación');
    expect(scopeLabel('ROLE')).toBe('Rol específico');
    expect(scopeLabel('USER')).toBe('Usuario específico');
  });
});
