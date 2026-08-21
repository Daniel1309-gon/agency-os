import { describe, expect, it, vi } from 'vitest';
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
});
