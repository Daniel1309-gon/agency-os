import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { VaultService } from '../../modules/vault/vault.service.js';
import { VaultCryptoService } from '../../modules/vault/vault.crypto.js';
import { VaultAlertService } from '../../modules/vault/vault-alerts.service.js';
import { DrizzleVaultRepository } from '../../modules/vault/vault.drizzle-repository.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { OutboxService } from '../../modules/outbox/outbox.service.js';
import { credentialAccessLog, auditLog, notifications, outboxEvents, profileAssignments, profileSessions, rocketchatChannels, ttProfileCredentials, ttProfiles } from '../../database/schema/index.js';
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
  adminId: string;
  operatorId: string;
  otherOperatorId: string;
  profileId: string;
  sessionId: string;
  assignmentId: string;
  deviceId: string;
}

beforeAll(async () => {
  ctx = await createTestContext();
  vault = new VaultService(
    new DrizzleVaultRepository(ctx.database),
    ctx.redis,
    new VaultCryptoService(ctx.config, ctx.database),
    new AuditService(ctx.database),
    ctx.database,
    new VaultAlertService(new DrizzleVaultRepository(ctx.database), ctx.database, ctx.redis, new OutboxService(ctx.database), ctx.logger),
  );
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
async function scenario(options: { profileStatus?: string; sessionStatus?: string; username?: string } = {}): Promise<Scenario> {
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const operator = await createUser(ctx);
  const other = await createUser(ctx);
  const profile = await createProfile(ctx, { status: options.profileStatus, chromeProfileDir: 'Profile 3' });
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
      deviceId: device.id,
      assignmentId: assignment.id,
      chromeProfileDir: 'Profile 3',
      status: options.sessionStatus ?? 'LAUNCHING',
    })
    .returning({ id: profileSessions.id });

  await vault.rotate(profile.id, { username: options.username ?? 'perfil@talky.test', secret: SECRET, profileVersion: 0 }, { id: admin.id, role: 'ADMIN' });

  return {
    adminId: admin.id,
    operatorId: operator.id,
    otherOperatorId: other.id,
    profileId: profile.id,
    sessionId: session.id,
    assignmentId: assignment.id,
    deviceId: device.id,
  };
}

