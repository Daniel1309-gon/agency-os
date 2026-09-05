import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignedProfileSchema,
  metricBatchSchema,
  operatorStatusSnapshotSchema,
  breakSummarySchema,
  shiftSummarySchema,
  prepareSessionMessageSchema,
  profileListResponseSchema,
  profileRecordSchema,
  sessionCloseSchema,
  sessionCreateSchema,
  sessionPatchSchema,
  managedUserSchema,
  assignmentHistoryResponseSchema,
  shiftTemplateRecordSchema,
  shiftOverrideRecordSchema,
  managedDeviceSchema,
  auditRecordSchema,
  auditLogResponseSchema,
  ipAllowlistRecordSchema,
  readinessResponseSchema,
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
  assert.equal(sessionCreateSchema.safeParse({
    profileId,
    assignmentId,
    chromeProfileDir: 'Profile 1000',
  }).success, false);
  assert.equal(sessionPatchSchema.safeParse({
    status: 'ERROR',
    errorCode: 'LOGIN_REJECTED',
    version: 1,
  }).success, true);
  assert.equal(sessionPatchSchema.safeParse({
    status: 'ERROR',
    errorCode: 'LOGIN_REJECTED',
  }).success, false);
  assert.equal(sessionCloseSchema.safeParse({ version: 1 }).success, true);
  assert.equal(sessionCloseSchema.safeParse({}).success, false);

  assert.equal(prepareSessionMessageSchema.safeParse({
    action: 'prepareSession',
    accessToken: 'access-token',
    profileId,
    sessionId,
    chromeProfileDir: 'Profile 7',
    launchUrl: 'https://talkytimes.com/auth/login',
    version: 1,
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
      status: 'STALE',
      version: 2,
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

test('operator status snapshots expose only the safe live semáforo contract', () => {
  const snapshot = {
    operatorId: '44444444-4444-4444-8444-444444444444',
    fullName: 'Valentina Ríos',
    status: 'ONLINE',
    reason: 'SESSION_ACTIVE',
    changedAt: '2026-08-21T08:00:00.000Z',
  };

  assert.equal(operatorStatusSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(operatorStatusSnapshotSchema.safeParse({ ...snapshot, password: 'never' }).success, false);
  assert.equal(operatorStatusSnapshotSchema.safeParse({ ...snapshot, status: 'ACTIVE' }).success, false);
});

test('shift and break responses expose the fields required by the operator workspace', () => {
  assert.equal(shiftSummarySchema.safeParse({
    id: '55555555-5555-4555-8555-555555555555',
    operatorId: '44444444-4444-4444-8444-444444444444',
    businessDate: '2026-08-21',
    scheduledRange: '["2026-08-21 11:05:00+00","2026-08-21 19:05:00+00")',
    actualStartAt: '2026-08-21T11:06:00.000Z',
    actualEndAt: null,
    status: 'IN_PROGRESS',
    effectiveMinutes: null,
    notes: null,
  }).success, true);
  assert.equal(breakSummarySchema.safeParse({
    id: '66666666-6666-4666-8666-666666666666',
    shiftId: '55555555-5555-4555-8555-555555555555',
    type: 'REST',
    scheduledAt: '2026-08-21T15:00:00.000Z',
    startedAt: null,
    endedAt: null,
    durationMinutes: null,
    status: 'PENDING',
  }).success, true);
});

test('profile catalog contracts expose metadata without credentials', () => {
  const profile = {
    id: profileId,
    displayName: 'Perfil de prueba',
    loginEmail: 'profile@example.com',
    externalRef: null,
    country: 'CO',
    status: 'ACTIVE',
    chromeProfileDir: 'Profile 7',
    notes: null,
    version: 1,
    createdAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
  };

  assert.equal(profileRecordSchema.safeParse(profile).success, true);
  assert.equal(profileListResponseSchema.safeParse({
    data: [profile],
    pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  }).success, true);
  assert.equal(profileRecordSchema.safeParse({ ...profile, password: 'never' }).success, false);
});

test('management contracts expose scoped records without credential material', () => {
  const user = {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'operator@example.com',
    fullName: 'Operador de prueba',
    nationalId: null,
    phone: null,
    roleId: '77777777-7777-4777-8777-777777777777',
    roleCode: 'OPERADOR',
    status: 'ACTIVE',
    mustChangePassword: true,
    rocketchatUserId: null,
    rocketchatDirectRoomId: null,
    lastLoginAt: null,
    createdAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
  };
  assert.equal(managedUserSchema.safeParse(user).success, true);
  assert.equal(managedUserSchema.safeParse({ ...user, passwordHash: 'forbidden' }).success, false);
  assert.equal(assignmentHistoryResponseSchema.safeParse({ items: [], page: 1, pageSize: 100, total: 0 }).success, true);
  assert.equal(shiftTemplateRecordSchema.safeParse({
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Turno mañana',
    crewId: null,
    startTime: '06:05:00',
    endTime: '14:05:00',
    crossesMidnight: false,
    weekdays: [1, 2, 3, 4, 5],
    breakMinutes: 30,
    validFrom: '2026-08-21',
    validTo: null,
    isActive: true,
  }).success, true);
  assert.equal(shiftOverrideRecordSchema.safeParse({
    id: '99999999-9999-4999-8999-999999999999',
    operatorId: user.id,
    range: '["2026-08-21 12:00:00+00","2026-08-21 13:00:00+00")',
    type: 'OVERTIME',
    reason: 'Cobertura',
    approvedBy: user.id,
    revokedAt: null,
    revokedBy: null,
    createdAt: '2026-08-21T08:00:00.000Z',
  }).success, true);
});

test('security contracts expose operational metadata without secrets', () => {
  const device = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    hostname: 'OFFICE-01',
    label: 'Puesto principal',
    status: 'APPROVED',
    extensionVersion: '1.0.0',
    helperVersion: '1.0.0',
    osVersion: 'Windows 11',
    lastSeenAt: '2026-08-21T08:00:00.000Z',
    lastIp: '10.20.30.40',
    tokenIssuedAt: '2026-08-21T08:00:00.000Z',
    tokenExpiresAt: '2026-11-19T08:00:00.000Z',
    revokedAt: null,
    revokedReason: null,
  };
  const audit = {
    id: 1,
    occurredAt: '2026-08-21T08:00:00.000Z',
    actorType: 'USER',
    actorUserId: '44444444-4444-4444-8444-444444444444',
    actorDeviceId: null,
    action: 'user.updated',
    entityType: 'user',
    entityId: '44444444-4444-4444-8444-444444444444',
    result: 'SUCCESS',
    ip: '10.20.30.40',
    requestId: 'req-1',
    metadata: { userId: '44444444-4444-4444-8444-444444444444' },
  };
  assert.equal(managedDeviceSchema.safeParse(device).success, true);
  assert.equal(managedDeviceSchema.safeParse({ ...device, tokenHash: 'forbidden' }).success, false);
  assert.equal(auditRecordSchema.safeParse(audit).success, true);
  assert.equal(auditRecordSchema.safeParse({ ...audit, metadata: { password: 'forbidden' } }).success, false);
  assert.equal(auditLogResponseSchema.safeParse({ data: [audit], pagination: { limit: 50, nextCursor: null } }).success, true);
  assert.equal(ipAllowlistRecordSchema.safeParse({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Oficina', cidr: '10.20.30.0/24', scope: 'ALL', roleId: null, userId: null, isActive: true, expiresAt: null }).success, true);
  assert.equal(readinessResponseSchema.safeParse({ status: 'ok', checks: { postgres: true, redis: true } }).success, true);
});
