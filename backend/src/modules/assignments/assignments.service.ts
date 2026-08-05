import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, isPgError } from '../../database/pg-error.js';
import { hashToken } from '../../common/auth/crypto.js';
import { devices, profileAssignments, profileSessions, shifts, ttProfiles, users } from '../../database/schema/index.js';
import type { AssignmentCreateInput, SessionCreateInput, SessionPatchInput } from './assignments.schemas.js';

function range(from: string, to: string): string {
  if (new Date(from).getTime() >= new Date(to).getTime()) throw new ConflictException('validTo must be after validFrom');
  return `[${from},${to})`;
}

@Injectable()
export class AssignmentsService {
  constructor(private readonly db: DatabaseService) {}

  async create(input: AssignmentCreateInput, assignedBy: string) {
    const [profile] = await this.db.db.select({ id: ttProfiles.id }).from(ttProfiles).where(and(eq(ttProfiles.id, input.profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt))).limit(1);
    const [operator] = await this.db.db.select({ id: users.id }).from(users).where(and(eq(users.id, input.operatorId), eq(users.status, 'ACTIVE'), isNull(users.deletedAt))).limit(1);
    if (!profile || !operator) throw new NotFoundException('Profile or operator not found');
    try {
      const [row] = await this.db.db.insert(profileAssignments).values({ profileId: input.profileId, operatorId: input.operatorId, shiftId: input.shiftId, validRange: range(input.validFrom, input.validTo), status: 'ACTIVE', assignedBy }).returning({ id: profileAssignments.id, profileId: profileAssignments.profileId, operatorId: profileAssignments.operatorId, validRange: profileAssignments.validRange });
      return row;
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Profile is already assigned in this window');
      throw error;
    }
  }

  async end(id: string, actorId: string) {
    const [row] = await this.db.db.update(profileAssignments).set({ status: 'ENDED', endedAt: new Date(), endReason: 'NORMAL' }).where(and(eq(profileAssignments.id, id), eq(profileAssignments.assignedBy, actorId))).returning({ id: profileAssignments.id });
    if (!row) throw new NotFoundException('Assignment not found');
    return row;
  }

  async openSession(input: SessionCreateInput, userId: string, deviceToken: string) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), eq(devices.assignedOperatorId, userId)) });
    if (!device) throw new ForbiddenException('Device is not approved for this operator');
    const assignment = await this.db.db.query.profileAssignments.findFirst({ where: and(eq(profileAssignments.id, input.assignmentId), eq(profileAssignments.profileId, input.profileId), eq(profileAssignments.operatorId, userId), eq(profileAssignments.status, 'ACTIVE'), sql`${profileAssignments.validRange} @> now()`) });
    if (!assignment) throw new ForbiddenException('No active assignment for this profile');
    try {
      const [row] = await this.db.db.insert(profileSessions).values({ profileId: input.profileId, operatorId: userId, deviceId: device.id, assignmentId: input.assignmentId, chromeProfileDir: input.chromeProfileDir, status: 'LAUNCHING' }).returning({ id: profileSessions.id, status: profileSessions.status, startedAt: profileSessions.startedAt });
      return row;
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) throw new ConflictException('Profile already has a live session');
      throw error;
    }
  }

  async updateSession(id: string, input: SessionPatchInput, userId: string, deviceToken: string) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), eq(devices.assignedOperatorId, userId)) });
    if (!device) throw new ForbiddenException('Device is not approved');
    const [row] = await this.db.db.update(profileSessions).set({ status: input.status, lastHeartbeatAt: new Date(), errorCode: input.errorCode, errorDetail: input.errorDetail, endedAt: input.status === 'CLOSED' ? new Date() : undefined, endReason: input.status === 'CLOSED' ? 'OPERATOR_CLOSED' : undefined }).where(and(eq(profileSessions.id, id), eq(profileSessions.operatorId, userId), eq(profileSessions.deviceId, device.id))).returning({ id: profileSessions.id, status: profileSessions.status, lastHeartbeatAt: profileSessions.lastHeartbeatAt });
    if (!row) throw new NotFoundException('Session not found');
    return row;
  }

  async closeSession(id: string, userId: string, deviceToken: string) {
    return this.updateSession(id, { status: 'CLOSED' }, userId, deviceToken);
  }
}
