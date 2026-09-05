import { z } from 'zod';
import { roleCodeSchema, shiftStatusSchema } from './agency.js';

export const managedUserStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']);

export const managedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  nationalId: z.string().nullable(),
  phone: z.string().nullable(),
  roleId: z.string().uuid(),
  roleCode: roleCodeSchema,
  status: managedUserStatusSchema,
  mustChangePassword: z.boolean(),
  rocketchatUserId: z.string().nullable(),
  rocketchatDirectRoomId: z.string().nullable(),
  lastLoginAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type ManagedUser = z.infer<typeof managedUserSchema>;

export const roleRecordSchema = z.object({
  id: z.string().uuid(),
  code: roleCodeSchema,
  name: z.string(),
  hierarchyLevel: z.number().int(),
  isSystem: z.boolean(),
}).strict();
export type RoleRecord = z.infer<typeof roleRecordSchema>;

export const assignmentRecordSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  operatorId: z.string().uuid(),
  shiftId: z.string().uuid().nullable(),
  validRange: z.string(),
  status: z.string(),
  assignedBy: z.string().uuid(),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  endReason: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type AssignmentRecord = z.infer<typeof assignmentRecordSchema>;

export const assignmentHistoryResponseSchema = z.object({
  items: z.array(assignmentRecordSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
}).strict();
export type AssignmentHistoryResponse = z.infer<typeof assignmentHistoryResponseSchema>;

export const shiftTemplateRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  crewId: z.string().uuid().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  crossesMidnight: z.boolean(),
  weekdays: z.array(z.number().int()),
  breakMinutes: z.number().int().nonnegative(),
  validFrom: z.string().date(),
  validTo: z.string().date().nullable(),
  isActive: z.boolean(),
}).strict();
export type ShiftTemplateRecord = z.infer<typeof shiftTemplateRecordSchema>;

export const createdShiftSchema = z.object({
  id: z.string().uuid(),
  operatorId: z.string().uuid(),
  businessDate: z.string().date(),
  scheduledRange: z.string().nullable(),
  status: shiftStatusSchema,
}).strict();
export type CreatedShift = z.infer<typeof createdShiftSchema>;

export const shiftOverrideRecordSchema = z.object({
  id: z.string().uuid(),
  operatorId: z.string().uuid(),
  range: z.string().nullable(),
  type: z.enum(['OVERTIME', 'EXTENDED_SHIFT', 'SPECIAL_PERMISSION']),
  reason: z.string(),
  approvedBy: z.string().uuid(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  revokedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ShiftOverrideRecord = z.infer<typeof shiftOverrideRecordSchema>;

export const managedDeviceSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string(),
  label: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REVOKED']),
  extensionVersion: z.string().nullable(),
  helperVersion: z.string().nullable(),
  osVersion: z.string().nullable(),
  lastSeenAt: z.string().datetime({ offset: true }).nullable(),
  lastIp: z.string().nullable(),
  tokenIssuedAt: z.string().datetime({ offset: true }).nullable(),
  tokenExpiresAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  revokedReason: z.string().nullable(),
}).strict();
export type ManagedDevice = z.infer<typeof managedDeviceSchema>;

const auditForbiddenKeys = new Set(['password', 'contrasena', 'contraseña', 'secret', 'plaintext', 'credential', 'token', 'ciphertext', 'nonce', 'tag', 'aad', 'kek', 'dek', 'authorization', 'passwordhash', 'accesstoken', 'refreshtoken', 'devicetoken']);

function validateAuditMetadata(value: unknown, path: string, context: z.RefinementCtx): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateAuditMetadata(item, `${path}[${index}]`, context));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const normalized = key.toLocaleLowerCase().replaceAll('_', '').replaceAll('-', '');
    if (auditForbiddenKeys.has(normalized)) context.addIssue({ code: z.ZodIssueCode.custom, path: [...path.split('.'), key], message: 'Audit metadata cannot contain secret fields' });
    validateAuditMetadata(item, `${path}.${key}`, context);
  });
}

const auditMetadataSchema = z.record(z.unknown()).superRefine((value, context) => validateAuditMetadata(value, 'metadata', context));

export const auditRecordSchema = z.object({
  id: z.number().int().nonnegative(),
  occurredAt: z.string().datetime({ offset: true }),
  actorType: z.string(),
  actorUserId: z.string().uuid().nullable(),
  actorDeviceId: z.string().uuid().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  result: z.string(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  metadata: auditMetadataSchema,
}).strict();
export type AuditRecord = z.infer<typeof auditRecordSchema>;

export const auditLogResponseSchema = z.object({
  data: z.array(auditRecordSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    nextCursor: z.string().nullable(),
  }).strict(),
}).strict();
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

export const ipAllowlistRecordSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  cidr: z.string(),
  scope: z.enum(['ALL', 'ROLE', 'USER']),
  roleId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type IpAllowlistRecord = z.infer<typeof ipAllowlistRecordSchema>;

export const readinessResponseSchema = z.object({
  status: z.string(),
  checks: z.record(z.boolean()),
}).strict();
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
