import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { DeviceTokenGuard, JwtAuthGuard, PermissionsGuard } from './guards.js';
import { signAccessToken } from './crypto.js';
import type { ConfigService } from '../../config/config.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

const SECRET = 'a'.repeat(32);
const config = { get: () => SECRET } as unknown as ConfigService;

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
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
  it('lets a valid bearer token through and attaches the claims', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'OPERADOR', permissions: ['payroll.read'] }, SECRET, 60);
    const { context, request } = requestContext({ headers: { authorization: `Bearer ${token}` } });
    const guard = new JwtAuthGuard(config, reflectorReturning(false));

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user?.sub).toBe('user-1');
    expect(request.user?.permissions).toEqual(['payroll.read']);
  });

  it('rejects a missing, malformed or non-bearer authorization header', () => {
    const guard = new JwtAuthGuard(config, reflectorReturning(false));
    for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer' }]) {
      expect(() => guard.canActivate(contextFor({ headers }))).toThrow(UnauthorizedException);
    }
  });

  it('rejects a token signed with another secret', () => {
    const forged = signAccessToken({ sub: 'user-1', role: 'ADMIN', permissions: [] }, 'b'.repeat(32), 60);
    const guard = new JwtAuthGuard(config, reflectorReturning(false));
    expect(() => guard.canActivate(contextFor({ headers: { authorization: `Bearer ${forged}` } }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', () => {
    const expired = signAccessToken({ sub: 'user-1', role: 'ADMIN', permissions: [] }, SECRET, -1);
    const guard = new JwtAuthGuard(config, reflectorReturning(false));
    expect(() => guard.canActivate(contextFor({ headers: { authorization: `Bearer ${expired}` } }))).toThrow(
      UnauthorizedException,
    );
  });

  it('skips authentication only where @Public is declared', () => {
    const guard = new JwtAuthGuard(config, reflectorReturning(true));
    expect(guard.canActivate(contextFor({ headers: {} }))).toBe(true);
  });
});

describe('PermissionsGuard', () => {
  const guard = (required: string[] | undefined) => new PermissionsGuard(reflectorReturning(required));

  it('allows a handler that declares no permission', () => {
    expect(guard(undefined).canActivate(contextFor({}))).toBe(true);
    expect(guard([]).canActivate(contextFor({}))).toBe(true);
  });

  it('requires every declared permission, not just one of them', () => {
    const request = { user: { sub: 'u', role: 'COORDINADOR', permissions: ['payroll.read'], iat: 0, exp: 0, jti: '' } };
    expect(guard(['payroll.read']).canActivate(contextFor(request))).toBe(true);
    expect(() => guard(['payroll.read', 'payroll.close']).canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('denies a request that carries no claims at all', () => {
    expect(() => guard(['payroll.read']).canActivate(contextFor({}))).toThrow(ForbiddenException);
  });

  it('does not accept a permission prefix as the permission', () => {
    const request = { user: { sub: 'u', role: 'OPERADOR', permissions: ['vault.read_meta'], iat: 0, exp: 0, jti: '' } };
    expect(() => guard(['vault.credential.issue']).canActivate(contextFor(request))).toThrow(ForbiddenException);
  });
});

describe('DeviceTokenGuard', () => {
  const guard = new DeviceTokenGuard();

  it('requires the x-device-token header', () => {
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextFor({ headers: { 'x-device-token': 'abc' } }))).toBe(true);
  });
});
