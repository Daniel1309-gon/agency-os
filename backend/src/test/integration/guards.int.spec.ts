import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ClientCertGuard } from '../../common/auth/client-cert.js';
import { ALLOW_UNREGISTERED_CLIENT_CERT_KEY } from '../../common/auth/decorators.js';
import { IpAllowlistGuard, StationDeviceGuard } from '../../common/auth/guards.js';
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

const claims = (sub: string) => ({ sub, role: 'OPERADOR', permissions: [], av: 1, iat: 0, exp: 1, jti: 'jti' });

describe('Entrega 1 security guards against real infrastructure', () => {
  it('fails closed without an active office allowlist and accepts only a matching CIDR', async () => {
    const guard = new IpAllowlistGuard(ctx.database, ctx.config, reflector, new AuditService(ctx.database));
    await expect(guard.canActivate(contextFor({ ip: '10.20.30.40' }).context)).rejects.toThrow('IP allowlist is not configured');

    const admin = await createUser(ctx, { role: 'ADMIN' });
    await ctx.db.insert(ipAllowlist).values({ label: 'office', cidr: '10.0.0.0/8', scope: 'ALL', createdBy: admin.id });
    await expect(guard.canActivate(contextFor({ ip: '10.20.30.40' }).context)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({ ip: '192.0.2.10' }).context)).rejects.toThrow('IP address is not allowed');
  });

  it('lets an approved device through without any office allowlist entry', async () => {
    const operator = await createUser(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const guard = new IpAllowlistGuard(ctx.database, ctx.config, reflector, new AuditService(ctx.database));

    // ADR 0014: con certificado de dispositivo resuelto, la IP no es la puerta.
    await expect(guard.canActivate(contextFor({
      ip: '198.51.100.7',
      device: { id: device.id, label: 'PC', kind: 'STATION', fingerprint: device.fingerprint, certNotAfter: null },
    }).context)).resolves.toBe(true);

    // Sin dispositivo, una ruta pública sigue fallando cerrado sin allowlist.
    await expect(guard.canActivate(contextFor({ ip: '198.51.100.7' }).context)).rejects.toThrow('IP allowlist is not configured');
  });

  it('resolves the device principal from the certificate and rejects revoked or expired certificates', async () => {
    const operator = await createUser(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const audit = new AuditService(ctx.database);
    const guard = new ClientCertGuard(ctx.config, ctx.database, audit, new Reflector());

    const valid = contextFor({ user: claims(operator.id), headers: { 'client-cert': device.header } });
    await expect(guard.canActivate(valid.context)).resolves.toBe(true);
    expect(valid.request.device).toMatchObject({ id: device.id, kind: 'STATION', fingerprint: device.fingerprint });
    await expect(new StationDeviceGuard(audit).canActivate(valid.context)).resolves.toBe(true);

    await ctx.db.update(devices).set({ certNotAfter: new Date(Date.now() - 1_000) }).where(eq(devices.id, device.id));
    await expect(guard.canActivate(valid.context)).rejects.toThrow(ForbiddenException);

    await ctx.db.update(devices).set({ certNotAfter: null, status: 'REVOKED' }).where(eq(devices.id, device.id));
    await expect(guard.canActivate(valid.context)).rejects.toThrow(ForbiddenException);
  });

  it('lets an unregistered certificate reach the enrollment route without an approved device', async () => {
    const der = Buffer.from('unregistered-enrollment-der');
    const fingerprint = createHash('sha256').update(der).digest('hex');
    const allowUnregistered = {
      getAllAndOverride: (key: string) => (key === ALLOW_UNREGISTERED_CLIENT_CERT_KEY ? true : undefined),
    } as unknown as Reflector;
    const guard = new ClientCertGuard(ctx.config, ctx.database, new AuditService(ctx.database), allowUnregistered);
    const { context, request } = contextFor({ headers: { 'client-cert': `:${der.toString('base64')}:` } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.clientCertFingerprint).toBe(fingerprint);
    expect(request.device).toBeUndefined();
  });

  it('does not let an administrative device run station operations', async () => {
    const owner = await createUser(ctx, { role: 'ADMIN' });
    const adminDevice = await createDevice(ctx, { operatorId: owner.id, kind: 'ADMIN' });
    const audit = new AuditService(ctx.database);
    const guard = new ClientCertGuard(ctx.config, ctx.database, audit, new Reflector());
    const request = contextFor({ user: claims(owner.id), headers: { 'client-cert': adminDevice.header } });

    await expect(guard.canActivate(request.context)).resolves.toBe(true);
    expect(request.request.device?.kind).toBe('ADMIN');
    await expect(new StationDeviceGuard(audit).canActivate(request.context)).rejects.toThrow(ForbiddenException);
  });

  it('does not trust a forged certificate header: malformed is rejected and unknown is not authorized', async () => {
    const guard = new ClientCertGuard(ctx.config, ctx.database, new AuditService(ctx.database), new Reflector());
    const malformed = contextFor({ headers: { 'client-cert': 'not-rfc9440' } });
    const unknown = contextFor({ headers: { 'client-cert': ':bm90LWEtY2VydA==:' } });

    await expect(guard.canActivate(malformed.context)).rejects.toThrow('malformed');
    await expect(guard.canActivate(unknown.context)).rejects.toThrow('not authorized');
    expect(malformed.request.device).toBeUndefined();
    expect(unknown.request.device).toBeUndefined();
  });

  it('authorizes the normalized request IP and ignores a conflicting forwarded header', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await ctx.db.insert(ipAllowlist).values({ label: 'proxy office', cidr: '203.0.113.0/24', scope: 'ALL', createdBy: admin.id });
    const guard = new IpAllowlistGuard(ctx.database, ctx.config, reflector, new AuditService(ctx.database));

    await expect(guard.canActivate(contextFor({
      ip: '::ffff:203.0.113.10',
      headers: { 'x-forwarded-for': '10.0.0.10' },
    }).context)).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({
      ip: '198.51.100.10',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    }).context)).rejects.toThrow('IP address is not allowed');
  });
});
