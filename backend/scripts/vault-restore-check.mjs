// Ensayo de restore del vault (E1-09c; deploy/production/backup/README.md).
//   seal: guarda por el camino real (VaultService.rotate) una credencial sintética en un perfil.
//   open: descifra la credencial vigente con la VAULT_KEK del entorno y exige el secreto esperado.
// Sale con 1 si la credencial no abre (por ejemplo, con una KEK distinta a la custodiada).
// Uso: node scripts/vault-restore-check.mjs <seal|open> <externalRef> <secreto>
import { sql } from 'drizzle-orm';
import { ConfigService } from '../dist/config/config.service.js';
import { LoggerService } from '../dist/common/logger/logger.service.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { RedisService } from '../dist/common/redis/redis.service.js';
import { AuditService } from '../dist/common/audit/audit.service.js';
import { VaultCryptoService } from '../dist/modules/vault/vault.crypto.js';
import { VaultAlertService } from '../dist/modules/vault/vault-alerts.service.js';
import { DrizzleVaultRepository } from '../dist/modules/vault/vault.drizzle-repository.js';
import { VaultService } from '../dist/modules/vault/vault.service.js';
import { OutboxService } from '../dist/modules/outbox/outbox.service.js';

const [mode, externalRef, secret] = process.argv.slice(2);
if (!['seal', 'open'].includes(mode) || !externalRef || !secret) {
  console.error('uso: node scripts/vault-restore-check.mjs <seal|open> <externalRef> <secreto>');
  process.exit(2);
}

const config = new ConfigService();
const logger = new LoggerService('warn');
const database = new DatabaseService(config, logger);
await database.onModuleInit();
const crypto = new VaultCryptoService(config, database);
try {
  // Attribute the rotation to the bootstrap admin when configured, else to the oldest admin.
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || null;
  const { rows: [admin] } = await database.db.execute(sql`select u.id, u.email from users u join roles r on r.id = u.role_id where r.code = 'ADMIN' and u.deleted_at is null and (${adminEmail}::text is null or u.email = ${adminEmail}) order by u.created_at limit 1`);
  if (!admin) throw new Error(adminEmail ? `ADMIN user ${adminEmail} was not found` : 'an ADMIN user is required to run the vault restore check');
  console.log(`acting as ADMIN ${admin.email}`);
  // The ops container connects as the runtime role and tt_profile_credentials forces RLS, so
  // both modes run under the same ADMIN request context the API sets for each request.
  await database.withRequestContext(admin.id, 'ADMIN', async () => {
    const { rows: [profile] } = await database.db.execute(sql`select id, version, login_email from tt_profiles where external_ref = ${externalRef} and deleted_at is null`);
    if (!profile) throw new Error(`profile ${externalRef} does not exist`);
    if (mode === 'seal') {
      const redis = new RedisService(config);
      const vault = new VaultService(new DrizzleVaultRepository(database), redis, crypto, new AuditService(database), database, new VaultAlertService(new DrizzleVaultRepository(database), database, redis, new OutboxService(database), logger));
      const { version } = await vault.rotate(profile.id, { username: profile.login_email, secret, profileVersion: profile.version }, { id: admin.id, role: 'ADMIN' });
      console.log(`sealed ${externalRef} credential v${version}`);
    } else {
      const { rows: [row] } = await database.db.execute(sql`select secret_ciphertext, secret_nonce, secret_tag, key_version, aad_context from tt_profile_credentials where profile_id = ${profile.id} and is_current`);
      if (!row) throw new Error(`profile ${externalRef} has no current credential`);
      const opened = await crypto.decrypt({ ciphertext: row.secret_ciphertext, nonce: row.secret_nonce, tag: row.secret_tag, keyVersion: row.key_version, aadContext: row.aad_context });
      if (opened !== secret) throw new Error('restored credential does not match the sealed secret');
      console.log(`opened ${externalRef} credential (DEK v${row.key_version}) with the configured KEK`);
    }
  });
} catch (error) {
  // Drizzle wraps the PostgreSQL error and keeps it in `cause`; print it so a policy or
  // constraint failure is diagnosable without reading the database log.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
  console.error(`vault restore check failed: ${error instanceof Error ? error.message : String(error)}${cause}`);
  process.exitCode = 1;
} finally {
  await database.onModuleDestroy();
}
