import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { breaks, shifts } from '../../database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Ventana de break por iniciativa del operador (OPS-06, decision de la clienta). */
export const BREAK_WINDOW_MS = 4 * 3_600_000;
export const BREAK_MAX_MINUTES = 20;

@Injectable()
export class BreaksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}
  async list(shiftId: string, operatorId: string) {
    return this.db.db.select({
      id: breaks.id,
      shiftId: breaks.shiftId,
      type: breaks.type,
      scheduledAt: breaks.scheduledAt,
      startedAt: breaks.startedAt,
      endedAt: breaks.endedAt,
      durationMinutes: breaks.durationMinutes,
      status: breaks.status,
    }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.shiftId, shiftId), eq(shifts.operatorId, operatorId)));
  }
  /**
   * Break por iniciativa del operador (OPS-06): se crea y se inicia en el turno
   * IN_PROGRESS. Dos ventanas de 4 h contadas desde la hora PROGRAMADA del turno
   * -la primera en las primeras 4 h y la segunda en las 4 siguientes-; llegar
   * tarde no corre las ventanas y lo que no se toma se pierde. El tope de 20 min
   * lo aplica el job `breaks:auto-close`.
   */
  async startNew(operatorId: string) {
    return this.db.transaction(async () => {
      await this.db.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${operatorId}, 0))`);
      const [shift] = await this.db.db
        .select({ id: shifts.id, from: sql<Date | string | null>`lower(${shifts.scheduledRange})` })
        .from(shifts)
        .where(and(eq(shifts.operatorId, operatorId), eq(shifts.status, 'IN_PROGRESS')))
        .limit(1);
      if (!shift) throw new ConflictException('No shift in progress');
      const scheduledFrom = shift.from ? new Date(shift.from) : null;
      if (!scheduledFrom || Number.isNaN(scheduledFrom.getTime())) throw new ConflictException('Shift has no scheduled window');
      const now = new Date();
      const elapsed = now.getTime() - scheduledFrom.getTime();
      const windowIndex = elapsed < 0 ? 0 : Math.floor(elapsed / BREAK_WINDOW_MS);
      if (windowIndex > 1) throw new ConflictException('Breaks are only available during the first eight hours of the shift');
      const windowStart = new Date(scheduledFrom.getTime() + windowIndex * BREAK_WINDOW_MS);
      const windowEnd = new Date(windowStart.getTime() + BREAK_WINDOW_MS);
      const [active] = await this.db.db.select({ id: breaks.id }).from(breaks).where(and(eq(breaks.shiftId, shift.id), eq(breaks.status, 'IN_PROGRESS'))).limit(1);
      if (active) throw new ConflictException('Operator already has an active break');
      const [taken] = await this.db.db
        .select({ id: breaks.id })
        .from(breaks)
        .where(and(eq(breaks.shiftId, shift.id), gte(breaks.startedAt, windowStart), lt(breaks.startedAt, windowEnd)))
        .limit(1);
      if (taken) throw new ConflictException('Break already taken in this window');
      const [row] = await this.db.db
        .insert(breaks)
        .values({ shiftId: shift.id, type: 'REST', status: 'IN_PROGRESS', startedAt: now })
        .returning({ id: breaks.id, shiftId: breaks.shiftId, status: breaks.status, startedAt: breaks.startedAt });
      await this.audit.record({ actorType: 'USER', actorUserId: operatorId, action: 'break.started', entityType: 'break', entityId: row.id, result: 'SUCCESS', metadata: { shiftId: shift.id } });
      await this.realtime.publishOperatorChanged(operatorId);
      return row;
    });
  }

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
