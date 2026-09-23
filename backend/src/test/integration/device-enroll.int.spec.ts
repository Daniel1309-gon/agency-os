import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DevicesService } from '../../modules/devices/devices.service.js';
import { AuthService } from '../../modules/auth/auth.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { ShiftAccessService } from '../../common/auth/shift-access.service.js';
import { AuthVersionService } from '../../common/auth/auth-version.service.js';
import { devices as devicesTable, ipAllowlist } from '../../database/schema/index.js';
import {
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let app: NestFastifyApplication;
let devices: DevicesService;

/** Mismo grafo que el servicio real, con la auditoria que se le pase. */
function buildDevices(audit: AuditService): DevicesService {
  return new DevicesService(
    ctx.database,
    audit,
    new RealtimeService(ctx.database),
    new AuthService(ctx.database, ctx.config, ctx.redis, new ShiftAccessService(ctx.database), new AuthVersionService(ctx.database, new RealtimeService(ctx.database)), new AuditService(ctx.database)),
  );
}

async function startApi(): Promise<NestFastifyApplication> {
  const distModuleUrl = new URL('../../../dist/app.module.js', import.meta.url).href;
  const { AppModule } = await import(/* @vite-ignore */ distModuleUrl);
  const instance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  instance.setGlobalPrefix('api/v1');
  await instance.init();
  await instance.getHttpAdapter().getInstance().ready();
  return instance;
}

function certHeader(seed: string): { header: string; fingerprint: string } {
  const der = Buffer.from(seed);
  return { header: `:${der.toString('base64')}:`, fingerprint: createHash('sha256').update(der).digest('hex') };
}

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDatabase(ctx);
  await seedRoles(ctx);
  const admin = await createUser(ctx, { role: 'ADMIN' });
  await ctx.db.insert(ipAllowlist).values({ label: 'enroll test', cidr: '127.0.0.1/32', scope: 'ALL', createdBy: admin.id });
  devices = buildDevices(new AuditService(ctx.database));
  app = await startApi();
});

afterAll(async () => {
  await app?.close();
  await destroyTestContext(ctx);
});

describe('POST /devices/enroll', () => {
  it('enrolls a station whose certificate is not registered yet', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await devices.create({ hostname: 'pc-enroll-01', label: 'PC nueva', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const { header, fingerprint } = certHeader('enrollment-certificate-der');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'client-cert': header },
      payload: { code: pending.enrollmentCode, hostname: 'pc-enroll-01', label: 'PC nueva', certFingerprint: fingerprint },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ deviceId: pending.id });
  });

  it('does not leave the device enrolled when the audit write fails', async () => {
    // SEC-07b: ruta publica sin la transaccion del interceptor; el alta y su
    // auditoria se cierran juntas.
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await devices.create({ hostname: 'pc-atomic-01', label: 'Atómica', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const { fingerprint } = certHeader('atomic-enrollment-der');
    const failing = buildDevices({ record: async () => { throw new Error('audit down'); } } as unknown as AuditService);

    await expect(failing.enroll({ code: pending.enrollmentCode, hostname: 'pc-atomic-01', certFingerprint: fingerprint }, { fingerprint })).rejects.toThrow('audit down');

    const [row] = await ctx.db.select({ status: devicesTable.status, certFingerprint: devicesTable.certFingerprint }).from(devicesTable).where(eq(devicesTable.id, pending.id));
    expect(row).toEqual({ status: 'PENDING', certFingerprint: null });
  });

  it('rejects a body fingerprint that does not match the presented certificate', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await devices.create({ hostname: 'pc-enroll-02', label: 'PC nueva 2', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const { header } = certHeader('another-enrollment-der');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'client-cert': header },
      payload: { code: pending.enrollmentCode, hostname: 'pc-enroll-02', label: 'PC nueva 2', certFingerprint: 'a'.repeat(64) },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 409 when enrollment reuses an active certificate fingerprint', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const original = await devices.create({ hostname: 'pc-unique-01', label: 'Original', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const duplicate = await devices.create({ hostname: 'pc-unique-02', label: 'Duplicada', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const { header, fingerprint } = certHeader('active-certificate-collision');
    await devices.enroll({ code: original.enrollmentCode, hostname: 'pc-unique-01', certFingerprint: fingerprint }, { fingerprint });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      headers: { 'client-cert': header },
      payload: { code: duplicate.enrollmentCode, hostname: 'pc-unique-02', certFingerprint: fingerprint },
    });
    expect(response.statusCode).toBe(409);
  });

  it('returns 409 when certificate registration reuses an active fingerprint', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const original = await devices.create({ hostname: 'pc-register-01', label: 'Original', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const other = await devices.create({ hostname: 'pc-register-02', label: 'Otra', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const first = certHeader('register-certificate-original');
    const second = certHeader('register-certificate-other');
    await devices.enroll({ code: original.enrollmentCode, hostname: 'pc-register-01', certFingerprint: first.fingerprint }, { fingerprint: first.fingerprint });
    await devices.enroll({ code: other.enrollmentCode, hostname: 'pc-register-02', certFingerprint: second.fingerprint }, { fingerprint: second.fingerprint });

    await expect(devices.registerCertificate(other.id, { certFingerprint: first.fingerprint }, { sub: admin.id }))
      .rejects.toMatchObject({ status: 409 });
  });
});
