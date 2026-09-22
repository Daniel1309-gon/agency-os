import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { DevicesService } from '../../modules/devices/devices.service.js';
import { AuthService } from '../../modules/auth/auth.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { ShiftAccessService } from '../../common/auth/shift-access.service.js';
import { AuthVersionService } from '../../common/auth/auth-version.service.js';
import { hashToken, randomToken } from '../../common/auth/crypto.js';
import { auditLog, devices, refreshTokens } from '../../database/schema/index.js';
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
let service: DevicesService;

function fingerprintOf(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

beforeAll(async () => {
  ctx = await createTestContext();
  const realtime = new RealtimeService(ctx.database);
  const auth = new AuthService(ctx.database, ctx.config, ctx.redis, new ShiftAccessService(ctx.database), new AuthVersionService(ctx.database, realtime), new AuditService(ctx.database));
  service = new DevicesService(ctx.database, new AuditService(ctx.database), realtime, auth);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('DevicesService lifecycle', () => {
  it('expires enrollment codes and consumes them exactly once', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await service.create({ hostname: 'office-01', label: 'PC-01', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });

    expect(pending.enrollmentCodeExpiresAt).toBeInstanceOf(Date);
    expect(pending.enrollmentCodeExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    await expect(service.enroll({ code: pending.enrollmentCode, hostname: 'office-01', label: 'PC-01', certFingerprint: fingerprintOf('pc-01') }))
      .resolves.toEqual({ deviceId: pending.id });
    await expect(service.enroll({ code: pending.enrollmentCode, hostname: 'office-01', label: 'PC-01', certFingerprint: fingerprintOf('pc-01') }))
      .rejects.toBeInstanceOf(ConflictException);

    const expired = await service.create({ hostname: 'office-02', label: 'PC-02', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    await ctx.db.update(devices).set({ enrollmentCodeExpiresAt: new Date(Date.now() - 1_000) }).where(eq(devices.id, expired.id));
    await expect(service.enroll({ code: expired.enrollmentCode, hostname: 'office-02', label: 'PC-02', certFingerprint: fingerprintOf('pc-02') }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('registers a renewed certificate and heartbeats by device id', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await service.create({ hostname: 'office-03', label: 'PC-03', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    await service.enroll({ code: pending.enrollmentCode, hostname: 'office-03', label: 'PC-03', certFingerprint: fingerprintOf('pc-03') });

    await expect(service.registerCertificate(pending.id, { certFingerprint: fingerprintOf('pc-03-renewed'), certNotAfter: '2027-01-01T00:00:00.000Z' }, { sub: admin.id }))
      .resolves.toEqual({ deviceId: pending.id });
    await expect(service.registerCertificate('11111111-1111-1111-1111-111111111111', { certFingerprint: fingerprintOf('unknown') }, { sub: admin.id }))
      .rejects.toBeInstanceOf(ConflictException);

    await expect(service.heartbeat(pending.id, {}, '203.0.113.3')).resolves.toMatchObject({ id: pending.id });
    await expect(service.heartbeat('11111111-1111-1111-1111-111111111111', {}, '203.0.113.3')).rejects.toBeInstanceOf(ForbiddenException);

    const [stored] = await ctx.db.select({ fingerprint: devices.certFingerprint, notAfter: devices.certNotAfter }).from(devices).where(eq(devices.id, pending.id));
    expect(stored.fingerprint).toBe(fingerprintOf('pc-03-renewed'));
    expect(stored.notAfter?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('stores the certificate verified at the edge and rejects a body fingerprint that contradicts it', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await service.create({ hostname: 'office-05', label: 'PC-05', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const verified = fingerprintOf('pc-05-verified');
    const notAfter = new Date('2028-01-01T00:00:00.000Z');

    await expect(service.enroll(
      { code: pending.enrollmentCode, hostname: 'office-05', label: 'PC-05', certFingerprint: fingerprintOf('spoofed') },
      { fingerprint: verified, notAfter },
    )).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.enroll(
      { code: pending.enrollmentCode, hostname: 'office-05', label: 'PC-05', certFingerprint: verified },
      { fingerprint: verified, notAfter },
    )).resolves.toEqual({ deviceId: pending.id });

    const [stored] = await ctx.db.select({ fingerprint: devices.certFingerprint, notAfter: devices.certNotAfter }).from(devices).where(eq(devices.id, pending.id));
    expect(stored.fingerprint).toBe(verified);
    expect(stored.notAfter?.toISOString()).toBe(notAfter.toISOString());
  });

  it('revokes the refresh tokens issued on the device when it is revoked', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const device = await createDevice(ctx, { operatorId: admin.id });
    await ctx.db.insert(refreshTokens).values({
      userId: admin.id,
      tokenHash: hashToken(randomToken()),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      deviceId: device.id,
    });

    await service.revoke(device.id, { sub: admin.id, role: 'ADMIN' }, 'PC_REPLACED');

    const [stored] = await ctx.db
      .select({ revokedReason: refreshTokens.revokedReason })
      .from(refreshTokens)
      .where(eq(refreshTokens.deviceId, device.id));
    expect(stored.revokedReason).toBe('DEVICE_REVOKED');
  });

  it('releases a revoked fingerprint for a replacement PC without losing history', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const first = await service.create({ hostname: 'office-04', label: 'PC-04', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    const fingerprint = fingerprintOf('pc-04');
    await service.enroll({ code: first.enrollmentCode, hostname: 'office-04', label: 'PC-04', certFingerprint: fingerprint });
    await service.revoke(first.id, { sub: admin.id, role: 'ADMIN' }, 'PC_REPLACED');

    const replacement = await service.create({ hostname: 'office-04b', label: 'PC-04B', deviceKind: 'STATION' }, { sub: admin.id, role: 'ADMIN' });
    await expect(service.enroll({ code: replacement.enrollmentCode, hostname: 'office-04b', label: 'PC-04B', certFingerprint: fingerprint }))
      .resolves.toEqual({ deviceId: replacement.id });

    const [revoked] = await ctx.db.select({ fingerprint: devices.certFingerprint, status: devices.status }).from(devices).where(eq(devices.id, first.id));
    expect(revoked).toMatchObject({ fingerprint, status: 'REVOKED' });

    const events = await ctx.db.select({ action: auditLog.action }).from(auditLog);
    expect(events.map((row) => row.action)).toEqual(expect.arrayContaining(['device.enrolled', 'device.revoked']));
  });
});
