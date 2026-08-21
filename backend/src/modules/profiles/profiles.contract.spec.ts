import { describe, expect, it } from 'vitest';
import { assignedProfileSchema } from '@agency-os/shared';
import { mapAssignedProfile } from './profiles.service.js';

describe('assigned profile response contract', () => {
  it('preserves the shift binding and matches the shared operator DTO', () => {
    const shiftId = '11111111-1111-4111-8111-111111111111';
    const result = mapAssignedProfile({
      assignmentId: '22222222-2222-4222-8222-222222222222',
      profileId: '33333333-3333-4333-8333-333333333333',
      profileName: 'Perfil de prueba',
      profileUsername: 'profile-user',
      status: 'ACTIVE',
      chromeProfileDir: 'Profile 7',
      shiftId,
      validFrom: '2026-08-21T06:05:00-05:00',
      validTo: '2026-08-21T14:05:00-05:00',
      sessionId: null,
      sessionStatus: null,
      sessionStartedAt: null,
      sessionErrorCode: null,
    });

    expect(result).toMatchObject({ shiftId });
    expect(assignedProfileSchema.safeParse(result)).toMatchObject({ success: true });
  });
});
