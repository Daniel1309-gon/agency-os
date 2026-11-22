import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { OutboxService } from '../../modules/outbox/outbox.service.js';
import { CafeteriaService } from '../../modules/cafeteria/cafeteria.service.js';
import { IcebreakersService } from '../../modules/icebreakers/icebreakers.service.js';
import type { AiEngineClient } from '../../modules/icebreakers/ai-engine.client.js';
import { VaultAlertService } from '../../modules/vault/vault-alerts.service.js';
import { VaultCryptoService } from '../../modules/vault/vault.crypto.js';
import { DrizzleVaultRepository } from '../../modules/vault/vault.drizzle-repository.js';
import { VaultService } from '../../modules/vault/vault.service.js';
import {
  auditLog,
  credentialAccessLog,
  crewMembers,
  crews,
  icebreakerRules,
  icebreakers,
  notifications,
  operatorAccountEntries,
  profileAssignments,
  profileSessions,
  ttProfileCredentials,
  ttProfiles,
} from '../../database/schema/index.js';
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
 * Production-role RLS write sweep: runs every non-ADMIN service write targeting
 * a FORCE ROW LEVEL SECURITY table through a real non-superuser login role that
 * inherits `agency_app`. Because both `pool` and `independentPool` authenticate
 * as that login role, RLS is enforced on both `withRequestContext` and
 * `independentTransaction` — matching production exactly.
 */

const APP_LOGIN_ROLE = 'agency_app_rls_sweep_test';
const APP_LOGIN_PASS = 'agency_app_rls_sweep_pass_2026';

let ctx: TestContext;
let appDb: DatabaseService;
let cafeteria: CafeteriaService;
let vault: VaultService;
let icebreakersService: IcebreakersService;