const contextFor = (s: Scenario) => ({ userId: s.operatorId, deviceId: s.deviceId, ip: '10.20.30.40' });

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

    const rotated = await vault.rotate(s.profileId, { username: 'perfil@talky.test', secret: 'la-nueva', profileVersion: 1 }, { id: admin.id, role: 'ADMIN' });
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

  it('updates the catalog login and vault username together with the expected profile version', async () => {
    const s = await scenario();
    const rotated = await vault.rotate(s.profileId, { username: 'nuevo@talky.test', secret: 'la-nueva', profileVersion: 1 }, { id: s.adminId, role: 'ADMIN' });

    expect(rotated.version).toBe(2);
    const [profile] = await ctx.db.select({ loginEmail: ttProfiles.loginEmail, version: ttProfiles.version }).from(ttProfiles).where(eq(ttProfiles.id, s.profileId));
    const [credential] = await ctx.db.select({ username: ttProfileCredentials.username }).from(ttProfileCredentials).where(and(eq(ttProfileCredentials.profileId, s.profileId), eq(ttProfileCredentials.isCurrent, true)));
    expect(profile).toEqual({ loginEmail: 'nuevo@talky.test', version: 2 });
    expect(credential).toEqual({ username: 'nuevo@talky.test' });
    await expect(vault.rotate(s.profileId, { username: 'otro@talky.test', secret: 'otra', profileVersion: 0 }, { id: s.adminId, role: 'ADMIN' })).rejects.toThrow(ConflictException);
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
      vault.redeem({ grantId }, { userId: s.otherOperatorId, deviceId: s.deviceId }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not let a revoked device redeem a grant', async () => {
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

describe('station credential handoff, end to end', () => {
  it('delivers the credential once for the station that prepared the session', async () => {
    const s = await scenario();

    await expect(vault.handoff(
      { profileId: s.profileId, sessionId: s.sessionId },
      { deviceId: s.deviceId, ip: '10.20.30.40' },
    )).resolves.toEqual({ username: 'perfil@talky.test', secret: SECRET, sessionVersion: 1 });

    await expect(vault.handoff(
      { profileId: s.profileId, sessionId: s.sessionId },
      { deviceId: s.deviceId, ip: '10.20.30.40' },
    )).rejects.toThrow(ConflictException);
  });

  it('rejects a prepared session after the 60-second station handoff window', async () => {
    const s = await scenario();
    await ctx.db
      .update(profileSessions)
      .set({ startedAt: new Date(Date.now() - 61_000) })
      .where(eq(profileSessions.id, s.sessionId));

    await expect(vault.handoff(
      { profileId: s.profileId, sessionId: s.sessionId },
      { deviceId: s.deviceId, ip: '10.20.30.40' },
    )).rejects.toThrow(ForbiddenException);
  });

  it('rejects a handoff from a station different than the one that prepared the session', async () => {
    const s = await scenario();
    const otherStation = await createDevice(ctx, { operatorId: s.otherOperatorId });

    await expect(vault.handoff(
      { profileId: s.profileId, sessionId: s.sessionId },
      { deviceId: otherStation.id, ip: '10.20.30.40' },
    )).rejects.toThrow(ForbiddenException);
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

  it('denies a grant requested from a station different than the prepared one', async () => {
    const s = await scenario();
    const sharedStation = await createDevice(ctx, { operatorId: s.otherOperatorId });

    await expect(vault.grant(
      { profileId: s.profileId, sessionId: s.sessionId },
      { userId: s.operatorId, deviceId: sharedStation.id, ip: '10.20.30.40' },
    )).rejects.toThrow(ForbiddenException);
    // La sesion existe pero la preparo otra estacion: es el motivo especifico de
    // SEC-10, no un NO_ASSIGNMENT generico.
    expect(
      (await ctx.db.select({ denyReason: credentialAccessLog.denyReason }).from(credentialAccessLog).where(eq(credentialAccessLog.granted, false)))[0],
    ).toEqual({ denyReason: 'DEVICE_MISMATCH' });
  });

  it('rejects a session whose stored Chrome directory no longer matches the profile binding', async () => {
    const s = await scenario();
    await ctx.db.update(profileSessions).set({ chromeProfileDir: 'Profile 4' }).where(eq(profileSessions.id, s.sessionId));

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a second station against a session bound to the first one', async () => {
    const s = await scenario();
    const firstStation = await createDevice(ctx);
    const secondStation = await createDevice(ctx);

    await vault.grant(
      { profileId: s.profileId, sessionId: s.sessionId },
      { userId: s.operatorId, deviceId: firstStation.id, ip: '10.20.30.40' },
    ).catch(() => undefined);

    await expect(vault.grant(
      { profileId: s.profileId, sessionId: s.sessionId },
      { userId: s.operatorId, deviceId: secondStation.id, ip: '10.20.30.40' },
    )).rejects.toThrow(ForbiddenException);
  });

  it('does not let a revoked device obtain a grant', async () => {
    // Revocacion: la baja del dispositivo corta grants, sockets y refresh.
    const s = await scenario();
    await ctx.pool.query('UPDATE devices SET status = $1 WHERE id = $2', ['REVOKED', s.deviceId]);

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toThrow(ForbiddenException);
    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'DEVICE_NOT_APPROVED' }]);
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

describe('denials survive the request transaction', () => {
  // El TransactionInterceptor envuelve todo handler con request.user en
  // withRequestContext, y la excepcion revierte esa transaccion. La denegacion se
  // escribe justo antes de lanzarla, asi que sin transaccion propia desaparecia.
  it('keeps the denial and its audit row after the request rolls back', async () => {
    const s = await scenario();
    await ctx.db
      .update(profileAssignments)
      .set({ validRange: halfOpen(new Date(Date.now() - 7_200_000), new Date(Date.now() - 3_600_000)) })
      .where(eq(profileAssignments.id, s.assignmentId));

    await expect(
      ctx.database.withRequestContext(s.operatorId, 'OPERADOR', () =>
        vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s)),
      ),
    ).rejects.toThrow(ForbiddenException);

    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason, userId: credentialAccessLog.userId })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'NO_ASSIGNMENT', userId: s.operatorId }]);

    const audit = await ctx.db
      .select({ action: auditLog.action, result: auditLog.result })
      .from(auditLog)
      .where(eq(auditLog.action, 'vault.credential.denied'));
    expect(audit).toEqual([{ action: 'vault.credential.denied', result: 'DENIED' }]);
  });

  it('keeps reuse_attempted and its audit row after the request rolls back', async () => {
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await vault.redeem({ grantId }, contextFor(s));

    await expect(
      ctx.database.withRequestContext(s.operatorId, 'OPERADOR', () => vault.redeem({ grantId }, contextFor(s))),
    ).rejects.toThrow(ConflictException);

    const [row] = await ctx.db
      .select({ reuseAttempted: credentialAccessLog.reuseAttempted })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.grantJti, grantId));
    expect(row.reuseAttempted).toBe(true);

    const audit = await ctx.db
      .select({ result: auditLog.result })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'vault.credential.redeem'), eq(auditLog.result, 'DENIED')));
    expect(audit).toHaveLength(1);
  });
});

