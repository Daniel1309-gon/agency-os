import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignedProfileSchema,
  metricBatchSchema,
  sessionCreateSchema,
  sessionPatchSchema,
} from '../dist/index.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';

test('operator session contracts accept the supported payloads', () => {
  assert.equal(sessionCreateSchema.safeParse({
    profileId,
    assignmentId,
    chromeProfileDir: 'Profile 7',
  }).success, true);
  assert.equal(sessionPatchSchema.safeParse({
    status: 'ERROR',
    errorCode: 'LOGIN_REJECTED',
  }).success, true);
});

test('operator metrics contract bounds batches and rejects administrative fields', () => {
  const event = {
    dedupeKey: 'profile:event:1',
    profileId,
    eventType: 'POINTS_OBSERVED',
    points: 12,
    occurredAt: '2026-08-21T08:00:00-05:00',
    payload: {},
  };

  assert.equal(metricBatchSchema.safeParse({ events: [event] }).success, true);
  assert.equal(metricBatchSchema.safeParse({ events: [] }).success, false);
  assert.equal(metricBatchSchema.safeParse({
    events: [{ ...event, operatorId: sessionId }],
  }).success, false);
});

test('operator response contracts reject secrets and administrative compensation data', () => {
  const assignedProfile = {
    assignmentId,
    profileId,
    profileName: 'Perfil de prueba',
    profileUsername: 'profile-user',
    status: 'ACTIVE',
    chromeProfileDir: 'Profile 7',
    shiftId: null,
    validFrom: '2026-08-21T06:05:00-05:00',
    validTo: '2026-08-21T14:05:00-05:00',
    session: {
      id: sessionId,
      status: 'ACTIVE',
      startedAt: '2026-08-21T06:06:00-05:00',
      errorCode: null,
    },
  };

  assert.equal(assignedProfileSchema.safeParse(assignedProfile).success, true);
  assert.equal(assignedProfileSchema.safeParse({
    ...assignedProfile,
    credentialCiphertext: 'forbidden',
  }).success, false);
  assert.equal(assignedProfileSchema.safeParse({
    ...assignedProfile,
    commissionRate: '0.50',
  }).success, false);
});
