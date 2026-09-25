import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import type { ConfigService } from '../../config/config.service.js';
import { RedisService } from './redis.service.js';

describe('RedisService lifecycle', () => {
  it('closes an idle lazy client without attempting a network quit', async () => {
    const config = { get: () => 'redis://localhost:6379' } as unknown as ConfigService;
    const service = new RedisService(config);
    const client = (service as unknown as {
      client: { disconnect(): void; quit(): Promise<'OK'>; status: string };
    }).client;
    const disconnect = vi.spyOn(client, 'disconnect');
    const quit = vi.spyOn(client, 'quit').mockResolvedValue('OK');

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });

  it('discards a duplicate whose first connect failed before retrying', async () => {
    const service = new RedisService({ get: () => 'redis://127.0.0.1:56379' } as unknown as ConfigService);
    const first = {
      status: 'wait', on: vi.fn(), connect: vi.fn().mockRejectedValue(new Error('unavailable')),
      subscribe: vi.fn(), disconnect: vi.fn(), quit: vi.fn(),
    };
    const second = {
      status: 'wait', on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(1), disconnect: vi.fn(), quit: vi.fn().mockResolvedValue(undefined),
    };
    const client = (service as unknown as { client: Redis }).client;
    vi.spyOn(client, 'duplicate')
      .mockReturnValueOnce(first as unknown as Redis)
      .mockReturnValueOnce(second as unknown as Redis);
    try {
      await expect(service.subscribe('bridge', vi.fn())).rejects.toThrow('unavailable');
      expect(first.disconnect).toHaveBeenCalledOnce();
      await expect(service.subscribe('bridge', vi.fn())).resolves.toBeUndefined();
      expect(second.connect).toHaveBeenCalledOnce();
      expect(second.subscribe).toHaveBeenCalledWith('bridge');
    } finally {
      await service.onModuleDestroy();
    }
  });
});
