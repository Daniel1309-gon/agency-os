import { Injectable } from '@nestjs/common';
import { asc, eq, or } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { breaks, operatorCurrentStatus, operatorStatusEvents, profileSessions, roles, shifts, users } from '../../database/schema/index.js';
import type { OperatorStatusInput } from './operator-status.schemas.js';

@Injectable()
export class OperatorStatusService {
  constructor(private readonly db: DatabaseService) {}
  async set(operatorId: string, input: OperatorStatusInput) { const now = new Date(); await this.db.db.transaction(async (tx) => { await tx.insert(operatorStatusEvents).values({ operatorId, status: input.status, reason: input.reason, occurredAt: now }); await tx.insert(operatorCurrentStatus).values({ operatorId, status: input.status, reason: input.reason, changedAt: now }).onConflictDoUpdate({ target: operatorCurrentStatus.operatorId, set: { status: input.status, reason: input.reason, changedAt: now } }); }); return { operatorId, ...input, changedAt: now }; }
  async list() {
    const operators = await this.db.db
      .select({ operatorId: users.id, fullName: users.fullName, declaredStatus: operatorCurrentStatus.status, declaredReason: operatorCurrentStatus.reason, changedAt: operatorCurrentStatus.changedAt })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(operatorCurrentStatus, eq(operatorCurrentStatus.operatorId, users.id))
      .where(eq(roles.code, 'OPERADOR'))
      .orderBy(asc(users.fullName));
    const activeSessions = await this.db.db
      .select({ operatorId: profileSessions.operatorId })
      .from(profileSessions)
      .where(or(eq(profileSessions.status, 'LAUNCHING'), eq(profileSessions.status, 'ACTIVE')));
    const activeBreaks = await this.db.db
      .select({ operatorId: shifts.operatorId })
      .from(breaks)
      .innerJoin(shifts, eq(shifts.id, breaks.shiftId))
      .where(eq(breaks.status, 'IN_PROGRESS'));
    const sessionOperators = new Set(activeSessions.map((row) => row.operatorId));
    const breakOperators = new Set(activeBreaks.map((row) => row.operatorId));

    return operators.map((operator) => {
      const status = operator.declaredStatus === 'ALERT'
        ? 'ALERT'
        : breakOperators.has(operator.operatorId)
          ? 'BREAK'
          : sessionOperators.has(operator.operatorId)
            ? 'ONLINE'
            : 'OFFLINE';
      return {
        operatorId: operator.operatorId,
        fullName: operator.fullName,
        status,
        reason: status === 'ALERT' ? operator.declaredReason : status === 'BREAK' ? 'BREAK_IN_PROGRESS' : status === 'ONLINE' ? 'SESSION_ACTIVE' : 'NO_ACTIVE_SESSION',
        changedAt: operator.changedAt,
      };
    });
  }
}
