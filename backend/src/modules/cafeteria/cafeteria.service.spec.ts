import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CafeteriaService } from './cafeteria.service.js';
import { createFakeDatabase, type FakeDatabase } from '../../test/support/fake-db.js';
import type { OrderStatusInput } from './cafeteria.schemas.js';

const ORDER = '11111111-1111-1111-1111-111111111111';
const OPERATOR = '22222222-2222-2222-2222-222222222222';
const ACTOR = '33333333-3333-3333-3333-333333333333';

function harness(): { service: CafeteriaService; db: FakeDatabase } {
  const db = createFakeDatabase();
  return { service: new CafeteriaService(db.service), db };
}

function realtimeHarness(): { service: CafeteriaService; db: FakeDatabase; realtime: { publishCafeteriaOrderChanged: ReturnType<typeof vi.fn> } } {
  const db = createFakeDatabase();
  const realtime = { publishCafeteriaOrderChanged: vi.fn().mockResolvedValue(undefined) };
  return { service: new CafeteriaService(db.service, realtime as never), db, realtime };
}

function withOrder(db: FakeDatabase, status: string, totalCop = '15000.00'): void {
  db.stub('cafeteria_orders').findFirst({ id: ORDER, operatorId: OPERATOR, status, totalCop });
  db.stub('cafeteria_orders').returning([{ id: ORDER, status, totalCop }]);
}

const move = (status: OrderStatusInput['status']): OrderStatusInput => ({ status });

describe('CafeteriaService order state machine', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('allows each forward transition', async () => {
    const allowed: Array<[string, OrderStatusInput['status']]> = [
      ['PLACED', 'ACCEPTED'],
      ['ACCEPTED', 'PREPARING'],
      ['PREPARING', 'READY'],
      ['READY', 'DELIVERED'],
    ];
    for (const [from, to] of allowed) {
      const local = harness();
      withOrder(local.db, from);
      await expect(local.service.updateStatus(ORDER, move(to), ACTOR)).resolves.toBeDefined();
    }
  });

  it('rejects skipping a step or moving backwards', async () => {
    const rejected: Array<[string, OrderStatusInput['status']]> = [
      ['PLACED', 'READY'],
      ['PLACED', 'DELIVERED'],
      ['ACCEPTED', 'DELIVERED'],
      ['READY', 'PREPARING'],
      ['READY', 'CANCELLED'],
    ];
    for (const [from, to] of rejected) {
      const local = harness();
      withOrder(local.db, from);
      await expect(local.service.updateStatus(ORDER, move(to), ACTOR)).rejects.toThrow(ConflictException);
      expect(local.db.updated('cafeteria_orders')).toHaveLength(0);
    }
  });

  it('treats DELIVERED, CANCELLED and EXPIRED as final', async () => {
    for (const from of ['DELIVERED', 'CANCELLED', 'EXPIRED']) {
      const local = harness();
      withOrder(local.db, from);
      await expect(local.service.updateStatus(ORDER, move('ACCEPTED'), ACTOR)).rejects.toThrow(ConflictException);
    }
  });

  it('debits the operator account exactly once, on delivery', async () => {
    // FR-35: el cobro del pedido va en la misma transaccion que la entrega.
    withOrder(h.db, 'READY');
    await h.service.updateStatus(ORDER, move('DELIVERED'), ACTOR);

    const entries = h.db.inserted('operator_account_entries') as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      operatorId: OPERATOR,
      entryType: 'DEBIT_CAFETERIA',
      amountCop: '-15000.00',
      referenceType: 'cafeteria_order',
      referenceId: ORDER,
    });
    expect(h.db.transactions()).toBe(1);
  });

  it('does not debit on any transition other than delivery', async () => {
    for (const [from, to] of [
      ['PLACED', 'ACCEPTED'],
      ['ACCEPTED', 'PREPARING'],
      ['PREPARING', 'READY'],
      ['PLACED', 'CANCELLED'],
    ] as Array<[string, OrderStatusInput['status']]>) {
      const local = harness();
      withOrder(local.db, from);
      await local.service.updateStatus(ORDER, move(to), ACTOR);
      expect(local.db.inserted('operator_account_entries')).toHaveLength(0);
    }
  });

  it('sets a pickup deadline when the order becomes READY', async () => {
    withOrder(h.db, 'PREPARING');
    const before = Date.now();
    await h.service.updateStatus(ORDER, move('READY'), ACTOR);

    const patch = h.db.updated('cafeteria_orders')[0] as { readyAt: Date; pickupDeadlineAt: Date };
    expect(patch.readyAt).toBeInstanceOf(Date);
    expect(patch.pickupDeadlineAt.getTime()).toBeGreaterThan(before);
  });

  it('stamps who delivered the order', async () => {
    withOrder(h.db, 'READY');
    await h.service.updateStatus(ORDER, move('DELIVERED'), ACTOR);
    expect(h.db.updated('cafeteria_orders')[0]).toMatchObject({ deliveredBy: ACTOR });
  });

  it('records a reason on cancellation, defaulting when none is given', async () => {
    withOrder(h.db, 'PLACED');
    await h.service.updateStatus(ORDER, { status: 'CANCELLED' }, ACTOR);
    expect(h.db.updated('cafeteria_orders')[0]).toMatchObject({ cancelReason: 'Cancelled' });

    const explicit = harness();
    withOrder(explicit.db, 'PLACED');
    await explicit.service.updateStatus(ORDER, { status: 'CANCELLED', cancelReason: 'sin stock' }, ACTOR);
    expect(explicit.db.updated('cafeteria_orders')[0]).toMatchObject({ cancelReason: 'sin stock' });
  });

  it('rejects an unknown order', async () => {
    h.db.stub('cafeteria_orders').findFirst(undefined);
    await expect(h.service.updateStatus(ORDER, move('ACCEPTED'), ACTOR)).rejects.toThrow(NotFoundException);
  });
});

