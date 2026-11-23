import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { PG_UNIQUE_VIOLATION, isPgError } from '../../database/pg-error.js';
import { DatabaseService } from '../../database/database.service.js';
import { cafeteriaOrderItems, cafeteriaOrders, cafeteriaProducts, operatorAccountEntries, users } from '../../database/schema/index.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { OrderInput, OrderListQueryInput, OrderStatusInput, ProductInput, ProductUpdateInput, SalesSummaryQueryInput } from './cafeteria.schemas.js';

/** Calendar date in Bogota: a debit at 22:00 belongs to that day, not to the next UTC day. */
function bogotaDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Colombia has no DST (fixed UTC-05:00): start of the given Bogota calendar day in UTC. */
function bogotaDayStartUtc(date: string): Date {
  return new Date(`${date}T00:00:00-05:00`);
}

function bogotaNextDayStartUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return bogotaDayStartUtc(next);
}

const DEFAULT_ORDERS_LIMIT = 200;
const ACTIVE_ORDER_STATUSES = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'];
const TOP_ITEMS_LIMIT = 5;

const transitions: Record<string, string[]> = { PLACED: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'], READY: ['DELIVERED', 'EXPIRED'], DELIVERED: [], CANCELLED: [], EXPIRED: [] };

/** Same default as cafeteria_products.pickup_deadline_minutes. */
const DEFAULT_PICKUP_DEADLINE_MINUTES = 30;

@Injectable()
export class CafeteriaService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly realtime?: RealtimeService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async createProduct(input: ProductInput, actorId?: string) {
    const [row] = await this.db.db.insert(cafeteriaProducts).values({ ...input, priceCop: input.priceCop.toFixed(2), prepMinutes: input.prepMinutes }).returning({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, priceCop: cafeteriaProducts.priceCop, isAvailable: cafeteriaProducts.isAvailable });
    await this.audit?.record({
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorUserId: actorId,
      action: 'cafeteria.product.created',
      entityType: 'cafeteria_product',
      entityId: row.id,
      result: 'SUCCESS',
      metadata: { productId: row.id, sku: row.sku, priceCop: row.priceCop, isAvailable: row.isAvailable },
    });
    return row;
  }

  async products() { return this.db.db.select({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, description: cafeteriaProducts.description, category: cafeteriaProducts.category, priceCop: cafeteriaProducts.priceCop, isAvailable: cafeteriaProducts.isAvailable, prepMinutes: cafeteriaProducts.prepMinutes, pickupDeadlineMinutes: cafeteriaProducts.pickupDeadlineMinutes, imageUri: cafeteriaProducts.imageUri, updatedAt: cafeteriaProducts.updatedAt }).from(cafeteriaProducts).where(isNull(cafeteriaProducts.deletedAt)).orderBy(cafeteriaProducts.category, cafeteriaProducts.name); }

  async updateProduct(id: string, input: ProductUpdateInput, actorId?: string) {
    const values = { ...input, priceCop: input.priceCop === undefined ? undefined : input.priceCop.toFixed(2), updatedAt: new Date() };
    const [row] = await this.db.db.update(cafeteriaProducts).set(values).where(and(eq(cafeteriaProducts.id, id), isNull(cafeteriaProducts.deletedAt))).returning({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, priceCop: cafeteriaProducts.priceCop, isAvailable: cafeteriaProducts.isAvailable, updatedAt: cafeteriaProducts.updatedAt });
    if (!row) throw new NotFoundException('Product not found');
    await this.audit?.record({
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorUserId: actorId,
      action: 'cafeteria.product.updated',
      entityType: 'cafeteria_product',
      entityId: row.id,
      result: 'SUCCESS',
      metadata: { productId: row.id, sku: row.sku, priceCop: row.priceCop, isAvailable: row.isAvailable },
    });
    return row;
  }

  async menu() { return this.db.db.select({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, description: cafeteriaProducts.description, category: cafeteriaProducts.category, priceCop: cafeteriaProducts.priceCop, prepMinutes: cafeteriaProducts.prepMinutes, pickupDeadlineMinutes: cafeteriaProducts.pickupDeadlineMinutes, imageUri: cafeteriaProducts.imageUri }).from(cafeteriaProducts).where(and(eq(cafeteriaProducts.isAvailable, true), isNull(cafeteriaProducts.deletedAt))); }

  async createOrder(input: OrderInput, operatorId: string, idempotencyKey: string) {
    if (!idempotencyKey) throw new ConflictException('Idempotency-Key is required');
    const existing = await this.findOrderSummary(operatorId, idempotencyKey);
    if (existing) return this.withOrderItems(existing);
    try {
      const order = await this.db.db.transaction(async (tx) => {
        let total = 0;
        const itemRows: Array<{ productId: string; productNameSnapshot: string; unitPriceCop: string; quantity: number; lineTotalCop: string; notes?: string }> = [];
        for (const item of input.items) {
          const product = await tx.query.cafeteriaProducts.findFirst({ where: and(eq(cafeteriaProducts.id, item.productId), eq(cafeteriaProducts.isAvailable, true), isNull(cafeteriaProducts.deletedAt)) });
          if (!product) throw new NotFoundException(`Product ${item.productId} not available`);
          const line = Number(product.priceCop) * item.quantity;
          total += line;
          itemRows.push({ productId: product.id, productNameSnapshot: product.name, unitPriceCop: Number(product.priceCop).toFixed(2), quantity: item.quantity, lineTotalCop: line.toFixed(2), notes: item.notes });
        }
        const [orderRow] = await tx.insert(cafeteriaOrders).values({ operatorId, status: 'PLACED', totalCop: total.toFixed(2), notes: input.notes, idempotencyKey }).returning({ id: cafeteriaOrders.id, orderNumber: cafeteriaOrders.orderNumber, status: cafeteriaOrders.status, totalCop: cafeteriaOrders.totalCop });
        await tx.insert(cafeteriaOrderItems).values(itemRows.map((item) => ({ ...item, orderId: orderRow.id })));
        return orderRow;
      });
      await this.realtime?.publishCafeteriaOrderChanged(order.id, 'cafeteria.order.created');
      return this.withOrderItems(order);
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) {
        const concurrent = await this.findOrderSummary(operatorId, idempotencyKey);
        if (concurrent) return this.withOrderItems(concurrent);
      }
      throw error;
    }
  }

  private async findOrderSummary(operatorId: string, idempotencyKey: string) {
    const row = await this.db.db.query.cafeteriaOrders.findFirst({
      where: and(eq(cafeteriaOrders.operatorId, operatorId), eq(cafeteriaOrders.idempotencyKey, idempotencyKey)),
      columns: { id: true, orderNumber: true, status: true, totalCop: true },
    });
    if (!row) return undefined;
    return { id: row.id, orderNumber: row.orderNumber, status: row.status, totalCop: row.totalCop };
  }

  /**
   * Kitchen roles (`cafeteria.manage`) cancel through the normal transitions. Anyone
   * else may only withdraw their own order before the kitchen accepts it.
   */
  async cancelOrder(orderId: string, reason: string | undefined, actor: { sub: string; permissions: string[] }) {
    const manages = actor.permissions.includes('*') || actor.permissions.includes('cafeteria.manage');
    const input: OrderStatusInput = { status: 'CANCELLED', cancelReason: reason };
    if (manages) return this.updateStatus(orderId, input, actor.sub);
    return this.updateStatus(orderId, input, actor.sub, { ownerId: actor.sub, from: 'PLACED' });
  }

  async updateStatus(orderId: string, input: OrderStatusInput, actorId: string, guard?: { ownerId: string; from: string }) {
    const updated = await this.db.db.transaction(async (tx) => {
      const order = await tx.query.cafeteriaOrders.findFirst({ where: eq(cafeteriaOrders.id, orderId) });
      if (!order) throw new NotFoundException('Order not found');
      if (guard && order.operatorId !== guard.ownerId) throw new ForbiddenException('Order belongs to another operator');
      if (guard && order.status !== guard.from) throw new ConflictException(`Order can no longer be cancelled (${order.status})`);
      if (!transitions[order.status]?.includes(input.status)) throw new ConflictException(`Cannot move order from ${order.status} to ${input.status}`);
      const now = new Date();
      const values: Record<string, unknown> = { status: input.status };
      if (input.status === 'ACCEPTED') values.acceptedAt = now;
      if (input.status === 'READY') { values.readyAt = now; values.pickupDeadlineAt = new Date(now.getTime() + (await this.pickupDeadlineMinutes(tx, orderId)) * 60_000); }
      if (input.status === 'DELIVERED') { values.deliveredAt = now; values.deliveredBy = actorId; }
      if (input.status === 'CANCELLED') { values.cancelledAt = now; values.cancelReason = input.cancelReason ?? 'Cancelled'; }
      // Compare-and-swap on the status read above: of two concurrent transitions only
      // the first to commit matches; the other finds the row moved on and is refused,
      // so a delivered (and debited) order can never be cancelled afterwards.
      const [updated] = await tx.update(cafeteriaOrders).set(values as never).where(and(eq(cafeteriaOrders.id, orderId), eq(cafeteriaOrders.status, order.status))).returning({ id: cafeteriaOrders.id, status: cafeteriaOrders.status, totalCop: cafeteriaOrders.totalCop });
      if (!updated) throw new ConflictException(`Order ${orderId} changed concurrently; reload it and try again`);
      if (input.status === 'DELIVERED') await tx.insert(operatorAccountEntries).values({ operatorId: order.operatorId, entryType: 'DEBIT_CAFETERIA', amountCop: `-${order.totalCop}`, referenceType: 'cafeteria_order', referenceId: order.id, businessDate: bogotaDate(now), createdBy: actorId }).onConflictDoNothing();
      return updated;
    });
    await this.realtime?.publishCafeteriaOrderChanged(updated.id);
    return this.withOrderItems(updated);
  }

  /** FR-34: the most perishable product of the order sets its pickup deadline. */
  private async pickupDeadlineMinutes(tx: Pick<DatabaseService['db'], 'select'>, orderId: string): Promise<number> {
    const [row] = await tx.select({ minutes: sql<number | null>`min(${cafeteriaProducts.pickupDeadlineMinutes})` }).from(cafeteriaOrderItems).innerJoin(cafeteriaProducts, eq(cafeteriaProducts.id, cafeteriaOrderItems.productId)).where(eq(cafeteriaOrderItems.orderId, orderId));
    return Number(row?.minutes ?? DEFAULT_PICKUP_DEADLINE_MINUTES);
  }

  async orders(query?: string | Partial<OrderListQueryInput>, operatorId?: string) {
    const filters: { status?: string; from?: string; to?: string; limit?: number; active?: boolean } = typeof query === 'string' ? { status: query } : (query ?? {});
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_ORDERS_LIMIT, 1), 500);
    const rows = await this.db.db
      .select({
        id: cafeteriaOrders.id,
        orderNumber: cafeteriaOrders.orderNumber,
        operatorId: cafeteriaOrders.operatorId,
        operatorName: users.fullName,
        status: cafeteriaOrders.status,
        placedAt: cafeteriaOrders.placedAt,
        acceptedAt: cafeteriaOrders.acceptedAt,
        readyAt: cafeteriaOrders.readyAt,
        pickupDeadlineAt: cafeteriaOrders.pickupDeadlineAt,
        deliveredAt: cafeteriaOrders.deliveredAt,
        cancelledAt: cafeteriaOrders.cancelledAt,
        cancelReason: cafeteriaOrders.cancelReason,
        totalCop: cafeteriaOrders.totalCop,
        notes: cafeteriaOrders.notes,
      })
      .from(cafeteriaOrders)
      .leftJoin(users, eq(users.id, cafeteriaOrders.operatorId))
      .where(and(
        filters.status ? eq(cafeteriaOrders.status, filters.status) : undefined,
        filters.active ? inArray(cafeteriaOrders.status, ACTIVE_ORDER_STATUSES) : undefined,
        operatorId ? eq(cafeteriaOrders.operatorId, operatorId) : undefined,
        filters.from ? gte(cafeteriaOrders.placedAt, bogotaDayStartUtc(filters.from)) : undefined,
        filters.to ? lt(cafeteriaOrders.placedAt, bogotaNextDayStartUtc(filters.to)) : undefined,
      ))
      .orderBy(desc(cafeteriaOrders.placedAt))
      .limit(limit);
    const seq = this.realtime?.nextSeq();
    const withItems = await this.attachItems(rows);
    return seq === undefined ? withItems : withItems.map((row) => ({ ...row, seq }));
  }

  /**
   * Sales closure for a Bogota date range, aggregated in Postgres so the totals cover
   * every order in the range, not only the rows a bounded history page returns.
   */
  async salesSummary(query: SalesSummaryQueryInput) {
    const inRange = and(
      gte(cafeteriaOrders.placedAt, bogotaDayStartUtc(query.from)),
      lt(cafeteriaOrders.placedAt, bogotaNextDayStartUtc(query.to)),
    );
    const delivered = sql`${cafeteriaOrders.status} = 'DELIVERED'`;
    const [totals] = await this.db.db
      .select({
        totalOrders: sql<number>`count(*)::int`,
        deliveredCount: sql<number>`(count(*) filter (where ${delivered}))::int`,
        deliveredTotalCop: sql<string>`coalesce(sum(${cafeteriaOrders.totalCop}) filter (where ${delivered}), 0)::numeric(14,2)::text`,
        averageTicketCop: sql<string>`coalesce(avg(${cafeteriaOrders.totalCop}) filter (where ${delivered}), 0)::numeric(14,2)::text`,
        cancelledCount: sql<number>`(count(*) filter (where ${cafeteriaOrders.status} = 'CANCELLED'))::int`,
        expiredCount: sql<number>`(count(*) filter (where ${cafeteriaOrders.status} = 'EXPIRED'))::int`,
      })
      .from(cafeteriaOrders)
      .where(inRange);
    const quantity = sql<number>`sum(${cafeteriaOrderItems.quantity})::int`;
    const revenue = sql<string>`sum(${cafeteriaOrderItems.lineTotalCop})::numeric(14,2)::text`;
    const topItems = await this.db.db
      .select({ name: cafeteriaOrderItems.productNameSnapshot, quantity, revenueCop: revenue })
      .from(cafeteriaOrderItems)
      .innerJoin(cafeteriaOrders, eq(cafeteriaOrders.id, cafeteriaOrderItems.orderId))
      .where(and(inRange, eq(cafeteriaOrders.status, 'DELIVERED')))
      .groupBy(cafeteriaOrderItems.productNameSnapshot)
      .orderBy(desc(sql`sum(${cafeteriaOrderItems.quantity})`), desc(sql`sum(${cafeteriaOrderItems.lineTotalCop})`), cafeteriaOrderItems.productNameSnapshot)
      .limit(TOP_ITEMS_LIMIT);
    const totalOrders = Number(totals?.totalOrders ?? 0);
    const deliveredCount = Number(totals?.deliveredCount ?? 0);
    const cancelledCount = Number(totals?.cancelledCount ?? 0);
    const expiredCount = Number(totals?.expiredCount ?? 0);
    return {
      from: query.from,
      to: query.to,
      totalOrders,
      deliveredCount,
      deliveredTotalCop: totals?.deliveredTotalCop ?? '0.00',
      averageTicketCop: totals?.averageTicketCop ?? '0.00',
      cancelledCount,
      expiredCount,
      inProgressCount: totalOrders - deliveredCount - cancelledCount - expiredCount,
      topItems: topItems.map((item) => ({ name: item.name, quantity: Number(item.quantity), revenueCop: item.revenueCop })),
    };
  }

  async account(operatorId: string) {
    const [balance] = await this.db.db.select({ balance: sql<string>`coalesce(sum(${operatorAccountEntries.amountCop}), 0)` }).from(operatorAccountEntries).where(eq(operatorAccountEntries.operatorId, operatorId));
    // Same calendar as the debit itself: the month in Bogota, by business date.
    const firstOfMonth = `${bogotaDate(new Date()).slice(0, 7)}-01`;
    const [consumption] = await this.db.db.select({ consumedCop: sql<string>`coalesce(sum(abs(${operatorAccountEntries.amountCop})), 0)` }).from(operatorAccountEntries).where(and(eq(operatorAccountEntries.operatorId, operatorId), eq(operatorAccountEntries.entryType, 'DEBIT_CAFETERIA'), gte(operatorAccountEntries.businessDate, firstOfMonth)));
    return { balanceCop: balance?.balance ?? '0', monthConsumedCop: consumption?.consumedCop ?? '0' };
  }

  private async withOrderItems<T extends { id: string }>(order: T) {
    const [withItems] = await this.attachItems([order]);
    return withItems ?? { ...order, items: [] };
  }

  private async attachItems<T extends { id: string }>(rows: T[]) {
    if (!rows.length) return rows.map((row) => ({ ...row, items: [] }));
    const itemRows = await this.db.db.select({ orderId: cafeteriaOrderItems.orderId, productId: cafeteriaOrderItems.productId, productNameSnapshot: cafeteriaOrderItems.productNameSnapshot, quantity: cafeteriaOrderItems.quantity, unitPriceCop: cafeteriaOrderItems.unitPriceCop, lineTotalCop: cafeteriaOrderItems.lineTotalCop, notes: cafeteriaOrderItems.notes }).from(cafeteriaOrderItems).where(inArray(cafeteriaOrderItems.orderId, rows.map((row) => row.id)));
    const byOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) byOrder.set(item.orderId, [...(byOrder.get(item.orderId) ?? []), item]);
    return rows.map((row) => ({ ...row, items: (byOrder.get(row.id) ?? []).map(({ orderId: _orderId, ...item }) => item) }));
  }
}
