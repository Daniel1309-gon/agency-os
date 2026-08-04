import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly db: DatabaseService) {}

  async checkReady(): Promise<{ status: 'ok' | 'fail'; checks: Record<string, boolean> }> {
    const dbOk = await this.db.ping();
    const checks = { postgres: dbOk };
    return {
      status: dbOk ? 'ok' : 'fail',
      checks,
    };
  }

  checkLive(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
