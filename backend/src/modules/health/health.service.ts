import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../common/redis/redis.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly db: DatabaseService, private readonly redis: RedisService) {}

  async checkReady(): Promise<{ status: 'ok' | 'fail'; checks: Record<string, boolean> }> {
    const [postgres, redis] = await Promise.all([this.db.ping(), this.redis.ping()]);
    const checks = { postgres, redis };
    if (!postgres || !redis) {
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Dependencies are not ready', details: checks });
    }
    return { status: 'ok', checks };
  }

  checkLive(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