describe('CafeteriaService.createOrder', () => {
  it('publishes a created order only after the transaction resolves', async () => {
    const { service, db, realtime } = realtimeHarness();
    db.stub('cafeteria_orders').findFirst(undefined);
    db.stub('cafeteria_products').findFirst({ id: 'p-1', name: 'Tinto', priceCop: '3500.00', isAvailable: true });
    db.stub('cafeteria_orders').returning([{ id: ORDER, orderNumber: 8, status: 'PLACED', totalCop: '3500.00' }]);

    await service.createOrder({ items: [{ productId: 'p-1', quantity: 1 }] }, OPERATOR, 'key-event');

    expect(db.transactions()).toBe(1);
    expect(realtime.publishCafeteriaOrderChanged).toHaveBeenCalledWith(ORDER, 'cafeteria.order.created');
  });

  it('requires an idempotency key', async () => {
    const { service } = harness();
    await expect(
      service.createOrder({ items: [{ productId: ORDER, quantity: 1 }] }, OPERATOR, ''),
    ).rejects.toThrow(ConflictException);
  });

  it('returns the existing order instead of placing a duplicate', async () => {
    const { service, db } = harness();
    db.stub('cafeteria_orders').findFirst({ id: ORDER, status: 'PLACED', totalCop: '9000.00' });

    const result = await service.createOrder({ items: [{ productId: ORDER, quantity: 1 }] }, OPERATOR, 'key-1');

    expect(result).toMatchObject({ id: ORDER });
    expect(db.inserted('cafeteria_orders')).toHaveLength(0);
    expect(db.transactions()).toBe(0);
  });

  it('snapshots name and price per line and totals from the snapshot', async () => {
    // Un cambio de precio manana no puede reescribir el pedido de hoy.
    const { service, db } = harness();
    db.stub('cafeteria_orders').findFirst(undefined);
    db.stub('cafeteria_products').findFirst({ id: 'p-1', name: 'Almuerzo', priceCop: '12500.00', isAvailable: true });
    db.stub('cafeteria_orders').returning([{ id: ORDER, orderNumber: 7, status: 'PLACED', totalCop: '25000.00' }]);

    await service.createOrder({ items: [{ productId: 'p-1', quantity: 2 }] }, OPERATOR, 'key-2');

    expect(db.inserted('cafeteria_orders')[0]).toMatchObject({ totalCop: '25000.00', status: 'PLACED', idempotencyKey: 'key-2' });
    const [items] = db.inserted('cafeteria_order_items') as Array<Array<Record<string, unknown>>>;
    expect(items[0]).toMatchObject({
      productNameSnapshot: 'Almuerzo',
      unitPriceCop: '12500.00',
      quantity: 2,
      lineTotalCop: '25000.00',
    });
  });

  it('refuses an order containing a product that is not available', async () => {
    const { service, db } = harness();
    db.stub('cafeteria_orders').findFirst(undefined);
    db.stub('cafeteria_products').findFirst(undefined);

    await expect(service.createOrder({ items: [{ productId: 'p-1', quantity: 1 }] }, OPERATOR, 'key-3')).rejects.toThrow(
      NotFoundException,
    );
    expect(db.inserted('cafeteria_orders')).toHaveLength(0);
  });
});

describe('CafeteriaService.orders', () => {
  it('returns the item snapshots required by the KDS', async () => {
    const { service, db } = harness();
    db.stub('cafeteria_orders').select([{
      id: ORDER,
      orderNumber: 11,
      operatorId: OPERATOR,
      status: 'PLACED',
      placedAt: new Date('2026-08-18T12:00:00Z'),
      acceptedAt: null,
      readyAt: null,
      pickupDeadlineAt: null,
      deliveredAt: null,
      totalCop: '7000.00',
      notes: null,
    }]);
    db.stub('cafeteria_order_items').select([{
      orderId: ORDER,
      productId: '66666666-6666-4666-8666-666666666666',
      productNameSnapshot: 'Arepa',
      quantity: 2,
      unitPriceCop: '3500.00',
      lineTotalCop: '7000.00',
      notes: null,
    }]);

    await expect(service.orders()).resolves.toMatchObject([{
      id: ORDER,
      items: [{ productNameSnapshot: 'Arepa', quantity: 2, lineTotalCop: '7000.00' }],
    }]);
  });
});
