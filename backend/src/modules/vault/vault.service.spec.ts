import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VaultService } from './vault.service.js';
import type { VaultCryptoService } from './vault.crypto.js';
import { createFakeDatabase, type FakeDatabase } from '../../test/support/fake-db.js';
import { hashToken } from '../../common/auth/crypto.js';
import type { RedisService } from '../../common/redis/redis.service.js';
import type { AuditService } from '../../common/audit/audit.service.js';
import { DrizzleVaultRepository } from './vault.drizzle-repository.js';

const OPERATOR = '11111111-1111-1111-1111-111111111111';
const OTHER_OPERATOR = '99999999-9999-9999-9999-999999999999';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const SESSION = '33333333-3333-3333-3333-333333333333';
const ASSIGNMENT = '44444444-4444-4444-4444-444444444444';
const DEVICE = '55555555-5555-5555-5555-555555555555';
const DEVICE_TOKEN = 'device-token-de-pruebas';

interface Harness {
  service: VaultService;
  db: FakeDatabase;
  store: Map<string, string>;
  ttls: Map<string, number>;
  counters: Map<string, number>;
  decrypt: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const db = createFakeDatabase();
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const counters = new Map<string, number>();

  const redis = {
    async setEx(key: string, seconds: number, value: string) {
      store.set(key, value);
      ttls.set(key, seconds);
    },
    async getDel(key: string) {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async compareAndDelete(key: string, expected: string) {
      if (store.get(key) !== expected) return false;
      store.delete(key);
      return true;
    },
    async incrWithExpiry(key: string) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
  } as unknown as RedisService;

  const decrypt = vi.fn(async () => 'la-contrasena-del-perfil');
  const crypto = {
    decrypt,
    encrypt: vi.fn(async () => ({
      ciphertext: Buffer.from('c'),
      nonce: Buffer.from('n'),
      tag: Buffer.from('t'),
      keyVersion: 1,
      aadContext: `${PROFILE}:1`,
    })),
  } as unknown as VaultCryptoService;

  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  return { service: new VaultService(new DrizzleVaultRepository(db.service), redis, crypto, audit), db, store, ttls, counters, decrypt };
}

/** Estado en el que un grant debe salir bien: dispositivo, perfil, sesion y asignacion vigentes. */
function happyPath(db: FakeDatabase): void {
  db.stub('devices').findFirst({ id: DEVICE, tokenHash: hashToken(DEVICE_TOKEN), status: 'APPROVED', assignedOperatorId: OPERATOR });
  db.stub('tt_profiles').findFirst({ id: PROFILE, status: 'ACTIVE', deletedAt: null });
  db.stub('profile_sessions').findFirst({ id: SESSION, profileId: PROFILE, operatorId: OPERATOR, deviceId: DEVICE, status: 'LAUNCHING', assignmentId: ASSIGNMENT });
  db.stub('profile_assignments').select([{ id: ASSIGNMENT }]);
}

const context = { userId: OPERATOR, deviceToken: DEVICE_TOKEN, ip: '10.0.0.5' };
const grantInput = { profileId: PROFILE, sessionId: SESSION };

describe('VaultService.grant', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('issues a one-use grant that expires within 60 seconds', async () => {
    // Decision #18: la ventana en que la credencial existe fuera del vault es
    // la del formulario de login, no la de una sesion.
    happyPath(h.db);
    const before = Date.now();
    const grant = await h.service.grant(grantInput, context);
    const after = Date.now();

    expect(grant.grantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(grant.expiresAt.getTime()).toBeGreaterThan(before);
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(after + 60_000);
    // Y la caducidad tiene que estar en Redis, no solo en la respuesta: si solo
    // estuviera en la respuesta, el ticket sobreviviria a su propio vencimiento.
    expect(h.ttls.get(`vault:grant:${grant.grantId}`)).toBeLessThanOrEqual(60);
    // El ticket vive en Redis; la respuesta no lleva secreto.
    expect(JSON.stringify(grant)).not.toContain('contrasena');
    expect(h.store.has(`vault:grant:${grant.grantId}`)).toBe(true);
  });

  it('records the grant in the credential access log without the secret', async () => {
    happyPath(h.db);
    const grant = await h.service.grant(grantInput, context);
    const [logged] = h.db.inserted('credential_access_log') as Array<Record<string, unknown>>;

    expect(logged).toMatchObject({
      profileId: PROFILE,
      userId: OPERATOR,
      deviceId: DEVICE,
      assignmentId: ASSIGNMENT,
      purpose: 'LOGIN_INJECTION',
      granted: true,
      grantJti: grant.grantId,
      ip: '10.0.0.5',
    });
    expect(Object.keys(logged)).not.toContain('secret');
  });

  it('accepts an approved office station even when it was previously associated with another operator', async () => {
    happyPath(h.db);
    h.db.stub('devices').findFirst({ id: DEVICE, status: 'APPROVED', assignedOperatorId: OTHER_OPERATOR });

    await expect(h.service.grant(grantInput, context)).resolves.toMatchObject({ grantId: expect.any(String) });
  });

  it('claims an unbound web-prepared session for the station requesting the grant', async () => {
    happyPath(h.db);
    h.db.stub('profile_sessions')
      .findFirst({ id: SESSION, profileId: PROFILE, operatorId: OPERATOR, deviceId: null, status: 'LAUNCHING', assignmentId: ASSIGNMENT })
      .returning([{ id: SESSION, deviceId: DEVICE }]);

    await h.service.grant(grantInput, context);

    expect(h.db.updated('profile_sessions')[0]).toMatchObject({ deviceId: DEVICE });
  });

  it('denies an inactive profile and records PROFILE_INACTIVE', async () => {
    happyPath(h.db);
    h.db.stub('tt_profiles').findFirst(undefined);

    await expect(h.service.grant(grantInput, context)).rejects.toThrow(ForbiddenException);
    expect(h.db.inserted('credential_access_log')[0]).toMatchObject({ granted: false, denyReason: 'PROFILE_INACTIVE' });
  });

  it('denies an operator with no live session and records NO_ASSIGNMENT', async () => {
    happyPath(h.db);
    h.db.stub('profile_sessions').findFirst(undefined);

    await expect(h.service.grant(grantInput, context)).rejects.toThrow(ForbiddenException);
    expect(h.db.inserted('credential_access_log')[0]).toMatchObject({ granted: false, denyReason: 'NO_ASSIGNMENT' });
    expect(h.store.size).toBe(0);
  });

  it('denies when the session exists but its assignment is no longer current', async () => {
    happyPath(h.db);
    h.db.stub('profile_assignments').select([]);

    await expect(h.service.grant(grantInput, context)).rejects.toThrow(ForbiddenException);
    expect(h.db.inserted('credential_access_log')[0]).toMatchObject({ granted: false, denyReason: 'NO_ASSIGNMENT' });
  });

  it('rate limits at 30 grants per hour for the same operator and profile', async () => {
    happyPath(h.db);
    for (let i = 0; i < 30; i += 1) {
      await h.service.grant(grantInput, context);
    }

    await expect(h.service.grant(grantInput, context)).rejects.toMatchObject({ status: 429 });
    const denied = (h.db.inserted('credential_access_log') as Array<Record<string, unknown>>).filter((row) => row.granted === false);
    expect(denied[0]).toMatchObject({ denyReason: 'RATE_LIMITED' });
  });
});

describe('VaultService.redeem', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    happyPath(h.db);
    h.db.stub('tt_profile_credentials').findFirst({
      profileId: PROFILE,
      username: 'perfil@talky.test',
      secretCiphertext: Buffer.from('c'),
      secretNonce: Buffer.from('n'),
      secretTag: Buffer.from('t'),
      keyVersion: 1,
      aadContext: `${PROFILE}:1`,
      isCurrent: true,
    });
  });

  it('returns the credential once and marks the ticket consumed', async () => {
    const { grantId } = await h.service.grant(grantInput, context);
    const credential = await h.service.redeem({ grantId }, context);

    expect(credential).toEqual({ username: 'perfil@talky.test', secret: 'la-contrasena-del-perfil' });
    expect(h.db.updated('credential_access_log').at(-1)).toMatchObject({ consumedAt: expect.any(Date) });
  });

  it('rejects the second redeem of the same grant and flags reuse', async () => {
    // Criterio de entrega de PLAN.md §9: canjear dos veces el mismo grantId.
    const { grantId } = await h.service.grant(grantInput, context);
    await h.service.redeem({ grantId }, context);

    await expect(h.service.redeem({ grantId }, context)).rejects.toThrow(ConflictException);
    expect(h.db.updated('credential_access_log').at(-1)).toMatchObject({ reuseAttempted: true });
  });

  it('rejects an unknown or expired grant id as reuse', async () => {
    await expect(h.service.redeem({ grantId: '66666666-6666-6666-6666-666666666666' }, context)).rejects.toThrow(
      ConflictException,
    );
    expect(h.decrypt).not.toHaveBeenCalled();
  });

  it('rejects a grant redeemed by a different operator', async () => {
    const { grantId } = await h.service.grant(grantInput, context);

    await expect(h.service.redeem({ grantId }, { ...context, userId: OTHER_OPERATOR })).rejects.toThrow(ForbiddenException);
    expect(h.decrypt).not.toHaveBeenCalled();
  });

  it('rejects a grant redeemed from a different device', async () => {
    const { grantId } = await h.service.grant(grantInput, context);
    h.db.stub('devices').findFirst(undefined);

    await expect(h.service.redeem({ grantId }, { ...context, deviceToken: 'otro-token' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(h.decrypt).not.toHaveBeenCalled();
  });

  it('fails cleanly when the profile has no current credential', async () => {
    const { grantId } = await h.service.grant(grantInput, context);
    h.db.stub('tt_profile_credentials').findFirst(undefined);

    await expect(h.service.redeem({ grantId }, context)).rejects.toThrow(NotFoundException);
  });

  it('does not burn a grant when an unauthorized operator tries to redeem it', async () => {
    // El binding se valida antes del consumo: un atacante no puede inutilizar
    // el login legitimo quemando un grant que no le pertenece.
    const { grantId } = await h.service.grant(grantInput, context);
    await expect(h.service.redeem({ grantId }, { ...context, userId: OTHER_OPERATOR })).rejects.toThrow(ForbiddenException);

    expect(h.store.has(`vault:grant:${grantId}`)).toBe(true);
    await expect(h.service.redeem({ grantId }, context)).resolves.toEqual({
      username: 'perfil@talky.test',
      secret: 'la-contrasena-del-perfil',
    });
  });
});
