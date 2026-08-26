import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { DatabaseService } from '../../database/database.service.js';
import {
  credentialAccessLog,
  devices,
  profileAssignments,
  profileSessions,
  ttProfileCredentials,
  ttProfiles,
} from '../../database/schema/index.js';
import type {
  VaultAccessRecord,
  VaultAssignment,
  VaultCredentialMetadata,
  VaultCredentialRotation,
  VaultDevice,
  VaultEncryptedCredential,
  VaultLaunchingSession,
  VaultPreparedHandoffSession,
  VaultRepository,
} from './vault.repository.port.js';

@Injectable()
export class DrizzleVaultRepository implements VaultRepository {
  constructor(private readonly database: DatabaseService) {}

  async profileExistsForRotation(profileId: string): Promise<boolean> {
    const profile = await this.database.db.query.ttProfiles.findFirst({ where: eq(ttProfiles.id, profileId) });
    return Boolean(profile && !profile.deletedAt);
  }

  async currentCredentialVersion(profileId: string): Promise<number | undefined> {
    const credential = await this.database.db.query.ttProfileCredentials.findFirst({
      where: and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)),
    });
    return credential?.version;
  }

  async rotateCredential(rotation: VaultCredentialRotation): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      await transaction
        .update(ttProfileCredentials)
        .set({ isCurrent: false })
        .where(and(eq(ttProfileCredentials.profileId, rotation.profileId), eq(ttProfileCredentials.isCurrent, true)));
      await transaction.insert(ttProfileCredentials).values({
        profileId: rotation.profileId,
        username: rotation.username,
        secretCiphertext: rotation.ciphertext,
        secretNonce: rotation.nonce,
        secretTag: rotation.tag,
        keyVersion: rotation.keyVersion,
        aadContext: rotation.aadContext,
        version: rotation.version,
        isCurrent: true,
        rotatedAt: rotation.rotatedAt,
        rotatedBy: rotation.rotatedBy,
      });
      await transaction.insert(credentialAccessLog).values({
        profileId: rotation.profileId,
        userId: rotation.rotatedBy,
        purpose: 'ADMIN_ROTATION',
        granted: true,
        occurredAt: rotation.rotatedAt,
      });
    });
  }

  async currentCredentialMetadata(profileId: string): Promise<VaultCredentialMetadata | undefined> {
    return this.database.db
      .select({
        version: ttProfileCredentials.version,
        rotatedAt: ttProfileCredentials.rotatedAt,
        rotatedBy: ttProfileCredentials.rotatedBy,
      })
      .from(ttProfileCredentials)
      .where(and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  async findApprovedDevice(tokenHash: string, deviceId?: string): Promise<VaultDevice | undefined> {
    return this.database.db.query.devices.findFirst({
      where: and(
        eq(devices.tokenHash, tokenHash),
        deviceId ? eq(devices.id, deviceId) : undefined,
        eq(devices.status, 'APPROVED'),
        sql`${devices.tokenExpiresAt} > now()`,
      ),
      columns: { id: true },
    });
  }

  async activeProfileExists(profileId: string): Promise<boolean> {
    const profile = await this.database.db.query.ttProfiles.findFirst({
      where: and(eq(ttProfiles.id, profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt)),
      columns: { id: true },
    });
    return Boolean(profile);
  }

  async sessionChromeBindingMatches(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
  }): Promise<boolean> {
    const [session, profile] = await Promise.all([
      this.database.db.query.profileSessions.findFirst({
        where: and(
          eq(profileSessions.id, input.sessionId),
          eq(profileSessions.profileId, input.profileId),
          eq(profileSessions.operatorId, input.operatorId),
        ),
        columns: { chromeProfileDir: true },
      }),
      this.database.db.query.ttProfiles.findFirst({
        where: and(eq(ttProfiles.id, input.profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt)),
        columns: { chromeProfileDir: true },
      }),
    ]);
    return Boolean(profile?.chromeProfileDir && session?.chromeProfileDir === profile.chromeProfileDir);
  }

  async findLaunchingSession(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
    deviceId?: string;
  }): Promise<VaultLaunchingSession | undefined> {
    return this.database.db.query.profileSessions.findFirst({
      where: and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        eq(profileSessions.operatorId, input.operatorId),
        input.deviceId ? eq(profileSessions.deviceId, input.deviceId) : undefined,
        eq(profileSessions.status, 'LAUNCHING'),
      ),
      columns: { assignmentId: true, deviceId: true },
    });
  }

  async findPreparedHandoffSession(input: {
    sessionId: string;
    profileId: string;
    notBefore: Date;
  }): Promise<VaultPreparedHandoffSession | undefined> {
    return this.database.db.query.profileSessions.findFirst({
      where: and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        eq(profileSessions.status, 'LAUNCHING'),
        sql`${profileSessions.startedAt} >= ${input.notBefore}`,
      ),
      columns: { operatorId: true, version: true },
    });
  }

  async findActiveAssignment(input: {
    assignmentId: string;
    profileId: string;
    operatorId: string;
  }): Promise<VaultAssignment | undefined> {
    return this.database.db
      .select({ id: profileAssignments.id })
      .from(profileAssignments)
      .where(and(
        eq(profileAssignments.id, input.assignmentId),
        eq(profileAssignments.profileId, input.profileId),
        eq(profileAssignments.operatorId, input.operatorId),
        eq(profileAssignments.status, 'ACTIVE'),
        sql`${profileAssignments.validRange} @> now()`,
      ))
      .limit(1)
      .then((rows) => rows[0]);
  }

  async claimLaunchingSession(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
    deviceId: string;
    claimedAt: Date;
  }): Promise<boolean> {
    const [claimed] = await this.database.db
      .update(profileSessions)
      .set({ deviceId: input.deviceId, lastHeartbeatAt: input.claimedAt })
      .where(and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        eq(profileSessions.operatorId, input.operatorId),
        eq(profileSessions.status, 'LAUNCHING'),
        isNull(profileSessions.deviceId),
        sql`exists (
          select 1 from tt_profiles profile
          where profile.id = ${profileSessions.profileId}
            and profile.status = 'ACTIVE'
            and profile.deleted_at is null
            and profile.chrome_profile_dir = ${profileSessions.chromeProfileDir}
        )`,
      ))
      .returning({ id: profileSessions.id });
    return Boolean(claimed);
  }

  async recordCredentialAccess(record: VaultAccessRecord): Promise<void> {
    await this.database.db.insert(credentialAccessLog).values(record);
  }

  async markGrantReuse(grantId: string): Promise<void> {
    await this.database.db
      .update(credentialAccessLog)
      .set({ reuseAttempted: true })
      .where(eq(credentialAccessLog.grantJti, grantId));
  }

  async currentCredential(profileId: string): Promise<VaultEncryptedCredential | undefined> {
    const credential = await this.database.db.query.ttProfileCredentials.findFirst({
      where: and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)),
    });
    if (!credential) return undefined;
    return {
      username: credential.username,
      ciphertext: credential.secretCiphertext,
      nonce: credential.secretNonce,
      tag: credential.secretTag,
      keyVersion: credential.keyVersion,
      aadContext: credential.aadContext,
    };
  }

  async markGrantConsumed(grantId: string, consumedAt: Date): Promise<void> {
    await this.database.db
      .update(credentialAccessLog)
      .set({ consumedAt })
      .where(eq(credentialAccessLog.grantJti, grantId));
  }
}
