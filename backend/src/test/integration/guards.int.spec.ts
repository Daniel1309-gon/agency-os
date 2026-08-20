import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { DeviceTokenGuard, IpAllowlistGuard } from '../../common/auth/guards.js';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthenticatedRequest } from '../../common/auth/auth.types.js';
import { devices, ipAllowlist } from '../../database/schema/index.js';
import {
  createDevice,
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let reflector: Reflector;

beforeAll(async () => {
  ctx = await createTestContext();
  reflector = new Reflector();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

function contextFor(request: Partial<AuthenticatedRequest>): { context: ExecutionContext; request: AuthenticatedRequest } {
  const target = { headers: {}, ...request } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => target }),
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
  return { context, request: target };
}

const claims = (sub: string) => ({ sub, role: 'OPERADOR', permissions: [], iat: 0, exp: 1, jti: 'jti' });

describe('Entrega 1 security guards against real infrastructure', () => {
  it('fails closed without an active office allowlist and accepts only a matching CIDR', async () => {
    const guard = new IpAllowlistGuard(ctx.database, ctx.config, reflector, new AuditService(ctx.database));
    await expect(guard.canActivate(contextFor({ ip: '10.20.30.40' }).context)).rejects.toThrow('IP allowlist is not configured');

    const admin = await createUser(ctx, { role: 'ADMIN' });
    await ctx.db.insert(ipAllowlist).values({ label: 'office', cidr: '10.0.0.0/8', scope: 'ALL', createdBy: admin.id });
    await expect(guard.canActivate(contextFor({ ip: '10.20.30.40' }).context)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({ ip: '192.0.2.10' }).context)).rejects.toThrow('IP address is not allowed');
  });

  it('accepts an approved office station for any authenticated operator', async () => {
    const operator = await createUser(ctx);
    const other = await createUser(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const guard = new DeviceTokenGuard(ctx.database, new AuditService(ctx.database));

    const valid = contextFor({ user: claims(operator.id), headers: { 'x-device-token': device.token } });
    await expect(guard.canActivate(valid.context)).resolves.toBe(true);
    expect(valid.request.device).toMatchObject({ id: device.id });
    expect(valid.request.device).not.toHaveProperty('operatorId');

    const foreign = contextFor({ user: claims(other.id), headers: { 'x-device-token': device.token } });
    await expect(guard.canActivate(foreign.context)).resolves.toBe(true);

    await ctx.db.update(devices).set({ tokenExpiresAt: new Date(Date.now() - 1_000) }).where(eq(devices.id, device.id));
    await expect(guard.canActivate(valid.context)).rejects.toThrow(ForbiddenException);
  });
});
