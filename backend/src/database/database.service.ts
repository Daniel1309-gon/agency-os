import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { ConfigService } from '../config/config.service.js';
import { LoggerService } from '../common/logger/logger.service.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;
  private _db: NodePgDatabase<typeof schema> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('DATABASE_URL');
    this.pool = new Pool({ connectionString: url });
    this._db = drizzle({ client: this.pool, schema });
    try {
      await this.pool.query('SELECT 1');
      this.logger.info('Database connected');
    } catch (err) {
      this.logger.error('Database connection failed', { err: String(err) });
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Database pool closed');
    }
  }

  get db(): NodePgDatabase<typeof schema> {
    if (!this._db) {
      throw new Error('Database not initialized');
    }
    return this._db;
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
