import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, isPgError } from '../../database/pg-error.js';
import { hashToken } from '../../common/auth/crypto.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { crewMembers, crews, devices, profileAssignments, profileSessions, roles, shifts, ttProfiles, users } from '../../database/schema/index.js';
import type { AssignmentCreateInput, AssignmentHistoryQuery, SessionCreateInput, SessionPatchInput } from './assignments.schemas.js';

function range(from: string, to: string): string {
  if (new Date(from).getTime() >= new Date(to).getTime()) throw new ConflictException('validTo must be after validFrom');
  return `[${from},${to})`;
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(input: AssignmentCreateInput, assignedBy: string) {
    const [profile] = await this.db.db.select({ id: ttProfiles.id }).from(ttProfiles).where(and(eq(ttProfiles.id, input.profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt))).limit(1);
    const [operator] = await this.db.db
      .select({ id: users.id, status: users.status, roleCode: roles.code })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, input.operatorId), isNull(users.deletedAt)))
      .limit(1);
    if (!profile) throw new NotFoundException('Profile not found');
    if (!operator || operator.status !== 'ACTIVE') throw new NotFoundException('Operator not found');
    if (operator.roleCode !== 'OPERADOR') throw new ConflictException('Assignments can only target an OPERADOR');
    await this.assertActorCanManageOperator(assignedBy, input.operatorId);
    const validRange = range(input.validFrom, input.validTo);
    if (input.shiftId) {
      const [matchingShift] = await this.db.db
        .select({ id: shifts.id })
        .from(shifts)
        .where(and(
          eq(shifts.id, input.shiftId),
          eq(shifts.operatorId, input.operatorId),
          sql`${shifts.scheduledRange} @> ${validRange}::tstzrange`,
        ))
        .limit(1);
      if (!matchingShift) throw new ConflictException('Assignment must be contained in a shift for the same operator');
    }
    try {
      const [row] = await this.db.db.insert(profileAssignments).values({ profileId: input.profileId, operatorId: input.operatorId, shiftId: input.shiftId, validRange, status: 'ACTIVE', assignedBy }).returning({ id: profileAssignments.id, profileId: profileAssignments.profileId, operatorId: profileAssignments.operatorId, validRange: profileAssignments.validRange });
      await this.audit.record({ actorType: 'USER', actorUserId: assignedBy, action: 'assignment.created', entityType: 'assignment', entityId: row.id, result: 'SUCCESS', metadata: { profileId: input.profileId, operatorId: input.operatorId, shiftId: input.shiftId } });
      return row;
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Profile is already assigned in this window');
      throw error;
    }
  }

  async end(id: string, actorId: string) {
    const [assignment] = await this.db.db.select({ operatorId: profileAssignments.operatorId }).from(profileAssignments).where(and(eq(profileAssignments.id, id), eq(profileAssignments.status, 'ACTIVE'))).limit(1);
    if (!assignment) throw new NotFoundException('Assignment not found');
    await this.assertActorCanManageOperator(actorId, assignment.operatorId);
    const [row] = await this.db.db.update(profileAssignments).set({ status: 'ENDED', endedAt: new Date(), endReason: 'NORMAL' }).where(and(eq(profileAssignments.id, id), eq(profileAssignments.status, 'ACTIVE'))).returning({ id: profileAssignments.id });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'assignment.ended', entityType: 'assignment', entityId: row.id, result: 'SUCCESS' });
    return row;
  }

  async history(query: AssignmentHistoryQuery, actorId: string) {
    const role = await this.actorRole(actorId);
    const scope = role === 'ADMIN' || role === 'DIRECTOR_OPERATIVO'
      ? undefined
      : role === 'COORDINADOR'
        ? sql`exists (
            select 1 from ${crewMembers}
            inner join ${crews} on ${crews.id} = ${crewMembers.crewId}
            where ${crewMembers.userId} = ${profileAssignments.operatorId}
              and ${crewMembers.validRange} @> now()
              and ${crews.coordinatorId} = ${actorId}
              and ${crews.isActive} = true
          )`
        : eq(profileAssignments.operatorId, actorId);
    const filter = and(
      scope,
      query.operatorId ? eq(profileAssignments.operatorId, query.operatorId) : undefined,
      query.profileId ? eq(profileAssignments.profileId, query.profileId) : undefined,
    );
    const [items, [total]] = await Promise.all([
      this.db.db
        .select({
          id: profileAssignments.id,
          profileId: profileAssignments.profileId,
          operatorId: profileAssignments.operatorId,
          shiftId: profileAssignments.shiftId,
          validRange: profileAssignments.validRange,
          status: profileAssignments.status,
          assignedBy: profileAssignments.assignedBy,
          endedAt: profileAssignments.endedAt,
          endReason: profileAssignments.endReason,
          createdAt: profileAssignments.createdAt,
        })
        .from(profileAssignments)
        .where(filter)
        .orderBy(desc(profileAssignments.createdAt), desc(profileAssignments.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.db.select({ value: count() }).from(profileAssignments).where(filter),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total: total?.value ?? 0 };
  }

  async openSession(input: SessionCreateInput, userId: string, deviceToken: string) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), eq(devices.assignedOperatorId, userId)) });
    if (!device) throw new ForbiddenException('Device is not approved for this operator');
    const assignment = await this.db.db.query.profileAssignments.findFirst({ where: and(eq(profileAssignments.id, input.assignmentId), eq(profileAssignments.profileId, input.profileId), eq(profileAssignments.operatorId, userId), eq(profileAssignments.status, 'ACTIVE'), sql`${profileAssignments.validRange} @> now()`) });
    if (!assignment) throw new ForbiddenException('No active assignment for this profile');
    try {
      const [row] = await this.db.db.insert(profileSessions).values({ profileId: input.profileId, operatorId: userId, deviceId: device.id, assignmentId: input.assignmentId, chromeProfileDir: input.chromeProfileDir, status: 'LAUNCHING' }).returning({ id: profileSessions.id, status: profileSessions.status, startedAt: profileSessions.startedAt });
      await this.audit.record({ actorType: 'DEVICE', actorUserId: userId, actorDeviceId: device.id, action: 'session.opened', entityType: 'session', entityId: row.id, result: 'SUCCESS', metadata: { profileId: input.profileId, assignmentId: input.assignmentId, deviceId: device.id } });
      await this.realtime.publishOperatorChanged(userId);
      return row;
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) throw new ConflictException('Profile already has a live session');
      throw error;
    }
  }

  async updateSession(id: string, input: SessionPatchInput, userId: string, deviceToken: string) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), eq(devices.assignedOperatorId, userId)) });
    if (!device) throw new ForbiddenException('Device is not approved');
    const [current] = await this.db.db
      .select({ status: profileSessions.status, assignmentId: profileSessions.assignmentId })
      .from(profileSessions)
      .where(and(eq(profileSessions.id, id), eq(profileSessions.operatorId, userId), eq(profileSessions.deviceId, device.id)))
      .limit(1);
    if (!current) throw new NotFoundException('Session not found');
    if (current.status === 'CLOSED') throw new ConflictException('A closed session cannot be reopened');
    const allowed: Record<string, readonly string[]> = {
      LAUNCHING: ['LAUNCHING', 'ACTIVE', 'ERROR', 'CLOSED'],
      ACTIVE: ['ACTIVE', 'ERROR', 'CLOSED'],
      ERROR: ['ERROR', 'LAUNCHING', 'CLOSED'],
    };
    if (!allowed[current.status]?.includes(input.status)) {
      throw new ConflictException(`Invalid session transition from ${current.status} to ${input.status}`);
    }
    const assignment = await this.db.db.query.profileAssignments.findFirst({
      where: and(
        eq(profileAssignments.id, current.assignmentId),
        eq(profileAssignments.operatorId, userId),
        eq(profileAssignments.status, 'ACTIVE'),
        sql`${profileAssignments.validRange} @> now()`,
      ),
    });
    if (!assignment) throw new ForbiddenException('The assignment is no longer active');
    const [row] = await this.db.db.update(profileSessions).set({ status: input.status, lastHeartbeatAt: new Date(), errorCode: input.status === 'ERROR' ? input.errorCode : null, errorDetail: input.status === 'ERROR' ? input.errorDetail : null, endedAt: input.status === 'CLOSED' ? new Date() : undefined, endReason: input.status === 'CLOSED' ? 'OPERATOR_CLOSED' : undefined }).where(and(
      eq(profileSessions.id, id),
      eq(profileSessions.operatorId, userId),
      eq(profileSessions.deviceId, device.id),
      eq(profileSessions.status, current.status),
      sql`exists (select 1 from profile_assignments pa where pa.id = ${profileSessions.assignmentId} and pa.status = 'ACTIVE' and pa.valid_range @> now())`,
    )).returning({ id: profileSessions.id, status: profileSessions.status, lastHeartbeatAt: profileSessions.lastHeartbeatAt });
    if (!row) throw new ConflictException('Session changed concurrently or its assignment expired');
    await this.audit.record({ actorType: 'DEVICE', actorUserId: userId, actorDeviceId: device.id, action: 'session.transitioned', entityType: 'session', entityId: row.id, result: 'SUCCESS', metadata: { fromStatus: current.status, toStatus: input.status, errorCode: input.errorCode } });
    await this.realtime.publishOperatorChanged(userId);
    return row;
  }

  async closeSession(id: string, userId: string, deviceToken: string) {
    return this.updateSession(id, { status: 'CLOSED' }, userId, deviceToken);
  }

  private async actorRole(actorId: string): Promise<string> {
    const [actor] = await this.db.db.select({ role: roles.code }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, actorId)).limit(1);
    if (!actor) throw new ForbiddenException('Assignment actor is not active');
    return actor.role;
  }

  private async assertActorCanManageOperator(actorId: string, operatorId: string): Promise<void> {
    const role = await this.actorRole(actorId);
    if (role === 'ADMIN' || role === 'DIRECTOR_OPERATIVO') return;
    if (role === 'COORDINADOR') {
      const [managed] = await this.db.db
        .select({ id: crewMembers.id })
        .from(crewMembers)
        .innerJoin(crews, eq(crews.id, crewMembers.crewId))
        .where(and(eq(crewMembers.userId, operatorId), eq(crews.coordinatorId, actorId), eq(crews.isActive, true), sql`${crewMembers.validRange} @> now()`))
        .limit(1);
      if (managed) return;
    }
    throw new ForbiddenException('Operator is outside the actor crew scope');
  }
}
