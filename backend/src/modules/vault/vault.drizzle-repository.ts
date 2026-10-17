import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';

import { DatabaseService } from '../../database/database.service.js';
import {
  credentialAccessLog,
  devices,
  notifications,
  profileAssignments,
  profileSessions,
  roles,
  rocketchatChannels,
  ttProfileCredentials,
  ttProfiles,
  users,
} from '../../database/schema/index.js';
import type {
  VaultAbuseAlertTargets,
  VaultAccessRecord,
  VaultAssignment,
  VaultCredentialMetadata,
  VaultCredentialRotation,
  VaultDevice,
  VaultEncryptedCredential,
  VaultLaunchingSession,
  VaultPreparedHandoffSession,
  VaultProfileUpdate,
  VaultScopeActor,
  VaultRepository,
} from './vault.repository.port.js';

@Injectable()
export class DrizzleVaultRepository implements VaultRepository {
  constructor(private readonly database: DatabaseService) {}

  async profileExistsForRotation(profileId: string, actor: VaultScopeActor): Promise<boolean> {
    const scope = actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO'
      ? undefined
      : actor.role === 'COORDINADOR'
        ? sql`exists (
            select 1 from profile_assignments assignment
            inner join crew_members member on member.user_id = assignment.operator_id
            inner join crews crew on crew.id = member.crew_id
            where assignment.profile_id = ${ttProfiles.id}
              and assignment.status in ('SCHEDULED', 'ACTIVE')
              and assignment.valid_range @> now()
              and member.valid_range @> now()
              and crew.coordinator_id = ${actor.id}
              and crew.is_active = true
          )`
        : sql`exists (
            select 1 from profile_assignments assignment
            where assignment.profile_id = ${ttProfiles.id}
              and assignment.operator_id = ${actor.id}
              and assignment.status in ('SCHEDULED', 'ACTIVE')
              and assignment.valid_range @> now()
          )`;
    const profile = await this.database.db.query.ttProfiles.findFirst({
      where: and(eq(ttProfiles.id, profileId), isNull(ttProfiles.deletedAt), scope),
    });
    return Boolean(profile && !profile.deletedAt);
  }

  async currentCredentialVersion(profileId: string): Promise<number | undefined> {
    const credential = await this.database.db.query.ttProfileCredentials.findFirst({
      where: and(eq(ttProfileCredentials.profileId, profileId), eq(ttProfileCredentials.isCurrent, true)),
    });
    return credential?.version;
  }

  async rotateCredential(rotation: VaultCredentialRotation, profile?: VaultProfileUpdate): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      if (profile) {
        const [updated] = await transaction
          .update(ttProfiles)
          .set({ loginEmail: profile.loginEmail, updatedBy: profile.updatedBy, updatedAt: rotation.rotatedAt, version: sql<number>`${ttProfiles.version} + 1` })
          .where(and(
            eq(ttProfiles.id, rotation.profileId),
            eq(ttProfiles.version, profile.version),
            isNull(ttProfiles.deletedAt),
          ))
          .returning({ id: ttProfiles.id });
        if (!updated) throw new Error('PROFILE_VERSION_CONFLICT');
      }
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

  async findApprovedDevice(deviceId: string): Promise<VaultDevice | undefined> {
    return this.database.db.query.devices.findFirst({
      where: and(
        eq(devices.id, deviceId),
        eq(devices.status, 'APPROVED'),
        isNull(devices.revokedAt),
        or(isNull(devices.certNotAfter), gt(devices.certNotAfter, new Date())),
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
    const session = await this.database.db.query.profileSessions.findFirst({
      where: and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        eq(profileSessions.operatorId, input.operatorId),
      ),
      columns: { chromeProfileDir: true },
    });
    const profile = await this.database.db.query.ttProfiles.findFirst({
      where: and(eq(ttProfiles.id, input.profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt)),
      columns: { chromeProfileDir: true },
    });
    return Boolean(profile?.chromeProfileDir && session?.chromeProfileDir === profile.chromeProfileDir);
  }

  async findLaunchingSession(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
    deviceId: string;
  }): Promise<VaultLaunchingSession | undefined> {
    return this.database.db.query.profileSessions.findFirst({
      where: and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        eq(profileSessions.operatorId, input.operatorId),
        eq(profileSessions.deviceId, input.deviceId),
        eq(profileSessions.status, 'LAUNCHING'),
      ),
      columns: { assignmentId: true, deviceId: true },
    });
  }

  async findPreparedHandoffSession(input: {
    sessionId: string;
    profileId: string;
    deviceId: string;
    notBefore: Date;
  }): Promise<VaultPreparedHandoffSession | undefined> {
    return this.database.db.query.profileSessions.findFirst({
      where: and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        eq(profileSessions.deviceId, input.deviceId),
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

  async recordCredentialAccess(record: VaultAccessRecord): Promise<void> {
    await this.database.db.insert(credentialAccessLog).values(record);
  }

  async markGrantReuse(grantId: string): Promise<string | undefined> {
    const [row] = await this.database.db
      .update(credentialAccessLog)
      .set({ reuseAttempted: true })
      .where(eq(credentialAccessLog.grantJti, grantId))
      .returning({ profileId: credentialAccessLog.profileId });
    return row?.profileId;
  }

  async findSessionPreparedByAnotherDevice(input: {
    sessionId: string;
    profileId: string;
    operatorId?: string;
    deviceId: string;
  }): Promise<{ operatorId: string } | undefined> {
    return this.database.db.query.profileSessions.findFirst({
      where: and(
        eq(profileSessions.id, input.sessionId),
        eq(profileSessions.profileId, input.profileId),
        input.operatorId ? eq(profileSessions.operatorId, input.operatorId) : undefined,
        ne(profileSessions.deviceId, input.deviceId),
        eq(profileSessions.status, 'LAUNCHING'),
      ),
      columns: { operatorId: true },
    });
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

  async abuseAlertTargets(userId: string, profileId: string): Promise<VaultAbuseAlertTargets> {
    const [actor] = await this.database.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [profile] = await this.database.db.select({ displayName: ttProfiles.displayName }).from(ttProfiles).where(eq(ttProfiles.id, profileId)).limit(1);
    const admins = await this.database.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.code, 'ADMIN'), eq(users.status, 'ACTIVE'), isNull(users.deletedAt)));
    const [channel] = await this.database.db
      .select({ id: rocketchatChannels.id })
      .from(rocketchatChannels)
      .where(and(eq(rocketchatChannels.purpose, 'ALERTS'), eq(rocketchatChannels.isActive, true)))
      .limit(1);
    return { actorEmail: actor?.email, profileName: profile?.displayName, adminIds: admins.map((admin) => admin.id), alertsChannelId: channel?.id };
  }

  async recordAbuseNotifications(adminIds: string[], notification: { body: string; profileId: string }): Promise<void> {
    if (!adminIds.length) return;
    await this.database.db.insert(notifications).values(adminIds.map((userId) => ({
      userId,
      type: 'vault.abuse',
      title: 'Alerta de abuso del vault',
      body: notification.body,
      severity: 'WARNING',
      channels: 'IN_APP',
      referenceType: 'profile',
      referenceId: notification.profileId,
    })));
  }
}
