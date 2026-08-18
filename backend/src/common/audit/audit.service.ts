import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { auditLog } from '../../database/schema/index.js';

const ALLOWED_METADATA_KEYS = new Set([
  'profileId', 'assignmentId', 'sessionId', 'deviceId', 'grantId', 'reason', 'denyReason',
  'status', 'fromStatus', 'toStatus', 'attempt', 'route', 'resource', 'version', 'count',
  'outcome', 'source', 'businessDate', 'periodId', 'errorCode', 'reused', 'role', 'permission',
  'operatorId', 'shiftId', 'userId', 'crewId', 'key', 'article', 'latencyMs',
]);

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 2 || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return undefined;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => ALLOWED_METADATA_KEYS.has(key))
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
      .filter(([, item]) => item !== undefined),
  );
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitizeValue(metadata ?? {}) as Record<string, unknown>) ?? {};
}

export interface AuditRecord {
  actorType: string;
  actorUserId?: string;
  actorDeviceId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  result: string;
  ip?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(input: AuditRecord): Promise<void> {
    await this.db.db.insert(auditLog).values({
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      actorDeviceId: input.actorDeviceId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      result: input.result,
      ip: input.ip,
      requestId: input.requestId,
      metadata: sanitizeMetadata(input.metadata),
    });
  }
}
