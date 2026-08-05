import { describe, expect, it } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import { hashPassword, needsRehash, signAccessToken, verifyAccessToken, verifyPassword } from './crypto.js';

describe('authentication crypto', () => {
  it('hashes and verifies a password without accepting a different password', async () => {
    const hash = await hashPassword('Correct horse battery staple', 14);
    expect(hash.startsWith('scrypt$14$8$1$')).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('accepts a passphrase longer than the 72 bytes bcrypt would have truncated', async () => {
    const long = 'a'.repeat(80);
    const hash = await hashPassword(long, 14);
    expect(await verifyPassword(long, hash)).toBe(true);
    // bcrypt habria dado true aqui, porque ignora todo lo que pasa de 72 bytes.
    expect(await verifyPassword(`${long}-diferente`, hash)).toBe(false);
  });

  it('verifies legacy cost-based hashes and marks them for rehash', async () => {
    // Formato previo a la decision #19: scrypt$<cost>$<salt>$<digest>, con N = 2^(cost+2).
    // Un usuario creado antes del cambio tiene que poder entrar; si no, el admin
    // sembrado por el seed queda fuera del sistema sin aviso.
    const salt = randomBytes(16);
    const digest = scryptSync('clave heredada', salt, 64, { N: 2 ** 12, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const legacy = `scrypt$10$${salt.toString('base64url')}$${digest.toString('base64url')}`;

    expect(await verifyPassword('clave heredada', legacy)).toBe(true);
    expect(await verifyPassword('otra clave', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('only flags a rehash when the stored parameters differ from the current ones', async () => {
    const hash = await hashPassword('x', 14);
    expect(needsRehash(hash, 14)).toBe(false);
    expect(needsRehash(hash, 17)).toBe(true);
  });

  it('signs and verifies access token claims', () => {
    const token = signAccessToken({ sub: '00000000-0000-0000-0000-000000000001', role: 'ADMIN', permissions: ['users.read'] }, 'a'.repeat(32), 60);
    const claims = verifyAccessToken(token, 'a'.repeat(32));
    expect(claims.sub).toBe('00000000-0000-0000-0000-000000000001');
    expect(() => verifyAccessToken(token, 'b'.repeat(32))).toThrow();
  });
});
