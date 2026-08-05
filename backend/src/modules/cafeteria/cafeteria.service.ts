import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { cafeteriaOrderItems, cafeteriaOrders, cafeteriaProducts, operatorAccountEntries } from '../../database/schema/index.js';
import type { OrderInput, OrderStatusInput, ProductInput, ProductUpdateInput } from './cafeteria.schemas.js';

const transitions: Record<string, string[]> = { PLACED: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'], READY: ['DELIVERED', 'EXPIRED'], DELIVERED: [], CANCELLED: [], EXPIRED: [] };

@Injectable()
export class CafeteriaService {
  constructor(private readonly db: DatabaseService) {}

  async createProduct(input: ProductInput) {
    const [row] = await this.db.db.insert(cafeteriaProducts).values({ ...input, priceCop: input.priceCop.toFixed(2), prepMinutes: input.prepMinutes }).returning({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, priceCop: cafeteriaProducts.priceCop, isAvailable: cafeteriaProducts.isAvailable });
    return row;
  }

  async products() { return this.db.db.select({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, description: cafeteriaProducts.description, category: cafeteriaProducts.category, priceCop: cafeteriaProducts.priceCop, isAvailable: cafeteriaProducts.isAvailable, prepMinutes: cafeteriaProducts.prepMinutes, pickupDeadlineMinutes: cafeteriaProducts.pickupDeadlineMinutes, imageUri: cafeteriaProducts.imageUri, updatedAt: cafeteriaProducts.updatedAt }).from(cafeteriaProducts).where(isNull(cafeteriaProducts.deletedAt)).orderBy(cafeteriaProducts.category, cafeteriaProducts.name); }

  async updateProduct(id: string, input: ProductUpdateInput) {
    const values = { ...input, priceCop: input.priceCop === undefined ? undefined : input.priceCop.toFixed(2), updatedAt: new Date() };
    const [row] = await this.db.db.update(cafeteriaProducts).set(values).where(and(eq(cafeteriaProducts.id, id), isNull(cafeteriaProducts.deletedAt))).returning({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, priceCop: cafeteriaProducts.priceCop, isAvailable: cafeteriaProducts.isAvailable, updatedAt: cafeteriaProducts.updatedAt });
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  async menu() { return this.db.db.select({ id: cafeteriaProducts.id, sku: cafeteriaProducts.sku, name: cafeteriaProducts.name, description: cafeteriaProducts.description, category: cafeteriaProducts.category, priceCop: cafeteriaProducts.priceCop, prepMinutes: cafeteriaProducts.prepMinutes, pickupDeadlineMinutes: cafeteriaProducts.pickupDeadlineMinutes, imageUri: cafeteriaProducts.imageUri }).from(cafeteriaProducts).where(and(eq(cafeteriaProducts.isAvailable, true), isNull(cafeteriaProducts.deletedAt))); }

  async createOrder(input: OrderInput, operatorId: string, idempotencyKey: string) {
    if (!idempotencyKey) throw new ConflictException('Idempotency-Key is required');
    const existing = await this.db.db.query.cafeteriaOrders.findFirst({ where: and(eq(cafeteriaOrders.operatorId, operatorId), eq(cafeteriaOrders.idempotencyKey, idempotencyKey)) });
    if (existing) return existing;
    return this.db.db.transaction(async (tx) => {
      let total = 0;
      const itemRows: Array<{ productId: string; productNameSnapshot: string; unitPriceCop: string; quantity: number; lineTotalCop: string; notes?: string }> = [];
      for (const item of input.items) {
        const product = await tx.query.cafeteriaProducts.findFirst({ where: and(eq(cafeteriaProducts.id, item.productId), eq(cafeteriaProducts.isAvailable, true)) });
        if (!product) throw new NotFoundException(`Product ${item.productId} not available`);
        const line = Number(product.priceCop) * item.quantity;
        total += line;
        itemRows.push({ productId: product.id, productNameSnapshot: product.name, unitPriceCop: Number(product.priceCop).toFixed(2), quantity: item.quantity, lineTotalCop: line.toFixed(2), notes: item.notes });
      }
      const [order] = await tx.insert(cafeteriaOrders).values({ operatorId, status: 'PLACED', totalCop: total.toFixed(2), notes: input.notes, idempotencyKey }).returning({ id: cafeteriaOrders.id, orderNumber: cafeteriaOrders.orderNumber, status: cafeteriaOrders.status, totalCop: cafeteriaOrders.totalCop });
      await tx.insert(cafeteriaOrderItems).values(itemRows.map((item) => ({ ...item, orderId: order.id })));
      return order;
    });
  }

  async updateStatus(orderId: string, input: OrderStatusInput, actorId: string) {
    return this.db.db.transaction(async (tx) => {
      const order = await tx.query.cafeteriaOrders.findFirst({ where: eq(cafeteriaOrders.id, orderId) });
      if (!order) throw new NotFoundException('Order not found');
      if (!transitions[order.status]?.includes(input.status)) throw new ConflictException(`Cannot move order from ${order.status} to ${input.status}`);
      const now = new Date();
      const values: Record<string, unknown> = { status: input.status };
      if (input.status === 'ACCEPTED') values.acceptedAt = now;
      if (input.status === 'READY') { values.readyAt = now; values.pickupDeadlineAt = new Date(now.getTime() + 30 * 60_000); }
      if (input.status === 'DELIVERED') { values.deliveredAt = now; values.deliveredBy = actorId; }
      if (input.status === 'CANCELLED') { values.cancelledAt = now; values.cancelReason = input.cancelReason ?? 'Cancelled'; }
      const [updated] = await tx.update(cafeteriaOrders).set(values as never).where(eq(cafeteriaOrders.id, orderId)).returning({ id: cafeteriaOrders.id, status: cafeteriaOrders.status, totalCop: cafeteriaOrders.totalCop });
      if (input.status === 'DELIVERED') await tx.insert(operatorAccountEntries).values({ operatorId: order.operatorId, entryType: 'DEBIT_CAFETERIA', amountCop: `-${order.totalCop}`, referenceType: 'cafeteria_order', referenceId: order.id, businessDate: now.toISOString().slice(0, 10), createdBy: actorId }).onConflictDoNothing();
      return updated;
    });
  }

  async orders(status?: string, operatorId?: string) {
    return this.db.db.select({ id: cafeteriaOrders.id, orderNumber: cafeteriaOrders.orderNumber, operatorId: cafeteriaOrders.operatorId, status: cafeteriaOrders.status, placedAt: cafeteriaOrders.placedAt, readyAt: cafeteriaOrders.readyAt, pickupDeadlineAt: cafeteriaOrders.pickupDeadlineAt, totalCop: cafeteriaOrders.totalCop, notes: cafeteriaOrders.notes }).from(cafeteriaOrders).where(and(status ? eq(cafeteriaOrders.status, status) : undefined, operatorId ? eq(cafeteriaOrders.operatorId, operatorId) : undefined)).orderBy(desc(cafeteriaOrders.placedAt));
  }

  async account(operatorId: string) {
    const [balance] = await this.db.db.select({ balance: sql<string>`coalesce(sum(${operatorAccountEntries.amountCop}), 0)` }).from(operatorAccountEntries).where(eq(operatorAccountEntries.operatorId, operatorId));
    const firstOfMonth = new Date();
    firstOfMonth.setUTCDate(1); firstOfMonth.setUTCHours(0, 0, 0, 0);
    const [consumption] = await this.db.db.select({ consumedCop: sql<string>`coalesce(sum(abs(${operatorAccountEntries.amountCop})), 0)` }).from(operatorAccountEntries).where(and(eq(operatorAccountEntries.operatorId, operatorId), eq(operatorAccountEntries.entryType, 'DEBIT_CAFETERIA'), sql`${operatorAccountEntries.createdAt} >= ${firstOfMonth}`));
    return { balanceCop: balance?.balance ?? '0', monthConsumedCop: consumption?.consumedCop ?? '0' };
  }
}
