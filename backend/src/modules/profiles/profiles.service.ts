import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { credentialAccessLog, profileAssignments, ttProfiles } from '../../database/schema/index.js';
import type { ProfileCreateInput, ProfileUpdateInput } from './profiles.schemas.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly db: DatabaseService) {}

  async list(page = 1, pageSize = 20) {
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
      .where(isNull(ttProfiles.deletedAt))
      .orderBy(asc(ttProfiles.displayName))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize);
    const [{ count }] = await this.db.db.select({ count: sql<number>`count(*)::int` }).from(ttProfiles).where(isNull(ttProfiles.deletedAt));
    const totalItems = Number(count ?? 0);
    return { data: rows, pagination: { page: safePage, pageSize: safeSize, totalItems, totalPages: Math.ceil(totalItems / safeSize) } };
  }

  async get(id: string) {
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
      .where(and(eq(ttProfiles.id, id), isNull(ttProfiles.deletedAt)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!row) throw new NotFoundException('Profile not found');
    return row;
  }

  async create(input: ProfileCreateInput, actorId: string) {
    const [row] = await this.db.db.insert(ttProfiles).values({ ...input, createdBy: actorId, updatedBy: actorId }).returning({ id: ttProfiles.id, displayName: ttProfiles.displayName, loginEmail: ttProfiles.loginEmail, version: ttProfiles.version });
    return row;
  }

  async update(id: string, input: ProfileUpdateInput, actorId: string) {
    const { version, ...changes } = input;
    const [row] = await this.db.db.update(ttProfiles).set({ ...changes, updatedBy: actorId, updatedAt: new Date(), version: version + 1 }).where(and(eq(ttProfiles.id, id), eq(ttProfiles.version, version), isNull(ttProfiles.deletedAt))).returning({ id: ttProfiles.id, version: ttProfiles.version });
    if (!row) throw new ConflictException('Profile was modified by another request');
    return row;
  }

  async deactivate(id: string, actorId: string) {
    const [row] = await this.db.db.update(ttProfiles).set({ status: 'RETIRED', deletedAt: new Date(), updatedBy: actorId, updatedAt: new Date(), version: sql`${ttProfiles.version} + 1` }).where(and(eq(ttProfiles.id, id), isNull(ttProfiles.deletedAt))).returning({ id: ttProfiles.id });
    if (!row) throw new NotFoundException('Profile not found');
    return { ok: true };
  }

  async assignedTo(operatorId: string) {
    return this.db.db.select({ id: ttProfiles.id, displayName: ttProfiles.displayName, chromeProfileDir: ttProfiles.chromeProfileDir, assignmentId: profileAssignments.id, validRange: profileAssignments.validRange }).from(profileAssignments).innerJoin(ttProfiles, eq(ttProfiles.id, profileAssignments.profileId)).where(and(eq(profileAssignments.operatorId, operatorId), eq(profileAssignments.status, 'ACTIVE'), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt), sql`${profileAssignments.validRange} @> now()`));
  }

  async accessLog(profileId: string) {
    const exists = await this.db.db.select({ id: ttProfiles.id }).from(ttProfiles).where(and(eq(ttProfiles.id, profileId), isNull(ttProfiles.deletedAt))).limit(1);
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
}
