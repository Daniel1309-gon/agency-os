import { describe, expect, it } from 'vitest';

import { createFakeDatabase } from '../../test/support/fake-db.js';
import { DrizzleVaultRepository } from './vault.drizzle-repository.js';

const PROFILE = '22222222-2222-2222-2222-222222222222';
const ADMIN = '77777777-7777-7777-7777-777777777777';

describe('DrizzleVaultRepository.rotateCredential', () => {
  it('rotates encrypted material and records access in one transaction', async () => {
    const db = createFakeDatabase();
    const repository = new DrizzleVaultRepository(db.service);
    const rotatedAt = new Date('2026-08-21T12:00:00.000Z');

    await repository.rotateCredential({
      profileId: PROFILE,
      username: 'profile@example.test',
      ciphertext: Buffer.from('ciphertext'),
      nonce: Buffer.from('nonce'),
      tag: Buffer.from('tag'),
      keyVersion: 3,
      aadContext: `${PROFILE}:3`,
      version: 4,
      rotatedAt,
      rotatedBy: ADMIN,
    });

    expect(db.transactions()).toBe(1);
    expect(db.updated('tt_profile_credentials')[0]).toEqual({ isCurrent: false });
    expect(db.inserted('tt_profile_credentials')[0]).toMatchObject({
      profileId: PROFILE,
      username: 'profile@example.test',
      secretCiphertext: Buffer.from('ciphertext'),
      keyVersion: 3,
      version: 4,
      isCurrent: true,
      rotatedBy: ADMIN,
    });
    expect(db.inserted('credential_access_log')[0]).toMatchObject({
      profileId: PROFILE,
      userId: ADMIN,
      purpose: 'ADMIN_ROTATION',
      granted: true,
      occurredAt: rotatedAt,
    });
    expect(JSON.stringify(db.inserted('credential_access_log')[0])).not.toContain('ciphertext');
  });
});
