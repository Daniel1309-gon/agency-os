import { describe, expect, it } from 'vitest';
import { rolePermissionCodes } from './role-permissions.js';

describe('role permission contract', () => {
  it('lets management roles rotate profile credentials without rotating vault keys', () => {
    const permissions = new Set(rolePermissionCodes.DIRECTOR_OPERATIVO);

    expect(permissions).toEqual(new Set([
      'users.read',
      'crews.read',
      'crews.manage',
      'profiles.read',
      'profiles.create',
      'profiles.update',
      'vault.rotate',
      'vault.read_meta',
      'shifts.read',
      'shifts.manage',
      'shifts.approve_overtime',
      'operators.monitor',
      'metrics.audit',
      'reports.read',
      'icebreaker.review',
      'payroll.read',
      'cafeteria.manage',
      'chat.manage',
      'audit.read',
    ]));

    for (const forbidden of [
      'users.create',
      'users.update',
      'users.disable',
      'vault.credential.issue',
      'vault.keys.rotate',
      'devices.manage',
      'payroll.configure',
      'payroll.adjust',
      'payroll.close',
      'security.manage',
      'settings.manage',
    ]) {
      expect(permissions.has(forbidden)).toBe(false);
    }
  });

  it('keeps cafeteria and operator security boundaries out of other roles', () => {
    expect(rolePermissionCodes.COORDINADOR).not.toContain('cafeteria.manage');
    expect(rolePermissionCodes.COORDINADOR).not.toContain('devices.manage');
    expect(rolePermissionCodes.COORDINADOR).toEqual(expect.arrayContaining(['vault.rotate', 'vault.read_meta']));
    expect(rolePermissionCodes.COORDINADOR).not.toContain('vault.keys.rotate');
    expect(rolePermissionCodes.CAFETERIA).toEqual(['cafeteria.manage', 'chat.manage']);
    expect(rolePermissionCodes.CAFETERIA).not.toContain('profiles.read');
    expect(rolePermissionCodes.CAFETERIA).not.toContain('payroll.read');
    expect(rolePermissionCodes.CAFETERIA).not.toContain('vault.credential.issue');
    expect(rolePermissionCodes.OPERADOR).not.toContain('vault.read_meta');
  });
});
