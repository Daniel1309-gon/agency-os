/**
 * Las pruebas de integracion nunca tocan la base de datos de desarrollo: derivan
 * un nombre propio (`<db>_test`) del DATABASE_URL configurado, y un indice de
 * Redis aparte. Ambos derivados son funciones puras del entorno, asi que el
 * globalSetup y los tests llegan al mismo destino sin pasarse nada.
 */

const DEFAULT_DATABASE_URL = 'postgresql://agency:agency@localhost:5432/agency_os';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/** Indice de Redis reservado a las pruebas. El 0 es el de desarrollo. */
export const TEST_REDIS_DB = 15;

function databaseUrl(): URL {
  return new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}

export function testDatabaseName(): string {
  const name = databaseUrl().pathname.replace(/^\//, '') || 'agency_os';
  return name.endsWith('_test') ? name : `${name}_test`;
}

/** Conexion a la base `postgres` para poder crear y borrar la base de prueba. */
export function maintenanceDatabaseUrl(): string {
  const url = databaseUrl();
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseUrl(): string {
  const url = databaseUrl();
  url.pathname = `/${testDatabaseName()}`;
  return url.toString();
}

export function testRedisUrl(): string {
  const url = new URL(process.env.REDIS_URL ?? DEFAULT_REDIS_URL);
  url.pathname = `/${TEST_REDIS_DB}`;
  return url.toString();
}
