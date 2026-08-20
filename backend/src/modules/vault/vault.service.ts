import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { hashToken } from '../../common/auth/crypto.js';
import {
  credentialAccessLog,
  devices,
  profileAssignments,
  profileSessions,
  ttProfileCredentials,
  ttProfiles,
} from '../../database/schema/index.js';
import { VaultCryptoService } from './vault.crypto.js';
import type { CredentialGrantInput, CredentialRedeemInput, CredentialRotationInput } from './vault.schemas.js';

interface RequestContext {
  userId: string;
  deviceToken: string;
  ip?: string;
}

@Injectable()
export class VaultService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly crypto: VaultCryptoService,
    private readonly audit: AuditService,
  ) {}

  async rotate(profileId: string, input: CredentialRotationInput, actorId: string): Promise<{ version: number; rotatedAt: Date }> {
    const profile = await this.db.db.query.ttProfiles.findFirst({ where: eq(ttProfiles.id, profileId) });
    if (!profile || profile.deletedAt) throw new NotFoundException('Profile not found');
    const current = await this.db.db.query.ttProfileCredentials.findFirst({
      where: and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)),
    });
    const version = (current?.version ?? 0) + 1;
    const encrypted = await this.crypto.encrypt(input.secret, profileId, 1);
    const now = new Date();
    await this.db.db.transaction(async (tx) => {
      await tx.update(ttProfileCredentials).set({ isCurrent: false }).where(and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)));
      await tx.insert(ttProfileCredentials).values({
        profileId,
        username: input.username,
        secretCiphertext: encrypted.ciphertext,
        secretNonce: encrypted.nonce,
        secretTag: encrypted.tag,
        keyVersion: encrypted.keyVersion,
        aadContext: encrypted.aadContext,
        version,
        isCurrent: true,
        rotatedAt: now,
        rotatedBy: actorId,
      });
      await tx.insert(credentialAccessLog).values({ profileId, userId: actorId, purpose: 'ADMIN_ROTATION', granted: true, occurredAt: now });
    });
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'vault.credential.rotated', entityType: 'profile', entityId: profileId, result: 'SUCCESS', metadata: { profileId, version } });
    return { version, rotatedAt: now };
  }

  async meta(profileId: string): Promise<{ version: number; rotatedAt: Date; rotatedBy: string }> {
    const row = await this.db.db
      .select({ version: ttProfileCredentials.version, rotatedAt: ttProfileCredentials.rotatedAt, rotatedBy: ttProfileCredentials.rotatedBy })
      .from(ttProfileCredentials)
      .where(and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!row) throw new NotFoundException('Credential metadata not found');
    return row;
  }

  async grant(input: CredentialGrantInput, context: RequestContext): Promise<{ grantId: string; expiresAt: Date }> {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(context.deviceToken)), eq(devices.status, 'APPROVED'), sql`${devices.tokenExpiresAt} > now()`) });
    if (!device) throw new ForbiddenException('Device is not approved');
    const profile = await this.db.db.query.ttProfiles.findFirst({ where: and(eq(ttProfiles.id, input.profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt)) });
    if (!profile) {
      await this.deny(input.profileId, context, 'PROFILE_INACTIVE');
      throw new ForbiddenException('Profile is inactive');
    }
    const session = await this.db.db.query.profileSessions.findFirst({ where: and(eq(profileSessions.id, input.sessionId), eq(profileSessions.profileId, input.profileId), eq(profileSessions.operatorId, context.userId), eq(profileSessions.status, 'LAUNCHING')) });
    const assignment = session
      ? await this.db.db
          .select({ id: profileAssignments.id })
          .from(profileAssignments)
          .where(and(
            eq(profileAssignments.id, session.assignmentId),
            eq(profileAssignments.profileId, input.profileId),
            eq(profileAssignments.operatorId, context.userId),
            eq(profileAssignments.status, 'ACTIVE'),
            sql`${profileAssignments.validRange} @> now()`,
          ))
          .limit(1)
          .then((rows) => rows[0])
      : undefined;
    if (!assignment || !session) {
      await this.deny(input.profileId, context, 'NO_ASSIGNMENT');
      throw new ForbiddenException('No active assignment for this profile');
    }
    if (session.deviceId && session.deviceId !== device.id) {
      await this.deny(input.profileId, context, 'SESSION_DEVICE_MISMATCH');
      throw new ForbiddenException('Session was claimed by another station');
    }
    if (!session.deviceId) {
      const [claimed] = await this.db.db
        .update(profileSessions)
        .set({ deviceId: device.id, lastHeartbeatAt: new Date() })
        .where(and(
          eq(profileSessions.id, input.sessionId),
          eq(profileSessions.profileId, input.profileId),
          eq(profileSessions.operatorId, context.userId),
          eq(profileSessions.status, 'LAUNCHING'),
          isNull(profileSessions.deviceId),
        ))
        .returning({ id: profileSessions.id });
      if (!claimed) {
        await this.deny(input.profileId, context, 'SESSION_DEVICE_MISMATCH');
        throw new ForbiddenException('Session was claimed by another station');
      }
    }
    const rateKey = `vault:grant-rate:${context.userId}:${input.profileId}`;
    if ((await this.redis.incrWithExpiry(rateKey, 3600)) > 30) {
      await this.deny(input.profileId, context, 'RATE_LIMITED');
      throw new HttpException('Credential grant rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    const grantId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await this.redis.setEx(`vault:grant:${grantId}`, 60, JSON.stringify({ grantId, profileId: input.profileId, sessionId: input.sessionId, userId: context.userId, deviceId: device.id, assignmentId: assignment.id }));
    await this.db.db.insert(credentialAccessLog).values({ profileId: input.profileId, userId: context.userId, deviceId: device.id, assignmentId: assignment.id, purpose: 'LOGIN_INJECTION', granted: true, grantJti: grantId, ip: context.ip });
    await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, actorDeviceId: device.id, action: 'vault.credential.issued', entityType: 'profile', entityId: input.profileId, result: 'SUCCESS', ip: context.ip, metadata: { profileId: input.profileId, assignmentId: assignment.id, sessionId: input.sessionId, deviceId: device.id, grantId } });
    return { grantId, expiresAt };
  }

  async redeem(input: CredentialRedeemInput, context: RequestContext): Promise<{ username: string; secret: string }> {
    const grantKey = `vault:grant:${input.grantId}`;
    const raw = await this.redis.get(grantKey);
    if (!raw) {
      await this.db.db.update(credentialAccessLog).set({ reuseAttempted: true }).where(eq(credentialAccessLog.grantJti, input.grantId));
      await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, action: 'vault.credential.redeem', result: 'DENIED', ip: context.ip, metadata: { grantId: input.grantId, reused: true } });
      throw new ConflictException('Grant expired or already consumed');
    }
    const grant = JSON.parse(raw) as { profileId: string; sessionId: string; userId: string; deviceId: string; assignmentId: string };
    if (grant.userId !== context.userId) throw new ForbiddenException('Grant is not assigned to this operator');
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.id, grant.deviceId), eq(devices.tokenHash, hashToken(context.deviceToken)), eq(devices.status, 'APPROVED'), sql`${devices.tokenExpiresAt} > now()`) });
    if (!device) throw new ForbiddenException('Device is not approved');
    const session = await this.db.db.query.profileSessions.findFirst({ where: and(eq(profileSessions.id, grant.sessionId), eq(profileSessions.profileId, grant.profileId), eq(profileSessions.operatorId, context.userId), eq(profileSessions.deviceId, grant.deviceId), eq(profileSessions.status, 'LAUNCHING')) });
    if (!session) throw new ForbiddenException('Session is not ready for credential redemption');
    const assignment = await this.db.db
      .select({ id: profileAssignments.id })
      .from(profileAssignments)
      .where(and(eq(profileAssignments.id, grant.assignmentId), eq(profileAssignments.profileId, grant.profileId), eq(profileAssignments.operatorId, context.userId), eq(profileAssignments.status, 'ACTIVE'), sql`${profileAssignments.validRange} @> now()`))
      .limit(1)
      .then((rows) => rows[0]);
    if (!assignment) throw new ForbiddenException('Assignment is not active');
    if (!(await this.redis.compareAndDelete(grantKey, raw))) {
      await this.db.db.update(credentialAccessLog).set({ reuseAttempted: true }).where(eq(credentialAccessLog.grantJti, input.grantId));
      await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, actorDeviceId: grant.deviceId, action: 'vault.credential.redeem', result: 'DENIED', ip: context.ip, metadata: { grantId: input.grantId, reused: true } });
      throw new ConflictException('Grant expired or already consumed');
    }
    const credential = await this.db.db.query.ttProfileCredentials.findFirst({ where: and(eq(ttProfileCredentials.profileId, grant.profileId), eq(ttProfileCredentials.isCurrent, true)) });
    if (!credential) throw new NotFoundException('Credential unavailable');
    const secret = await this.crypto.decrypt({ ciphertext: credential.secretCiphertext, nonce: credential.secretNonce, tag: credential.secretTag, keyVersion: credential.keyVersion, aadContext: credential.aadContext });
    await this.db.db.update(credentialAccessLog).set({ consumedAt: new Date() }).where(eq(credentialAccessLog.grantJti, input.grantId));
    await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, actorDeviceId: device.id, action: 'vault.credential.redeemed', entityType: 'profile', entityId: grant.profileId, result: 'SUCCESS', ip: context.ip, metadata: { profileId: grant.profileId, sessionId: grant.sessionId, deviceId: device.id, grantId: input.grantId } });
    return { username: credential.username, secret };
  }

  private async deny(profileId: string, context: RequestContext, reason: string): Promise<void> {
    await this.db.db.insert(credentialAccessLog).values({ profileId, userId: context.userId, purpose: 'LOGIN_INJECTION', granted: false, denyReason: reason, ip: context.ip });
    await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, action: 'vault.credential.denied', entityType: 'profile', entityId: profileId, result: 'DENIED', ip: context.ip, metadata: { profileId, denyReason: reason } });
  }
}
