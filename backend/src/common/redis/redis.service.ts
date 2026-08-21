import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomToken } from '../auth/crypto.js';
import Redis from 'ioredis';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client.status === 'wait') await this.client.connect();
    return this.client.get(key);
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.setex(key, seconds, value);
  }

  async getDel(key: string): Promise<string | null> {
    if (this.client.status === 'wait') await this.client.connect();
    const result = await this.client.call('GETDEL', key);
    return typeof result === 'string' ? result : null;
  }

  async compareAndDelete(key: string, expected: string): Promise<boolean> {
    if (this.client.status === 'wait') await this.client.connect();
    const result = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      expected,
    );
    return Number(result) === 1;
  }

  async incrWithExpiry(key: string, seconds: number): Promise<number> {
    if (this.client.status === 'wait') await this.client.connect();
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, seconds);
    return count;
  }

  async acquireLock(key: string, seconds: number): Promise<string | null> {
    if (this.client.status === 'wait') await this.client.connect();
    const token = randomToken(16);
    const result = await this.client.set(key, token, 'EX', seconds, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      this.client.disconnect();
      return;
    }
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
