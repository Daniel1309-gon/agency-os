import { describe, expect, it, vi } from 'vitest';
import { AssignmentsService } from './assignments.service.js';
import { createFakeDatabase } from '../../test/support/fake-db.js';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { RealtimeService } from '../realtime/realtime.service.js';

const OPERATOR = '11111111-1111-1111-1111-111111111111';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const ASSIGNMENT = '33333333-3333-3333-3333-333333333333';
const SESSION = '55555555-5555-5555-5555-555555555555';

function harness() {
  const db = createFakeDatabase();
  db.stub('tt_profiles').select([{ id: PROFILE, chromeProfileDir: 'Profile 1' }]);
  db.stub('profile_assignments').findFirst({ id: ASSIGNMENT, profileId: PROFILE, operatorId: OPERATOR, status: 'ACTIVE' });
  db.stub('profile_sessions').returning([{ id: SESSION, status: 'LAUNCHING', startedAt: null }]);
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const realtime = { publishOperatorChanged: vi.fn(async () => undefined) } as unknown as RealtimeService;
  return { service: new AssignmentsService(db.service, audit, realtime), db };
}

describe('AssignmentsService.prepareSession', () => {
  it('prepares an unbound session so the operator can use any approved office station', async () => {
    const { service, db } = harness();
    const result = await service.prepareSession({ profileId: PROFILE, assignmentId: ASSIGNMENT, chromeProfileDir: 'Profile 1' }, OPERATOR);

    expect(result).toMatchObject({ id: SESSION, status: 'LAUNCHING' });
    expect(db.inserted('profile_sessions')[0]).toMatchObject({
      profileId: PROFILE,
      operatorId: OPERATOR,
      assignmentId: ASSIGNMENT,
      status: 'LAUNCHING',
    });
    expect(db.inserted('profile_sessions')[0]).not.toHaveProperty('deviceId');
  });
});
