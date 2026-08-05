import { describe, expect, it } from 'vitest';
import { VaultCryptoService } from './vault.crypto.js';
import { createFakeDatabase, type FakeDatabase } from '../../test/support/fake-db.js';
import type { ConfigService } from '../../config/config.service.js';

const KEK = 'una-kek-de-pruebas-de-mas-de-32-caracteres';
const PROFILE_A = '11111111-1111-1111-1111-111111111111';
const PROFILE_B = '22222222-2222-2222-2222-222222222222';

function crypto(kek = KEK): { service: VaultCryptoService; db: FakeDatabase } {
  const db = createFakeDatabase();
  const config = { get: () => kek } as unknown as ConfigService;
  return { service: new VaultCryptoService(config, db.service), db };
}

/** Publica en `findFirst` la clave que `ensureKey` acaba de insertar. */
function publishGeneratedKey(db: FakeDatabase): { version: number; wrappedDek: Buffer } {
  const [inserted] = db.inserted('encryption_keys') as Array<{ version: number; wrappedDek: Buffer }>;
  db.stub('encryption_keys').findFirst(inserted);
  return inserted;
}

describe('VaultCryptoService', () => {
  it('encrypts a secret and decrypts it back', async () => {
    const { service, db } = crypto();
    const encrypted = await service.encrypt('super-secreta', PROFILE_A);
    publishGeneratedKey(db);

    expect(encrypted.ciphertext.toString('utf8')).not.toContain('super-secreta');
    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.tag).toHaveLength(16);
    expect(encrypted.aadContext).toBe(`${PROFILE_A}:1`);
    expect(await service.decrypt(encrypted)).toBe('super-secreta');
  });

  it('wraps the DEK before storing it: the key at rest is not the key in use', async () => {
    const { service, db } = crypto();
    await service.encrypt('x', PROFILE_A);
    const [stored] = db.inserted('encryption_keys') as Array<{ wrappedDek: Buffer; algorithm: string }>;

    expect(stored.algorithm).toBe('AES-256-GCM');
    // nonce (12) + tag (16) + DEK cifrada (32).
    expect(stored.wrappedDek).toHaveLength(60);
  });

  it('binds a ciphertext to its profile through the AAD', async () => {
    // Decision de PLAN.md §3.2: sin esto, mover una fila de credencial de un
    // perfil a otro entregaria la contrasena del primero al operador del segundo.
    const { service, db } = crypto();
    const encrypted = await service.encrypt('secreto-del-perfil-a', PROFILE_A);
    publishGeneratedKey(db);

    await expect(service.decrypt({ ...encrypted, aadContext: `${PROFILE_B}:1` })).rejects.toThrow();
  });

  it('rejects a tampered ciphertext, nonce or tag', async () => {
    const { service, db } = crypto();
    const encrypted = await service.encrypt('secreto', PROFILE_A);
    publishGeneratedKey(db);

    const flip = (buffer: Buffer): Buffer => {
      const copy = Buffer.from(buffer);
      copy[0] ^= 0xff;
      return copy;
    };

    await expect(service.decrypt({ ...encrypted, ciphertext: flip(encrypted.ciphertext) })).rejects.toThrow();
    await expect(service.decrypt({ ...encrypted, nonce: flip(encrypted.nonce) })).rejects.toThrow();
    await expect(service.decrypt({ ...encrypted, tag: flip(encrypted.tag) })).rejects.toThrow();
  });

  it('cannot decrypt with a different KEK', async () => {
    const { service, db } = crypto();
    const encrypted = await service.encrypt('secreto', PROFILE_A);
    const stored = publishGeneratedKey(db);

    const other = crypto('otra-kek-distinta-de-mas-de-32-caracteres');
    other.db.stub('encryption_keys').findFirst(stored);
    await expect(other.service.decrypt(encrypted)).rejects.toThrow();
  });

  it('fails loudly when the referenced key version is gone', async () => {
    const { service } = crypto();
    const encrypted = await service.encrypt('secreto', PROFILE_A);
    await expect(service.decrypt(encrypted)).rejects.toThrow('Encryption key version unavailable');
  });

  it('uses a fresh nonce on every encryption', async () => {
    const { service } = crypto();
    const nonces = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      nonces.add((await service.encrypt('mismo secreto', PROFILE_A)).nonce.toString('hex'));
    }
    // Un nonce repetido con la misma clave rompe GCM por completo.
    expect(nonces.size).toBe(25);
  });

  it('reuses the stored DEK instead of generating a new one per call', async () => {
    const { service, db } = crypto();
    await service.encrypt('uno', PROFILE_A);
    publishGeneratedKey(db);
    await service.encrypt('dos', PROFILE_A);

    expect(db.inserted('encryption_keys')).toHaveLength(1);
  });
});
