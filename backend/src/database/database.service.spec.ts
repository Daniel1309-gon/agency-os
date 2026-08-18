import { describe, expect, it } from 'vitest';
import { assertLeastPrivilegedRuntimeRole, type RuntimeRoleSecurity } from './database.service.js';

const safeRole: RuntimeRoleSecurity = {
  currentUser: 'agency_runtime',
  isAgencyAppMember: true,
  isSuperuser: false,
  ownsTables: false,
};

describe('production runtime database role', () => {
  it('accepts only a non-owner, non-superuser member of agency_app', () => {
    expect(() => assertLeastPrivilegedRuntimeRole(safeRole)).not.toThrow();
  });

  it.each([
    { isAgencyAppMember: false },
    { isSuperuser: true },
    { ownsTables: true },
  ])('rejects unsafe role capabilities: %o', (override) => {
    expect(() => assertLeastPrivilegedRuntimeRole({ ...safeRole, ...override })).toThrow(/Unsafe production database role/);
  });
});
