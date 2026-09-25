import { describe, expect, it, vi } from 'vitest';
import { RealtimeService } from './realtime.service.js';
import type { RedisService } from '../../common/redis/redis.service.js';
import type { DatabaseService } from '../../database/database.service.js';

const CHANNEL = 'agency:realtime:bridge';

function redisStub() {
  let handler: ((message: string) => void) | undefined;
  const redis = {
    publish: vi.fn(async () => undefined),
    subscribe: vi.fn(async (_channel: string, callback: (message: string) => void) => {
      handler = callback;
    }),
  };
  return { redis: redis as unknown as RedisService, publish: redis.publish, deliver: (message: string) => handler?.(message), subscribed: redis.subscribe };
}

function serverStub() {
  const emitted: Array<{ rooms: string[]; name: string; payload: unknown; local: boolean }> = [];
  const server = {
    to: (rooms: string[]) => ({ emit: (name: string, payload: unknown) => emitted.push({ rooms, name, payload, local: false }) }),
    local: { to: (rooms: string[]) => ({ emit: (name: string, payload: unknown) => emitted.push({ rooms, name, payload, local: true }) }) },
  };
  return { server: server as never, emitted };
}

function dbStub() {
  const memberships = { from: () => ({ where: async () => [] }) };
  const db = {
    afterCommit: async (work: () => Promise<void>) => work(),
    db: { select: () => memberships },
  };
  return db as unknown as DatabaseService;
}

describe('RealtimeService bridge', () => {
  it('publishes to Redis when there is no local socket server (worker)', async () => {
    const bus = redisStub();
    const service = new RealtimeService(dbStub(), bus.redis);

    await service.publishOperatorChanged('op-1');

    expect(bus.publish).toHaveBeenCalledWith(CHANNEL, JSON.stringify({ target: 'operator', operatorId: 'op-1' }));
  });

  it('re-emits bridged events on the API instances and does not publish local ones', async () => {
    const bus = redisStub();
    const service = new RealtimeService(dbStub(), bus.redis);
    vi.spyOn(service as unknown as { snapshotAll: () => Promise<unknown[]> }, 'snapshotAll').mockResolvedValue([
      { operatorId: 'op-1', fullName: 'Operadora', status: 'ONLINE', reason: 'SESSION_ACTIVE', changedAt: null },
    ]);
    const api = serverStub();
    service.attach(api.server);

    await service.publishOperatorChanged('op-1');
    expect(api.emitted).toHaveLength(1);
    expect(api.emitted[0]).toMatchObject({ name: 'operator.status.changed', rooms: ['role:ADMIN', 'role:DIRECTOR_OPERATIVO', 'user:op-1'], local: false });
    expect(bus.publish).not.toHaveBeenCalled();

    bus.deliver(JSON.stringify({ target: 'operator', operatorId: 'op-1' }));
    await vi.waitFor(() => expect(api.emitted).toHaveLength(2));
    expect(api.emitted[1]).toMatchObject({ name: 'operator.status.changed', local: true });
    expect(bus.subscribed).toHaveBeenCalledWith(CHANNEL, expect.any(Function));
  });

  it('retries a failed bridge subscription and cancels the timer on destroy', async () => {
    vi.useFakeTimers();
    try {
      const bus = redisStub();
      bus.subscribed.mockRejectedValueOnce(new Error('Redis unavailable'));
      const service = new RealtimeService(dbStub(), bus.redis);
      service.attach(serverStub().server);
      await vi.advanceTimersByTimeAsync(0);
      expect(bus.subscribed).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(bus.subscribed).toHaveBeenCalledTimes(2);
      await service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bus.subscribed).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps bridged cafeteria events local to each API', async () => {
    const bus = redisStub();
    const service = new RealtimeService(dbStub(), bus.redis);
    vi.spyOn(service as never, 'orderSnapshot').mockResolvedValue({ id: 'order-1', operatorId: 'op-1' });
    const api = serverStub();
    service.attach(api.server);
    bus.deliver(JSON.stringify({ target: 'cafeteria', orderId: 'order-1', eventName: 'cafeteria.order.changed' }));
    await vi.waitFor(() => expect(api.emitted).toHaveLength(1));
    expect(api.emitted[0]).toMatchObject({ local: true, rooms: ['role:CAFETERIA', 'user:op-1'] });
  });
});
