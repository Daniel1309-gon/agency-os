// Reenvoltura de la KEK del vault (SEC-09a; runbook en deploy/production/backup/README.md).
// Rotar la KEK no re-cifra las credenciales -eso es SEC-09b, E2-: cada DEK de
// encryption_keys se abre con VAULT_KEK_PREVIOUS y se vuelve a envolver con VAULT_KEK.
// Primero reenvuelve todo en memoria y solo despues escribe, en una transaccion: si una
// sola fila no abre con la KEK anterior, no cambia nada.
// Uso: VAULT_KEK_PREVIOUS=<vieja> VAULT_KEK=<nueva> node scripts/vault-rewrap-kek.mjs
import { sql } from 'drizzle-orm';
import { ConfigService } from '../dist/config/config.service.js';
import { LoggerService } from '../dist/common/logger/logger.service.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { VaultCryptoService } from '../dist/modules/vault/vault.crypto.js';

const previous = process.env.VAULT_KEK_PREVIOUS;
if (!previous || previous.length < 32) {
  console.error('VAULT_KEK_PREVIOUS is required and must be at least 32 characters, like VAULT_KEK');
  process.exit(2);
}
if (previous === process.env.VAULT_KEK) {
  console.error('VAULT_KEK_PREVIOUS must differ from VAULT_KEK');
  process.exit(2);
}

const config = new ConfigService();
const database = new DatabaseService(config, new LoggerService('warn'));
await database.onModuleInit();
const crypto = new VaultCryptoService(config, database);
try {
  const { rows } = await database.db.execute(sql`select version, wrapped_dek from encryption_keys order by version`);
  if (!rows.length) throw new Error('encryption_keys is empty: nothing to rewrap');
  const rewrapped = rows.map((row) => ({ version: row.version, wrappedDek: crypto.rewrap(row.wrapped_dek, previous) }));
  await database.db.transaction(async (tx) => {
    for (const row of rewrapped) {
      await tx.execute(sql`update encryption_keys set wrapped_dek = ${row.wrappedDek} where version = ${row.version}`);
    }
  });
  console.log(`rewrapped ${rewrapped.length} DEK(s) to the configured VAULT_KEK`);
} catch (error) {
  console.error(`vault KEK rewrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await database.onModuleDestroy();
}
