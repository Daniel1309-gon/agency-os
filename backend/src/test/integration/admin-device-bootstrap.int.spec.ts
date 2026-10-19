import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { resolveApprovedDevice } from '../../common/auth/client-cert.js';
import { devices } from '../../database/schema/index.js';
import {
  createDevice,
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

const script = fileURLToPath(new URL('../../../scripts/db-bootstrap-admin-device.mjs', import.meta.url));

let ctx: TestContext;

function fingerprintOf(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function runBootstrap(env: Record<string, string>) {
  const result = spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH ?? '', DATABASE_URL: process.env.DATABASE_URL ?? '', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('db-bootstrap-admin-device', () => {
  it('registers the admin certificate as an approved ADMIN device that the client-cert guard accepts', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN', email: 'owner@agency.test' });
    const fingerprint = fingerprintOf('admin-laptop');

    const result = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'Owner@Agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: fingerprint.toUpperCase() });

    expect(result.status).toBe(0);
    expect(result.output).toContain('Bootstrap admin device registered');
    const rows = await ctx.db.select().from(devices).where(eq(devices.certFingerprint, fingerprint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceKind: 'ADMIN', status: 'APPROVED', approvedBy: admin.id, label: 'admin-bootstrap' });
    await expect(resolveApprovedDevice(ctx.database, fingerprint)).resolves.toMatchObject({ kind: 'ADMIN', fingerprint });
  });

  it('leaves the devices untouched when an active ADMIN device already exists', async () => {
    await createUser(ctx, { role: 'ADMIN', email: 'owner@agency.test' });
    const first = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'owner@agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: fingerprintOf('first') });
    expect(first.status).toBe(0);

    const second = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'owner@agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: fingerprintOf('second') });

    expect(second.status).toBe(0);
    expect(second.output).toContain('An active ADMIN device already exists; bootstrap was not changed');
    const rows = await ctx.db.select({ fingerprint: devices.certFingerprint }).from(devices);
    expect(rows).toEqual([{ fingerprint: fingerprintOf('first') }]);
  });

  it('still bootstraps when the only active devices are stations', async () => {
    await createUser(ctx, { role: 'ADMIN', email: 'owner@agency.test' });
    await createDevice(ctx);

    const result = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'owner@agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: fingerprintOf('admin') });

    expect(result.status).toBe(0);
    const admins = await ctx.db.select().from(devices).where(eq(devices.deviceKind, 'ADMIN'));
    expect(admins).toHaveLength(1);
  });

  it('refuses a fingerprint that already belongs to an active station and leaves it unchanged', async () => {
    await createUser(ctx, { role: 'ADMIN', email: 'owner@agency.test' });
    const station = await createDevice(ctx);

    const result = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'owner@agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: station.fingerprint });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('This certificate fingerprint already belongs to an active device; revoke it first');
    const rows = await ctx.db.select({ id: devices.id, kind: devices.deviceKind }).from(devices);
    expect(rows).toEqual([{ id: station.id, kind: 'STATION' }]);
  });

  it('rejects a fingerprint that is not a SHA-256 hex digest and writes nothing', async () => {
    await createUser(ctx, { role: 'ADMIN', email: 'owner@agency.test' });

    const result = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'owner@agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: 'AA:BB:CC' });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT must be the SHA-256 fingerprint');
    expect(await ctx.db.select().from(devices)).toHaveLength(0);
  });

  it('fails when the bootstrap admin does not exist and writes nothing', async () => {
    const result = runBootstrap({ BOOTSTRAP_ADMIN_EMAIL: 'missing@agency.test', BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT: fingerprintOf('admin') });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Bootstrap admin was not found; run db:seed first');
    expect(await ctx.db.select().from(devices)).toHaveLength(0);
  });
});
