import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DevicesService } from '../../modules/devices/devices.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { auditLog, devices } from '../../database/schema/index.js';
import {
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let service: DevicesService;

beforeAll(async () => {
  ctx = await createTestContext();
  service = new DevicesService(ctx.database, new AuditService(ctx.database));
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
    const pending = await service.create({ hostname: 'office-01', label: 'PC-01' }, { sub: admin.id, role: 'ADMIN' });

    expect(pending.enrollmentCodeExpiresAt).toBeInstanceOf(Date);
    expect(pending.enrollmentCodeExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    await expect(service.enroll({ code: pending.enrollmentCode, hostname: 'office-01', label: 'PC-01' })).resolves.toMatchObject({
      deviceId: pending.id,
      expiresAt: expect.any(Date),
    });
    await expect(service.enroll({ code: pending.enrollmentCode, hostname: 'office-01', label: 'PC-01' }))
      .rejects.toBeInstanceOf(ConflictException);

    const expired = await service.create({ hostname: 'office-02', label: 'PC-02' }, { sub: admin.id, role: 'ADMIN' });
    await ctx.db.update(devices).set({ enrollmentCodeExpiresAt: new Date(Date.now() - 1_000) }).where(eq(devices.id, expired.id));
    await expect(service.enroll({ code: expired.enrollmentCode, hostname: 'office-02', label: 'PC-02' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rotates an approved token and invalidates the previous token', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await service.create({ hostname: 'office-03', label: 'PC-03' }, { sub: admin.id, role: 'ADMIN' });
    const enrolled = await service.enroll({ code: pending.enrollmentCode, hostname: 'office-03', label: 'PC-03' });
    const rotated = await service.rotate(pending.id, { sub: admin.id, role: 'ADMIN' });

    expect(rotated.deviceToken).not.toBe(enrolled.deviceToken);
    await expect(service.heartbeat(enrolled.deviceToken, {}, '203.0.113.3')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.heartbeat(rotated.deviceToken, {}, '203.0.113.3')).resolves.toMatchObject({ id: pending.id });

    const events = await ctx.db
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.entityId, pending.id));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(enrolled.deviceToken);
    expect(serialized).not.toContain(rotated.deviceToken);
  });

  it('rejects an expired token even when heartbeat calls the service directly', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const pending = await service.create({ hostname: 'office-04', label: 'PC-04' }, { sub: admin.id, role: 'ADMIN' });
    const enrolled = await service.enroll({ code: pending.enrollmentCode, hostname: 'office-04', label: 'PC-04' });
    await ctx.db.update(devices).set({ tokenExpiresAt: new Date(Date.now() - 1_000) }).where(eq(devices.id, pending.id));

    await expect(service.heartbeat(enrolled.deviceToken, {}, '203.0.113.4')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
