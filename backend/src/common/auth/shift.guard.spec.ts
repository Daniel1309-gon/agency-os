import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ShiftWindowGuard } from './shift.guard.js';
import type { AuthenticatedRequest } from './auth.types.js';
import type { AuditService } from '../audit/audit.service.js';

const audit = { record: async () => undefined } as unknown as AuditService;

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  const target = { headers: {}, ...request } as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => target }),
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
}

function dbFor(...responses: unknown[][]) {
  const queue = [...responses];
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => queue.shift() ?? [] }),
        }),
      }),
    },
  } as never;
}

const operator = { sub: 'operator-1', role: 'OPERADOR', permissions: [], iat: 0, exp: 1, jti: 'jti' };

describe('ShiftWindowGuard', () => {
  it('rejects an operator outside a shift and without an override', async () => {
    const guard = new ShiftWindowGuard(dbFor([], []), reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ user: operator }))).rejects.toThrow(ForbiddenException);
  });

  it('allows an operator inside an approved shift', async () => {
    const guard = new ShiftWindowGuard(dbFor([{ id: 'shift-1' }]), reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ user: operator }))).resolves.toBe(true);
  });

  it('does not impose operator windows on administrative actors', async () => {
    const guard = new ShiftWindowGuard(dbFor(), reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ user: { ...operator, role: 'ADMIN' } }))).resolves.toBe(true);
  });
});
