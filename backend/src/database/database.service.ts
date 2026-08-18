import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { ConfigService } from '../config/config.service.js';
import { LoggerService } from '../common/logger/logger.service.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;
  private _db: NodePgDatabase<typeof schema> | null = null;
  private readonly requestContext = new AsyncLocalStorage<NodePgDatabase<typeof schema>>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('DATABASE_APP_URL') || this.config.get('DATABASE_URL');
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
    const scoped = this.requestContext.getStore();
    if (scoped) return scoped;
    if (!this._db) {
      throw new Error('Database not initialized');
    }
    return this._db;
  }

  async withRequestContext<T>(userId: string, roleCode: string, callback: () => Promise<T>): Promise<T> {
    if (!this._db) throw new Error('Database not initialized');
    return this._db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      await transaction.execute(sql`select set_config('app.role_code', ${roleCode}, true)`);
      return this.requestContext.run(transaction as unknown as NodePgDatabase<typeof schema>, callback);
    });
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
