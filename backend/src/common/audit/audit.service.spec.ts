import { describe, expect, it } from 'vitest';
import { AuditService } from './audit.service.js';
import { createFakeDatabase } from '../../test/support/fake-db.js';

describe('AuditService', () => {
  it('writes only allowlisted, non-secret metadata', async () => {
    const fake = createFakeDatabase();
    const audit = new AuditService(fake.service);

    await audit.record({
      actorType: 'USER',
      actorUserId: '00000000-0000-0000-0000-000000000001',
      action: 'vault.credential.issued',
      entityType: 'profile',
      entityId: '00000000-0000-0000-0000-000000000002',
      result: 'SUCCESS',
      metadata: {
        profileId: '00000000-0000-0000-0000-000000000002',
        grantId: 'grant-1',
        extra: 'must-not-survive',
        nested: { extra: 'must-not-survive', reason: 'allowed' },
      },
    });

    expect(fake.inserted('audit_log')).toEqual([
      expect.objectContaining({
        action: 'vault.credential.issued',
        metadata: { profileId: '00000000-0000-0000-0000-000000000002', grantId: 'grant-1' },
      }),
    ]);
  });

  it('fails closed when a secret field is passed, including when nested', async () => {
    const fake = createFakeDatabase();
    const audit = new AuditService(fake.service);

    await expect(audit.record({
      actorType: 'USER',
      action: 'vault.credential.issued',
      result: 'SUCCESS',
      metadata: { context: { password: 'must-not-survive' } },
    })).rejects.toThrow(/forbidden secret field/);
    expect(fake.inserted('audit_log')).toHaveLength(0);
  });
});
