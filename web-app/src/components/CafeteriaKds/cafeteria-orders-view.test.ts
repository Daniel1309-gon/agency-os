import { describe, expect, it } from 'vitest';
import type { CafeteriaOrder } from '@agency-os/shared';
import { applyOrderSnapshot, mergeOrders } from './cafeteria-orders-view';

const order = (overrides: Partial<CafeteriaOrder>): CafeteriaOrder => ({
  id: '11111111-1111-4111-8111-111111111111',
  orderNumber: 1,
  operatorId: '22222222-2222-4222-8222-222222222222',
  status: 'PLACED',
  placedAt: '2026-11-22T15:00:00.000Z',
  totalCop: '5000.00',
  items: [],
  ...overrides,
});

describe('cafeteria orders monotonic view (OPS-04)', () => {
  it('ignores a stale HTTP or WS snapshot when a newer WS event has already been applied', () => {
    const newerWs = order({ status: 'ACCEPTED', seq: 200 });
    const staleHttp = [order({ status: 'PLACED', seq: 100 })];

    expect(applyOrderSnapshot([newerWs], staleHttp)).toEqual([newerWs]);
  });

  it('applies updates with equal or higher seq idempotently', () => {
    const initial = order({ status: 'PLACED', seq: 100 });
    const sameSeq = order({ status: 'PLACED', seq: 100 });
    const newer = order({ status: 'READY', seq: 150 });

    expect(mergeOrders([initial], [sameSeq])).toEqual([sameSeq]);
    expect(mergeOrders([initial], [newer])).toEqual([newer]);
  });

  it('drops orders a newer full snapshot no longer contains, such as delivered or expired ones', () => {
    const gone = order({ id: '33333333-3333-4333-8333-333333333333', status: 'PLACED', seq: 100 });
    const fresh = order({ id: '44444444-4444-4444-8444-444444444444', status: 'PLACED', seq: 200 });

    expect(applyOrderSnapshot([gone], [fresh])).toEqual([fresh]);
  });

  it('keeps an order applied after the snapshot was taken, even when the snapshot does not list it yet', () => {
    const later = order({ id: '55555555-5555-4555-8555-555555555555', status: 'PLACED', seq: 300 });
    const snapshot = [order({ id: '44444444-4444-4444-8444-444444444444', seq: 200 })];

    expect(applyOrderSnapshot([later], snapshot).map((item) => item.id)).toEqual(['55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444']);
  });
});
