import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../../common/redis/redis.service.js';
import { createTestContext, destroyTestContext, type TestContext } from '../support/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

describe('RedisService lazy connection', () => {
  it('serves concurrent first commands without the offline queue', async () => {
    // Un cliente nuevo (nunca conectado) con dos comandos a la vez: es el patron
    // del rate limit de login (cuenta + IP) y fallaba con 503.
    const fresh = new RedisService(ctx.config);
    try {
      const stamp = Date.now();
      const [first, second] = await Promise.all([
        fresh.incrWithExpiry(`probe:${stamp}:a`, 30),
        fresh.incrWithExpiry(`probe:${stamp}:b`, 30),
      ]);
      expect([first, second]).toEqual([1, 1]);
    } finally {
      await fresh.onModuleDestroy();
    }
  });
});
