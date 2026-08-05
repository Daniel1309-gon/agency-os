import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from './config.service.js';

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://agency:agency@db:5432/agency_os',
  REDIS_URL: 'redis://cache:6379',
  JWT_SECRET: 'a-production-grade-secret-of-40-characters',
  VAULT_KEK: 'a-production-grade-kek-of-40-characters!!',
  CORS_ORIGINS: 'https://app.agency.example',
};

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = process.env;
  process.env = { ...VALID } as NodeJS.ProcessEnv;
});

afterEach(() => {
  process.env = original;
});

describe('ConfigService', () => {
  it('applies the documented defaults', () => {
    const config = new ConfigService();
    expect(config.get('PORT')).toBe(3000);
    expect(config.get('JWT_ACCESS_TTL_SECONDS')).toBe(900);
    expect(config.get('JWT_REFRESH_TTL_DAYS')).toBe(7);
    expect(config.get('PASSWORD_SCRYPT_LOG2N')).toBe(17);
    expect(config.get('LOG_LEVEL')).toBe('info');
  });

  it('refuses to start when a required secret is missing or too short', () => {
    delete process.env.JWT_SECRET;
    expect(() => new ConfigService()).toThrow(/Invalid environment configuration/);

    process.env.JWT_SECRET = 'too-short';
    expect(() => new ConfigService()).toThrow(/JWT_SECRET/);
  });

  it('refuses placeholder secrets in production', () => {
    process.env.JWT_SECRET = 'change-me-change-me-change-me-change-me';
    expect(() => new ConfigService()).toThrow(/placeholder values/);

    process.env.JWT_SECRET = VALID.JWT_SECRET;
    process.env.VAULT_KEK = 'minimum-kek-value-padded-to-thirty-two';
    expect(() => new ConfigService()).toThrow(/placeholder values/);
  });

  it('refuses a production CORS allowlist that still points at localhost', () => {
    process.env.CORS_ORIGINS = 'https://app.agency.example,http://localhost:5173';
    expect(() => new ConfigService()).toThrow(/CORS_ORIGINS/);
  });

  it('allows those same values outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'change-me-change-me-change-me-change-me';
    process.env.CORS_ORIGINS = 'http://localhost:5173';
    expect(() => new ConfigService()).not.toThrow();
  });

  it('rejects a scrypt cost outside the accepted band', () => {
    process.env.PASSWORD_SCRYPT_LOG2N = '10';
    expect(() => new ConfigService()).toThrow(/PASSWORD_SCRYPT_LOG2N/);

    process.env.PASSWORD_SCRYPT_LOG2N = '21';
    expect(() => new ConfigService()).toThrow(/PASSWORD_SCRYPT_LOG2N/);
  });

  it('rejects a malformed extension id but accepts an empty one', () => {
    process.env.EXTENSION_ID = 'not-a-chrome-extension-id';
    expect(() => new ConfigService()).toThrow(/EXTENSION_ID/);

    process.env.EXTENSION_ID = '';
    expect(() => new ConfigService()).not.toThrow();

    process.env.EXTENSION_ID = 'a'.repeat(32);
    expect(new ConfigService().get('EXTENSION_ID')).toBe('a'.repeat(32));
  });
});
