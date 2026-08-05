import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { operatorCurrentStatus, operatorStatusEvents, users } from '../../database/schema/index.js';
import type { OperatorStatusInput } from './operator-status.schemas.js';

@Injectable()
export class OperatorStatusService {
  constructor(private readonly db: DatabaseService) {}
  async set(operatorId: string, input: OperatorStatusInput) { const now = new Date(); await this.db.db.transaction(async (tx) => { await tx.insert(operatorStatusEvents).values({ operatorId, status: input.status, reason: input.reason, occurredAt: now }); await tx.insert(operatorCurrentStatus).values({ operatorId, status: input.status, reason: input.reason, changedAt: now }).onConflictDoUpdate({ target: operatorCurrentStatus.operatorId, set: { status: input.status, reason: input.reason, changedAt: now } }); }); return { operatorId, ...input, changedAt: now }; }
  async list() { return this.db.db.select({ operatorId: operatorCurrentStatus.operatorId, fullName: users.fullName, status: operatorCurrentStatus.status, reason: operatorCurrentStatus.reason, changedAt: operatorCurrentStatus.changedAt }).from(operatorCurrentStatus).innerJoin(users, eq(users.id, operatorCurrentStatus.operatorId)).orderBy(asc(users.fullName)); }
}
