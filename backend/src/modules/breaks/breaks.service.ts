import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { breaks, shifts } from '../../database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

@Injectable()
export class BreaksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}
  async list(shiftId: string, operatorId: string) { return this.db.db.select().from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.shiftId, shiftId), eq(shifts.operatorId, operatorId))); }
  async start(id: string, operatorId: string) {
    return this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${operatorId}, 0))`);
      const [candidate] = await this.db.db.select({ id: breaks.id }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.id, id), eq(shifts.operatorId, operatorId), eq(shifts.status, 'IN_PROGRESS'), eq(breaks.status, 'PENDING')));
      if (!candidate) throw new ConflictException('Break is not pending or its shift is not active');
      const [active] = await this.db.db.select({ id: breaks.id }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(shifts.operatorId, operatorId), eq(breaks.status, 'IN_PROGRESS'))).limit(1);
      if (active) throw new ConflictException('Operator already has an active break');
      const [row] = await this.db.db.update(breaks).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(and(eq(breaks.id, id), eq(breaks.status, 'PENDING'))).returning({ id: breaks.id, status: breaks.status, startedAt: breaks.startedAt });
      if (!row) throw new ConflictException('Break changed concurrently');
      await this.audit.record({ actorType: 'USER', actorUserId: operatorId, action: 'break.started', entityType: 'break', entityId: row.id, result: 'SUCCESS' });
      await this.realtime.publishOperatorChanged(operatorId);
      return row;
    });
  }
  async end(id: string, operatorId: string) { const [current] = await this.db.db.select({ id: breaks.id, startedAt: breaks.startedAt }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.id, id), eq(shifts.operatorId, operatorId), eq(breaks.status, 'IN_PROGRESS'))); if (!current) throw new NotFoundException('Break not found or not in progress'); const endedAt = new Date(); const durationMinutes = current.startedAt ? Math.max(0, Math.round((endedAt.getTime() - current.startedAt.getTime()) / 60_000)) : 0; const [row] = await this.db.db.update(breaks).set({ status: 'COMPLETED', endedAt, durationMinutes }).where(and(eq(breaks.id, id), eq(breaks.status, 'IN_PROGRESS'))).returning({ id: breaks.id, status: breaks.status, endedAt: breaks.endedAt, durationMinutes: breaks.durationMinutes }); if (!row) throw new ConflictException('Break changed concurrently'); await this.audit.record({ actorType: 'USER', actorUserId: operatorId, action: 'break.ended', entityType: 'break', entityId: row.id, result: 'SUCCESS' }); await this.realtime.publishOperatorChanged(operatorId); return row; }
}
