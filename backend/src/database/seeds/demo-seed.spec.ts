import { describe, expect, it } from 'vitest';
import { demoAccounts, demoProfiles, validateDemoSeedConfig } from './demo-seed.js';

describe('demo seed configuration', () => {
  it('defines one account for every non-admin application role', () => {
    expect(demoAccounts.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: 'director@agency.test', role: 'DIRECTOR_OPERATIVO' },
      { email: 'coordinador@agency.test', role: 'COORDINADOR' },
      { email: 'operador@agency.test', role: 'OPERADOR' },
      { email: 'cafeteria@agency.test', role: 'CAFETERIA' },
    ]);
  });

  it('defines the six station E2E profiles with deterministic Chrome directories', () => {
    expect(demoProfiles.map(({ displayName, loginEmail, chromeProfileDir }) => ({ displayName, loginEmail, chromeProfileDir }))).toEqual([
      { displayName: 'Luna Demo', loginEmail: 'luna.demo@talkytimes.test', chromeProfileDir: 'Profile 1' },
      { displayName: 'Mar Demo', loginEmail: 'mar.demo@talkytimes.test', chromeProfileDir: 'Profile 2' },
      { displayName: 'Sol Demo', loginEmail: 'sol.demo@talkytimes.test', chromeProfileDir: 'Profile 3' },
      { displayName: 'Nube Demo', loginEmail: 'nube.demo@talkytimes.test', chromeProfileDir: 'Profile 4' },
      { displayName: 'Alma Demo', loginEmail: 'alma.demo@talkytimes.test', chromeProfileDir: 'Profile 5' },
      { displayName: 'Vera Demo', loginEmail: 'vera.demo@talkytimes.test', chromeProfileDir: 'Profile 6' },
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
