import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes, scryptSync } from 'node:crypto';
import { AuthService } from '../../modules/auth/auth.service.js';
import { loginAttempts, refreshTokens, users } from '../../database/schema/index.js';
import { verifyAccessToken } from '../../common/auth/crypto.js';
import {
  TEST_JWT_SECRET,
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let auth: AuthService;

beforeAll(async () => {
  ctx = await createTestContext();
  auth = new AuthService(ctx.database, ctx.config, ctx.redis);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

/** Cada intento desde una IP distinta, para aislar el bloqueo por contrasena del rate limit por IP. */
const fromIp = (n: number) => `10.0.0.${n}`;

async function storedUser(id: string) {
  return ctx.db
    .select({ failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil, passwordHash: users.passwordHash, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.id, id))
    .then((rows) => rows[0]);
}

describe('AuthService.login', () => {
  it('issues an access token carrying the role and permissions of the user', async () => {
    const user = await createUser(ctx, { role: 'OPERADOR', permissions: ['payroll.read', 'vault.credential.issue'] });

    const tokens = await auth.login({ email: user.email, password: user.password }, fromIp(1), 'vitest');
    const claims = verifyAccessToken(tokens.accessToken, TEST_JWT_SECRET);

    expect(claims.sub).toBe(user.id);
    expect(claims.role).toBe('OPERADOR');
    expect(claims.permissions.sort()).toEqual(['payroll.read', 'vault.credential.issue']);
    expect(tokens.expiresIn).toBe(900);
  });

  it('never returns the password hash in the user payload', async () => {
    const user = await createUser(ctx);
    const tokens = await auth.login({ email: user.email, password: user.password }, fromIp(1));

    expect(Object.keys(tokens.user)).toEqual(['id', 'email', 'fullName', 'role', 'permissions', 'mustChangePassword']);
    expect(JSON.stringify(tokens)).not.toContain('scrypt$');
  });

  it('accepts the email in any case and with surrounding spaces', async () => {
    const user = await createUser(ctx, { email: 'carol@agency.test' });
    await expect(auth.login({ email: '  CAROL@Agency.TEST  ', password: user.password }, fromIp(1))).resolves.toBeDefined();
  });

  it('answers the same way for an unknown email and a wrong password', async () => {
    const user = await createUser(ctx);

    const unknown = await auth.login({ email: 'nadie@agency.test', password: 'x' }, fromIp(2)).catch((error) => error);
    const wrong = await auth.login({ email: user.email, password: 'incorrecta' }, fromIp(3)).catch((error) => error);

    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    // Mismo mensaje: la respuesta no revela si la cuenta existe.
    expect((unknown as Error).message).toBe((wrong as Error).message);
  });

  it('counts failures and locks the account on the fifth', async () => {
    const user = await createUser(ctx);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(auth.login({ email: user.email, password: 'mala' }, fromIp(attempt))).rejects.toThrow();
      expect((await storedUser(user.id)).failedLoginCount).toBe(attempt);
      expect((await storedUser(user.id)).lockedUntil).toBeNull();
    }

    await expect(auth.login({ email: user.email, password: 'mala' }, fromIp(5))).rejects.toThrow();
    const locked = await storedUser(user.id);
    expect(locked.failedLoginCount).toBe(5);
    expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

    // Y con la contrasena correcta tampoco entra mientras dure el bloqueo.
    await expect(auth.login({ email: user.email, password: user.password }, fromIp(6))).rejects.toMatchObject({ status: 429 });
  });

  it('clears the failure counter on a successful login', async () => {
    const user = await createUser(ctx);
    await expect(auth.login({ email: user.email, password: 'mala' }, fromIp(7))).rejects.toThrow();

    await auth.login({ email: user.email, password: user.password }, fromIp(8));
    const after = await storedUser(user.id);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rate limits by ip and email after five attempts', async () => {
    const user = await createUser(ctx);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.login({ email: user.email, password: user.password }, fromIp(9)).catch(() => undefined);
    }
    await expect(auth.login({ email: user.email, password: user.password }, fromIp(9))).rejects.toMatchObject({ status: 429 });

    // Otra IP no arrastra el castigo de la primera.
    await expect(auth.login({ email: user.email, password: user.password }, fromIp(10))).resolves.toBeDefined();
  });

  it('refuses a disabled or soft-deleted user without saying why', async () => {
    const disabled = await createUser(ctx, { status: 'DISABLED' });
    await expect(auth.login({ email: disabled.email, password: disabled.password }, fromIp(11))).rejects.toThrow(
      UnauthorizedException,
    );

    const deleted = await createUser(ctx);
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.id));
    await expect(auth.login({ email: deleted.email, password: deleted.password }, fromIp(12))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('records every attempt with its outcome, for FR-05', async () => {
    const user = await createUser(ctx);
    await auth.login({ email: user.email, password: user.password }, fromIp(13));
    await auth.login({ email: user.email, password: 'mala' }, fromIp(14)).catch(() => undefined);
    await auth.login({ email: 'nadie@agency.test', password: 'x' }, fromIp(15)).catch(() => undefined);

    const rows = await ctx.db
      .select({ email: loginAttempts.emailAttempted, outcome: loginAttempts.outcome, userId: loginAttempts.userId })
      .from(loginAttempts);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.outcome)).toEqual(['SUCCESS', 'BAD_CREDENTIALS', 'BAD_CREDENTIALS']);
    // El intento contra un email inexistente no puede inventarse un userId.
    expect(rows[2].userId).toBeNull();
  });

  it('rewrites a legacy hash on the next successful login', async () => {
    // Decision #19: el admin sembrado antes del cambio de formato tiene que
    // poder entrar, y salir de ahi con el formato nuevo.
    const user = await createUser(ctx);
    const salt = randomBytes(16);
    const digest = scryptSync('clave heredada', salt, 64, { N: 2 ** 12, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const legacy = `scrypt$10$${salt.toString('base64url')}$${digest.toString('base64url')}`;
    await ctx.db.update(users).set({ passwordHash: legacy }).where(eq(users.id, user.id));

    await expect(auth.login({ email: user.email, password: 'clave heredada' }, fromIp(16))).resolves.toBeDefined();

    const after = await storedUser(user.id);
    expect(after.passwordHash).not.toBe(legacy);
    expect(after.passwordHash.split('$')).toHaveLength(6);
  });
});

describe('AuthService refresh rotation', () => {
  it('rotates the refresh token and revokes the one it replaces', async () => {
    const user = await createUser(ctx);
    const first = await auth.login({ email: user.email, password: user.password }, fromIp(20));

    const second = await auth.refresh(first.refreshToken, fromIp(20), 'vitest');
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const rows = await ctx.db
      .select({ revokedAt: refreshTokens.revokedAt, reason: refreshTokens.revokedReason, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.reason === 'ROTATED')).toHaveLength(1);
    // La rotacion mantiene la familia, para poder revocarla entera si hay reuso.
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    const user = await createUser(ctx);
    const first = await auth.login({ email: user.email, password: user.password }, fromIp(21));
    const second = await auth.refresh(first.refreshToken);

    await expect(auth.refresh(first.refreshToken)).rejects.toThrow(ConflictException);

    // El token vigente cae con la familia: robar uno no deja al ladron dentro.
    await expect(auth.refresh(second.refreshToken)).rejects.toThrow(ConflictException);
    const live = await ctx.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it('rejects an unknown or expired refresh token', async () => {
    const user = await createUser(ctx);
    const tokens = await auth.login({ email: user.email, password: user.password }, fromIp(22));

    await expect(auth.refresh('un-token-que-no-existe')).rejects.toThrow(UnauthorizedException);

    await ctx.db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(refreshTokens.userId, user.id));
    await expect(auth.refresh(tokens.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('stops refreshing once the user is no longer active', async () => {
    const user = await createUser(ctx);
    const tokens = await auth.login({ email: user.email, password: user.password }, fromIp(23));
    await ctx.db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, user.id));

    await expect(auth.refresh(tokens.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('revokes the family on logout', async () => {
    const user = await createUser(ctx);
    const tokens = await auth.login({ email: user.email, password: user.password }, fromIp(24));

    await auth.logout(tokens.refreshToken);
    await expect(auth.refresh(tokens.refreshToken)).rejects.toThrow(ConflictException);
  });
});

describe('AuthService password changes', () => {
  it('changes the password and cuts every live session', async () => {
    const user = await createUser(ctx, { mustChangePassword: true });
    const tokens = await auth.login({ email: user.email, password: user.password }, fromIp(30));

    await auth.changePassword(user.id, { currentPassword: user.password, newPassword: 'una-contrasena-nueva-larga' });

    await expect(auth.refresh(tokens.refreshToken)).rejects.toThrow(ConflictException);
    await expect(auth.login({ email: user.email, password: user.password }, fromIp(31))).rejects.toThrow(UnauthorizedException);
    const after = await auth.login({ email: user.email, password: 'una-contrasena-nueva-larga' }, fromIp(32));
    expect(after.user.mustChangePassword).toBe(false);
  });

  it('refuses a change that does not prove the current password', async () => {
    const user = await createUser(ctx);
    await expect(
      auth.changePassword(user.id, { currentPassword: 'la-que-no-es', newPassword: 'otra-contrasena-larga' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('forces a password change after an admin reset', async () => {
    const user = await createUser(ctx);
    await auth.resetPassword(user.id, { userId: user.id, newPassword: 'reseteada-por-el-admin' });

    const tokens = await auth.login({ email: user.email, password: 'reseteada-por-el-admin' }, fromIp(33));
    expect(tokens.user.mustChangePassword).toBe(true);
  });
});