function appConnectionUrl(adminUrl: string): string {
  const parsed = new URL(adminUrl);
  parsed.username = APP_LOGIN_ROLE;
  parsed.password = APP_LOGIN_PASS;
  return parsed.toString();
}

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_LOGIN_ROLE}') THEN
        CREATE ROLE ${APP_LOGIN_ROLE} LOGIN PASSWORD '${APP_LOGIN_PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
      ALTER ROLE ${APP_LOGIN_ROLE} INHERIT;
      GRANT agency_app TO ${APP_LOGIN_ROLE};
    END
    $$;
  `);

  const appUrl = appConnectionUrl(ctx.config.get('DATABASE_URL'));
  const appConfig = {
    get: (key: string) => {
      if (key === 'DATABASE_URL' || key === 'DATABASE_APP_URL') return appUrl;
      if (key === 'DATABASE_RUNTIME_ROLE') return 'app';
      return ctx.config.get(key as never);
    },
  } as unknown as ConfigService;
  const logger = new LoggerService('silent');
  appDb = new DatabaseService(appConfig, logger);
  await appDb.onModuleInit();

  // Prove the connection is non-superuser and inherits agency_app on BOTH pools.
  const identity = await appDb.db.execute(sql`
    SELECT current_user AS role_name,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
           pg_has_role(current_user, 'agency_app', 'MEMBER') AS has_app
  `);
  expect(identity.rows[0]).toEqual({ role_name: APP_LOGIN_ROLE, is_super: false, has_app: true });

  const audit = new AuditService(appDb);
  const vaultRepo = new DrizzleVaultRepository(appDb);
  const vaultCrypto = new VaultCryptoService(appConfig, appDb);
  const vaultAlerts = new VaultAlertService(vaultRepo, appDb, ctx.redis, new OutboxService(appDb), logger);

  cafeteria = new CafeteriaService(appDb);
  vault = new VaultService(vaultRepo, ctx.redis, vaultCrypto, audit, appDb, vaultAlerts);
  const noAiEngine = { evaluate: async () => undefined } as unknown as AiEngineClient;
  icebreakersService = new IcebreakersService(appDb, noAiEngine, audit);
});

afterAll(async () => {
  await appDb?.onModuleDestroy();
  await ctx?.pool.query(`DROP ROLE IF EXISTS ${APP_LOGIN_ROLE}`).catch(() => undefined);
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

describe('CafeteriaService writes under production agency_app role', () => {
  async function readyOrder(actorId: string) {
    const adminCafeteria = new CafeteriaService(ctx.database);
    const operator = await createUser(ctx);
    const product = await adminCafeteria.createProduct({
      sku: `SWEEP-${operator.id.slice(0, 6)}`,
      name: 'Cafe',
      category: 'bebidas',
      priceCop: 8500,
      pickupDeadlineMinutes: 20,
    });
    const order = await adminCafeteria.createOrder({ items: [{ productId: product.id, quantity: 2 }] }, operator.id, `sweep-${operator.id}`);
    for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
      await adminCafeteria.updateStatus(order.id, { status }, actorId);
    }
    return { operatorId: operator.id, orderId: order.id };
  }

  it('lets DIRECTOR_OPERATIVO mark an order DELIVERED and insert its exact debit under RLS (S2)', async () => {
    const director = await createUser(ctx, { role: 'DIRECTOR_OPERATIVO' });
    const { operatorId, orderId } = await readyOrder(director.id);

    await appDb.withRequestContext(director.id, 'DIRECTOR_OPERATIVO', async () => {
      await expect(cafeteria.updateStatus(orderId, { status: 'DELIVERED' }, director.id)).resolves.toMatchObject({
        status: 'DELIVERED',
        totalCop: '17000.00',
      });
    });

    const entries = await ctx.db.select().from(operatorAccountEntries).where(eq(operatorAccountEntries.operatorId, operatorId));
    expect(entries).toMatchObject([{ entryType: 'DEBIT_CAFETERIA', amountCop: '-17000.00', referenceId: orderId }]);
  });

  it('still refuses DIRECTOR_OPERATIVO writing an arbitrary or mismatched debit directly under RLS (S2)', async () => {
    const director = await createUser(ctx, { role: 'DIRECTOR_OPERATIVO' });
    const { operatorId, orderId } = await readyOrder(director.id);

    await expect(
      appDb.withRequestContext(director.id, 'DIRECTOR_OPERATIVO', () =>
        appDb.db.insert(operatorAccountEntries).values({
          operatorId,
          entryType: 'DEBIT_CAFETERIA',
          amountCop: '-1.00',
          referenceType: 'cafeteria_order',
          referenceId: orderId,
          businessDate: '2026-08-04',
          createdBy: director.id,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

describe('VaultService writes under production agency_app role', () => {
  async function vaultScenario() {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const director = await createUser(ctx, { role: 'DIRECTOR_OPERATIVO' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const operator = await createUser(ctx, { role: 'OPERADOR' });
    const otherOperator = await createUser(ctx, { role: 'OPERADOR' });
    const profile = await createProfile(ctx, { chromeProfileDir: 'Profile 7' });
    const otherProfile = await createProfile(ctx, { chromeProfileDir: 'Profile 8' });
    const device = await createDevice(ctx, { operatorId: operator.id });

    const [crew] = await ctx.db.insert(crews).values({ name: 'Sweep Crew', coordinatorId: coordinator.id }).returning({ id: crews.id });
    await ctx.db.insert(crewMembers).values({
      crewId: crew.id,
      userId: operator.id,
      validRange: halfOpen(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)),
    });
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
        assignmentId: assignment.id,
        profileId: profile.id,
        operatorId: operator.id,
        deviceId: device.id,
        chromeProfileDir: 'Profile 7',
        status: 'LAUNCHING',
      })
      .returning({ id: profileSessions.id });

    // Seed an initial credential as ADMIN (using superuser ctx so scenario setup is independent).
    const adminVault = new VaultService(
      new DrizzleVaultRepository(ctx.database),
      ctx.redis,
      new VaultCryptoService(ctx.config, ctx.database),
      new AuditService(ctx.database),
      ctx.database,
      new VaultAlertService(new DrizzleVaultRepository(ctx.database), ctx.database, ctx.redis, new OutboxService(ctx.database), ctx.logger),
    );
    const [profileRow] = await ctx.db.select({ version: ttProfiles.version }).from(ttProfiles).where(eq(ttProfiles.id, profile.id));
    const initialVersion = profileRow!.version;
    await adminVault.rotate(profile.id, { username: 'model@tt.test', secret: 'initial-secret-123', profileVersion: initialVersion }, { id: admin.id, role: 'ADMIN' });

    return { admin, director, coordinator, operator, otherOperator, profile, otherProfile, device, assignment, session, profileVersionAfterSeed: initialVersion + 1 };
  }

  it('lets DIRECTOR_OPERATIVO and in-crew COORDINADOR rotate credentials, while refusing out-of-scope COORDINADOR (S1)', async () => {
    const s = await vaultScenario();

    await appDb.withRequestContext(s.coordinator.id, 'COORDINADOR', async () => {
      await expect(
        vault.rotate(s.profile.id, { username: 'coord@tt.test', secret: 'coord-secret-123', profileVersion: s.profileVersionAfterSeed }, { id: s.coordinator.id, role: 'COORDINADOR' }),
      ).resolves.toMatchObject({ version: 2 });

      await expect(
        vault.rotate(s.otherProfile.id, { username: 'other@tt.test', secret: 'other-secret-123', profileVersion: 1 }, { id: s.coordinator.id, role: 'COORDINADOR' }),
      ).rejects.toThrow(NotFoundException);
    });

    await appDb.withRequestContext(s.director.id, 'DIRECTOR_OPERATIVO', async () => {
      await expect(
        vault.rotate(s.profile.id, { username: 'dir@tt.test', secret: 'dir-secret-123', profileVersion: s.profileVersionAfterSeed + 1 }, { id: s.director.id, role: 'DIRECTOR_OPERATIVO' }),
      ).resolves.toMatchObject({ version: 3 });
    });

    const current = await ctx.db
      .select({ version: ttProfileCredentials.version, username: ttProfileCredentials.username })
      .from(ttProfileCredentials)
      .where(and(eq(ttProfileCredentials.profileId, s.profile.id), eq(ttProfileCredentials.isCurrent, true)));
    expect(current).toEqual([{ version: 3, username: 'dir@tt.test' }]);
  });

  it('lets OPERADOR grant, redeem, handoff, and persist independent denial rows under agency_app (S1)', async () => {
    const s = await vaultScenario();
    const reqCtx = { userId: s.operator.id, deviceId: s.device.id, ip: '10.0.0.10' };

    const redeemed = await appDb.withRequestContext(s.operator.id, 'OPERADOR', async () => {
      const { grantId } = await vault.grant({ profileId: s.profile.id, sessionId: s.session.id }, reqCtx);
      return vault.redeem({ grantId }, reqCtx);
    });
    expect(redeemed).toEqual({ username: 'model@tt.test', secret: 'initial-secret-123' });

    // Station handoff runs withRequestContext(prepared.operatorId, 'OPERADOR') internally under agency_app.
    const handedOff = await vault.handoff(
      { profileId: s.profile.id, sessionId: s.session.id },
      { deviceId: s.device.id, ip: '10.0.0.10' },
    );
    expect(handedOff).toMatchObject({ username: 'model@tt.test', secret: 'initial-secret-123' });

    // Denial path (NO_ASSIGNMENT) uses independentTransaction under agency_app and survives outer rollback.
    await expect(
      appDb.withRequestContext(s.operator.id, 'OPERADOR', () =>
        vault.grant({ profileId: s.otherProfile.id, sessionId: s.session.id }, reqCtx),
      ),
    ).rejects.toThrow(ForbiddenException);

    const denials = await ctx.db
      .select({ denyReason: credentialAccessLog.denyReason })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.granted, false));
    expect(denials).toEqual([{ denyReason: 'NO_ASSIGNMENT' }]);
  });

  it('records reuse_attempted and fires GRANT_REUSE alert under agency_app even after the operator assignment ends (S3)', async () => {
    const s = await vaultScenario();
    const reqCtx = { userId: s.operator.id, deviceId: s.device.id, ip: '10.0.0.11' };

    const { grantId } = await appDb.withRequestContext(s.operator.id, 'OPERADOR', () =>
      vault.grant({ profileId: s.profile.id, sessionId: s.session.id }, reqCtx),
    );
    await appDb.withRequestContext(s.operator.id, 'OPERADOR', () => vault.redeem({ grantId }, reqCtx));

    // End the assignment before the replay attempt so app_can_access_profile(profile_id) becomes FALSE.
    await ctx.db
      .update(profileAssignments)
      .set({ validRange: halfOpen(new Date(Date.now() - 7_200_000), new Date(Date.now() - 1_000)) })
      .where(eq(profileAssignments.id, s.assignment.id));

    await expect(
      appDb.withRequestContext(s.operator.id, 'OPERADOR', () => vault.redeem({ grantId }, reqCtx)),
    ).rejects.toThrow(ConflictException);

    const [access] = await ctx.db
      .select({ reuseAttempted: credentialAccessLog.reuseAttempted })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.grantJti, grantId));
    expect(access?.reuseAttempted).toBe(true);

    const adminAlerts = await ctx.db
      .select({ type: notifications.type })
      .from(notifications)
      .where(and(eq(notifications.userId, s.admin.id), eq(notifications.type, 'vault.abuse')));
    expect(adminAlerts).toHaveLength(1);
  });

  it('records reuse_attempted and fires GRANT_REUSE alert under agency_app when a different operator replays a consumed grant, while still blocking direct operator reads (S3)', async () => {
    const s = await vaultScenario();
    const ownerCtx = { userId: s.operator.id, deviceId: s.device.id, ip: '10.0.0.12' };
    const attackerCtx = { userId: s.otherOperator.id, deviceId: s.device.id, ip: '10.0.0.13' };

    const { grantId } = await appDb.withRequestContext(s.operator.id, 'OPERADOR', () =>
      vault.grant({ profileId: s.profile.id, sessionId: s.session.id }, ownerCtx),
    );
    await appDb.withRequestContext(s.operator.id, 'OPERADOR', () => vault.redeem({ grantId }, ownerCtx));

    await expect(
      appDb.withRequestContext(s.otherOperator.id, 'OPERADOR', () => vault.redeem({ grantId }, attackerCtx)),
    ).rejects.toThrow(ConflictException);

    const [access] = await ctx.db
      .select({ reuseAttempted: credentialAccessLog.reuseAttempted })
      .from(credentialAccessLog)
      .where(eq(credentialAccessLog.grantJti, grantId));
    expect(access?.reuseAttempted).toBe(true);

    const adminAlerts = await ctx.db
      .select({ type: notifications.type })
      .from(notifications)
      .where(and(eq(notifications.userId, s.admin.id), eq(notifications.type, 'vault.abuse')));
    expect(adminAlerts).toHaveLength(1);

    const audits = await ctx.db
      .select({ actorUserId: auditLog.actorUserId, action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.action, 'vault.credential.redeem'));
    expect(audits).toEqual([{ actorUserId: s.otherOperator.id, action: 'vault.credential.redeem' }]);

    // RLS negative proof: the other operator still cannot SELECT or UPDATE the row directly.
    const visibleToAttacker = await appDb.withRequestContext(s.otherOperator.id, 'OPERADOR', () =>
      appDb.db.select({ id: credentialAccessLog.id }).from(credentialAccessLog).where(eq(credentialAccessLog.grantJti, grantId)),
    );
    expect(visibleToAttacker).toEqual([]);
  });
});

describe('IcebreakersService writes under production agency_app role', () => {
  it('lets OPERADOR create/update/evaluate/publish and lets in-crew COORDINADOR and DIRECTOR_OPERATIVO review under agency_app (S1)', async () => {
    const director = await createUser(ctx, { role: 'DIRECTOR_OPERATIVO' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const operator = await createUser(ctx, { role: 'OPERADOR' });
    const [crew] = await ctx.db.insert(crews).values({ name: 'IB Crew', coordinatorId: coordinator.id }).returning({ id: crews.id });
    await ctx.db.insert(crewMembers).values({
      crewId: crew.id,
      userId: operator.id,
      validRange: halfOpen(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)),
    });
    await ctx.db.insert(icebreakerRules).values({ code: 'NO_URL', name: 'No URL', kind: 'KEYWORD', pattern: 'http://', severity: 'BLOCKING' });

    const opActor = { sub: operator.id, role: 'OPERADOR' as const };
    const created = await appDb.withRequestContext(operator.id, 'OPERADOR', async () => {
      const item = await icebreakersService.create({ text: 'Visit http://bad.test' }, opActor);
      await icebreakersService.update(item.id, { text: 'Check http://bad.test', version: item.version }, opActor);
      const evaluated = await icebreakersService.evaluate(item.id, opActor);
      expect(evaluated.status).toBe('BLOCKED');
      return item;
    });

    // In-crew COORDINADOR overrides to APPROVED under agency_app.
    await appDb.withRequestContext(coordinator.id, 'COORDINADOR', async () => {
      await expect(
        icebreakersService.review(created.id, { verdict: 'OVERRIDDEN_ALLOW', reason: 'false positive' }, { sub: coordinator.id, role: 'COORDINADOR' }),
      ).resolves.toMatchObject({ verdict: 'OVERRIDDEN_ALLOW' });
    });

    // OPERADOR publishes the approved icebreaker under agency_app.
    await appDb.withRequestContext(operator.id, 'OPERADOR', async () => {
      await expect(icebreakersService.publish(created.id, opActor)).resolves.toMatchObject({ status: 'PUBLISHED' });
    });

    // DIRECTOR_OPERATIVO can also review under agency_app.
    await appDb.withRequestContext(director.id, 'DIRECTOR_OPERATIVO', async () => {
      await expect(
        icebreakersService.review(created.id, { verdict: 'TRUE_POSITIVE', reason: 'audit note' }, { sub: director.id, role: 'DIRECTOR_OPERATIVO' }),
      ).resolves.toMatchObject({ verdict: 'TRUE_POSITIVE' });
    });

    const [row] = await ctx.db.select({ status: icebreakers.status }).from(icebreakers).where(eq(icebreakers.id, created.id));
    expect(row?.status).toBe('PUBLISHED');
  });
});
