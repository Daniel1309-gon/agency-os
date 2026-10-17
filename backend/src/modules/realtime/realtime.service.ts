import { Injectable, Logger, Optional, type LoggerService, type OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Server } from 'socket.io';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { breaks, cafeteriaOrderItems, cafeteriaOrders, crewMembers, crews, operatorCurrentStatus, profileSessions, roles, shifts, users } from '../../database/schema/index.js';

export interface OperatorStatusSnapshot {
  operatorId: string;
  fullName: string;
  status: string;
  reason: string;
  changedAt: Date | null;
}

export interface CafeteriaOrderSnapshot {
  id: string;
  orderNumber: number;
  operatorId: string;
  status: string;
  placedAt: Date;
  acceptedAt: Date | null;
  readyAt: Date | null;
  pickupDeadlineAt: Date | null;
  deliveredAt: Date | null;
  totalCop: string;
  notes: string | null;
  items: Array<{
    productId: string;
    productNameSnapshot: string;
    quantity: number;
    unitPriceCop: string;
    lineTotalCop: string;
    notes: string | null;
  }>;
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private static readonly BRIDGE_CHANNEL = 'agency:realtime:bridge';
  private readonly logger: LoggerService = new Logger(RealtimeService.name);
  private server?: Server;
  private bridgeRetry?: ReturnType<typeof setTimeout>;
  private bridgeAttempts = 0;
  private destroyed = false;

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  attach(server: Server): void {
    this.server = server;
    void this.subscribeBridge();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.bridgeRetry) clearTimeout(this.bridgeRetry);
  }

  private async subscribeBridge(): Promise<void> {
    if (!this.redis || this.destroyed) return;
    try {
      await this.redis.subscribe(RealtimeService.BRIDGE_CHANNEL, (message) => {
        void this.onBridgeMessage(message).catch(() => this.logger.error('Falló un evento del puente realtime'));
      });
      this.bridgeAttempts = 0;
    } catch {
      const delay = Math.min(60_000, 5_000 * 2 ** Math.min(this.bridgeAttempts++, 4));
      this.logger.error(`Falló la suscripción al puente realtime; reintento en ${delay} ms`);
      if (!this.destroyed) {
        this.bridgeRetry = setTimeout(() => {
          this.bridgeRetry = undefined;
          void this.subscribeBridge();
        }, delay);
      }
    }
  }

  /**
   * Corta los sockets afectados por una revocacion. El plan pide cierre objetivo
   * en cinco segundos en condiciones normales; con el adaptador Redis la orden
   * cruza instancias.
   */
  disconnectUser(userId: string): void {
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }

  disconnectDevice(deviceId: string): void {
    this.server?.in(`device:${deviceId}`).disconnectSockets(true);
  }

  disconnectRole(roleCode: string): void {
    this.server?.in(`role:${roleCode}`).disconnectSockets(true);
  }

  async snapshotFor(user: Pick<AccessTokenClaims, 'sub' | 'role'>): Promise<OperatorStatusSnapshot[]> {
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

  async snapshotCafeteriaFor(user: AccessTokenClaims): Promise<CafeteriaOrderSnapshot[]> {
    return this.snapshotCafeteria(user.role === 'OPERADOR' ? user.sub : undefined);
  }

  async publishCafeteriaOrderChanged(orderId: string, eventName = 'cafeteria.order.changed'): Promise<void> {
    await this.db.afterCommit(async () => {
      if (!this.server) {
        await this.publishBridge({ target: 'cafeteria', orderId, eventName });
        return;
      }
      const order = await this.orderSnapshot(orderId);
      if (!order) return;
      this.server.to(['role:CAFETERIA', `user:${order.operatorId}`]).emit(eventName, order);
    });
  }

  private async publishBridge(event: { target: 'operator'; operatorId: string } | { target: 'cafeteria'; orderId: string; eventName: string }): Promise<void> {
    await this.redis?.publish(RealtimeService.BRIDGE_CHANNEL, JSON.stringify(event)).catch(() => undefined);
  }

  private async onBridgeMessage(message: string): Promise<void> {
    if (!this.server) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const event = parsed as { target?: string; operatorId?: string; orderId?: string; eventName?: string };
    if (event.target === 'operator' && typeof event.operatorId === 'string') {
      await this.emitOperatorChanged(event.operatorId, true);
      return;
    }
    if (event.target === 'cafeteria' && typeof event.orderId === 'string') {
      const order = await this.orderSnapshot(event.orderId);
      if (!order) return;
      this.server.local.to(['role:CAFETERIA', `user:${order.operatorId}`]).emit(event.eventName ?? 'cafeteria.order.changed', order);
    }
  }

  private async emitOperatorChanged(operatorId: string, local = false): Promise<void> {
    if (!this.server) {
      await this.publishBridge({ target: 'operator', operatorId });
      return;
    }
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
    (local ? this.server.local : this.server).to(rooms).emit('operator.status.changed', status);
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

  private async snapshotCafeteria(operatorId?: string): Promise<CafeteriaOrderSnapshot[]> {
    const rows = await this.db.db
      .select({ id: cafeteriaOrders.id, orderNumber: cafeteriaOrders.orderNumber, operatorId: cafeteriaOrders.operatorId, status: cafeteriaOrders.status, placedAt: cafeteriaOrders.placedAt, acceptedAt: cafeteriaOrders.acceptedAt, readyAt: cafeteriaOrders.readyAt, pickupDeadlineAt: cafeteriaOrders.pickupDeadlineAt, deliveredAt: cafeteriaOrders.deliveredAt, totalCop: cafeteriaOrders.totalCop, notes: cafeteriaOrders.notes })
      .from(cafeteriaOrders)
      .where(operatorId ? eq(cafeteriaOrders.operatorId, operatorId) : undefined)
      .orderBy(sql`${cafeteriaOrders.placedAt} desc`)
      .limit(100);
    return this.attachCafeteriaItems(rows);
  }

  private async orderSnapshot(orderId: string): Promise<CafeteriaOrderSnapshot | undefined> {
    const rows = await this.db.db
      .select({ id: cafeteriaOrders.id, orderNumber: cafeteriaOrders.orderNumber, operatorId: cafeteriaOrders.operatorId, status: cafeteriaOrders.status, placedAt: cafeteriaOrders.placedAt, acceptedAt: cafeteriaOrders.acceptedAt, readyAt: cafeteriaOrders.readyAt, pickupDeadlineAt: cafeteriaOrders.pickupDeadlineAt, deliveredAt: cafeteriaOrders.deliveredAt, totalCop: cafeteriaOrders.totalCop, notes: cafeteriaOrders.notes })
      .from(cafeteriaOrders)
      .where(eq(cafeteriaOrders.id, orderId))
      .limit(1);
    const [snapshot] = await this.attachCafeteriaItems(rows);
    return snapshot;
  }

  private async attachCafeteriaItems<T extends { id: string }>(rows: T[]): Promise<Array<T & { items: CafeteriaOrderSnapshot['items'] }>> {
    if (!rows.length) return [];
    const itemRows = await this.db.db
      .select({ orderId: cafeteriaOrderItems.orderId, productId: cafeteriaOrderItems.productId, productNameSnapshot: cafeteriaOrderItems.productNameSnapshot, quantity: cafeteriaOrderItems.quantity, unitPriceCop: cafeteriaOrderItems.unitPriceCop, lineTotalCop: cafeteriaOrderItems.lineTotalCop, notes: cafeteriaOrderItems.notes })
      .from(cafeteriaOrderItems)
      .where(sql`${cafeteriaOrderItems.orderId} in (${sql.join(rows.map((row) => sql`${row.id}`), sql`, `)})`);
    const byOrder = new Map<string, CafeteriaOrderSnapshot['items']>();
    for (const item of itemRows) {
      const list = byOrder.get(item.orderId) ?? [];
      list.push({ productId: item.productId, productNameSnapshot: item.productNameSnapshot, quantity: item.quantity, unitPriceCop: item.unitPriceCop, lineTotalCop: item.lineTotalCop, notes: item.notes });
      byOrder.set(item.orderId, list);
    }
    return rows.map((row) => ({ ...row, items: byOrder.get(row.id) ?? [] }));
  }
}
