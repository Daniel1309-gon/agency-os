import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ShiftWindowGuard } from './shift.guard.js';
import type { AuthenticatedRequest } from './auth.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ShiftAccessService } from './shift-access.service.js';

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

const operator = { sub: 'operator-1', role: 'OPERADOR', permissions: [], iat: 0, exp: 1, jti: 'jti' };

describe('ShiftWindowGuard', () => {
  it('rejects an operator outside a shift and without an override', async () => {
    const shiftAccess = { isWithinApprovedWindow: vi.fn().mockResolvedValue(false) } as unknown as ShiftAccessService;
    const guard = new ShiftWindowGuard(shiftAccess, reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ user: operator }))).rejects.toThrow(ForbiddenException);
    expect(shiftAccess.isWithinApprovedWindow).toHaveBeenCalledWith(operator.sub);
  });

  it('allows an operator inside an approved shift', async () => {
    const shiftAccess = { isWithinApprovedWindow: vi.fn().mockResolvedValue(true) } as unknown as ShiftAccessService;
    const guard = new ShiftWindowGuard(shiftAccess, reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ user: operator }))).resolves.toBe(true);
  });

  it('does not impose operator windows on administrative actors', async () => {
    const shiftAccess = { isWithinApprovedWindow: vi.fn() } as unknown as ShiftAccessService;
    const guard = new ShiftWindowGuard(shiftAccess, reflectorReturning(true), audit);
    await expect(guard.canActivate(contextFor({ user: { ...operator, role: 'ADMIN' } }))).resolves.toBe(true);
    expect(shiftAccess.isWithinApprovedWindow).not.toHaveBeenCalled();
  });
});
