import { describe, expect, it } from 'vitest';
import { demoAccounts, validateDemoSeedConfig } from './demo-seed.js';

describe('demo seed configuration', () => {
  it('defines one account for every non-admin application role', () => {
    expect(demoAccounts.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: 'director@agency.test', role: 'DIRECTOR_OPERATIVO' },
      { email: 'coordinador@agency.test', role: 'COORDINADOR' },
      { email: 'operador@agency.test', role: 'OPERADOR' },
      { email: 'cafeteria@agency.test', role: 'CAFETERIA' },
    ]);
  });

  it('refuses to run outside the development environment', () => {
    expect(() => validateDemoSeedConfig('production', 'not-the-local-demo-password')).toThrow(
      'Demo seed is only allowed in development',
    );
    expect(() => validateDemoSeedConfig('test', 'not-the-local-demo-password')).toThrow(
      'Demo seed is only allowed in development',
    );
  });

  it('requires a password accepted by the login boundary', () => {
    expect(() => validateDemoSeedConfig('development', undefined)).toThrow(
      'DEMO_USER_PASSWORD is required',
    );
    expect(() => validateDemoSeedConfig('development', 'too-short')).toThrow(
      'DEMO_USER_PASSWORD must contain between 12 and 72 characters',
    );
    expect(validateDemoSeedConfig('development', 'not-the-local-demo-password')).toBe(
      'not-the-local-demo-password',
    );
  });
});
