import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const ownerRole = process.env.DATABASE_OWNER_ROLE ?? 'agency_owner';
if (!/^[a-z_][a-z0-9_]*$/.test(ownerRole)) throw new Error('DATABASE_OWNER_ROLE contains an invalid PostgreSQL identifier');

// Keep migrations on one connection so SET ROLE applies to every statement.
const pool = new Pool({ connectionString, max: 1 });
try {
  const ownerExists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ownerRole]);
  if (ownerExists.rowCount) await pool.query(`SET ROLE "${ownerRole}"`);
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
  });
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
