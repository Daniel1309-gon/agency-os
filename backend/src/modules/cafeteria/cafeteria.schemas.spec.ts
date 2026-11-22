import { describe, expect, it } from 'vitest';
import { productSchema, productUpdateSchema } from './cafeteria.schemas.js';

describe('cafeteria product schemas', () => {
  it('defaults the pickup deadline to 30 minutes on create', () => {
    expect(productSchema.parse({ sku: 'CAF-1', name: 'Tinto', category: 'Bebidas', priceCop: 2000 }).pickupDeadlineMinutes).toBe(30);
  });

  it('leaves the pickup deadline untouched on an update that omits it', () => {
    const parsed = productUpdateSchema.parse({ name: 'Tinto doble' });
    expect(parsed).toEqual({ name: 'Tinto doble' });
    expect('pickupDeadlineMinutes' in parsed).toBe(false);
  });

  it('still validates the pickup deadline when an update sends it', () => {
    expect(productUpdateSchema.parse({ pickupDeadlineMinutes: 15 }).pickupDeadlineMinutes).toBe(15);
    expect(productUpdateSchema.safeParse({ pickupDeadlineMinutes: 0 }).success).toBe(false);
  });
});
