import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { credentialAccessLog, profileAssignments, profileSessions, ttProfiles } from '../../database/schema/index.js';
import type { ProfileCreateInput, ProfileUpdateInput } from './profiles.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { assignedProfileSchema, type AssignedProfile } from '@agency-os/shared';

interface AssignedProfileRow {
  assignmentId: string;
  chromeProfileDir: string;
  profileId: string;
  profileName: string;
  profileUsername: string;
  sessionErrorCode: string | null;
  sessionId: string | null;
  sessionStartedAt: Date | string | null;
  sessionStatus: string | null;
  shiftId: string | null;
  status: string;
  validFrom: Date | string;
  validTo: Date | string;
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function mapAssignedProfile(row: AssignedProfileRow): AssignedProfile {
  return assignedProfileSchema.parse({
    assignmentId: row.assignmentId,
    profileId: row.profileId,
    profileName: row.profileName,
    profileUsername: row.profileUsername,
    status: row.status,
    chromeProfileDir: row.chromeProfileDir,
    shiftId: row.shiftId,
    validFrom: isoTimestamp(row.validFrom),
    validTo: isoTimestamp(row.validTo),
    session: row.sessionId ? {
      id: row.sessionId,
      status: row.sessionStatus,
      startedAt: row.sessionStartedAt ? isoTimestamp(row.sessionStartedAt) : null,
      errorCode: row.sessionErrorCode,
    } : null,
  });
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Pick<AccessTokenClaims, 'sub' | 'role'>, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const rows = await this.db.db
      .select({
        id: ttProfiles.id,
        displayName: ttProfiles.displayName,
        loginEmail: ttProfiles.loginEmail,
        externalRef: ttProfiles.externalRef,
        country: ttProfiles.country,
        status: ttProfiles.status,
        chromeProfileDir: ttProfiles.chromeProfileDir,
        notes: ttProfiles.notes,
        version: ttProfiles.version,
        createdAt: ttProfiles.createdAt,
        updatedAt: ttProfiles.updatedAt,
      })
      .from(ttProfiles)
      .where(this.profileScope(actor))
      .orderBy(asc(ttProfiles.displayName))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize);
    const [{ count }] = await this.db.db.select({ count: sql<number>`count(*)::int` }).from(ttProfiles).where(this.profileScope(actor));
    const totalItems = Number(count ?? 0);
    return { data: rows, pagination: { page: safePage, pageSize: safeSize, totalItems, totalPages: Math.ceil(totalItems / safeSize) } };
  }

  async get(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const row = await this.db.db
      .select({
        id: ttProfiles.id,
        displayName: ttProfiles.displayName,
        loginEmail: ttProfiles.loginEmail,
        externalRef: ttProfiles.externalRef,
        country: ttProfiles.country,
        status: ttProfiles.status,
        chromeProfileDir: ttProfiles.chromeProfileDir,
        notes: ttProfiles.notes,
        version: ttProfiles.version,
        createdAt: ttProfiles.createdAt,
        updatedAt: ttProfiles.updatedAt,
      })
      .from(ttProfiles)
      .where(and(eq(ttProfiles.id, id), this.profileScope(actor)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!row) throw new NotFoundException('Profile not found');
    return row;
  }

  async create(input: ProfileCreateInput, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const [row] = await this.db.db.insert(ttProfiles).values({ ...input, createdBy: actor.sub, updatedBy: actor.sub }).returning({ id: ttProfiles.id, displayName: ttProfiles.displayName, loginEmail: ttProfiles.loginEmail, version: ttProfiles.version });
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'profile.created', entityType: 'profile', entityId: row.id, result: 'SUCCESS', metadata: { profileId: row.id, version: row.version } });
    return row;
  }

  async update(id: string, input: ProfileUpdateInput, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const { version, ...changes } = input;
    const [row] = await this.db.db.update(ttProfiles).set({ ...changes, updatedBy: actor.sub, updatedAt: new Date(), version: version + 1 }).where(and(eq(ttProfiles.id, id), eq(ttProfiles.version, version), this.profileScope(actor))).returning({ id: ttProfiles.id, version: ttProfiles.version });
    if (!row) throw new ConflictException('Profile was modified by another request');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'profile.updated', entityType: 'profile', entityId: row.id, result: 'SUCCESS', metadata: { profileId: row.id, version: row.version } });
    return row;
  }

  async deactivate(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const [row] = await this.db.db.update(ttProfiles).set({ status: 'RETIRED', deletedAt: new Date(), updatedBy: actor.sub, updatedAt: new Date(), version: sql`${ttProfiles.version} + 1` }).where(and(eq(ttProfiles.id, id), this.profileScope(actor))).returning({ id: ttProfiles.id });
    if (!row) throw new NotFoundException('Profile not found');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'profile.deactivated', entityType: 'profile', entityId: row.id, result: 'SUCCESS', metadata: { profileId: row.id } });
    return { ok: true };
  }

  async assignedTo(operatorId: string) {
    const rows = await this.db.db
      .select({
        assignmentId: profileAssignments.id,
        profileId: ttProfiles.id,
        profileName: ttProfiles.displayName,
        profileUsername: ttProfiles.loginEmail,
        status: ttProfiles.status,
        chromeProfileDir: sql<string>`coalesce(${ttProfiles.chromeProfileDir}, '')`,
        shiftId: profileAssignments.shiftId,
        validFrom: sql<string>`lower(${profileAssignments.validRange})`,
        validTo: sql<string>`upper(${profileAssignments.validRange})`,
        sessionId: profileSessions.id,
        sessionStatus: profileSessions.status,
        sessionStartedAt: profileSessions.startedAt,
        sessionErrorCode: profileSessions.errorCode,
      })
      .from(profileAssignments)
      .innerJoin(ttProfiles, eq(ttProfiles.id, profileAssignments.profileId))
      .leftJoin(profileSessions, and(
        eq(profileSessions.profileId, profileAssignments.profileId),
        eq(profileSessions.operatorId, operatorId),
        sql`${profileSessions.status} IN ('LAUNCHING', 'ACTIVE', 'ERROR')`,
      ))
      .where(and(
        eq(profileAssignments.operatorId, operatorId),
        eq(profileAssignments.status, 'ACTIVE'),
        eq(ttProfiles.status, 'ACTIVE'),
        isNull(ttProfiles.deletedAt),
        sql`${profileAssignments.validRange} @> now()`,
      ));

    return rows.map(mapAssignedProfile);
  }

  async accessLog(profileId: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const exists = await this.db.db.select({ id: ttProfiles.id }).from(ttProfiles).where(and(eq(ttProfiles.id, profileId), this.profileScope(actor))).limit(1);
    if (!exists.length) throw new NotFoundException('Profile not found');
    return this.db.db.select({
      id: credentialAccessLog.id,
      userId: credentialAccessLog.userId,
      deviceId: credentialAccessLog.deviceId,
      assignmentId: credentialAccessLog.assignmentId,
      purpose: credentialAccessLog.purpose,
      granted: credentialAccessLog.granted,
      denyReason: credentialAccessLog.denyReason,
      grantJti: credentialAccessLog.grantJti,
      consumedAt: credentialAccessLog.consumedAt,
      reuseAttempted: credentialAccessLog.reuseAttempted,
      occurredAt: credentialAccessLog.occurredAt,
    }).from(credentialAccessLog).where(eq(credentialAccessLog.profileId, profileId)).orderBy(desc(credentialAccessLog.occurredAt));
  }

  private profileScope(actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    if (actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO') return isNull(ttProfiles.deletedAt);
    if (actor.role === 'COORDINADOR') {
      return and(
        isNull(ttProfiles.deletedAt),
        or(
          eq(ttProfiles.createdBy, actor.sub),
          sql`exists (
            select 1 from profile_assignments assignment
            inner join crew_members member on member.user_id = assignment.operator_id
            inner join crews crew on crew.id = member.crew_id
            where assignment.profile_id = ${ttProfiles.id}
              and assignment.status = 'ACTIVE'
              and assignment.valid_range @> now()
              and member.valid_range @> now()
              and crew.coordinator_id = ${actor.sub}
              and crew.is_active = true
          )`,
        ),
      );
    }
    return and(
      isNull(ttProfiles.deletedAt),
      sql`exists (
        select 1 from profile_assignments assignment
        where assignment.profile_id = ${ttProfiles.id}
          and assignment.operator_id = ${actor.sub}
          and assignment.status = 'ACTIVE'
          and assignment.valid_range @> now()
      )`,
    );
  }
}
