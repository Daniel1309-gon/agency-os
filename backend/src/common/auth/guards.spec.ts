import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IpAllowlistGuard, JwtAuthGuard, PermissionsGuard, RolesGuard, StationDeviceGuard } from './guards.js';
import { signAccessToken } from './crypto.js';
import type { ConfigService } from '../../config/config.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { DatabaseService } from '../../database/database.service.js';
import { STATION_AUTH_KEY } from './decorators.js';

const SECRET = 'a'.repeat(32);
const config = { get: () => SECRET } as unknown as ConfigService;
const audit = { record: async () => undefined } as unknown as AuditService;

function jwtDatabase(active = true): DatabaseService {
  return {
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => active ? [{ id: 'user-1', authVersion: 1 }] : [] }),
          }),
        }),
      }),
    },
  } as unknown as DatabaseService;
}

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
}

function reflectorByKey(values: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => values[key] } as unknown as Reflector;
}

/** El contexto devuelve siempre el mismo objeto request, para poder observar lo que el guard le escribe. */
function requestContext(request: Partial<AuthenticatedRequest>): { context: ExecutionContext; request: AuthenticatedRequest } {
  const target = { headers: {}, ...request } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => target }),
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
  return { context, request: target };
}

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return requestContext(request).context;
}

