import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import Redis from 'ioredis';
import { ConfigService } from '../../config/config.service.js';

export class RedisIoAdapter extends IoAdapter {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private closing?: Promise<void>;

  constructor(app: INestApplicationContext, config: ConfigService) {
    super(app);
    this.publisher = new Redis(config.get('REDIS_URL'), { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.subscriber = this.publisher.duplicate();
  }

  async connect(): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, { ...options, transports: ['websocket'] });
    server.adapter(createAdapter(this.publisher, this.subscriber));
    return server;
  }

  close(server: { close?(callback?: () => void): void; server?: { close(callback?: () => void): void } }): Promise<void> {
    this.closing ??= this.closeOnce(server);
    return this.closing;
  }

  private async closeOnce(server: { close?(callback?: () => void): void; server?: { close(callback?: () => void): void } }): Promise<void> {
    try {
      let close: ((callback?: () => void) => void) | undefined;
      if (typeof server.close === 'function') close = server.close.bind(server);
      else if (server.server) close = server.server.close.bind(server.server);
      if (close) await new Promise<void>((resolve) => close(resolve));
    } finally {
      await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
    }
  }
}
