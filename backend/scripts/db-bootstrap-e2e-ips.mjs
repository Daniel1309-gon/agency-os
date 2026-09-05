import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const LABELS = ['station-e2e-docker-ingress', 'station-e2e-server', 'station-e2e-client'];

export function parseBootstrapCidrs(raw) {
  const values = String(raw ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length !== 3) {
    throw new Error('BOOTSTRAP_IP_CIDRS must contain exactly three IPv4 /32 entries');
  }
  for (const value of values) {
    const match = /^(.*)\/32$/.exec(value);
    if (!match || isIP(match[1]) !== 4) {
      throw new Error('Every bootstrap CIDR must be an IPv4 /32');
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('Bootstrap CIDRs must be unique');
  }
  return values.map((cidr, index) => ({ label: LABELS[index], cidr }));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!connectionString) throw new Error('DATABASE_URL is required');
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required');
  const entries = parseBootstrapCidrs(process.env.BOOTSTRAP_IP_CIDRS);
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString });
  try {
    const admin = await pool.query(
      `SELECT u.id
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
        WHERE u.email = $1 AND r.code = 'ADMIN' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        LIMIT 1`,
      [email],
    );
    if (!admin.rowCount) throw new Error('Bootstrap admin was not found; run the base seed first');
    await pool.query('BEGIN');
    try {
      for (const entry of entries) {
        const updated = await pool.query(
          `UPDATE ip_allowlist
              SET cidr = $1::cidr, scope = 'ALL', role_id = NULL, user_id = NULL,
                  is_active = true, expires_at = NULL
            WHERE label = $2
          RETURNING id`,
          [entry.cidr, entry.label],
        );
        if (!updated.rowCount) {
          await pool.query(
            `INSERT INTO ip_allowlist (label, cidr, scope, created_by)
             VALUES ($1, $2::cidr, 'ALL', $3)`,
            [entry.label, entry.cidr, admin.rows[0].id],
          );
        }
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log('Station E2E allowlist configured with three IPv4 /32 entries');
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Station E2E allowlist bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
