import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const cidr = process.env.BOOTSTRAP_IP_CIDR?.trim() || '127.0.0.1/32';
if (!connectionString) throw new Error('DATABASE_URL is required');
if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required');

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
  if (!admin.rowCount) throw new Error('Bootstrap admin was not found; run db:seed first');
  const inserted = await pool.query(
    `INSERT INTO ip_allowlist (label, cidr, scope, created_by)
     SELECT 'local-bootstrap', $1::cidr, 'ALL', $2
      WHERE NOT EXISTS (SELECT 1 FROM ip_allowlist WHERE is_active = true)
     RETURNING id`,
    [cidr, admin.rows[0].id],
  );
  console.log(inserted.rowCount ? `Bootstrap IP allowlist configured for ${cidr}` : 'An active IP allowlist already exists; bootstrap was not changed');
} finally {
  await pool.end();
}
