import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CafeteriaService } from '../../modules/cafeteria/cafeteria.service.js';
import { cafeteriaOrderItems, cafeteriaOrders, cafeteriaProducts, operatorAccountEntries } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let cafeteria: CafeteriaService;

beforeAll(async () => {
  ctx = await createTestContext();
  cafeteria = new CafeteriaService(ctx.database);
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

const LUNCH = { sku: 'ALM-01', name: 'Almuerzo del dia', category: 'almuerzos', priceCop: 12500, pickupDeadlineMinutes: 30 };
const COFFEE = { sku: 'CAF-01', name: 'Cafe', category: 'bebidas', priceCop: 2500, pickupDeadlineMinutes: 15 };

describe('cafeteria catalogue', () => {
  it('hides unavailable and deleted products from the operator menu', async () => {
    const lunch = await cafeteria.createProduct(LUNCH);
    const coffee = await cafeteria.createProduct(COFFEE);
    await cafeteria.updateProduct(coffee.id, { isAvailable: false });
    const [gone] = await ctx.db
      .insert(cafeteriaProducts)
      .values({ sku: 'X-01', name: 'Retirado', category: 'x', priceCop: '1000.00', deletedAt: new Date() })
      .returning({ id: cafeteriaProducts.id });

    const menu = await cafeteria.menu();
    expect(menu.map((item) => item.id)).toEqual([lunch.id]);

    // El catalogo de administracion si ve el no disponible, pero no el borrado.
    const catalogue = await cafeteria.products();
    expect(catalogue.map((item) => item.id).sort()).toEqual([coffee.id, lunch.id].sort());
    expect(catalogue.map((item) => item.id)).not.toContain(gone.id);
  });

  it('rejects updating a product that does not exist', async () => {
    await expect(cafeteria.updateProduct('11111111-1111-1111-1111-111111111111', { priceCop: 1 })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('placing an order', () => {
  it('totals from the price at the time and snapshots each line', async () => {
    const operator = await createUser(ctx);
    const lunch = await cafeteria.createProduct(LUNCH);
    const coffee = await cafeteria.createProduct(COFFEE);

    const order = await cafeteria.createOrder(
      { items: [{ productId: lunch.id, quantity: 2 }, { productId: coffee.id, quantity: 1 }] },
      operator.id,
      'key-1',
    );
    expect(order.totalCop).toBe('27500.00');

    const items = await ctx.db
      .select({ name: cafeteriaOrderItems.productNameSnapshot, unit: cafeteriaOrderItems.unitPriceCop, total: cafeteriaOrderItems.lineTotalCop })
      .from(cafeteriaOrderItems)
      .where(eq(cafeteriaOrderItems.orderId, order.id));
    expect(items).toHaveLength(2);

    // Subir el precio no reescribe el pedido de ayer.
    await cafeteria.updateProduct(lunch.id, { priceCop: 20000 });
    const unchanged = await ctx.db
      .select({ unit: cafeteriaOrderItems.unitPriceCop })
      .from(cafeteriaOrderItems)
      .where(eq(cafeteriaOrderItems.orderId, order.id));
    expect(unchanged.map((row) => row.unit).sort()).toEqual(['12500.00', '2500.00']);
  });

  it('is idempotent: the same key returns the same order', async () => {
    const operator = await createUser(ctx);
    const lunch = await cafeteria.createProduct(LUNCH);
    const input = { items: [{ productId: lunch.id, quantity: 1 }] };

    const first = await cafeteria.createOrder(input, operator.id, 'key-repeat');
    const second = await cafeteria.createOrder(input, operator.id, 'key-repeat');

    expect(second.id).toBe(first.id);
    expect(await cafeteria.orders(undefined, operator.id)).toHaveLength(1);
  });

  it('scopes the idempotency key to the operator', async () => {
    const first = await createUser(ctx);
    const second = await createUser(ctx);
    const lunch = await cafeteria.createProduct(LUNCH);
    const input = { items: [{ productId: lunch.id, quantity: 1 }] };

    const a = await cafeteria.createOrder(input, first.id, 'same-key');
    const b = await cafeteria.createOrder(input, second.id, 'same-key');
    expect(b.id).not.toBe(a.id);
  });

  it('rolls the whole order back if one line is unavailable', async () => {
    const operator = await createUser(ctx);
    const lunch = await cafeteria.createProduct(LUNCH);
    const coffee = await cafeteria.createProduct(COFFEE);
    await cafeteria.updateProduct(coffee.id, { isAvailable: false });

    await expect(
      cafeteria.createOrder({ items: [{ productId: lunch.id, quantity: 1 }, { productId: coffee.id, quantity: 1 }] }, operator.id, 'key-2'),
    ).rejects.toThrow(NotFoundException);

    // Ni el pedido ni la linea buena quedan a medias.
    expect(await cafeteria.orders(undefined, operator.id)).toHaveLength(0);
    expect(await ctx.db.select({ id: cafeteriaOrderItems.id }).from(cafeteriaOrderItems)).toHaveLength(0);
  });

  it('rejects a soft-deleted product even if isAvailable is still true (A5)', async () => {
    const operator = await createUser(ctx);
    const lunch = await cafeteria.createProduct(LUNCH);
    await ctx.pool.query('UPDATE cafeteria_products SET deleted_at = now() WHERE id = $1', [lunch.id]);

    await expect(
      cafeteria.createOrder({ items: [{ productId: lunch.id, quantity: 1 }] }, operator.id, 'key-deleted'),
    ).rejects.toThrow(NotFoundException);
  });

  it('deterministically triggers 23505 inside withRequestContext savepoint and returns a consistent response shape (A5)', async () => {
    const operator = await createUser(ctx);
    const lunch = await cafeteria.createProduct(LUNCH);
    const input = { items: [{ productId: lunch.id, quantity: 2 }] };

    // Synchronize both calls right after the pre-check returns undefined so both
    // enter tx.transaction (SAVEPOINT) concurrently and the loser deterministically hits 23505.
    const target = cafeteria as unknown as { findOrderSummary: (op: string, key: string) => Promise<unknown> };
    const origFind = target.findOrderSummary.bind(cafeteria);
    let precheckHits = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const spy = vi.spyOn(target, 'findOrderSummary').mockImplementation(async (op: string, key: string) => {
      const res = await origFind(op, key);
      if (res === undefined) {
        precheckHits += 1;
        if (precheckHits === 2) releaseBarrier();
        await barrier;
      }
      return res;
    });

    try {
      const [first, second] = await Promise.all([
        ctx.database.withRequestContext(operator.id, 'OPERADOR', () => cafeteria.createOrder(input, operator.id, 'race-key-1')),
        ctx.database.withRequestContext(operator.id, 'OPERADOR', () => cafeteria.createOrder(input, operator.id, 'race-key-1')),
      ]);

      expect(precheckHits).toBe(2);
      expect(second.id).toBe(first.id);
      expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
      expect(second).toEqual(first);
      expect(await cafeteria.orders(undefined, operator.id)).toHaveLength(1);
      expect(await ctx.db.select({ id: cafeteriaOrderItems.id }).from(cafeteriaOrderItems)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the kitchen flow and the debit', () => {
  let sequence = 0;

  async function placedOrder(): Promise<{ operatorId: string; orderId: string; kitchenId: string }> {
    sequence += 1;
    const operator = await createUser(ctx);
    const kitchen = await createUser(ctx, { role: 'CAFETERIA' });
    const lunch = await cafeteria.createProduct({ ...LUNCH, sku: `ALM-${sequence}` });
    const order = await cafeteria.createOrder({ items: [{ productId: lunch.id, quantity: 2 }] }, operator.id, `key-${sequence}`);
    return { operatorId: operator.id, orderId: order.id, kitchenId: kitchen.id };
  }

  it('walks PLACED to DELIVERED and debits the operator once', async () => {
    const { operatorId, orderId, kitchenId } = await placedOrder();

    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'] as const) {
      await cafeteria.updateStatus(orderId, { status }, kitchenId);
    }

    const entries = await ctx.db
      .select({ amountCop: operatorAccountEntries.amountCop, entryType: operatorAccountEntries.entryType })
      .from(operatorAccountEntries)
      .where(eq(operatorAccountEntries.operatorId, operatorId));
    expect(entries).toEqual([{ amountCop: '-25000.00', entryType: 'DEBIT_CAFETERIA' }]);

    const account = await cafeteria.account(operatorId);
    expect(account.balanceCop).toBe('-25000.00');
    expect(account.monthConsumedCop).toBe('25000.00');
  });

  it('refuses an invalid transition without touching the order', async () => {
    const { orderId, kitchenId } = await placedOrder();

    await expect(cafeteria.updateStatus(orderId, { status: 'DELIVERED' }, kitchenId)).rejects.toThrow(ConflictException);
    const [order] = await cafeteria.orders(undefined, undefined);
    expect(order.status).toBe('PLACED');
    expect(await ctx.db.select({ id: operatorAccountEntries.id }).from(operatorAccountEntries)).toHaveLength(0);
  });

  it('cannot be delivered twice, so the debit cannot double', async () => {
    const { operatorId, orderId, kitchenId } = await placedOrder();
    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'] as const) {
      await cafeteria.updateStatus(orderId, { status }, kitchenId);
    }

    await expect(cafeteria.updateStatus(orderId, { status: 'DELIVERED' }, kitchenId)).rejects.toThrow(ConflictException);
    expect(await ctx.db.select({ id: operatorAccountEntries.id }).from(operatorAccountEntries).where(eq(operatorAccountEntries.operatorId, operatorId))).toHaveLength(1);
  });

  it('sets a pickup deadline when the order is ready', async () => {
    const { orderId, kitchenId } = await placedOrder();
    await cafeteria.updateStatus(orderId, { status: 'ACCEPTED' }, kitchenId);
    await cafeteria.updateStatus(orderId, { status: 'PREPARING' }, kitchenId);
    await cafeteria.updateStatus(orderId, { status: 'READY' }, kitchenId);

    const [order] = await cafeteria.orders('READY');
    expect(order.readyAt).toBeInstanceOf(Date);
    expect(order.pickupDeadlineAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('lets only one of two concurrent transitions win, and debits a delivered order once', async () => {
    // CAF-02: "dos entregas concurrentes producen una sola transición/débito".
    // A third connection holds the row lock, so both transitions read READY and then
    // queue on the UPDATE; releasing it makes the race deterministic.
    // Pairs that are both valid from the starting status, so the SQL compare-and-swap
    // (not the transition table) is what decides the winner.
    const races = [
      { from: 'READY', first: { status: 'DELIVERED' }, second: { status: 'DELIVERED' } },
      { from: 'PREPARING', first: { status: 'READY' }, second: { status: 'CANCELLED', cancelReason: 'carrera' } },
    ] as const;
    for (const race of races) {
      const { operatorId, orderId, kitchenId } = await placedOrder();
      const path = race.from === 'READY' ? (['ACCEPTED', 'PREPARING', 'READY'] as const) : (['ACCEPTED', 'PREPARING'] as const);
      for (const status of path) await cafeteria.updateStatus(orderId, { status }, kitchenId);

      const blocker = await ctx.pool.connect();
      let results: PromiseSettledResult<unknown>[];
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM cafeteria_orders WHERE id = $1 FOR UPDATE', [orderId]);
        const racing = Promise.allSettled([cafeteria.updateStatus(orderId, race.first, kitchenId), cafeteria.updateStatus(orderId, race.second, kitchenId)]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await blocker.query('COMMIT');
        results = await racing;
      } finally {
        blocker.release();
      }

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(String(rejected.reason.message)).toMatch(/changed concurrently/);
      const [order] = await ctx.db.select({ status: cafeteriaOrders.status }).from(cafeteriaOrders).where(eq(cafeteriaOrders.id, orderId));
      const debits = await ctx.db.select({ id: operatorAccountEntries.id }).from(operatorAccountEntries).where(eq(operatorAccountEntries.operatorId, operatorId));
      expect(debits).toHaveLength(order.status === 'DELIVERED' ? 1 : 0);
    }
  });

  it('uses the shortest pickup deadline among the ordered products', async () => {
    const operator = await createUser(ctx);
    const kitchen = await createUser(ctx, { role: 'CAFETERIA' });
    const lunch = await cafeteria.createProduct({ ...LUNCH, sku: 'ALM-DL' });
    const coffee = await cafeteria.createProduct({ ...COFFEE, sku: 'CAF-DL' });
    const order = await cafeteria.createOrder({ items: [{ productId: lunch.id, quantity: 1 }, { productId: coffee.id, quantity: 1 }] }, operator.id, 'key-deadline');
    for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) await cafeteria.updateStatus(order.id, { status }, kitchen.id);

    const [ready] = await cafeteria.orders('READY');
    // Coffee allows 15 minutes, lunch 30: the coffee decides.
    expect(ready.pickupDeadlineAt!.getTime() - ready.readyAt!.getTime()).toBe(15 * 60_000);
  });

  it('dates the debit in Bogota, so an order delivered at 22:00 counts on that day', async () => {
    const { operatorId, orderId, kitchenId } = await placedOrder();
    for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) await cafeteria.updateStatus(orderId, { status }, kitchenId);

    // 2026-08-04 03:00Z is 2026-08-03 22:00 in Bogota.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-04T03:00:00Z') });
    try {
      await cafeteria.updateStatus(orderId, { status: 'DELIVERED' }, kitchenId);
    } finally {
      vi.useRealTimers();
    }

    const [entry] = await ctx.db.select({ businessDate: operatorAccountEntries.businessDate }).from(operatorAccountEntries).where(eq(operatorAccountEntries.operatorId, operatorId));
    expect(entry.businessDate).toBe('2026-08-03');
  });

  it('counts the month consumption by the Bogota business date of the debit', async () => {
    const { operatorId, orderId, kitchenId } = await placedOrder();
    for (const status of ['ACCEPTED', 'PREPARING', 'READY'] as const) await cafeteria.updateStatus(orderId, { status }, kitchenId);
    // Delivered on 2026-08-31 22:00 Bogota (2026-09-01 03:00Z): an August debit.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-01T03:00:00Z') });
    try {
      await cafeteria.updateStatus(orderId, { status: 'DELIVERED' }, kitchenId);
      // Still 2026-08-31 in Bogota: August's consumption includes it.
      vi.setSystemTime(new Date('2026-09-01T04:30:00Z'));
      expect((await cafeteria.account(operatorId)).monthConsumedCop).toBe('25000.00');
      // 2026-09-01 in Bogota: a new month, nothing consumed yet.
      vi.setSystemTime(new Date('2026-09-01T06:00:00Z'));
      expect((await cafeteria.account(operatorId)).monthConsumedCop).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not debit a cancelled order', async () => {
    const { operatorId, orderId, kitchenId } = await placedOrder();
    await cafeteria.updateStatus(orderId, { status: 'CANCELLED', cancelReason: 'sin ingredientes' }, kitchenId);

    expect(await cafeteria.account(operatorId)).toMatchObject({ balanceCop: '0', monthConsumedCop: '0' });
  });

  it('lists the kitchen queue newest first, and filters by status', async () => {
    const { orderId, kitchenId } = await placedOrder();
    await placedOrder();
    await cafeteria.updateStatus(orderId, { status: 'ACCEPTED' }, kitchenId);

    expect(await cafeteria.orders('PLACED')).toHaveLength(1);
    expect(await cafeteria.orders('ACCEPTED')).toHaveLength(1);
    expect(await cafeteria.orders()).toHaveLength(2);
  });
});
