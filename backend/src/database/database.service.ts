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
  isRuntimeRoleMember: boolean;
  isAgencyOwnerMember: boolean;
  isSuperuser: boolean;
  ownsTables: boolean;
}

export function assertLeastPrivilegedRuntimeRole(role: RuntimeRoleSecurity): void {
  if (!role.isRuntimeRoleMember || role.isAgencyOwnerMember || role.isSuperuser || role.ownsTables) {
    throw new Error(`Unsafe production database role "${role.currentUser}": it must inherit its runtime role, never agency_owner, be non-superuser, and own no application tables`);
  }
}

/** Conexiones reservadas para `independentTransaction`; ver su comentario. */
const INDEPENDENT_POOL_MAX = 2;
/** Quien no consigue conexion en este tiempo falla en vez de esperar para siempre. */
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

interface DatabaseContext {
  database: NodePgDatabase<typeof schema>;
  afterCommit: Array<() => Promise<void>>;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool | null = null;
  private independentPool: Pool | null = null;
  private _db: NodePgDatabase<typeof schema> | null = null;
  private _independentDb: NodePgDatabase<typeof schema> | null = null;
  private readonly requestContext = new AsyncLocalStorage<DatabaseContext>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const runtimeRole = this.config.get('DATABASE_RUNTIME_ROLE');
    const configuredRuntimeUrl = runtimeRole === 'worker'
      ? this.config.get('DATABASE_WORKER_URL')
      : runtimeRole === 'readonly'
        ? this.config.get('DATABASE_READONLY_URL')
        : this.config.get('DATABASE_APP_URL');
    if (runtimeRole !== 'app' && !configuredRuntimeUrl) {
      throw new Error(`DATABASE_${runtimeRole.toUpperCase()}_URL is required for DATABASE_RUNTIME_ROLE=${runtimeRole}`);
    }
    const url = configuredRuntimeUrl || this.config.get('DATABASE_URL');
    this.pool = new Pool({ connectionString: url, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS });
    this.independentPool = new Pool({ connectionString: url, max: INDEPENDENT_POOL_MAX, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS });
    this._db = drizzle({ client: this.pool, schema });
    this._independentDb = drizzle({ client: this.independentPool, schema });
    try {
      await this.pool.query('SELECT 1');
      if (this.config.get('NODE_ENV') === 'production') {
        const expectedRuntimeRole = runtimeRole === 'worker' ? 'agency_worker' : runtimeRole === 'readonly' ? 'agency_readonly' : 'agency_app';
        const security = await this.pool.query<{
          currentUser: string;
          isRuntimeRoleMember: boolean;
          isAgencyOwnerMember: boolean;
          isSuperuser: boolean;
          ownsTables: boolean;
        }>(`
          SELECT
            current_user AS "currentUser",
            pg_has_role(current_user, $1, 'MEMBER') AS "isRuntimeRoleMember",
            pg_has_role(current_user, 'agency_owner', 'MEMBER') AS "isAgencyOwnerMember",
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "isSuperuser",
            EXISTS (
              SELECT 1
              FROM pg_class relation
              JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
              WHERE namespace.nspname = 'public'
                AND relation.relkind IN ('r', 'p')
                AND pg_get_userbyid(relation.relowner) = current_user
            ) AS "ownsTables"
        `, [expectedRuntimeRole]);
        assertLeastPrivilegedRuntimeRole(security.rows[0]);
      }
      this.logger.info('Database connected');
    } catch (err) {
      this.logger.error('Database connection failed', { err: String(err) });
      await this.pool.end().catch(() => undefined);
      await this.independentPool.end().catch(() => undefined);
      this.pool = null;
      this.independentPool = null;
      this._db = null;
      this._independentDb = null;
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await Promise.all([this.pool.end(), this.independentPool?.end()]);
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

  /**
   * Ejecuta el callback en su propia transaccion, con su propio contexto RLS, sin
   * reutilizar la transaccion del request en curso. Es para registros que deben
   * sobrevivir al rollback de una peticion que termina en error: las denegaciones
   * del vault se escriben justo antes de lanzar la excepcion, y el
   * `TransactionInterceptor` revierte la transaccion completa del handler.
   *
   * Usa un pool reservado: el request ya retiene una conexion del principal y, si
   * esta pidiera otra del mismo pool, 10 denegaciones concurrentes se esperarian
   * entre si para siempre.
   *
   * Invariante: el callback no debe tocar filas que la transaccion del request ya
   * modifico o bloqueo. Esperaria un lock que el request retiene, y Postgres no
   * puede detectar ese bloqueo porque el request espera en la aplicacion, no en la
   * base. Hoy se cumple: las denegaciones insertan en `credential_access_log`,
   * `audit_log`, `notifications` y `outbox_events`, y `markGrantReuse` actualiza
   * una fila que el request no toco antes.
   *
   * ponytail: dos conexiones reservadas por proceso; si las denegaciones
   * concurrentes empiezan a esperar el timeout en este pool, subir
   * INDEPENDENT_POOL_MAX.
   */
  async independentTransaction<T>(userId: string, roleCode: string, callback: () => Promise<T>): Promise<T> {
    if (!this._independentDb) throw new Error('Database not initialized');
    const afterCommit: Array<() => Promise<void>> = [];
    const result = await this._independentDb.transaction(async (transaction) => {
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
