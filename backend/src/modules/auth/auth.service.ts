import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { ShiftAccessService } from '../../common/auth/shift-access.service.js';
import {
  loginAttempts,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  users,
} from '../../database/schema/index.js';
import {
  hashPassword,
  hashToken,
  needsRehash,
  randomToken,
  signAccessToken,
  verifyPassword,
} from '../../common/auth/crypto.js';
import type { LoginInput, PasswordChangeInput, PasswordResetInput } from './auth.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { normalizeIp } from '../../common/auth/ip.js';

const LOGIN_RATE_LIMIT = 5;
const REFRESH_RATE_LIMIT = 30;
const AUTH_RATE_WINDOW_SECONDS = 900;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly shiftAccess: ShiftAccessService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, ip?: string, userAgent?: string): Promise<AuthTokens> {
    const email = input.email.trim().toLowerCase();
    const clientIp = normalizeIp(ip);
    const attempts = await this.rateLimitCounts([
      `auth:login:ip:${clientIp ?? 'unknown'}`,
      `auth:login:account:${email}`,
    ], AUTH_RATE_WINDOW_SECONDS);
    if (attempts.some((count) => count > LOGIN_RATE_LIMIT)) {
      await this.recordAttempt(email, undefined, clientIp, 'RATE_LIMITED');
      throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    const identity = await this.findIdentity(email);
    if (!identity) {
      await this.recordAttempt(email, undefined, clientIp, 'BAD_CREDENTIALS');
      throw new UnauthorizedException('Invalid credentials');
    }

    if (identity.status === 'DISABLED' || identity.deletedAt) {
      await this.recordAttempt(email, identity.id, clientIp, 'DISABLED');
      throw new UnauthorizedException('Invalid credentials');
    }
    if (identity.lockedUntil && identity.lockedUntil.getTime() > Date.now()) {
      await this.recordAttempt(email, identity.id, clientIp, 'LOCKED');
      throw new HttpException('Account temporarily locked', HttpStatus.TOO_MANY_REQUESTS);
    }

    const valid = await verifyPassword(input.password, identity.passwordHash);
    if (!valid) {
      const nextFailed = identity.failedLoginCount + 1;
      const lockedUntil = nextFailed >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
      await this.db.db
        .update(users)
        .set({ failedLoginCount: nextFailed, lockedUntil, updatedAt: new Date() })
        .where(eq(users.id, identity.id));
      await this.recordAttempt(email, identity.id, clientIp, nextFailed >= 5 ? 'LOCKED' : 'BAD_CREDENTIALS');
      throw new UnauthorizedException('Invalid credentials');
    }

    if (identity.role === 'OPERADOR' && this.config.get('REQUIRE_SHIFT_FOR_AUTH') && !(await this.shiftAccess.isWithinApprovedWindow(identity.id))) {
      await this.recordAttempt(email, identity.id, clientIp, 'OUTSIDE_SHIFT');
      throw new ForbiddenException('Operator is outside an approved shift');
    }

    // Los hashes con parametros viejos (o con el formato previo a la decision #19)
    // se reescriben aqui: es el unico momento en que existe la contrasena en claro.
    const rehashed = needsRehash(identity.passwordHash, this.config.get('PASSWORD_SCRYPT_LOG2N'))
      ? await hashPassword(input.password, this.config.get('PASSWORD_SCRYPT_LOG2N'))
      : undefined;
    await this.db.db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        ...(rehashed ? { passwordHash: rehashed } : {}),
      })
      .where(eq(users.id, identity.id));
    await this.recordAttempt(email, identity.id, clientIp, 'SUCCESS');
    return this.issueTokens(identity, clientIp, userAgent);
  }

  async refresh(rawToken: string, ip?: string, userAgent?: string): Promise<AuthTokens> {
    const clientIp = normalizeIp(ip);
    const ipCount = await this.rateLimitCounts([`auth:refresh:ip:${clientIp ?? 'unknown'}`], AUTH_RATE_WINDOW_SECONDS);
    if (ipCount[0] > REFRESH_RATE_LIMIT) throw new HttpException('Too many refresh attempts', HttpStatus.TOO_MANY_REQUESTS);
    const tokenHash = hashToken(rawToken);
    const current = await this.db.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });
    if (!current) throw new UnauthorizedException('Invalid refresh token');
    const identityKeys = [`auth:refresh:account:${current.userId}`];
    if (current.deviceId) identityKeys.push(`auth:refresh:device:${current.deviceId}`);
    const identityCounts = await this.rateLimitCounts(identityKeys, AUTH_RATE_WINDOW_SECONDS);
    if (identityCounts.some((count) => count > REFRESH_RATE_LIMIT)) throw new HttpException('Too many refresh attempts', HttpStatus.TOO_MANY_REQUESTS);
    if (current.revokedAt) {
      await this.revokeFamily(current.familyId, 'REUSE_DETECTED');
      throw new ConflictException('Refresh token reuse detected');
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const identity = await this.findIdentityById(current.userId);
    if (!identity || identity.status !== 'ACTIVE') throw new UnauthorizedException('Invalid refresh token');
    if (identity.role === 'OPERADOR' && this.config.get('REQUIRE_SHIFT_FOR_AUTH') && !(await this.shiftAccess.isWithinApprovedWindow(identity.id))) {
      throw new ForbiddenException('Operator is outside an approved shift');
    }
    const nextToken = randomToken();
    const nextId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000);
    await this.db.db.transaction(async (tx) => {
      const [rotated] = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: 'ROTATED', replacedById: nextId })
        .where(and(eq(refreshTokens.id, current.id), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
        .returning({ id: refreshTokens.id });
      if (!rotated) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' })
          .where(eq(refreshTokens.familyId, current.familyId));
        throw new ConflictException('Refresh token reuse detected');
      }
      await tx.insert(refreshTokens).values({
        id: nextId,
        userId: current.userId,
        tokenHash: hashToken(nextToken),
        familyId: current.familyId,
        expiresAt,
        ip: clientIp,
        userAgent,
        deviceId: current.deviceId,
      });
    });
    return { ...(await this.issueAccessToken(identity)), refreshToken: nextToken };
  }

  async logout(rawToken: string): Promise<void> {
    const current = await this.db.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, hashToken(rawToken)),
    });
    if (current) await this.revokeFamily(current.familyId, 'LOGOUT');
  }

  async changePassword(userId: string, input: PasswordChangeInput): Promise<void> {
    const user = await this.db.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is invalid');
    }
    await this.db.db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.newPassword, this.config.get('PASSWORD_SCRYPT_LOG2N')),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await this.revokeAllUserTokens(userId, 'ADMIN_REVOKE');
  }

  async resetPassword(userId: string, input: PasswordResetInput): Promise<void> {
    const [updated] = await this.db.db.update(users).set({ passwordHash: await hashPassword(input.newPassword, this.config.get('PASSWORD_SCRYPT_LOG2N')), mustChangePassword: true, passwordChangedAt: new Date(), updatedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.deletedAt))).returning({ id: users.id });
    if (!updated) throw new UnauthorizedException('User not found');
    await this.revokeAllUserTokens(userId, 'ADMIN_REVOKE');
  }

  async me(userId: string): Promise<AuthUser> {
    const identity = await this.findIdentityById(userId);
    if (!identity || identity.status !== 'ACTIVE') throw new UnauthorizedException('User not active');
    return this.toUser(identity);
  }

  private async findIdentity(email: string) {
    return this.db.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        fullName: users.fullName,
        roleId: users.roleId,
        role: roles.code,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        failedLoginCount: users.failedLoginCount,
        lockedUntil: users.lockedUntil,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  private async findIdentityById(id: string) {
    return this.db.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        fullName: users.fullName,
        roleId: users.roleId,
        role: roles.code,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        failedLoginCount: users.failedLoginCount,
        lockedUntil: users.lockedUntil,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  private async issueTokens(identity: NonNullable<Awaited<ReturnType<AuthService['findIdentity']>>>, ip?: string, userAgent?: string) {
    const refreshToken = randomToken();
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000);
    const user = await this.toUser(identity);
    await this.db.db.insert(refreshTokens).values({
      userId: identity.id,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt,
      ip,
      userAgent,
    });
    return { ...(await this.issueAccessToken(identity)), refreshToken, user };
  }

  private async issueAccessToken(identity: NonNullable<Awaited<ReturnType<AuthService['findIdentity']>>>) {
    const user = await this.toUser(identity);
    return {
      accessToken: signAccessToken(
        { sub: identity.id, role: user.role, permissions: user.permissions },
        this.config.get('JWT_SECRET'),
        this.config.get('JWT_ACCESS_TTL_SECONDS'),
      ),
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS'),
      user,
    };
  }

  private async toUser(identity: NonNullable<Awaited<ReturnType<AuthService['findIdentity']>>>) {
    const rows = await this.db.db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, identity.roleId));
    return {
      id: identity.id,
      email: identity.email,
      fullName: identity.fullName,
      role: identity.role,
      permissions: rows.map((row) => row.code),
      mustChangePassword: identity.mustChangePassword,
    } satisfies AuthUser;
  }

  private async recordAttempt(email: string, userId: string | undefined, ip: string | undefined, outcome: string): Promise<void> {
    await this.db.db.insert(loginAttempts).values({ emailAttempted: email, userId, ip, outcome });
    await this.audit.record({ actorType: userId ? 'USER' : 'ANONYMOUS', actorUserId: userId, action: 'auth.login', entityType: userId ? 'user' : undefined, entityId: userId, result: outcome === 'SUCCESS' ? 'SUCCESS' : 'DENIED', ip, metadata: { outcome } });
  }

  private async rateLimitCounts(keys: string[], seconds: number): Promise<number[]> {
    try {
      return await Promise.all(keys.map((key) => this.redis.incrWithExpiry(key, seconds)));
    } catch {
      throw new ServiceUnavailableException('Authentication temporarily unavailable');
    }
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.db.db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: reason }).where(eq(refreshTokens.familyId, familyId));
  }

  private async revokeAllUserTokens(userId: string, reason: string): Promise<void> {
    await this.db.db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
