import { Pool } from 'pg';
import Redis from 'ioredis';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { hashPassword, hashToken, randomToken } from '../../common/auth/crypto.js';
import * as schema from '../../database/schema/index.js';
import { devices, roles, ttProfiles, permissions, rolePermissions } from '../../database/schema/index.js';
import { users } from '../../database/schema/index.js';
import { testDatabaseUrl, testRedisUrl } from './env.js';

/**
 * log2(N)=14 en pruebas. El valor de produccion (17) pide 128 MiB y ~0.5 s por
 * hash; una suite con decenas de usuarios tardaria minutos sin probar nada
 * distinto. El formato del hash lleva sus propios parametros, asi que verificar
 * con 14 ejercita exactamente el mismo codigo.
 */
export const TEST_SCRYPT_LOG2N = 14;

export interface TestContext {
  config: ConfigService;
  logger: LoggerService;
  database: DatabaseService;
  redis: RedisService;
  /** Cliente crudo, para el SQL de los tests de invariantes. */
  pool: Pool;
  /** Cliente crudo de Redis, para limpiar entre pruebas. */
  rawRedis: Redis;
  db: NodePgDatabase<typeof schema>;
}

export const TEST_JWT_SECRET = 'test-jwt-secret-with-more-than-32-chars';
export const TEST_VAULT_KEK = 'test-vault-kek-with-more-than-32-chars';

function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.REDIS_URL = testRedisUrl();
  process.env.REQUIRE_SHIFT_FOR_AUTH = 'false';
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.VAULT_KEK = TEST_VAULT_KEK;
  process.env.PASSWORD_SCRYPT_LOG2N = String(TEST_SCRYPT_LOG2N);
  // El schema de configuracion no acepta 'silent'; ese nivel es de pino y solo
  // se le pasa al logger, para que la suite no escupa una linea por consulta.
  process.env.LOG_LEVEL = 'fatal';
}

export async function createTestContext(logLevel = 'silent'): Promise<TestContext> {
  applyTestEnv();
  const config = new ConfigService();
  const logger = new LoggerService(logLevel);
  const database = new DatabaseService(config, logger);
  await database.onModuleInit();
  const redis = new RedisService(config);
  if (!(await redis.ping())) {
    throw new Error('Redis de pruebas no responde durante la inicialización del contexto');
  }
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  const rawRedis = new Redis(testRedisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1 });
  await rawRedis.connect();
  return { config, logger, database, redis, pool, rawRedis, db: drizzle({ client: pool, schema }) };
}

export async function destroyTestContext(context: TestContext | undefined): Promise<void> {
  // Tolera un contexto a medio construir: si el beforeAll fallo, el afterAll no
  // debe tapar el error real con un TypeError.
  if (!context) return;
  await context.database.onModuleDestroy().catch(() => undefined);
  await context.redis.onModuleDestroy().catch(() => undefined);
  await context.pool.end().catch(() => undefined);
  await context.rawRedis.quit().catch(() => undefined);
}

let cachedCleanup: string | null = null;

/**
 * Vacia la base entre pruebas. Se descubren las tablas en vez de enumerarlas:
 * una tabla nueva del schema entra sola, y ninguna prueba queda contaminada por
 * filas de otra solo porque alguien olvido la lista.
 *
 * Es DELETE y no TRUNCATE a proposito. TRUNCATE reescribe el fichero de cada
 * tabla y en Docker Desktop eso cuesta ~15 s por limpieza — mas que toda la
 * suite. El mismo borrado con DELETE en una transaccion cuesta ~30 ms.
 * `session_replication_role = replica` desactiva los triggers de FK durante esa
 * transaccion, para no tener que ordenar los DELETE por dependencias; es
 * SET LOCAL, asi que no sobrevive al COMMIT.
 *
 * Las secuencias no se reinician: ninguna prueba debe depender del valor
 * concreto de un id.
 */
export async function resetDatabase(context: TestContext): Promise<void> {
  if (!cachedCleanup) {
    // Las particiones quedan fuera: el DELETE sobre la tabla particionada ya las vacia, y
    // enumerarlas dejaria la lista cacheada apuntando a una particion que la retencion de
    // audit_log puede haber borrado entre medias.
    const result = await context.pool.query<{ tablename: string }>(
      `SELECT c.relname AS tablename
       FROM pg_class c
       INNER JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`,
    );
    cachedCleanup = result.rows.map((row) => `DELETE FROM "public"."${row.tablename}";`).join('\n');
  }
  if (cachedCleanup) {
    await context.pool.query(`BEGIN; SET LOCAL session_replication_role = replica;\n${cachedCleanup}\nCOMMIT;`);
  }
  await context.rawRedis.flushdb();
}

