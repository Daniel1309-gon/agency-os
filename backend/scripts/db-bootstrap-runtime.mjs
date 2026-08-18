import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const password = process.env.DATABASE_RUNTIME_PASSWORD;
if (!connectionString) throw new Error('DATABASE_URL is required');
if (!password || password.length < 32) throw new Error('DATABASE_RUNTIME_PASSWORD must contain at least 32 characters');

const pool = new Pool({ connectionString });
try {
  const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'agency_app'");
  if (!role.rowCount) throw new Error('agency_app does not exist; run db:migrate first');
  const quotedPassword = (await pool.query('SELECT quote_literal($1) AS value', [password])).rows[0].value;
  const runtime = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'agency_runtime'");
  if (runtime.rowCount) {
    await pool.query(`ALTER ROLE agency_runtime LOGIN PASSWORD ${quotedPassword} IN ROLE agency_app`);
  } else {
    await pool.query(`CREATE ROLE agency_runtime LOGIN PASSWORD ${quotedPassword} IN ROLE agency_app`);
  }
  await pool.query('GRANT agency_app TO agency_runtime');
  await pool.query('ALTER ROLE agency_runtime SET row_security = on');
  await pool.query('REVOKE CREATE ON SCHEMA public FROM agency_runtime');
  console.log('agency_runtime is ready with least-privilege defaults');
} finally {
  await pool.end();
}
