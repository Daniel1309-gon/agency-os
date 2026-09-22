import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ClientCertGuard, certificateFingerprint, parseClientCertHeader } from './client-cert.js';
import { ALLOW_UNREGISTERED_CLIENT_CERT_KEY, SKIP_CLIENT_CERT_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ConfigService } from '../../config/config.service.js';
import type { DatabaseService } from '../../database/database.service.js';

const audit = { record: async () => undefined } as unknown as AuditService;

function cert(seed: string): { der: Buffer; header: string; fingerprint: string } {
  const der = createHash('sha256').update(seed).digest();
  return { der, header: `:${der.toString('base64')}:`, fingerprint: certificateFingerprint(der) };
}

function configFor(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    NODE_ENV: 'production',
    TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    DEV_CLIENT_CERT_FINGERPRINT: '',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function dbFor(rows: unknown[]): DatabaseService {
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    },
  } as unknown as DatabaseService;
}

function reflectorFor(skip = false, allowUnregistered = false): Reflector {
  return {
    getAllAndOverride: (key: string) => {
      if (key === SKIP_CLIENT_CERT_KEY) return skip;
      if (key === ALLOW_UNREGISTERED_CLIENT_CERT_KEY) return allowUnregistered;
      return undefined;
    },
  } as unknown as Reflector;
}

function contextFor(request: Partial<AuthenticatedRequest>): { context: ExecutionContext; request: AuthenticatedRequest } {
  const target = { headers: {}, ...request } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => target }),
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
  return { context, request: target };
}

const approved = { id: 'device-1', label: 'Office PC', deviceKind: 'STATION', certExpiresAt: new Date(Date.now() + 86_400_000) };

describe('parseClientCertHeader', () => {
  it('decodes the RFC 9440 encoding and rejects anything malformed', () => {
    const { der, header } = cert('one');
    expect(parseClientCertHeader(header)).toEqual(der);
    for (const value of [undefined, '', 'abc', 'plain-base64', `:${'!'.repeat(4)}:`, `:${Buffer.alloc(20_000).toString('base64')}:`]) {
      expect(parseClientCertHeader(value)).toBeNull();
    }
  });
});

describe('ClientCertGuard', () => {
  it('rejects every request without a certificate identity in production', async () => {
    const guard = new ClientCertGuard(configFor(), dbFor([]), audit, reflectorFor());
    await expect(guard.canActivate(contextFor({}).context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a client-supplied header that does not come from the trusted proxy', async () => {
    const { header } = cert('two');
    const guard = new ClientCertGuard(configFor(), dbFor([approved]), audit, reflectorFor());
    const { context } = contextFor({ headers: { 'client-cert': header }, raw: { socket: { remoteAddress: '203.0.113.9' } } });
    await expect(guard.canActivate(context)).rejects.toThrow('cannot be trusted');
  });

  it('rejects a header from the proxy when the certificate is malformed or unknown', async () => {
    const guard = new ClientCertGuard(configFor(), dbFor([]), audit, reflectorFor());
    const trusted = { socket: { remoteAddress: '10.1.2.3' } };
    await expect(guard.canActivate(contextFor({ headers: { 'client-cert': 'not-rfc9440' }, raw: trusted }).context)).rejects.toThrow('malformed');
    await expect(guard.canActivate(contextFor({ headers: { 'client-cert': cert('three').header }, raw: trusted }).context)).rejects.toThrow('not authorized');
  });

  it('attaches the device principal for a verified certificate', async () => {
    const { header, fingerprint } = cert('four');
    const guard = new ClientCertGuard(configFor(), dbFor([approved]), audit, reflectorFor());
    const { context, request } = contextFor({ headers: { 'client-cert': header }, raw: { socket: { remoteAddress: '10.1.2.3' } } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.device).toEqual({ id: 'device-1', label: 'Office PC', kind: 'STATION', fingerprint, certNotAfter: approved.certExpiresAt });
  });

  it('uses the explicit development fingerprint only outside production', async () => {
    const fingerprint = 'c'.repeat(64);
    const dev = new ClientCertGuard(configFor({ NODE_ENV: 'development', DEV_CLIENT_CERT_FINGERPRINT: fingerprint }), dbFor([approved]), audit, reflectorFor());
    await expect(dev.canActivate(contextFor({}).context)).resolves.toBe(true);
    const production = new ClientCertGuard(configFor({ DEV_CLIENT_CERT_FINGERPRINT: fingerprint }), dbFor([approved]), audit, reflectorFor());
    await expect(production.canActivate(contextFor({}).context)).rejects.toThrow('DEV_CLIENT_CERT_FINGERPRINT is not allowed in production');
  });

  it('accepts an unregistered certificate only on enrollment routes, keeping the verified fingerprint', async () => {
    const { header, fingerprint } = cert('five');
    const guard = new ClientCertGuard(configFor(), dbFor([]), audit, reflectorFor(false, true));
    const { context, request } = contextFor({ headers: { 'client-cert': header }, raw: { socket: { remoteAddress: '10.1.2.3' } } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.clientCertFingerprint).toBe(fingerprint);
    expect(request.device).toBeUndefined();

    const strict = new ClientCertGuard(configFor(), dbFor([]), audit, reflectorFor());
    await expect(strict.canActivate(contextFor({ headers: { 'client-cert': header }, raw: { socket: { remoteAddress: '10.1.2.3' } } }).context))
      .rejects.toThrow('not authorized');
  });

  it('skips only the routes explicitly marked and audits every denial', async () => {
    const record = vi.fn(async () => undefined);
    const guard = new ClientCertGuard(configFor(), dbFor([]), { record } as unknown as AuditService, reflectorFor(true));
    await expect(guard.canActivate(contextFor({}).context)).resolves.toBe(true);

    const denying = new ClientCertGuard(configFor(), dbFor([]), { record } as unknown as AuditService, reflectorFor());
    await expect(denying.canActivate(contextFor({ ip: '10.0.0.1' }).context)).rejects.toThrow(ForbiddenException);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
