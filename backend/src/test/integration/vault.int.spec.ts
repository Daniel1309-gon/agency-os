import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { VaultService } from '../../modules/vault/vault.service.js';
import { VaultCryptoService } from '../../modules/vault/vault.crypto.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { credentialAccessLog, profileAssignments, profileSessions, ttProfileCredentials } from '../../database/schema/index.js';
import {
  createDevice,
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

/**
 * El flujo grant/redeem de PLAN.md §6.3 con Postgres y Redis reales. Los casos
 * de abuso de §9 son criterio de entrega, no cobertura de relleno.
 */

const SECRET = 'la-contrasena-real-del-perfil-en-talkytimes';

let ctx: TestContext;
let vault: VaultService;

interface Scenario {
  operatorId: string;
  otherOperatorId: string;
  profileId: string;
  sessionId: string;
  assignmentId: string;
  deviceToken: string;
  deviceId: string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  vault = new VaultService(ctx.database, ctx.redis, new VaultCryptoService(ctx.config, ctx.database), new AuditService(ctx.database));
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Operador en turno, con dispositivo aprobado, asignacion vigente y sesion viva. */
async function scenario(options: { profileStatus?: string; sessionStatus?: string; sessionDeviceId?: string | null } = {}): Promise<Scenario> {
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const operator = await createUser(ctx);
  const other = await createUser(ctx);
  const profile = await createProfile(ctx, { status: options.profileStatus });
  const device = await createDevice(ctx, { operatorId: operator.id });

  const [assignment] = await ctx.db
    .insert(profileAssignments)
    .values({
      profileId: profile.id,
      operatorId: operator.id,
      validRange: halfOpen(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)),
      status: 'ACTIVE',
      assignedBy: admin.id,
    })
    .returning({ id: profileAssignments.id });

  const [session] = await ctx.db
    .insert(profileSessions)
    .values({
      profileId: profile.id,
      operatorId: operator.id,
      deviceId: options.sessionDeviceId === undefined ? device.id : options.sessionDeviceId,
      assignmentId: assignment.id,
      chromeProfileDir: 'Profile 3',
      status: options.sessionStatus ?? 'LAUNCHING',
    })
    .returning({ id: profileSessions.id });

  await vault.rotate(profile.id, { username: 'perfil@talky.test', secret: SECRET }, admin.id);

  return {
    operatorId: operator.id,
    otherOperatorId: other.id,
    profileId: profile.id,
    sessionId: session.id,
    assignmentId: assignment.id,
    deviceToken: device.token,
    deviceId: device.id,
  };
}

const contextFor = (s: Scenario) => ({ userId: s.operatorId, deviceToken: s.deviceToken, ip: '10.20.30.40' });

describe('vault rotation', () => {
  it('stores the secret encrypted and never in clear text', async () => {
    const s = await scenario();
    const stored = await ctx.db
      .select({
        ciphertext: ttProfileCredentials.secretCiphertext,
        username: ttProfileCredentials.username,
        aadContext: ttProfileCredentials.aadContext,
        version: ttProfileCredentials.version,
      })
      .from(ttProfileCredentials)
      .where(eq(ttProfileCredentials.profileId, s.profileId));

    expect(stored).toHaveLength(1);
    expect(stored[0].ciphertext.toString('utf8')).not.toContain(SECRET);
    expect(stored[0].aadContext).toBe(`${s.profileId}:1`);
    // El usuario no es secreto; la contrasena si.
    expect(stored[0].username).toBe('perfil@talky.test');
  });

  it('bumps the version and leaves exactly one current credential', async () => {
    const s = await scenario();
    const admin = await createUser(ctx, { role: 'ADMIN' });

    const rotated = await vault.rotate(s.profileId, { username: 'perfil@talky.test', secret: 'la-nueva' }, admin.id);
    expect(rotated.version).toBe(2);

    const current = await ctx.db
      .select({ version: ttProfileCredentials.version })
      .from(ttProfileCredentials)
      .where(and(eq(ttProfileCredentials.profileId, s.profileId), eq(ttProfileCredentials.isCurrent, true)));
    expect(current).toEqual([{ version: 2 }]);

    // Y el redeem entrega la nueva, no la vieja.
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await expect(vault.redeem({ grantId }, contextFor(s))).resolves.toMatchObject({ secret: 'la-nueva' });
  });

  it('logs the rotation without the secret', async () => {
    const s = await scenario();
    const rows = await ctx.db
      .select({ purpose: credentialAccessLog.purpose, granted: credentialAccessLog.granted })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.profileId, s.profileId));

    expect(rows).toEqual([{ purpose: 'ADMIN_ROTATION', granted: true }]);
  });
});

