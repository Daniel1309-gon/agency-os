import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
      const result = await this.db.transaction(async () => {
        await this.assertActorCanManageOperator(assignedBy, input.operatorId);
        const [row] = await this.db.db.insert(profileAssignments).values({ profileId: input.profileId, operatorId: input.operatorId, shiftId: input.shiftId, validRange, status: 'ACTIVE', assignedBy }).returning({ id: profileAssignments.id, profileId: profileAssignments.profileId, operatorId: profileAssignments.operatorId, validRange: profileAssignments.validRange });
        const [previous] = await this.db.db
          .select({ id: profileAssignments.id, operatorId: profileAssignments.operatorId })
          .from(profileAssignments)
          .where(and(
            eq(profileAssignments.profileId, input.profileId),
            eq(profileAssignments.status, 'ACTIVE'),
            sql`${profileAssignments.operatorId} <> ${input.operatorId}`,
            sql`upper(${profileAssignments.validRange}) = lower(${validRange}::tstzrange)`,
          ))
          .limit(1);

        let previousOperatorId: string | undefined;
        if (previous) {
          await this.assertActorCanManageOperator(assignedBy, previous.operatorId);
          const handoffAt = new Date(input.validFrom);
          const [ended] = await this.db.db
            .update(profileAssignments)
            .set({ status: 'ENDED', endedAt: handoffAt, endReason: 'HANDOFF' })
            .where(and(eq(profileAssignments.id, previous.id), eq(profileAssignments.status, 'ACTIVE')))
            .returning({ id: profileAssignments.id });
          if (!ended) throw new ConflictException('Previous assignment changed during handoff');

          const closedSessions = await this.db.db
            .update(profileSessions)
            .set({ status: 'CLOSED', endedAt: handoffAt, endReason: 'SHIFT_ENDED', version: sql<number>`${profileSessions.version} + 1` })
            .where(and(
              eq(profileSessions.assignmentId, previous.id),
              inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE', 'ERROR']),
            ))
            .returning({ id: profileSessions.id });
          await this.audit.record({ actorType: 'USER', actorUserId: assignedBy, action: 'assignment.ended', entityType: 'assignment', entityId: previous.id, result: 'SUCCESS', metadata: { reason: 'HANDOFF', operatorId: previous.operatorId } });
          for (const session of closedSessions) {
            await this.audit.record({ actorType: 'USER', actorUserId: assignedBy, action: 'session.closed', entityType: 'session', entityId: session.id, result: 'SUCCESS', metadata: { assignmentId: previous.id, reason: 'SHIFT_ENDED' } });
          }
          previousOperatorId = previous.operatorId;
        }

        await this.audit.record({ actorType: 'USER', actorUserId: assignedBy, action: 'assignment.created', entityType: 'assignment', entityId: row.id, result: 'SUCCESS', metadata: { profileId: input.profileId, operatorId: input.operatorId, shiftId: input.shiftId } });
        return { row, previousOperatorId };
      });
      if (result.previousOperatorId) await this.realtime.publishOperatorChanged(result.previousOperatorId);
      return result.row;
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Profile is already assigned in this window');
      throw error;
    }
  }

  async end(id: string, actorId: string) {
    const endedAt = new Date();
    const result = await this.db.transaction(async () => {
      const [assignment] = await this.db.db.select({ operatorId: profileAssignments.operatorId }).from(profileAssignments).where(and(eq(profileAssignments.id, id), eq(profileAssignments.status, 'ACTIVE'))).limit(1);
      if (!assignment) throw new NotFoundException('Assignment not found');
      await this.assertActorCanManageOperator(actorId, assignment.operatorId);
      const [row] = await this.db.db.update(profileAssignments).set({ status: 'ENDED', endedAt, endReason: 'NORMAL' }).where(and(eq(profileAssignments.id, id), eq(profileAssignments.status, 'ACTIVE'))).returning({ id: profileAssignments.id });
      if (!row) throw new NotFoundException('Assignment not found');

      const closedSessions = await this.db.db
        .update(profileSessions)
        .set({ status: 'CLOSED', endedAt, endReason: 'ASSIGNMENT_ENDED', version: sql<number>`${profileSessions.version} + 1` })
        .where(and(
          eq(profileSessions.assignmentId, id),
          inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE', 'ERROR']),
        ))
        .returning({ id: profileSessions.id });

      await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'assignment.ended', entityType: 'assignment', entityId: row.id, result: 'SUCCESS' });
      for (const session of closedSessions) {
        await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'session.closed', entityType: 'session', entityId: session.id, result: 'SUCCESS', metadata: { assignmentId: id, reason: 'ASSIGNMENT_ENDED' } });
      }
      return { row, operatorId: assignment.operatorId };
    });
    await this.realtime.publishOperatorChanged(result.operatorId);
    return result.row;
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
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), sql`${devices.tokenExpiresAt} > now()`) });
    if (!device) throw new ForbiddenException('Device is not approved');
    return this.createSession(input, userId, device.id);
  }

  async prepareSession(input: SessionCreateInput, userId: string) {
    return this.createSession(input, userId);
  }

  private async createSession(input: SessionCreateInput, userId: string, deviceId?: string) {
    const assignment = await this.db.db.query.profileAssignments.findFirst({ where: and(eq(profileAssignments.id, input.assignmentId), eq(profileAssignments.profileId, input.profileId), eq(profileAssignments.operatorId, userId), eq(profileAssignments.status, 'ACTIVE'), sql`${profileAssignments.validRange} @> now()`) });
    if (!assignment) throw new ForbiddenException('No active assignment for this profile');

    const [profile] = await this.db.db
      .select({ id: ttProfiles.id, chromeProfileDir: ttProfiles.chromeProfileDir })
      .from(ttProfiles)
      .where(and(eq(ttProfiles.id, input.profileId), eq(ttProfiles.status, 'ACTIVE'), isNull(ttProfiles.deletedAt)))
      .limit(1);
    if (!profile?.chromeProfileDir) throw new ConflictException('Profile has no Chrome profile binding');
    if (profile.chromeProfileDir !== input.chromeProfileDir) throw new ConflictException('Chrome profile binding does not match profile configuration');
    try {
      const [row] = await this.db.db.insert(profileSessions).values({ profileId: input.profileId, operatorId: userId, ...(deviceId ? { deviceId } : {}), assignmentId: input.assignmentId, chromeProfileDir: input.chromeProfileDir, status: 'LAUNCHING' }).returning({ id: profileSessions.id, status: profileSessions.status, version: profileSessions.version, startedAt: profileSessions.startedAt });
      await this.audit.record({ actorType: deviceId ? 'DEVICE' : 'USER', actorUserId: userId, actorDeviceId: deviceId, action: 'session.opened', entityType: 'session', entityId: row.id, result: 'SUCCESS', metadata: { profileId: input.profileId, assignmentId: input.assignmentId, ...(deviceId ? { deviceId } : {}) } });
      await this.realtime.publishOperatorChanged(userId);
      return row;
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) throw new ConflictException('Profile already has a live session');
      throw error;
    }
  }

  async updateSession(id: string, input: SessionPatchInput, userId: string, deviceToken: string) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), sql`${devices.tokenExpiresAt} > now()`) });
    if (!device) throw new ForbiddenException('Device is not approved');
    const [current] = await this.db.db
      .select({ status: profileSessions.status, assignmentId: profileSessions.assignmentId, deviceId: profileSessions.deviceId, version: profileSessions.version })
      .from(profileSessions)
      .where(and(eq(profileSessions.id, id), eq(profileSessions.operatorId, userId)))
      .limit(1);
    if (!current) throw new NotFoundException('Session not found');
    if (current.deviceId && current.deviceId !== device.id) throw new NotFoundException('Session not found');
    if (!current.deviceId && input.status === 'ACTIVE') throw new ConflictException('Session must be claimed before becoming active');
    if (current.status === 'CLOSED' || current.status === 'STALE') throw new ConflictException(`A ${current.status.toLowerCase()} session cannot be reopened`);
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
    const [row] = await this.db.db.update(profileSessions).set({ deviceId: current.deviceId ?? device.id, status: input.status, version: sql<number>`${profileSessions.version} + 1`, lastHeartbeatAt: new Date(), errorCode: input.status === 'ERROR' ? input.errorCode : null, errorDetail: input.status === 'ERROR' ? input.errorDetail : null, endedAt: input.status === 'CLOSED' ? new Date() : undefined, endReason: input.status === 'CLOSED' ? 'OPERATOR_CLOSED' : undefined }).where(and(
      eq(profileSessions.id, id),
      eq(profileSessions.operatorId, userId),
      current.deviceId ? eq(profileSessions.deviceId, device.id) : isNull(profileSessions.deviceId),
      eq(profileSessions.status, current.status),
      eq(profileSessions.version, input.version),
      sql`exists (select 1 from profile_assignments pa where pa.id = ${profileSessions.assignmentId} and pa.status = 'ACTIVE' and pa.valid_range @> now())`,
    )).returning({ id: profileSessions.id, status: profileSessions.status, version: profileSessions.version, lastHeartbeatAt: profileSessions.lastHeartbeatAt });
    if (!row) throw new ConflictException('Session changed concurrently or its assignment expired');
    await this.audit.record({ actorType: 'DEVICE', actorUserId: userId, actorDeviceId: device.id, action: 'session.transitioned', entityType: 'session', entityId: row.id, result: 'SUCCESS', metadata: { fromStatus: current.status, toStatus: input.status, errorCode: input.errorCode } });
    await this.realtime.publishOperatorChanged(userId);
    return row;
  }

  async closeSession(id: string, version: number, userId: string, deviceToken: string) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(deviceToken)), eq(devices.status, 'APPROVED'), sql`${devices.tokenExpiresAt} > now()`) });
    if (!device) throw new ForbiddenException('Device is not approved');
    const [current] = await this.db.db
      .select({ status: profileSessions.status, deviceId: profileSessions.deviceId })
      .from(profileSessions)
      .where(and(eq(profileSessions.id, id), eq(profileSessions.operatorId, userId)))
      .limit(1);
    if (!current) throw new NotFoundException('Session not found');
    if (current.deviceId && current.deviceId !== device.id) throw new NotFoundException('Session not found');
    if (current.status === 'CLOSED') throw new ConflictException('A closed session cannot be reopened');

    const [row] = await this.db.db
      .update(profileSessions)
      .set({ deviceId: current.deviceId ?? device.id, status: 'CLOSED', version: sql<number>`${profileSessions.version} + 1`, endedAt: new Date(), endReason: 'OPERATOR_CLOSED' })
      .where(and(
        eq(profileSessions.id, id),
        eq(profileSessions.operatorId, userId),
        current.deviceId ? eq(profileSessions.deviceId, device.id) : isNull(profileSessions.deviceId),
        eq(profileSessions.version, version),
        inArray(profileSessions.status, ['LAUNCHING', 'ACTIVE', 'ERROR', 'STALE']),
      ))
      .returning({ id: profileSessions.id, status: profileSessions.status, version: profileSessions.version, lastHeartbeatAt: profileSessions.lastHeartbeatAt });
    if (!row) throw new ConflictException('Session changed concurrently');
    await this.audit.record({ actorType: 'DEVICE', actorUserId: userId, actorDeviceId: device.id, action: 'session.transitioned', entityType: 'session', entityId: row.id, result: 'SUCCESS', metadata: { fromStatus: current.status, toStatus: 'CLOSED', errorCode: undefined } });
    await this.realtime.publishOperatorChanged(userId);
    return row;
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
