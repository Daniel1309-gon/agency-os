import { describe, expect, it } from 'vitest';
import {
  buildCreateProductPayload,
  buildUpdateProductPayload,
  buildSalesOrdersQuery,
  buildSalesSummaryQuery,
  cafeteriaOrderStatusLabel,
  isSalesHistoryTruncated,
} from './cafeteria-management-view';

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

  it('labels order statuses and flags a history table that hit the server limit', () => {
    expect(cafeteriaOrderStatusLabel('EXPIRED')).toBe('Expirado');
    expect(cafeteriaOrderStatusLabel('ACCEPTED')).toBe('Aceptado');
    expect(isSalesHistoryTruncated(499)).toBe(false);
    expect(isSalesHistoryTruncated(500)).toBe(true);
    expect(isSalesHistoryTruncated(2, 2)).toBe(true);
  });

  it('builds sales history query strings cleanly', () => {
    expect(buildSalesOrdersQuery({ from: '2026-11-22', to: '2026-11-22', status: 'DELIVERED' }))
      .toBe('/cafeteria/orders?from=2026-11-22&to=2026-11-22&status=DELIVERED&limit=500');
    expect(buildSalesSummaryQuery({ from: '2026-11-01', to: '2026-11-22' }))
      .toBe('/cafeteria/sales/summary?from=2026-11-01&to=2026-11-22');
  });
});

describe('buildUpdateProductPayload', () => {
  it('sends category, price, preparation and pickup deadline from the inline editor', () => {
    expect(buildUpdateProductPayload({ category: ' Bebidas ', priceCop: '4500', prepMinutes: '5', pickupDeadlineMinutes: '15' })).toEqual({ category: 'Bebidas', priceCop: 4500, prepMinutes: 5, pickupDeadlineMinutes: 15 });
  });

  it('keeps the stored preparation when the field is left empty', () => {
    expect(buildUpdateProductPayload({ category: 'Bebidas', priceCop: '4500', prepMinutes: '', pickupDeadlineMinutes: '15' })).toEqual({ category: 'Bebidas', priceCop: 4500, pickupDeadlineMinutes: 15 });
  });

  it('rejects invalid values with a Spanish message', () => {
    expect(() => buildUpdateProductPayload({ category: ' ', priceCop: '4500', prepMinutes: '', pickupDeadlineMinutes: '15' })).toThrow('La categoría es obligatoria.');
    expect(() => buildUpdateProductPayload({ category: 'B', priceCop: '0', prepMinutes: '', pickupDeadlineMinutes: '15' })).toThrow('El precio debe ser un número positivo en COP.');
    expect(() => buildUpdateProductPayload({ category: 'B', priceCop: '10', prepMinutes: '-1', pickupDeadlineMinutes: '15' })).toThrow('La preparación debe ser un entero entre 0 y 1440 minutos.');
    expect(() => buildUpdateProductPayload({ category: 'B', priceCop: '10', prepMinutes: '', pickupDeadlineMinutes: '0' })).toThrow('El límite de retiro debe ser un entero entre 1 y 1440 minutos.');
  });
});
