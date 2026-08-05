import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Redis from 'ioredis';
import { fileURLToPath } from 'node:url';
import { maintenanceDatabaseUrl, testDatabaseName, testDatabaseUrl, testRedisUrl } from './env.js';

const migrationsFolder = fileURLToPath(new URL('../../database/migrations', import.meta.url));

const UNREACHABLE = [
  'No se pudo conectar a Postgres o Redis para las pruebas de integracion.',
  'Levanta la infraestructura antes de correrlas:',
  '',
  '  docker compose up -d',
  '',
].join('\n');

/**
 * Prepara la base de prueba y le aplica las migraciones reales — no un schema
 * paralelo. Los constraints de exclusion, los CHECK y las politicas RLS que
 * verifican estas pruebas viven en los .sql, asi que probarlos contra un schema
 * generado de otra forma no probaria nada.
 *
 * La base se reutiliza entre corridas si ya existe: crearla cuesta ~50 s en
 * Docker Desktop, y el migrador de Drizzle solo aplica lo pendiente. Cada
 * archivo de pruebas vacia las tablas en su beforeEach, asi que reutilizarla no
 * arrastra datos. Si una migracion ya aplicada se edita en el sitio, el journal
 * no lo detecta: para eso esta TEST_DB_RECREATE=1.
 */
export async function setup(): Promise<void> {
  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(`${UNREACHABLE}\nCausa: ${error instanceof Error ? error.message : String(error)}`);
  }

  const name = testDatabaseName();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount && process.env.TEST_DB_RECREATE !== '1') {
      // Se reutiliza tal cual; las migraciones pendientes se aplican abajo.
    } else {
      // WITH (FORCE) corta las conexiones que quedaron de una corrida interrumpida.
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${name}"`);
    }
    // Una base de pruebas no necesita durabilidad ante caida: si el contenedor
    // muere, la corrida se repite. Con fsync por commit sobre el disco
    // virtualizado de Docker Desktop cada INSERT cuesta ~300 ms y la suite se
    // vuelve inusable. El ajuste es por base, asi que no toca la de desarrollo.
    await admin.query(`ALTER DATABASE "${name}" SET synchronous_commit = off`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: testDatabaseUrl() });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }

  const redis = new Redis(testRedisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } catch (error) {
    throw new Error(`${UNREACHABLE}\nCausa: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}
