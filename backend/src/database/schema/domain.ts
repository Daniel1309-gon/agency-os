import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { roles } from './roles.js';
import { users } from './users.js';

const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });
const inet = customType<{ data: string }>({ dataType: () => 'inet' });
const cidr = customType<{ data: string }>({ dataType: () => 'cidr' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const ts = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();
const actorFields = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
};

export const crews = pgTable('crews', {
  id: id(),
  name: text('name').notNull(),
  coordinatorId: uuid('coordinator_id').references(() => users.id),
  isActive: boolean('is_active').notNull().default(true),
  ...actorFields,
});

export const crewMembers = pgTable(
  'crew_members',
  {
    id: id(),
    crewId: uuid('crew_id').notNull().references(() => crews.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    validRange: tstzrange('valid_range'),
  },
  (t) => ({ crewMemberRange: index('crew_members_valid_range_idx').on(t.crewId, t.validRange) }),
);

export const operatorCompensation = pgTable('operator_compensation', {
  id: id(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }).notNull(),
  pointsToCopRate: numeric('points_to_cop_rate', { precision: 12, scale: 4 }).notNull(),
  monthlyGoalPoints: numeric('monthly_goal_points', { precision: 14, scale: 4 }),
  maxConcurrentProfiles: smallint('max_concurrent_profiles').notNull().default(1),
  validRange: tstzrange('valid_range'),
  note: text('note'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const devices = pgTable('devices', {
  id: id(),
  hostname: text('hostname').notNull(),
  label: text('label').notNull(),
  // Legacy only: stations are shared and authorization must never depend on this field.
  assignedOperatorId: uuid('assigned_operator_id').references(() => users.id),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  enrollmentCodeHash: text('enrollment_code_hash'),
  enrollmentCodeExpiresAt: ts('enrollment_code_expires_at'),
  tokenHash: text('token_hash'),
  tokenIssuedAt: ts('token_issued_at'),
  tokenExpiresAt: ts('token_expires_at'),
  extensionVersion: text('extension_version'),
  helperVersion: text('helper_version'),
  osVersion: text('os_version'),
  lastSeenAt: ts('last_seen_at'),
  lastIp: inet('last_ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
  approvedBy: uuid('approved_by').references(() => users.id),
  revokedAt: ts('revoked_at'),
  revokedReason: text('revoked_reason'),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  familyId: uuid('family_id').notNull(),
  issuedAt: ts('issued_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  replacedById: uuid('replaced_by_id'),
  revokedReason: varchar('revoked_reason', { length: 32 }),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  deviceId: uuid('device_id').references(() => devices.id),
});

export const ipAllowlist = pgTable('ip_allowlist', {
  id: id(),
  label: text('label').notNull(),
  cidr: cidr('cidr'),
  scope: varchar('scope', { length: 8 }).notNull().default('ALL'),
  roleId: uuid('role_id').references(() => roles.id),
  userId: uuid('user_id').references(() => users.id),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
});

export const loginAttempts = pgTable('login_attempts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  emailAttempted: text('email_attempted').notNull(),
  userId: uuid('user_id').references(() => users.id),
  ip: inet('ip'),
  outcome: varchar('outcome', { length: 32 }).notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorType: varchar('actor_type', { length: 16 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorDeviceId: uuid('actor_device_id').references(() => devices.id),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    result: varchar('result', { length: 16 }).notNull(),
    ip: inet('ip'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => ({ auditOccurredAt: index('audit_log_occurred_at_idx').on(t.occurredAt) }),
);

export const ttProfiles = pgTable(
  'tt_profiles',
  {
    id: id(),
    displayName: text('display_name').notNull(),
    loginEmail: text('login_email').notNull(),
    externalRef: text('external_ref'),
    country: char('country', { length: 2 }),
    status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
    chromeProfileDir: text('chrome_profile_dir'),
    notes: text('notes'),
    version: integer('version').notNull().default(0),
    ...actorFields,
    deletedAt: ts('deleted_at'),
  },
  (t) => ({
    loginEmailUnique: uniqueIndex('tt_profiles_login_email_unique')
      .on(t.loginEmail)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

export const encryptionKeys = pgTable('encryption_keys', {
  version: integer('version').primaryKey(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  algorithm: text('algorithm').notNull().default('AES-256-GCM'),
  createdAt: ts('created_at').notNull().defaultNow(),
  retiredAt: ts('retired_at'),
});

export const ttProfileCredentials = pgTable(
  'tt_profile_credentials',
  {
    id: id(),
    profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
    username: text('username').notNull(),
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    secretNonce: bytea('secret_nonce').notNull(),
    secretTag: bytea('secret_tag').notNull(),
    keyVersion: integer('key_version').notNull().references(() => encryptionKeys.version),
    aadContext: text('aad_context').notNull(),
    version: integer('version').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    rotatedAt: ts('rotated_at').notNull().defaultNow(),
    rotatedBy: uuid('rotated_by').notNull().references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({ currentCredential: uniqueIndex('one_current_credential_per_profile').on(t.profileId).where(sql`${t.isCurrent}`) }),
);

export const credentialAccessLog = pgTable('credential_access_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  userId: uuid('user_id').references(() => users.id),
  deviceId: uuid('device_id').references(() => devices.id),
  assignmentId: uuid('assignment_id'),
  purpose: varchar('purpose', { length: 32 }).notNull(),
  granted: boolean('granted').notNull(),
  denyReason: varchar('deny_reason', { length: 32 }),
  grantJti: uuid('grant_jti'),
  consumedAt: ts('consumed_at'),
  reuseAttempted: boolean('reuse_attempted').notNull().default(false),
  ip: inet('ip'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

export const shiftTemplates = pgTable('shift_templates', {
  id: id(),
  name: text('name').notNull(),
  crewId: uuid('crew_id').references(() => crews.id),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  crossesMidnight: boolean('crosses_midnight').notNull().default(false),
  weekdays: smallint('weekdays').array().notNull(),
  breakMinutes: smallint('break_minutes').notNull().default(0),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  isActive: boolean('is_active').notNull().default(true),
});

export const shifts = pgTable('shifts', {
  id: id(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  templateId: uuid('template_id').references(() => shiftTemplates.id),
  businessDate: date('business_date').notNull(),
  scheduledRange: tstzrange('scheduled_range'),
  actualStartAt: ts('actual_start_at'),
  actualEndAt: ts('actual_end_at'),
  status: varchar('status', { length: 16 }).notNull().default('SCHEDULED'),
  effectiveMinutes: integer('effective_minutes'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const shiftOverrides = pgTable('shift_overrides', {
  id: id(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  range: tstzrange('range'),
  type: varchar('type', { length: 32 }).notNull(),
  reason: text('reason').notNull(),
  approvedBy: uuid('approved_by').notNull().references(() => users.id),
  revokedAt: ts('revoked_at'),
  revokedBy: uuid('revoked_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const profileAssignments = pgTable(
  'profile_assignments',
  {
    id: id(),
    profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
    operatorId: uuid('operator_id').notNull().references(() => users.id),
    shiftId: uuid('shift_id').references(() => shifts.id),
    validRange: tstzrange('valid_range'),
    status: varchar('status', { length: 16 }).notNull().default('SCHEDULED'),
    assignedBy: uuid('assigned_by').notNull().references(() => users.id),
    endedAt: ts('ended_at'),
    endReason: varchar('end_reason', { length: 16 }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => ({ assignmentRange: index('profile_assignments_range_idx').on(t.profileId, t.validRange) }),
);

export const profileSessions = pgTable(
  'profile_sessions',
  {
    id: id(),
    profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
    operatorId: uuid('operator_id').notNull().references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    assignmentId: uuid('assignment_id').notNull().references(() => profileAssignments.id),
    chromeProfileDir: text('chrome_profile_dir').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('LAUNCHING'),
    version: integer('version').notNull().default(1),
    startedAt: ts('started_at').notNull().defaultNow(),
    lastHeartbeatAt: ts('last_heartbeat_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    endReason: varchar('end_reason', { length: 32 }),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
  },
  (t) => ({
    liveSession: uniqueIndex('profile_single_live_session').on(t.profileId).where(sql`${t.status} IN ('LAUNCHING', 'ACTIVE')`),
    versionPositive: check('profile_sessions_version_positive', sql`${t.version} > 0`),
  }),
);

export const breaks = pgTable('breaks', {
  id: id(),
  shiftId: uuid('shift_id').notNull().references(() => shifts.id),
  type: varchar('type', { length: 16 }).notNull(),
  scheduledAt: ts('scheduled_at'),
  notifiedAt: ts('notified_at'),
  startedAt: ts('started_at'),
  endedAt: ts('ended_at'),
  durationMinutes: integer('duration_minutes'),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
});

export const operatorStatusEvents = pgTable('operator_status_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  status: varchar('status', { length: 16 }).notNull(),
  reason: text('reason'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

export const operatorCurrentStatus = pgTable('operator_current_status', {
  operatorId: uuid('operator_id').primaryKey().references(() => users.id),
  status: varchar('status', { length: 16 }).notNull(),
  reason: text('reason'),
  changedAt: ts('changed_at').notNull().defaultNow(),
});

export const metricEvents = pgTable(
  'metric_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    dedupeKey: text('dedupe_key').notNull(),
    profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
    operatorId: uuid('operator_id').references(() => users.id),
    sessionId: uuid('session_id').references(() => profileSessions.id),
    eventType: text('event_type').notNull(),
    points: numeric('points', { precision: 14, scale: 4 }),
    occurredAt: ts('occurred_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => ({ metricDedupe: uniqueIndex('metric_event_dedupe').on(t.dedupeKey, t.occurredAt) }),
);

export const profileDailyMetrics = pgTable('profile_daily_metrics', {
  id: id(),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  businessDate: date('business_date').notNull(),
  source: varchar('source', { length: 16 }).notNull(),
  messagesSent: integer('messages_sent').notNull().default(0),
  responses: integer('responses').notNull().default(0),
  points: numeric('points', { precision: 14, scale: 4 }).notNull().default('0'),
  icebreakersSent: integer('icebreakers_sent').notNull().default(0),
  icebreakersReplied: integer('icebreakers_replied').notNull().default(0),
  responseRate: numeric('response_rate', { precision: 6, scale: 4 }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ dailyMetricUnique: uniqueIndex('profile_daily_metrics_unique').on(t.profileId, t.businessDate, t.source) }));

export const metricReconciliation = pgTable('metric_reconciliation', {
  id: id(),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  businessDate: date('business_date').notNull(),
  extensionPoints: numeric('extension_points', { precision: 14, scale: 4 }).notNull().default('0'),
  tableauPoints: numeric('tableau_points', { precision: 14, scale: 4 }).notNull().default('0'),
  differencePoints: numeric('difference_points', { precision: 14, scale: 4 }).notNull().default('0'),
  tolerancePoints: numeric('tolerance_points', { precision: 14, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 24 }).notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tableauViews = pgTable('tableau_views', {
  id: id(),
  name: text('name').notNull(),
  siteId: text('site_id').notNull(),
  viewId: text('view_id').notNull(),
  sourceTimezone: text('source_timezone').notNull().default('America/Bogota'),
  kind: varchar('kind', { length: 32 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  columnMapping: jsonb('column_mapping').$type<Record<string, string>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tableauHourlyPoints = pgTable('tableau_hourly_points', {
  id: id(),
  viewId: uuid('view_id').notNull().references(() => tableauViews.id),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  sourceHour: ts('source_hour').notNull(),
  businessDate: date('business_date').notNull(),
  points: numeric('points', { precision: 14, scale: 4 }).notNull(),
  rawRow: jsonb('raw_row').$type<Record<string, unknown>>().notNull().default({}),
  etlRunId: uuid('etl_run_id'),
}, (t) => ({ hourlyUnique: uniqueIndex('tableau_hourly_points_unique').on(t.viewId, t.profileId, t.sourceHour) }));

export const etlRuns = pgTable('etl_runs', {
  id: id(),
  viewId: uuid('view_id').references(() => tableauViews.id),
  businessDate: date('business_date').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('RUNNING'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  rowCount: integer('row_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  error: text('error'),
  checksum: text('checksum'),
}, (t) => ({ runUnique: uniqueIndex('etl_runs_view_date_unique').on(t.viewId, t.businessDate) }));

export const etlStagingRows = pgTable('etl_staging_rows', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  etlRunId: uuid('etl_run_id').notNull().references(() => etlRuns.id),
  rowNumber: integer('row_number').notNull(),
  rawRow: jsonb('raw_row').$type<Record<string, unknown>>().notNull(),
  validationStatus: varchar('validation_status', { length: 16 }).notNull(),
  validationError: text('validation_error'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const icebreakerRules = pgTable('icebreaker_rules', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  pattern: text('pattern'),
  severity: varchar('severity', { length: 16 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const icebreakers = pgTable('icebreakers', {
  id: id(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').references(() => ttProfiles.id),
  text: text('text').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(0),
  publishedAt: ts('published_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const icebreakerEvaluations = pgTable('icebreaker_evaluations', {
  id: id(),
  icebreakerId: uuid('icebreaker_id').notNull().references(() => icebreakers.id),
  evaluator: varchar('evaluator', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  score: numeric('score', { precision: 6, scale: 4 }),
  model: text('model'),
  result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
  tokenCostUsd: numeric('token_cost_usd', { precision: 12, scale: 6 }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const icebreakerViolations = pgTable('icebreaker_violations', {
  id: id(),
  icebreakerId: uuid('icebreaker_id').notNull().references(() => icebreakers.id),
  ruleId: uuid('rule_id').notNull().references(() => icebreakerRules.id),
  severity: varchar('severity', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('OPEN'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const icebreakerReviews = pgTable('icebreaker_reviews', {
  id: id(),
  icebreakerId: uuid('icebreaker_id').notNull().references(() => icebreakers.id),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id),
  verdict: varchar('verdict', { length: 24 }).notNull(),
  reason: text('reason').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const icebreakerEffectiveness = pgTable('icebreaker_effectiveness', {
  id: id(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').references(() => ttProfiles.id),
  businessDate: date('business_date').notNull(),
  sent: integer('sent').notNull().default(0),
  replied: integer('replied').notNull().default(0),
  responseRate: numeric('response_rate', { precision: 6, scale: 4 }),
  score: numeric('score', { precision: 6, scale: 4 }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payrollPeriods = pgTable('payroll_periods', {
  id: id(),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('OPEN'),
  defaultPointsToCopRate: numeric('default_points_to_cop_rate', { precision: 12, scale: 4 }).notNull(),
  lockedAt: ts('locked_at'),
  closedAt: ts('closed_at'),
  paidAt: ts('paid_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const pointsLedger = pgTable('points_ledger', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  assignmentId: uuid('assignment_id').references(() => profileAssignments.id),
  businessDate: date('business_date').notNull(),
  shiftBusinessDate: date('shift_business_date').notNull(),
  points: numeric('points', { precision: 14, scale: 4 }).notNull(),
  // 24 y no 16: `MANUAL_ADJUSTMENT` y `COMPETITION_AWARD` (PLAN.md §3.8) miden
  // 17 caracteres y no cabian, asi que todo ajuste manual de puntos moria con
  // un 22001 en vez de escribirse.
  source: varchar('source', { length: 24 }).notNull(),
  attributionMethod: varchar('attribution_method', { length: 24 }).notNull().default('DIRECT'),
  attributionBasis: jsonb('attribution_basis').$type<Record<string, unknown>>(),
  sourceHour: ts('source_hour'),
  referenceId: text('reference_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payrollLines = pgTable('payroll_lines', {
  id: id(),
  periodId: uuid('period_id').notNull().references(() => payrollPeriods.id),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  pointsTotal: numeric('points_total', { precision: 14, scale: 4 }).notNull(),
  commissionRateSnapshot: numeric('commission_rate_snapshot', { precision: 5, scale: 4 }).notNull(),
  pointsToCopRateSnapshot: numeric('points_to_cop_rate_snapshot', { precision: 12, scale: 4 }).notNull(),
  grossCop: numeric('gross_cop', { precision: 14, scale: 2 }).notNull(),
  netCop: numeric('net_cop', { precision: 14, scale: 2 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(0),
  computedAt: ts('computed_at'),
  computedBy: uuid('computed_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ payrollLineUnique: uniqueIndex('payroll_lines_period_operator_unique').on(t.periodId, t.operatorId) }));

export const payrollAdjustments = pgTable('payroll_adjustments', {
  id: id(),
  lineId: uuid('line_id').notNull().references(() => payrollLines.id),
  type: varchar('type', { length: 16 }).notNull(),
  amountCop: numeric('amount_cop', { precision: 14, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const goals = pgTable('goals', {
  id: id(),
  scope: varchar('scope', { length: 16 }).notNull(),
  operatorId: uuid('operator_id').references(() => users.id),
  crewId: uuid('crew_id').references(() => crews.id),
  periodId: uuid('period_id').notNull().references(() => payrollPeriods.id),
  targetPoints: numeric('target_points', { precision: 14, scale: 4 }).notNull(),
  bonusType: varchar('bonus_type', { length: 16 }).notNull(),
  bonusCop: numeric('bonus_cop', { precision: 14, scale: 2 }),
  tiers: jsonb('tiers').$type<unknown[]>(),
  isActive: boolean('is_active').notNull().default(true),
});

export const competitions = pgTable('competitions', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  metric: varchar('metric', { length: 24 }).notNull(),
  scope: varchar('scope', { length: 16 }).notNull(),
  crewId: uuid('crew_id').references(() => crews.id),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({}),
  prizeScheme: jsonb('prize_scheme').$type<Record<string, unknown>>().notNull().default({}),
  status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const competitionParticipants = pgTable('competition_participants', {
  competitionId: uuid('competition_id').notNull().references(() => competitions.id),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  enrolledAt: ts('enrolled_at').notNull().defaultNow(),
  currentValue: numeric('current_value', { precision: 14, scale: 4 }).notNull().default('0'),
  finalRank: integer('final_rank'),
  awardedCop: numeric('awarded_cop', { precision: 14, scale: 2 }),
  awardedAt: ts('awarded_at'),
}, (t) => ({ pk: primaryKey({ columns: [t.competitionId, t.operatorId] }) }));

export const payrollExports = pgTable('payroll_exports', {
  id: id(),
  periodId: uuid('period_id').notNull().references(() => payrollPeriods.id),
  format: varchar('format', { length: 8 }).notNull().default('XLSX'),
  fileUri: text('file_uri').notNull(),
  checksum: text('checksum').notNull(),
  rowCount: integer('row_count').notNull(),
  generatedBy: uuid('generated_by').notNull().references(() => users.id),
  generatedAt: ts('generated_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
});

export const cafeteriaProducts = pgTable('cafeteria_products', {
  id: id(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  priceCop: numeric('price_cop', { precision: 12, scale: 2 }).notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  prepMinutes: smallint('prep_minutes'),
  pickupDeadlineMinutes: smallint('pickup_deadline_minutes').notNull().default(30),
  imageUri: text('image_uri'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const cafeteriaOrders = pgTable('cafeteria_orders', {
  id: id(),
  orderNumber: bigint('order_number', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  status: varchar('status', { length: 16 }).notNull().default('PLACED'),
  placedAt: ts('placed_at').notNull().defaultNow(),
  acceptedAt: ts('accepted_at'),
  readyAt: ts('ready_at'),
  deliveredAt: ts('delivered_at'),
  cancelledAt: ts('cancelled_at'),
  pickupDeadlineAt: ts('pickup_deadline_at'),
  totalCop: numeric('total_cop', { precision: 12, scale: 2 }).notNull().default('0'),
  deliveredBy: uuid('delivered_by').references(() => users.id),
  cancelReason: text('cancel_reason'),
  notes: text('notes'),
  idempotencyKey: text('idempotency_key').notNull(),
}, (t) => ({ orderIdempotency: uniqueIndex('cafeteria_orders_operator_idempotency').on(t.operatorId, t.idempotencyKey) }));

export const cafeteriaOrderItems = pgTable('cafeteria_order_items', {
  id: id(),
  orderId: uuid('order_id').notNull().references(() => cafeteriaOrders.id),
  productId: uuid('product_id').notNull().references(() => cafeteriaProducts.id),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  unitPriceCop: numeric('unit_price_cop', { precision: 12, scale: 2 }).notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalCop: numeric('line_total_cop', { precision: 12, scale: 2 }).notNull(),
  notes: text('notes'),
});

export const operatorAccountEntries = pgTable('operator_account_entries', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  operatorId: uuid('operator_id').notNull().references(() => users.id),
  entryType: varchar('entry_type', { length: 32 }).notNull(),
  amountCop: numeric('amount_cop', { precision: 14, scale: 2 }).notNull(),
  referenceType: text('reference_type').notNull(),
  referenceId: uuid('reference_id').notNull(),
  businessDate: date('business_date').notNull(),
  periodId: uuid('period_id').references(() => payrollPeriods.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => ({ entryUnique: uniqueIndex('one_account_entry_per_reference').on(t.referenceType, t.referenceId, t.entryType) }));

export const rocketchatChannels = pgTable('rocketchat_channels', {
  id: id(),
  crewId: uuid('crew_id').references(() => crews.id),
  rcRoomId: text('rc_room_id').notNull().unique(),
  name: text('name').notNull(),
  type: varchar('type', { length: 8 }).notNull(),
  purpose: varchar('purpose', { length: 16 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const scheduledMessages = pgTable('scheduled_messages', {
  id: id(),
  channelId: uuid('channel_id').references(() => rocketchatChannels.id),
  targetUserId: uuid('target_user_id').references(() => users.id),
  body: text('body').notNull(),
  scheduledFor: ts('scheduled_for').notNull(),
  recurrenceRule: text('recurrence_rule'),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  sentAt: ts('sent_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  channels: varchar('channels', { length: 16 }).notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  processedAt: ts('processed_at'),
});

export const interactionCampaigns = pgTable('interaction_campaigns', {
  id: id(),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  type: varchar('type', { length: 8 }).notNull(),
  targetCountries: char('target_countries', { length: 2 }).array(),
  dailyLimit: integer('daily_limit').notNull(),
  hourlyLimit: integer('hourly_limit').notNull(),
  activeHours: jsonb('active_hours').$type<Record<string, unknown>>(),
  status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const interactionEvents = pgTable('interaction_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  campaignId: uuid('campaign_id').notNull().references(() => interactionCampaigns.id),
  profileId: uuid('profile_id').notNull().references(() => ttProfiles.id),
  sessionId: uuid('session_id').references(() => profileSessions.id),
  targetExternalRef: text('target_external_ref').notNull(),
  type: varchar('type', { length: 8 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('QUEUED'),
  executedAt: ts('executed_at'),
  error: text('error'),
  dedupeKey: text('dedupe_key').notNull().unique(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  description: text('description'),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  isEnabled: boolean('is_enabled').notNull().default(false),
  rollout: jsonb('rollout').$type<Record<string, unknown>>().notNull().default({}),
  description: text('description'),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