export const ROLE_CODES = ['ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR', 'OPERADOR', 'CAFETERIA'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Devuelve el mapa code -> id de roles, sembrandolos si hace falta. */
export async function seedRoles(context: TestContext): Promise<Map<RoleCode, string>> {
  const rows = await context.db
    .insert(roles)
    .values(ROLE_CODES.map((code, index) => ({ code, name: code, hierarchyLevel: index + 1, isSystem: true })))
    .onConflictDoNothing()
    .returning({ id: roles.id, code: roles.code });
  const existing = rows.length
    ? rows
    : await context.db.select({ id: roles.id, code: roles.code }).from(roles);
  return new Map(existing.map((row) => [row.code as RoleCode, row.id]));
}

export interface CreatedUser {
  id: string;
  email: string;
  password: string;
  roleId: string;
}

export async function createUser(
  context: TestContext,
  options: {
    role?: RoleCode;
    email?: string;
    password?: string;
    permissions?: string[];
    status?: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
    mustChangePassword?: boolean;
  } = {},
): Promise<CreatedUser> {
  const roleIds = await seedRoles(context);
  const role = options.role ?? 'OPERADOR';
  const roleId = roleIds.get(role);
  if (!roleId) throw new Error(`Role ${role} was not seeded`);
  const email = options.email ?? `user-${randomToken(6)}@agency.test`;
  const password = options.password ?? 'Correct horse battery staple';

  if (options.permissions?.length) {
    const inserted = await context.db
      .insert(permissions)
      .values(options.permissions.map((code) => ({ code, module: code.split('.')[0], description: code })))
      .onConflictDoNothing()
      .returning({ id: permissions.id, code: permissions.code });
    const all = inserted.length
      ? inserted
      : await context.db.select({ id: permissions.id, code: permissions.code }).from(permissions);
    const wanted = all.filter((row) => options.permissions?.includes(row.code));
    if (wanted.length) {
      await context.db
        .insert(rolePermissions)
        .values(wanted.map((row) => ({ roleId, permissionId: row.id })))
        .onConflictDoNothing();
    }
  }

  const [row] = await context.db
    .insert(users)
    .values({
      email,
      fullName: `Test ${email}`,
      passwordHash: await hashPassword(password, TEST_SCRYPT_LOG2N),
      roleId,
      status: options.status ?? 'ACTIVE',
      mustChangePassword: options.mustChangePassword ?? false,
    })
    .returning({ id: users.id });
  return { id: row.id, email, password, roleId };
}

export async function createProfile(
  context: TestContext,
  options: { status?: string; displayName?: string; chromeProfileDir?: string | null } = {},
): Promise<{ id: string }> {
  const suffix = randomToken(6);
  const [row] = await context.db
    .insert(ttProfiles)
    .values({
      displayName: options.displayName ?? `Profile ${suffix}`,
      loginEmail: `profile-${suffix}@talky.test`,
      status: options.status ?? 'ACTIVE',
      chromeProfileDir: options.chromeProfileDir === undefined ? 'Profile 1' : options.chromeProfileDir,
    })
    .returning({ id: ttProfiles.id });
  return row;
}

export async function createDevice(
  context: TestContext,
  options: { operatorId?: string; status?: string } = {},
): Promise<{ id: string; token: string }> {
  const token = randomToken();
  const [row] = await context.db
    .insert(devices)
    .values({
      hostname: `host-${randomToken(4)}`,
      label: `PC-${randomToken(4)}`,
      assignedOperatorId: options.operatorId,
      status: options.status ?? 'APPROVED',
      tokenHash: hashToken(token),
      tokenIssuedAt: new Date(),
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: devices.id });
  return { id: row.id, token };
}

/** Rango tstzrange semiabierto, la convencion que fija PLAN.md §4.1. */
export function halfOpen(from: Date | string, to: Date | string): string {
  const start = from instanceof Date ? from.toISOString() : from;
  const end = to instanceof Date ? to.toISOString() : to;
  return `[${start},${end})`;
}

export function isoOffset(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
