import { Pool } from 'pg';

// Registers the bootstrap admin's computer as the first ADMIN device. In production the
// client-cert guard only lets approved devices log in, and enrolling a device needs an
// admin session, so the very first ADMIN device has to be created out of band.
const connectionString = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const fingerprint = process.env.BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT?.trim().toLowerCase();
const label = process.env.BOOTSTRAP_ADMIN_DEVICE_LABEL?.trim() || 'admin-bootstrap';
if (!connectionString) throw new Error('DATABASE_URL is required');
if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required');
if (!fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) {
  throw new Error('BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT must be the SHA-256 fingerprint of the admin client certificate (64 hex characters)');
}

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
    `INSERT INTO devices (hostname, label, status, device_kind, cert_fingerprint, approved_by)
     SELECT $1, $1, 'APPROVED', 'ADMIN', $2, $3
      WHERE NOT EXISTS (SELECT 1 FROM devices WHERE device_kind = 'ADMIN' AND status <> 'REVOKED')
     RETURNING id`,
    [label, fingerprint, admin.rows[0].id],
  ).catch((error) => {
    // devices_cert_fingerprint_active_idx: one active device per certificate.
    if (error?.code === '23505') throw new Error('This certificate fingerprint already belongs to an active device; revoke it first');
    throw error;
  });
  console.log(inserted.rowCount ? `Bootstrap admin device registered as ${label}` : 'An active ADMIN device already exists; bootstrap was not changed');
} finally {
  await pool.end();
}
