import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { operatorCurrentStatus, operatorStatusEvents } from '../../database/schema/index.js';
import type { OperatorStatusInput } from './operator-status.schemas.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';

@Injectable()
export class OperatorStatusService {
  constructor(private readonly db: DatabaseService, private readonly realtime: RealtimeService) {}
  async set(operatorId: string, input: OperatorStatusInput) { const now = new Date(); await this.db.db.transaction(async (tx) => { await tx.insert(operatorStatusEvents).values({ operatorId, status: input.status, reason: input.reason, occurredAt: now }); await tx.insert(operatorCurrentStatus).values({ operatorId, status: input.status, reason: input.reason, changedAt: now }).onConflictDoUpdate({ target: operatorCurrentStatus.operatorId, set: { status: input.status, reason: input.reason, changedAt: now } }); }); await this.realtime.publishOperatorChanged(operatorId); return { operatorId, ...input, changedAt: now }; }
  async list(user: Pick<AccessTokenClaims, 'sub' | 'role'>) { return this.realtime.snapshotFor(user); }
}
