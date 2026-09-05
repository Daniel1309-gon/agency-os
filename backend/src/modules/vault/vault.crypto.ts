import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { encryptionKeys } from '../../database/schema/index.js';

export interface EncryptedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  keyVersion: number;
  aadContext: string;
}

@Injectable()
export class VaultCryptoService {
  constructor(private readonly config: ConfigService, private readonly db: DatabaseService) {}

  async ensureKey(version = 1): Promise<Buffer> {
    const existing = await this.db.db.query.encryptionKeys.findFirst({ where: eq(encryptionKeys.version, version) });
    if (existing) return this.unwrap(existing.wrappedDek);
    const dek = randomBytes(32);
    const wrapped = this.wrap(dek);
    await this.db.db.insert(encryptionKeys).values({ version, wrappedDek: wrapped, algorithm: 'AES-256-GCM' });
    return dek;
  }

  async currentKeyVersion(): Promise<number> {
    const [latest] = await this.db.db
      .select({ version: encryptionKeys.version })
      .from(encryptionKeys)
      .orderBy(desc(encryptionKeys.version))
      .limit(1);
    return latest?.version ?? 1;
  }

  async rotateKey(): Promise<number> {
    const version = (await this.currentKeyVersion()) + 1;
    await this.ensureKey(version);
    return version;
  }

  async encrypt(secret: string, profileId: string, version?: number): Promise<EncryptedSecret> {
    const keyVersion = version ?? await this.currentKeyVersion();
    const dek = await this.ensureKey(keyVersion);
    const nonce = randomBytes(12);
    const aadContext = `${profileId}:${keyVersion}`;
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(Buffer.from(aadContext));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag(), keyVersion, aadContext };
  }

  async decrypt(value: { ciphertext: Buffer; nonce: Buffer; tag: Buffer; keyVersion: number; aadContext: string }): Promise<string> {
    const key = await this.db.db.query.encryptionKeys.findFirst({ where: eq(encryptionKeys.version, value.keyVersion) });
    if (!key) throw new Error('Encryption key version unavailable');
    const decipher = createDecipheriv('aes-256-gcm', this.unwrap(key.wrappedDek), value.nonce);
    decipher.setAAD(Buffer.from(value.aadContext));
    decipher.setAuthTag(value.tag);
    return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
  }

  private kek(): Buffer {
    return createHash('sha256').update(this.config.get('VAULT_KEK')).digest();
  }

  private wrap(dek: Buffer): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek(), nonce);
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  }

  private unwrap(wrapped: Buffer): Buffer {
    const nonce = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ciphertext = wrapped.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.kek(), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
