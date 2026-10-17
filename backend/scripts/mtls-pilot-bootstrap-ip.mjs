import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Saltos internos del piloto que deben poder usar la API para provisionar y
// para los health checks que no dependen de una IP pública concreta.
const INTERNAL_ENTRIES = [
  { label: 'mtls-pilot-internal-ops', cidr: '172.32.0.250/32' },
];

export function parsePilotCidrs(raw) {
  const values = String(raw ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error('PILOT_IP_CIDRS must contain at least one public IP');
  for (const value of values) {
    const match = /^(.*)\/(32|128)$/.exec(value);
    if (!match || isIP(match[1]) === 0) {
      throw new Error('Every pilot CIDR must be a single host IPv4 /32 or IPv6 /128');
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('Pilot CIDRs must be unique');
  }
  return values.map((cidr, index) => ({ label: `mtls-pilot-client-${index + 1}`, cidr }));
}

export function parseExpiry(raw) {
  const value = String(raw ?? '').trim();
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error('PILOT_ALLOWLIST_EXPIRES_AT must be an ISO-8601 datetime');
  }
  if (date.getTime() <= Date.now()) {
    throw new Error('PILOT_ALLOWLIST_EXPIRES_AT must be in the future');
  }
  return date;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!connectionString) throw new Error('DATABASE_URL is required');
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required');
  const entries = [...parsePilotCidrs(process.env.PILOT_IP_CIDRS), ...INTERNAL_ENTRIES];
  const expiresAt = parseExpiry(process.env.PILOT_ALLOWLIST_EXPIRES_AT);
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
      // La allowlist del piloto se reconcilia por etiqueta: cada corrida deja
      // exactamente las entradas vigentes y expira el resto de la misma familia.
      await pool.query(
        `UPDATE ip_allowlist
            SET is_active = false
          WHERE label LIKE 'mtls-pilot-%'
            AND label <> ALL($1::text[])`,
        [entries.map((entry) => entry.label)],
      );
      for (const entry of entries) {
        const updated = await pool.query(
          `UPDATE ip_allowlist
              SET cidr = $1::cidr, scope = 'ALL', role_id = NULL, user_id = NULL,
                  is_active = true, expires_at = $2
            WHERE label = $3
          RETURNING id`,
          [entry.cidr, expiresAt, entry.label],
        );
        if (!updated.rowCount) {
          await pool.query(
            `INSERT INTO ip_allowlist (label, cidr, scope, created_by, expires_at)
             VALUES ($1, $2::cidr, 'ALL', $3, $4)`,
            [entry.label, entry.cidr, admin.rows[0].id, expiresAt],
          );
        }
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log(`Pilot allowlist reconciled: ${entries.length} entries, expires ${expiresAt.toISOString()}`);
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Pilot allowlist bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
