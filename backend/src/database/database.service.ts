import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { ConfigService } from '../config/config.service.js';
import { LoggerService } from '../common/logger/logger.service.js';

export interface RuntimeRoleSecurity {
  currentUser: string;
  isAgencyAppMember: boolean;
  isSuperuser: boolean;
  ownsTables: boolean;
}

export function assertLeastPrivilegedRuntimeRole(role: RuntimeRoleSecurity): void {
  if (!role.isAgencyAppMember || role.isSuperuser || role.ownsTables) {
    throw new Error(`Unsafe production database role "${role.currentUser}": it must inherit agency_app, be non-superuser, and own no application tables`);
  }
}

interface DatabaseContext {
  database: NodePgDatabase<typeof schema>;
  afterCommit: Array<() => Promise<void>>;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;
  private _db: NodePgDatabase<typeof schema> | null = null;
  private readonly requestContext = new AsyncLocalStorage<DatabaseContext>();

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
      if (this.config.get('NODE_ENV') === 'production') {
        const security = await this.pool.query<{
          currentUser: string;
          isAgencyAppMember: boolean;
          isSuperuser: boolean;
          ownsTables: boolean;
        }>(`
          SELECT
            current_user AS "currentUser",
            pg_has_role(current_user, 'agency_app', 'MEMBER') AS "isAgencyAppMember",
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "isSuperuser",
            EXISTS (
              SELECT 1
              FROM pg_class relation
              JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = 'public'
                AND relation.relkind IN ('r', 'p')
                AND pg_get_userbyid(relation.relowner) = current_user
            ) AS "ownsTables"
        `);
        assertLeastPrivilegedRuntimeRole(security.rows[0]);
      }
      this.logger.info('Database connected');
    } catch (err) {
      this.logger.error('Database connection failed', { err: String(err) });
      await this.pool.end().catch(() => undefined);
      this.pool = null;
      this._db = null;
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
    if (scoped) return scoped.database;
    if (!this._db) {
      throw new Error('Database not initialized');
    }
    return this._db;
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (this.requestContext.getStore()) return callback();
    if (!this._db) throw new Error('Database not initialized');
    const afterCommit: Array<() => Promise<void>> = [];
    const result = await this._db.transaction(async (transaction) =>
      this.requestContext.run({ database: transaction as unknown as NodePgDatabase<typeof schema>, afterCommit }, callback),
    );
    await Promise.allSettled(afterCommit.map((work) => work()));
    return result;
  }

  async withRequestContext<T>(userId: string, roleCode: string, callback: () => Promise<T>): Promise<T> {
    if (!this._db) throw new Error('Database not initialized');
    const afterCommit: Array<() => Promise<void>> = [];
    const result = await this._db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      await transaction.execute(sql`select set_config('app.role_code', ${roleCode}, true)`);
      return this.requestContext.run({ database: transaction as unknown as NodePgDatabase<typeof schema>, afterCommit }, callback);
    });
    await Promise.allSettled(afterCommit.map((work) => work()));
    return result;
  }

  async afterCommit(work: () => Promise<void>): Promise<void> {
    const context = this.requestContext.getStore();
    if (context) {
      context.afterCommit.push(work);
      return;
    }
    await work();
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
