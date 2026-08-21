import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const password = process.env.DATABASE_WORKER_PASSWORD;
if (!connectionString) throw new Error('DATABASE_URL is required');
if (!password || password.length < 32) throw new Error('DATABASE_WORKER_PASSWORD must contain at least 32 characters');

const pool = new Pool({ connectionString });
try {
  const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'agency_worker'");
  if (!role.rowCount) throw new Error('agency_worker does not exist; run db:migrate first');
  const quotedPassword = (await pool.query('SELECT quote_literal($1) AS value', [password])).rows[0].value;
  const runtime = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'agency_worker_runtime'");
  if (runtime.rowCount) {
    await pool.query(`ALTER ROLE agency_worker_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quotedPassword}`);
  } else {
    await pool.query(`CREATE ROLE agency_worker_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quotedPassword}`);
  }
  await pool.query('GRANT agency_worker TO agency_worker_runtime');
  await pool.query('ALTER ROLE agency_worker_runtime SET row_security = on');
  await pool.query('REVOKE CREATE ON SCHEMA public FROM agency_worker_runtime');
  console.log('agency_worker_runtime is ready with least-privilege defaults');
} finally {
  await pool.end();
}