describe('vault abuse alerts (SEC-10)', () => {
  async function registerAlertsChannel(): Promise<void> {
    await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'room-alertas', name: 'alertas', type: 'GROUP', purpose: 'ALERTS', isActive: true });
  }

  function alertsFor(userId: string) {
    return ctx.db
      .select({ type: notifications.type, body: notifications.body, referenceId: notifications.referenceId })
      .from(notifications)
      .where(eq(notifications.userId, userId));
  }

  function queuedAlertMessages() {
    return ctx.db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.eventType, 'rocketchat.message.send'));
  }

  it('alerts once per operator and profile when the grant rate limit is exceeded', async () => {
    const s = await scenario();
    await registerAlertsChannel();
    for (let i = 0; i < 30; i += 1) {
      await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    }

    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toMatchObject({ status: 429 });
    await expect(vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s))).rejects.toMatchObject({ status: 429 });

    const alerts = await alertsFor(s.adminId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'vault.abuse', referenceId: s.profileId });
    expect(alerts[0].body).toContain('límite de 30 emisiones');
    expect(await queuedAlertMessages()).toHaveLength(1);

    // Otra pareja (operador, perfil) abre su propia ventana de deduplicación.
    const other = await scenario({ username: 'otro-perfil@talky.test' });
    for (let i = 0; i < 30; i += 1) {
      await vault.grant({ profileId: other.profileId, sessionId: other.sessionId }, contextFor(other));
    }
    await expect(vault.grant({ profileId: other.profileId, sessionId: other.sessionId }, contextFor(other))).rejects.toMatchObject({ status: 429 });

    expect((await alertsFor(other.adminId)).map((row) => row.referenceId)).toEqual([other.profileId]);
    expect(await queuedAlertMessages()).toHaveLength(2);
  });

  it('alerts on grant reuse and suppresses the repeat inside the window', async () => {
    const s = await scenario();
    await registerAlertsChannel();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await vault.redeem({ grantId }, contextFor(s));

    await expect(vault.redeem({ grantId }, contextFor(s))).rejects.toThrow(ConflictException);
    expect(await alertsFor(s.adminId)).toHaveLength(1);
    await expect(vault.redeem({ grantId }, contextFor(s))).rejects.toThrow(ConflictException);
    expect(await alertsFor(s.adminId)).toHaveLength(1);
    expect(await queuedAlertMessages()).toHaveLength(1);
  });

  it('records the denial and alerts when a grant is used from another station', async () => {
    const s = await scenario();
    await registerAlertsChannel();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    const foreignStation = await createDevice(ctx, { operatorId: s.otherOperatorId });

    await expect(vault.redeem({ grantId }, { userId: s.operatorId, deviceId: foreignStation.id, ip: '10.20.30.41' })).rejects.toThrow(ForbiddenException);
    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'DEVICE_MISMATCH' }]);
    expect(await alertsFor(s.adminId)).toHaveLength(1);
    // El grant no se quema: la estación legítima todavía puede canjearlo.
    await expect(vault.redeem({ grantId }, contextFor(s))).resolves.toMatchObject({ secret: SECRET });
  });

  it('records the denial and alerts when another operator redeems the grant', async () => {
    const s = await scenario();
    await registerAlertsChannel();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));

    await expect(vault.redeem({ grantId }, { userId: s.otherOperatorId, deviceId: s.deviceId, ip: '10.20.30.42' })).rejects.toThrow(ForbiddenException);
    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'OPERATOR_MISMATCH' }]);
    expect(await alertsFor(s.adminId)).toHaveLength(1);
  });

  it('keeps the in-app notification when no ALERTS channel is registered', async () => {
    const s = await scenario();
    const { grantId } = await vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s));
    await vault.redeem({ grantId }, contextFor(s));

    await expect(vault.redeem({ grantId }, contextFor(s))).rejects.toThrow(ConflictException);
    expect(await alertsFor(s.adminId)).toHaveLength(1);
    expect(await queuedAlertMessages()).toHaveLength(0);
  });
});

describe('the secret never reaches the logs', () => {
  it('emits nothing containing the credential during a full grant and redeem at debug level', async () => {
    // Criterio de entrega de PLAN.md §9.
    const debugCtx = await createTestContext('debug');
    try {
      const debugVault = new VaultService(
        new DrizzleVaultRepository(debugCtx.database),
        debugCtx.redis,
        new VaultCryptoService(debugCtx.config, debugCtx.database),
        new AuditService(debugCtx.database),
        debugCtx.database,
        new VaultAlertService(new DrizzleVaultRepository(debugCtx.database), debugCtx.database, debugCtx.redis, new OutboxService(debugCtx.database), debugCtx.logger),
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
