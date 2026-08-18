import { Injectable } from '@nestjs/common';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Server } from 'socket.io';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { breaks, crewMembers, crews, operatorCurrentStatus, profileSessions, roles, shifts, users } from '../../database/schema/index.js';

export interface OperatorStatusSnapshot {
  operatorId: string;
  fullName: string;
  status: string;
  reason: string;
  changedAt: Date | null;
}

@Injectable()
export class RealtimeService {
  private server?: Server;

  constructor(private readonly db: DatabaseService) {}

  attach(server: Server): void {
    this.server = server;
  }

  async snapshotFor(user: AccessTokenClaims): Promise<OperatorStatusSnapshot[]> {
    const snapshot = await this.snapshotAll();
    if (user.role === 'ADMIN' || user.role === 'DIRECTOR_OPERATIVO') return snapshot;
    if (user.role === 'COORDINADOR') {
      const managed = await this.db.db
        .select({ operatorId: crewMembers.userId })
        .from(crews)
        .innerJoin(crewMembers, and(eq(crewMembers.crewId, crews.id), sql`${crewMembers.validRange} @> now()`))
        .where(and(eq(crews.coordinatorId, user.sub), eq(crews.isActive, true)));
      const allowed = new Set(managed.map((row) => row.operatorId));
      return snapshot.filter((row) => allowed.has(row.operatorId));
    }
    return snapshot.filter((row) => row.operatorId === user.sub);
  }

  async publishOperatorChanged(operatorId: string): Promise<void> {
    await this.db.afterCommit(() => this.emitOperatorChanged(operatorId));
  }

  private async emitOperatorChanged(operatorId: string): Promise<void> {
    if (!this.server) return;
    const status = (await this.snapshotAll()).find((row) => row.operatorId === operatorId);
    if (!status) return;
    const memberships = await this.db.db
      .select({ crewId: crewMembers.crewId })
      .from(crewMembers)
      .where(and(eq(crewMembers.userId, operatorId), sql`${crewMembers.validRange} @> now()`));
    const rooms = [
      'role:ADMIN',
      'role:DIRECTOR_OPERATIVO',
      `user:${operatorId}`,
      ...memberships.map((row) => `crew:${row.crewId}`),
    ];
    this.server.to(rooms).emit('operator.status.changed', status);
  }

  async snapshotAll(): Promise<OperatorStatusSnapshot[]> {
    const operators = await this.db.db
      .select({ operatorId: users.id, fullName: users.fullName, declaredStatus: operatorCurrentStatus.status, declaredReason: operatorCurrentStatus.reason, changedAt: operatorCurrentStatus.changedAt })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(operatorCurrentStatus, eq(operatorCurrentStatus.operatorId, users.id))
      .where(eq(roles.code, 'OPERADOR'))
      .orderBy(asc(users.fullName));
    const activeSessions = await this.db.db.select({ operatorId: profileSessions.operatorId }).from(profileSessions).where(or(eq(profileSessions.status, 'LAUNCHING'), eq(profileSessions.status, 'ACTIVE')));
    const activeBreaks = await this.db.db.select({ operatorId: shifts.operatorId }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(eq(breaks.status, 'IN_PROGRESS'));
    const sessionOperators = new Set(activeSessions.map((row) => row.operatorId));
    const breakOperators = new Set(activeBreaks.map((row) => row.operatorId));
    return operators.map((operator) => {
      const status = operator.declaredStatus === 'ALERT' ? 'ALERT' : breakOperators.has(operator.operatorId) ? 'BREAK' : sessionOperators.has(operator.operatorId) ? 'ONLINE' : 'OFFLINE';
      return {
        operatorId: operator.operatorId,
        fullName: operator.fullName,
        status,
        reason: status === 'ALERT' ? (operator.declaredReason ?? 'ALERT') : status === 'BREAK' ? 'BREAK_IN_PROGRESS' : status === 'ONLINE' ? 'SESSION_ACTIVE' : 'NO_ACTIVE_SESSION',
        changedAt: operator.changedAt,
      };
    });
  }
}
