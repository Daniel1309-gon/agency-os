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
import { DrizzleVaultRepository } from '../dist/modules/vault/vault.drizzle-repository.js';
import { VaultService } from '../dist/modules/vault/vault.service.js';

const [mode, externalRef, secret] = process.argv.slice(2);
if (!['seal', 'open'].includes(mode) || !externalRef || !secret) {
  console.error('uso: node scripts/vault-restore-check.mjs <seal|open> <externalRef> <secreto>');
  process.exit(2);
}

const config = new ConfigService();
const database = new DatabaseService(config, new LoggerService('warn'));
await database.onModuleInit();
const crypto = new VaultCryptoService(config, database);
try {
  const { rows: [profile] } = await database.db.execute(sql`select id, version, login_email from tt_profiles where external_ref = ${externalRef} and deleted_at is null`);
  if (!profile) throw new Error(`profile ${externalRef} does not exist`);
  if (mode === 'seal') {
    const { rows: [admin] } = await database.db.execute(sql`select u.id from users u join roles r on r.id = u.role_id where r.code = 'ADMIN' and u.deleted_at is null limit 1`);
    if (!admin) throw new Error('an ADMIN user is required to rotate the credential');
    const vault = new VaultService(new DrizzleVaultRepository(database), new RedisService(config), crypto, new AuditService(database), database);
    const { version } = await vault.rotate(profile.id, { username: profile.login_email, secret, profileVersion: profile.version }, { id: admin.id, role: 'ADMIN' });
    console.log(`sealed ${externalRef} credential v${version}`);
  } else {
    const { rows: [row] } = await database.db.execute(sql`select secret_ciphertext, secret_nonce, secret_tag, key_version, aad_context from tt_profile_credentials where profile_id = ${profile.id} and is_current`);
    if (!row) throw new Error(`profile ${externalRef} has no current credential`);
    const opened = await crypto.decrypt({ ciphertext: row.secret_ciphertext, nonce: row.secret_nonce, tag: row.secret_tag, keyVersion: row.key_version, aadContext: row.aad_context });
    if (opened !== secret) throw new Error('restored credential does not match the sealed secret');
    console.log(`opened ${externalRef} credential (DEK v${row.key_version}) with the configured KEK`);
  }
} catch (error) {
  console.error(`vault restore check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await database.onModuleDestroy();
}
