import { describe, expect, it } from 'vitest';
import type { CafeteriaOrder } from '@agency-os/shared';
import { canOperatorCancel, operatorOrderStatusCopy, pickupCopy, recentOrders } from './operator-orders-view';

function order(overrides: Partial<CafeteriaOrder>): CafeteriaOrder {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    orderNumber: 1,
    operatorId: '00000000-0000-4000-8000-0000000000aa',
    status: 'PLACED',
    placedAt: '2026-11-25T15:00:00.000Z',
    totalCop: '12500.00',
    items: [],
    ...overrides,
  };
}

describe('operator orders view model', () => {
  it('names every order status in the operator words and flags the ones still in progress', () => {
    expect(operatorOrderStatusCopy('PLACED')).toEqual({ label: 'Recibido', inProgress: true });
    expect(operatorOrderStatusCopy('ACCEPTED')).toEqual({ label: 'Aceptado', inProgress: true });
    expect(operatorOrderStatusCopy('PREPARING')).toEqual({ label: 'En preparación', inProgress: true });
    expect(operatorOrderStatusCopy('READY')).toEqual({ label: 'Listo para recoger', inProgress: true });
    expect(operatorOrderStatusCopy('DELIVERED')).toEqual({ label: 'Entregado', inProgress: false });
    expect(operatorOrderStatusCopy('CANCELLED')).toEqual({ label: 'Cancelado', inProgress: false });
    expect(operatorOrderStatusCopy('EXPIRED')).toEqual({ label: 'Expirado', inProgress: false });
  });

  it('lets the operator cancel only an order the kitchen has not accepted yet', () => {
    expect(canOperatorCancel(order({ status: 'PLACED' }))).toBe(true);
    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(canOperatorCancel(order({ status }))).toBe(false);
    }
  });

  it('tells the pickup deadline of a ready order in Bogota time', () => {
    expect(pickupCopy(order({ status: 'READY', pickupDeadlineAt: '2026-11-25T20:30:00.000Z' }))).toBe('Retíralo antes de las 15:30');
    expect(pickupCopy(order({ status: 'READY', pickupDeadlineAt: null }))).toBeNull();
    expect(pickupCopy(order({ status: 'PREPARING', pickupDeadlineAt: '2026-11-25T20:30:00.000Z' }))).toBeNull();
  });

  it('keeps the most recent orders first, up to the limit', () => {
    const orders = [
      order({ id: '00000000-0000-4000-8000-000000000001', placedAt: '2026-11-25T10:00:00.000Z' }),
      order({ id: '00000000-0000-4000-8000-000000000002', placedAt: '2026-11-25T12:00:00.000Z' }),
      order({ id: '00000000-0000-4000-8000-000000000003', placedAt: '2026-11-25T11:00:00.000Z' }),
    ];

    expect(recentOrders(orders, 2).map((item) => item.id)).toEqual(['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']);
  });
});
