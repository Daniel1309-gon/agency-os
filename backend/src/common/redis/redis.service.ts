import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomToken } from '../auth/crypto.js';
import Redis from 'ioredis';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private subscriber?: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureReady();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * `enableOfflineQueue: false` no perdona comandos concurrentes antes del
   * primer connect: dos llamadas a la vez (p. ej. el rate limit por cuenta y por
   * IP) veian el cliente conectando y la segunda fallaba. ioredis rechaza
   * `connect()` si ya esta conectando, asi que ahi se espera el evento `ready`.
   */
  private async ensureReady(): Promise<void> {
    const status = this.client.status;
    if (status === 'ready') return;
    if (status === 'wait' || status === 'end') {
      await this.client.connect();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.client.off('ready', onReady);
        this.client.off('error', onError);
      };
      const onReady = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      this.client.once('ready', onReady);
      this.client.once('error', onError);
    });
  }

  async get(key: string): Promise<string | null> {
    await this.ensureReady();
    return this.client.get(key);
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    await this.ensureReady();
    await this.client.setex(key, seconds, value);
  }

  async getDel(key: string): Promise<string | null> {
    await this.ensureReady();
    const result = await this.client.call('GETDEL', key);
    return typeof result === 'string' ? result : null;
  }

  async compareAndDelete(key: string, expected: string): Promise<boolean> {
    await this.ensureReady();
    const result = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      expected,
    );
    return Number(result) === 1;
  }

  async incrWithExpiry(key: string, seconds: number): Promise<number> {
    await this.ensureReady();
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, seconds);
    return count;
  }

  async acquireLock(key: string, seconds: number): Promise<string | null> {
    await this.ensureReady();
    const token = randomToken(16);
    const result = await this.client.set(key, token, 'EX', seconds, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    await this.ensureReady();
    await this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.ensureReady();
    await this.client.publish(channel, message);
  }

  /**
   * Suscriptor dedicado: una conexion en modo subscribe no puede emitir
   * comandos normales, por eso se duplica el cliente.
   */
  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate({ lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.subscriber.on('message', (received: string, message: string) => {
        if (received === channel) handler(message);
      });
    }
    const subscriber = this.subscriber;
    try {
      if (subscriber.status !== 'ready') await subscriber.connect();
      await subscriber.subscribe(channel);
    } catch (error) {
      subscriber.disconnect();
      if (this.subscriber === subscriber) this.subscriber = undefined;
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) await this.subscriber.quit().catch(() => this.subscriber?.disconnect());
    if (this.client.status === 'wait' || this.client.status === 'end') {
      this.client.disconnect();
      return;
    }
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
