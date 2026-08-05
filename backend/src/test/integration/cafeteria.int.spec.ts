import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CafeteriaService } from '../../modules/cafeteria/cafeteria.service.js';
import { cafeteriaOrderItems, cafeteriaProducts, operatorAccountEntries } from '../../database/schema/index.js';
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