describe('JwtAuthGuard', () => {
  it('lets a valid bearer token through and attaches the claims', async () => {
    const token = signAccessToken({ sub: 'user-1', role: 'OPERADOR', permissions: ['payroll.read'], av: 1 }, SECRET, 60);
    const { context, request } = requestContext({ headers: { authorization: `Bearer ${token}` } });
    const guard = new JwtAuthGuard(config, reflectorReturning(false), audit, jwtDatabase());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user?.sub).toBe('user-1');
    expect(request.user?.permissions).toEqual(['payroll.read']);
  });

  it('rejects a missing, malformed or non-bearer authorization header', async () => {
    const guard = new JwtAuthGuard(config, reflectorReturning(false), audit, jwtDatabase());
    for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer' }]) {
      await expect(guard.canActivate(contextFor({ headers }))).rejects.toThrow(UnauthorizedException);
    }
  });

  it('rejects a token signed with another secret', async () => {
    const forged = signAccessToken({ sub: 'user-1', role: 'ADMIN', permissions: [], av: 1 }, 'b'.repeat(32), 60);
    const guard = new JwtAuthGuard(config, reflectorReturning(false), audit, jwtDatabase());
    await expect(guard.canActivate(contextFor({ headers: { authorization: `Bearer ${forged}` } }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const expired = signAccessToken({ sub: 'user-1', role: 'ADMIN', permissions: [], av: 1 }, SECRET, -1);
    const guard = new JwtAuthGuard(config, reflectorReturning(false), audit, jwtDatabase());
    await expect(guard.canActivate(contextFor({ headers: { authorization: `Bearer ${expired}` } }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('skips authentication only where @Public is declared', async () => {
    const guard = new JwtAuthGuard(config, reflectorReturning(true), audit, jwtDatabase());
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('delegates authentication to the certificate identity on station routes', async () => {
    const guard = new JwtAuthGuard(
      config,
      reflectorByKey({ [STATION_AUTH_KEY]: true }),
      audit,
      jwtDatabase(),
    );

    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects a valid token after the user is disabled or its role changes', async () => {
    const token = signAccessToken({ sub: 'user-1', role: 'OPERADOR', permissions: [], av: 1 }, SECRET, 60);
    const guard = new JwtAuthGuard(config, reflectorReturning(false), audit, jwtDatabase(false));
    await expect(guard.canActivate(contextFor({ headers: { authorization: `Bearer ${token}` } }))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid token whose authorization version is stale', async () => {
    const stale = signAccessToken({ sub: 'user-1', role: 'OPERADOR', permissions: [], av: 0 }, SECRET, 60);
    const guard = new JwtAuthGuard(config, reflectorReturning(false), audit, jwtDatabase());
    await expect(guard.canActivate(contextFor({ headers: { authorization: `Bearer ${stale}` } }))).rejects.toThrow(UnauthorizedException);
  });

  it('lets database failures propagate instead of misclassifying them as invalid tokens', async () => {
    const token = signAccessToken({ sub: 'user-1', role: 'OPERADOR', permissions: [], av: 1 }, SECRET, 60);
    const database = {
      db: {
        select: () => {
          throw new Error('postgres unavailable');
        },
      },
    } as unknown as DatabaseService;
    const record = vi.fn(async () => undefined);
    const guard = new JwtAuthGuard(config, reflectorReturning(false), { record } as unknown as AuditService, database);

    await expect(guard.canActivate(contextFor({ headers: { authorization: `Bearer ${token}` } }))).rejects.toThrow('postgres unavailable');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('PermissionsGuard', () => {
  const guard = (required: string[] | undefined) => new PermissionsGuard(reflectorReturning(required), audit);

  it('allows a handler that declares no permission', async () => {
    await expect(guard(undefined).canActivate(contextFor({}))).resolves.toBe(true);
    await expect(guard([]).canActivate(contextFor({}))).resolves.toBe(true);
  });

  it('requires every declared permission, not just one of them', async () => {
    const request = { user: { sub: 'u', role: 'COORDINADOR', permissions: ['payroll.read'], av: 1, iat: 0, exp: 0, jti: '' } };
    await expect(guard(['payroll.read']).canActivate(contextFor(request))).resolves.toBe(true);
    await expect(guard(['payroll.read', 'payroll.close']).canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
  });

  it('denies a request that carries no claims at all', async () => {
    await expect(guard(['payroll.read']).canActivate(contextFor({}))).rejects.toThrow(ForbiddenException);
  });

  it('does not accept a permission prefix as the permission', async () => {
    const request = { user: { sub: 'u', role: 'OPERADOR', permissions: ['vault.read_meta'], av: 1, iat: 0, exp: 0, jti: '' } };
    await expect(guard(['vault.credential.issue']).canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
  });
});

describe('RolesGuard', () => {
  const guard = (required: string[] | undefined) => new RolesGuard(reflectorReturning(required), audit);

  it('allows only an explicitly declared role', async () => {
    const operator = { user: { sub: 'u', role: 'OPERADOR', permissions: [], av: 1, iat: 0, exp: 1, jti: '' } };
    const cafeteria = { user: { ...operator.user, role: 'CAFETERIA' } };
    await expect(guard(['OPERADOR']).canActivate(contextFor(operator))).resolves.toBe(true);
    await expect(guard(['OPERADOR']).canActivate(contextFor(cafeteria))).rejects.toThrow('Role is not allowed');
  });

  it('does not restrict handlers without role metadata', async () => {
    await expect(guard(undefined).canActivate(contextFor({}))).resolves.toBe(true);
  });
});

describe('StationDeviceGuard', () => {
  const guard = () => new StationDeviceGuard(audit);

  it('accepts an approved station identity resolved from the certificate', async () => {
    const { context, request } = requestContext({
      device: { id: 'device-1', label: 'Office PC', kind: 'STATION', fingerprint: 'a'.repeat(64), certNotAfter: null },
    });
    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.device?.id).toBe('device-1');
  });

  it('rejects a missing identity and an administrative device', async () => {
    await expect(guard().canActivate(contextFor({}))).rejects.toThrow(ForbiddenException);
    await expect(guard().canActivate(contextFor({
      device: { id: 'device-2', label: 'Owner laptop', kind: 'ADMIN', fingerprint: 'b'.repeat(64), certNotAfter: null },
    }))).rejects.toThrow(ForbiddenException);
  });
});

describe('IpAllowlistGuard', () => {
  const emptyDb = {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
      query: { roles: { findFirst: async () => undefined } },
    },
  };

  it('fails closed when no active allowlist exists', async () => {
    const guard = new IpAllowlistGuard(emptyDb as never, config, reflectorReturning(false), audit);
    await expect(guard.canActivate(contextFor({ headers: {}, ip: '203.0.113.10' }))).rejects.toThrow(
      'IP allowlist is not configured',
    );
  });

  it('bypasses only handlers explicitly marked for health checks', async () => {
    const guard = new IpAllowlistGuard(emptyDb as never, config, reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects an invalid request IP even when a forwarded header looks valid', async () => {
    const activeDb = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({ limit: async () => [{ id: 'active-entry' }] }),
          }),
        }),
        query: { roles: { findFirst: async () => undefined } },
      },
    };
    const guard = new IpAllowlistGuard(activeDb as never, config, reflectorReturning(false), audit);
    await expect(guard.canActivate(contextFor({
      ip: 'not-an-ip',
      headers: { 'x-forwarded-for': '10.0.0.10' },
    }))).rejects.toThrow('Client IP unavailable');
  });

  it('rate limits repeated denial audits for the same route and IP', async () => {
    const record = vi.fn(async (_input: unknown) => undefined);
    const guard = new IpAllowlistGuard(emptyDb as never, config, reflectorReturning(false), { record } as never);
    const request = contextFor({ ip: '198.51.100.254', raw: { url: '/api/v1/auth/login?password=must-not-be-audit-key' } });

    await expect(guard.canActivate(request)).rejects.toThrow('IP allowlist is not configured');
    await expect(guard.canActivate(request)).rejects.toThrow('IP allowlist is not configured');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({ metadata: { route: '/api/v1/auth/login' } });
  });
});
