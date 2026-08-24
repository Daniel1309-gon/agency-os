import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const ownerRole = process.env.DATABASE_OWNER_ROLE ?? 'agency_owner';
if (!/^[a-z_][a-z0-9_]*$/.test(ownerRole)) throw new Error('DATABASE_OWNER_ROLE contains an invalid PostgreSQL identifier');
const migrationJournal = JSON.parse(readFileSync(new URL('../src/database/migrations/meta/_journal.json', import.meta.url), 'utf8'));
const ownerRoleMigration = migrationJournal.entries.find((entry) => entry.tag === '0008_database_deployment_roles');
if (!ownerRoleMigration) throw new Error('Migration journal does not contain 0008_database_deployment_roles');

// Keep migrations on one connection so SET ROLE applies to every statement.
const pool = new Pool({ connectionString, max: 1 });
try {
  const ownerExists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ownerRole]);
  const journalExists = await pool.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS "journal"`);
  const appliedMigrations = journalExists.rows[0]?.journal
    ? Number((await pool.query('SELECT count(*)::int AS "appliedCount" FROM "drizzle"."__drizzle_migrations"')).rows[0].appliedCount)
    : 0;
  const ownerRoleMigrationApplied = appliedMigrations > ownerRoleMigration.idx;
  // Drizzle executes CREATE SCHEMA IF NOT EXISTS before reading its journal.
  // Once 0008 is applied, agency_owner is the effective migration role, so it
  // needs the database-level CREATE privilege for that idempotent statement.
  // Runtime roles never receive this grant.
  if (ownerExists.rowCount && ownerRoleMigrationApplied) {
    const [{ databaseName }] = (await pool.query('SELECT current_database() AS "databaseName"')).rows;
    await pool.query(`GRANT CREATE ON DATABASE "${databaseName.replaceAll('"', '""')}" TO "${ownerRole}"`);
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await pool.query(`GRANT USAGE, CREATE ON SCHEMA "drizzle" TO "${ownerRole}"`);
    if (journalExists.rows[0]?.journal) {
      await pool.query(`ALTER TABLE "drizzle"."__drizzle_migrations" OWNER TO "${ownerRole}"`);
    }
    await pool.query(`SET ROLE "${ownerRole}"`);
  }
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
  });
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
