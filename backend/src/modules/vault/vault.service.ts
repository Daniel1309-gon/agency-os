import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { hashToken } from '../../common/auth/crypto.js';
import { VaultCryptoService } from './vault.crypto.js';
import { VAULT_REPOSITORY, type VaultRepository } from './vault.repository.port.js';
import type { CredentialGrantInput, CredentialRedeemInput, CredentialRotationInput } from './vault.schemas.js';

interface RequestContext {
  userId: string;
  deviceToken: string;
  ip?: string;
}

@Injectable()
export class VaultService {
  constructor(
    @Inject(VAULT_REPOSITORY) private readonly repository: VaultRepository,
    private readonly redis: RedisService,
    private readonly crypto: VaultCryptoService,
    private readonly audit: AuditService,
  ) {}

  async rotate(profileId: string, input: CredentialRotationInput, actorId: string): Promise<{ version: number; rotatedAt: Date }> {
    if (!(await this.repository.profileExistsForRotation(profileId))) throw new NotFoundException('Profile not found');
    const version = (await this.repository.currentCredentialVersion(profileId) ?? 0) + 1;
    const encrypted = await this.crypto.encrypt(input.secret, profileId, 1);
    const now = new Date();
    await this.repository.rotateCredential({
      profileId,
      username: input.username,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      keyVersion: encrypted.keyVersion,
      aadContext: encrypted.aadContext,
      version,
      rotatedAt: now,
      rotatedBy: actorId,
    });
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'vault.credential.rotated', entityType: 'profile', entityId: profileId, result: 'SUCCESS', metadata: { profileId, version } });
    return { version, rotatedAt: now };
  }

  async meta(profileId: string): Promise<{ version: number; rotatedAt: Date; rotatedBy: string }> {
    const row = await this.repository.currentCredentialMetadata(profileId);
    if (!row) throw new NotFoundException('Credential metadata not found');
    return row;
  }

  async grant(input: CredentialGrantInput, context: RequestContext): Promise<{ grantId: string; expiresAt: Date }> {
    const device = await this.repository.findApprovedDevice(hashToken(context.deviceToken));
    if (!device) throw new ForbiddenException('Device is not approved');
    if (!(await this.repository.activeProfileExists(input.profileId))) {
      await this.deny(input.profileId, context, 'PROFILE_INACTIVE');
      throw new ForbiddenException('Profile is inactive');
    }
    const session = await this.repository.findLaunchingSession({
      sessionId: input.sessionId,
      profileId: input.profileId,
      operatorId: context.userId,
    });
    const assignment = session
      ? await this.repository.findActiveAssignment({
          assignmentId: session.assignmentId,
          profileId: input.profileId,
          operatorId: context.userId,
        })
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
      const claimed = await this.repository.claimLaunchingSession({
        sessionId: input.sessionId,
        profileId: input.profileId,
        operatorId: context.userId,
        deviceId: device.id,
        claimedAt: new Date(),
      });
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
    await this.repository.recordCredentialAccess({ profileId: input.profileId, userId: context.userId, deviceId: device.id, assignmentId: assignment.id, purpose: 'LOGIN_INJECTION', granted: true, grantJti: grantId, ip: context.ip });
    await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, actorDeviceId: device.id, action: 'vault.credential.issued', entityType: 'profile', entityId: input.profileId, result: 'SUCCESS', ip: context.ip, metadata: { profileId: input.profileId, assignmentId: assignment.id, sessionId: input.sessionId, deviceId: device.id, grantId } });
    return { grantId, expiresAt };
  }

  async redeem(input: CredentialRedeemInput, context: RequestContext): Promise<{ username: string; secret: string }> {
    const grantKey = `vault:grant:${input.grantId}`;
    const raw = await this.redis.get(grantKey);
    if (!raw) {
      await this.repository.markGrantReuse(input.grantId);
      await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, action: 'vault.credential.redeem', result: 'DENIED', ip: context.ip, metadata: { grantId: input.grantId, reused: true } });
      throw new ConflictException('Grant expired or already consumed');
    }
    const grant = JSON.parse(raw) as { profileId: string; sessionId: string; userId: string; deviceId: string; assignmentId: string };
    if (grant.userId !== context.userId) throw new ForbiddenException('Grant is not assigned to this operator');
    const device = await this.repository.findApprovedDevice(hashToken(context.deviceToken), grant.deviceId);
    if (!device) throw new ForbiddenException('Device is not approved');
    const session = await this.repository.findLaunchingSession({
      sessionId: grant.sessionId,
      profileId: grant.profileId,
      operatorId: context.userId,
      deviceId: grant.deviceId,
    });
    if (!session) throw new ForbiddenException('Session is not ready for credential redemption');
    const assignment = await this.repository.findActiveAssignment({
      assignmentId: grant.assignmentId,
      profileId: grant.profileId,
      operatorId: context.userId,
    });
    if (!assignment) throw new ForbiddenException('Assignment is not active');
    if (!(await this.redis.compareAndDelete(grantKey, raw))) {
      await this.repository.markGrantReuse(input.grantId);
      await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, actorDeviceId: grant.deviceId, action: 'vault.credential.redeem', result: 'DENIED', ip: context.ip, metadata: { grantId: input.grantId, reused: true } });
      throw new ConflictException('Grant expired or already consumed');
    }
    const credential = await this.repository.currentCredential(grant.profileId);
    if (!credential) throw new NotFoundException('Credential unavailable');
    const secret = await this.crypto.decrypt({ ciphertext: credential.ciphertext, nonce: credential.nonce, tag: credential.tag, keyVersion: credential.keyVersion, aadContext: credential.aadContext });
    await this.repository.markGrantConsumed(input.grantId, new Date());
    await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, actorDeviceId: device.id, action: 'vault.credential.redeemed', entityType: 'profile', entityId: grant.profileId, result: 'SUCCESS', ip: context.ip, metadata: { profileId: grant.profileId, sessionId: grant.sessionId, deviceId: device.id, grantId: input.grantId } });
    return { username: credential.username, secret };
  }

  private async deny(profileId: string, context: RequestContext, reason: string): Promise<void> {
    await this.repository.recordCredentialAccess({ profileId, userId: context.userId, purpose: 'LOGIN_INJECTION', granted: false, denyReason: reason, ip: context.ip });
    await this.audit.record({ actorType: 'DEVICE', actorUserId: context.userId, action: 'vault.credential.denied', entityType: 'profile', entityId: profileId, result: 'DENIED', ip: context.ip, metadata: { profileId, denyReason: reason } });
  }
}