describe('grant and redeem, end to end', () => {
  it('delivers the secret exactly once', async () => {
    const s = await scenario();
    const { grantId, expiresAt } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));

    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    await expect(vault.redeem({ grantId }, contextFor(s))).resolves.toEqual({
      username: 'perfil@talky.test',
      secret: SECRET,
    });

    const log = await ctx.db
      .select({ granted: credentialAccessLog.granted, consumedAt: credentialAccessLog.consumedAt, jti: credentialAccessLog.grantJti })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.grantJti, grantId));
    expect(log[0].granted).toBe(true);
    expect(log[0].consumedAt).toBeInstanceOf(Date);
  });

  it('rejects the second redeem and records reuse_attempted', async () => {
    // Criterio de entrega: canjear dos veces el mismo grantId → 409 y la
    // bitacora queda marcada como intento de reuso.
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await vault.redeem({ grantId }, contextFor(s));

    await expect(vault.redeem({ grantId }, contextFor(s))).rejects.toThrow(ConflictException);

    const [row] = await ctx.db
      .select({ reuseAttempted: credentialAccessLog.reuseAttempted })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.grantJti, grantId));
    expect(row.reuseAttempted).toBe(true);
  });

  it('does not let another operator redeem a grant that is not theirs', async () => {
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));

    await expect(
      vault.redeem({ grantId }, { userId: s.otherOperatorId, deviceToken: s.deviceToken }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not let a revoked device redeem', async () => {
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await ctx.pool.query('UPDATE devices SET status = $1 WHERE id = $2', ['REVOKED', s.deviceId]);

    await expect(vault.redeem({ grantId }, contextFor(s))).rejects.toThrow(ForbiddenException);
  });

  it('lets the grant expire: after its TTL the ticket is gone', async () => {
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));

    // Se fuerza la caducidad en Redis en vez de esperar 60 s de reloj.
    await ctx.rawRedis.del(`vault:grant:${grantId}`);
    await expect(vault.redeem({ grantId }, contextFor(s))).rejects.toThrow(ConflictException);
  });
});

describe('grant denials are recorded with their reason', () => {
  it('denies an operator whose assignment is not current', async () => {
    const s = await scenario();
    await ctx.db
      .update(profileAssignments)
      .set({ validRange: halfOpen(new Date(Date.now() - 7_200_000), new Date(Date.now() - 3_600_000)) })
      .where(eq(profileAssignments.id, s.assignmentId));

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toThrow(
      ForbiddenException,
    );

    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'NO_ASSIGNMENT' }]);
  });

  it('denies a paused profile with PROFILE_INACTIVE', async () => {
    const s = await scenario({ profileStatus: 'PAUSED' });

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toThrow(
      ForbiddenException,
    );
    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'PROFILE_INACTIVE' }]);
  });

  it('denies a session that is no longer live', async () => {
    const s = await scenario();
    await ctx.db.update(profileSessions).set({ status: 'CLOSED' }).where(eq(profileSessions.id, s.sessionId));

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets any approved office station claim a web-prepared session', async () => {
    const s = await scenario({ sessionDeviceId: null });
    const sharedStation = await createDevice(ctx, { operatorId: s.otherOperatorId });

    await expect(vault.grant(
      { profileId: s.profileId, sessionId: s.sessionId },
      { userId: s.operatorId, deviceToken: sharedStation.token, ip: '10.20.30.40' },
    )).resolves.toMatchObject({ grantId: expect.any(String) });

    const [claimed] = await ctx.db
      .select({ deviceId: profileSessions.deviceId })
      .from(profileSessions)
      .where(eq(profileSessions.id, s.sessionId));
    expect(claimed.deviceId).toBe(sharedStation.id);
  });

  it('rejects a second station after the prepared session has been claimed', async () => {
    const s = await scenario({ sessionDeviceId: null });
    const firstStation = await createDevice(ctx);
    const secondStation = await createDevice(ctx);

    await vault.grant(
      { profileId: s.profileId, sessionId: s.sessionId },
      { userId: s.operatorId, deviceToken: firstStation.token, ip: '10.20.30.40' },
    );

    await expect(vault.grant(
      { profileId: s.profileId, sessionId: s.sessionId },
      { userId: s.operatorId, deviceToken: secondStation.token, ip: '10.20.30.40' },
    )).rejects.toThrow('Session was claimed by another station');
  });

  it('rate limits after 30 grants in the hour and records RATE_LIMITED', async () => {
    const s = await scenario();
    for (let i = 0; i < 30; i += 1) {
      await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    }

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toMatchObject({
      status: 429,
    });
    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'RATE_LIMITED' }]);
  });
});

describe('the secret never reaches the logs', () => {
  it('emits nothing containing the credential during a full grant and redeem at debug level', async () => {
    // Criterio de entrega de PLAN.md §9.
    const debugCtx = await createTestContext('debug');
    try {
      const debugVault = new VaultService(
        debugCtx.database,
        debugCtx.redis,
        new VaultCryptoService(debugCtx.config, debugCtx.database),
        new AuditService(debugCtx.database),
      );
      const s = await scenario();

      const written: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
      try {
        const { grantId } = await debugVault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
        const credential = await debugVault.redeem({ grantId }, contextFor(s));
        expect(credential.secret).toBe(SECRET);
      } finally {
        spy.mockRestore();
      }

      expect(written.join('')).not.toContain(SECRET);
    } finally {
      await destroyTestContext(debugCtx);
    }
  });

  it('keeps the credential access log free of the secret', async () => {
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await vault.redeem({ grantId }, contextFor(s));

    const dump = await ctx.pool.query('SELECT to_jsonb(l) AS row FROM credential_access_log l');
    expect(JSON.stringify(dump.rows)).not.toContain(SECRET);
  });
});
