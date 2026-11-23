import { describe, expect, it } from 'vitest';
import type { CafeteriaOrder } from '@agency-os/shared';
import {
  buildCreateProductPayload,
  buildSalesOrdersQuery,
  cafeteriaOrderStatusLabel,
  summarizeCafeteriaSales,
} from './cafeteria-management-view';

function makeOrder(partial: Partial<CafeteriaOrder> & Pick<CafeteriaOrder, 'id' | 'status' | 'totalCop'>): CafeteriaOrder {
  return {
    orderNumber: 1,
    operatorId: '11111111-1111-4111-8111-111111111111',
    operatorName: 'Ana Operadora',
    placedAt: '2026-11-22T15:00:00.000Z',
    items: [],
    ...partial,
  };
}

describe('cafeteria management view helpers (A5)', () => {
  it('builds and validates new cafeteria product payloads', () => {
    expect(buildCreateProductPayload({
      sku: ' CAF-01 ',
      name: ' Tinto doble ',
      category: ' Bebidas ',
      description: ' Café recién colado ',
      priceCop: '3500',
      prepMinutes: '5',
      pickupDeadlineMinutes: '20',
    })).toEqual({
      sku: 'CAF-01',
      name: 'Tinto doble',
      category: 'Bebidas',
      description: 'Café recién colado',
      priceCop: 3500,
      prepMinutes: 5,
      pickupDeadlineMinutes: 20,
    });

    expect(() => buildCreateProductPayload({
      sku: '',
      name: 'Tinto',
      category: 'Bebidas',
      description: '',
      priceCop: '3500',
      prepMinutes: '',
      pickupDeadlineMinutes: '30',
    })).toThrow(/SKU/);

    expect(() => buildCreateProductPayload({
      sku: 'CAF-01',
      name: 'Tinto',
      category: 'Bebidas',
      description: '',
      priceCop: '-100',
      prepMinutes: '',
      pickupDeadlineMinutes: '30',
    })).toThrow(/precio/);
  });

  it('summarizes delivered revenue, average ticket, status counts, and top items excluding cancelled/expired orders', () => {
    const orders: CafeteriaOrder[] = [
      makeOrder({
        id: '11111111-1111-4111-8111-111111111111',
        status: 'DELIVERED',
        totalCop: '15000.00',
        items: [
          { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', productNameSnapshot: 'Almuerzo', quantity: 1, unitPriceCop: '12000.00', lineTotalCop: '12000.00' },
          { productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', productNameSnapshot: 'Tinto', quantity: 1, unitPriceCop: '3000.00', lineTotalCop: '3000.00' },
        ],
      }),
      makeOrder({
        id: '22222222-2222-4222-8222-222222222222',
        status: 'DELIVERED',
        totalCop: '6000.00',
        items: [
          { productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', productNameSnapshot: 'Tinto', quantity: 2, unitPriceCop: '3000.00', lineTotalCop: '6000.00' },
        ],
      }),
      makeOrder({
        id: '33333333-3333-4333-8333-333333333333',
        status: 'CANCELLED',
        totalCop: '12000.00',
        items: [
          { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', productNameSnapshot: 'Almuerzo', quantity: 4, unitPriceCop: '12000.00', lineTotalCop: '48000.00' },
        ],
      }),
      makeOrder({ id: '44444444-4444-4444-8444-444444444444', status: 'EXPIRED', totalCop: '4000.00' }),
    ];

    const summary = summarizeCafeteriaSales(orders);
    expect(summary).toEqual({
      totalOrders: 4,
      deliveredCount: 2,
      deliveredTotalCop: 21000,
      averageTicketCop: 10500,
      cancelledCount: 1,
      expiredCount: 1,
      inProgressCount: 0,
      topItems: [
        { name: 'Tinto', quantity: 3, revenueCop: 9000 },
        { name: 'Almuerzo', quantity: 1, revenueCop: 12000 },
      ],
    });
    expect(cafeteriaOrderStatusLabel('EXPIRED')).toBe('Expirado');
  });

  it('builds sales history query strings cleanly', () => {
    expect(buildSalesOrdersQuery({ from: '2026-11-22', to: '2026-11-22', status: 'DELIVERED' }))
      .toBe('/cafeteria/orders?from=2026-11-22&to=2026-11-22&status=DELIVERED&limit=500');
  });
});
