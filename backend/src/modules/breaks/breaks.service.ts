import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { breaks, shifts } from '../../database/schema/index.js';

@Injectable()
export class BreaksService {
  constructor(private readonly db: DatabaseService) {}
  async list(shiftId: string, operatorId: string) { return this.db.db.select().from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.shiftId, shiftId), eq(shifts.operatorId, operatorId))); }
  async start(id: string, operatorId: string) { const [candidate] = await this.db.db.select({ id: breaks.id }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.id, id), eq(shifts.operatorId, operatorId), eq(breaks.status, 'PENDING'))); if (!candidate) throw new ConflictException('Break is not pending'); const [row] = await this.db.db.update(breaks).set({ status: 'IN_PROGRESS', startedAt: new Date() }).where(and(eq(breaks.id, id), eq(breaks.status, 'PENDING'))).returning({ id: breaks.id, status: breaks.status, startedAt: breaks.startedAt }); return row; }
  async end(id: string, operatorId: string) { const [current] = await this.db.db.select({ id: breaks.id, startedAt: breaks.startedAt }).from(breaks).innerJoin(shifts, eq(shifts.id, breaks.shiftId)).where(and(eq(breaks.id, id), eq(shifts.operatorId, operatorId), eq(breaks.status, 'IN_PROGRESS'))); if (!current) throw new NotFoundException('Break not found or not in progress'); const endedAt = new Date(); const durationMinutes = current.startedAt ? Math.max(0, Math.round((endedAt.getTime() - current.startedAt.getTime()) / 60_000)) : 0; const [row] = await this.db.db.update(breaks).set({ status: 'COMPLETED', endedAt, durationMinutes }).where(and(eq(breaks.id, id), eq(breaks.status, 'IN_PROGRESS'))).returning({ id: breaks.id, status: breaks.status, endedAt: breaks.endedAt, durationMinutes: breaks.durationMinutes }); return row; }
}
