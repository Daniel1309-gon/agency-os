import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { cafeteriaOrders, profileAssignments, profileSessions, shifts } from '../../database/schema/index.js';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService, private readonly redis: RedisService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.runExclusive('sessions:reap', 55, () => this.reapSessions()), 60_000));
    this.timers.push(setInterval(() => void this.runExclusive('cafeteria:expire-orders', 55, () => this.expireOrders()), 60_000));
    this.timers.push(setInterval(() => void this.runExclusive('shifts:open-close', 55, () => this.closeExpiredShifts()), 60_000));
  }

  async onModuleDestroy(): Promise<void> { for (const timer of this.timers) clearInterval(timer); }

  private async runExclusive(name: string, ttl: number, work: () => Promise<void>): Promise<void> {
    const token = await this.redis.acquireLock(`agency:job:${name}`, ttl).catch(() => null);
    if (!token) return;
    try { await work(); } finally { await this.redis.releaseLock(`agency:job:${name}`, token).catch(() => undefined); }
  }

  private async reapSessions(): Promise<void> {
    const now = new Date();
    const assignmentEnded = sql`NOT EXISTS (
      SELECT 1
      FROM ${profileAssignments} AS assignment
      WHERE assignment.id = ${profileSessions.assignmentId}
        AND assignment.status = 'ACTIVE'
        AND assignment.valid_range @> now()
    )`;

    // The assignment boundary is authoritative: a stale heartbeat must not
    // keep a profile alive after the handoff, and a heartbeat arriving after
    // the boundary must never revive it.
    await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', endedAt: now, endReason: 'ASSIGNMENT_ENDED' })
      .where(and(or(eq(profileSessions.status, 'LAUNCHING'), eq(profileSessions.status, 'ACTIVE')), assignmentEnded));

    // LAUNCHING has its own deadline. Otherwise a failed extension handshake
    // occupies the partial unique index forever and blocks the next operator.
    await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', endedAt: now, endReason: 'LAUNCH_TIMEOUT' })
      .where(and(eq(profileSessions.status, 'LAUNCHING'), lt(profileSessions.startedAt, new Date(now.getTime() - 120_000))));

    await this.db.db
      .update(profileSessions)
      .set({ status: 'CLOSED', endedAt: now, endReason: 'HEARTBEAT_TIMEOUT' })
      .where(and(eq(profileSessions.status, 'ACTIVE'), lt(profileSessions.lastHeartbeatAt, new Date(now.getTime() - 120_000))));
  }

  private async expireOrders(): Promise<void> {
    await this.db.db.update(cafeteriaOrders).set({ status: 'EXPIRED' }).where(and(eq(cafeteriaOrders.status, 'READY'), isNotNull(cafeteriaOrders.pickupDeadlineAt), lt(cafeteriaOrders.pickupDeadlineAt, new Date())));
  }

  private async closeExpiredShifts(): Promise<void> {
    await this.db.db.update(shifts).set({ status: 'MISSED' }).where(and(eq(shifts.status, 'SCHEDULED'), isNotNull(shifts.scheduledRange), sql`upper(${shifts.scheduledRange}) < now()`));
    await this.db.db.update(shifts).set({ status: 'COMPLETED', actualEndAt: new Date(), effectiveMinutes: sql`greatest(0, extract(epoch from (now() - coalesce(${shifts.actualStartAt}, now()))) / 60)::int` }).where(and(eq(shifts.status, 'IN_PROGRESS'), isNotNull(shifts.scheduledRange), sql`upper(${shifts.scheduledRange}) < now()`));
  }
}
