import { AuditService } from '../audit/audit.service.js';
import { normalizeIp } from './ip.js';

const DENIAL_AUDIT_WINDOW_MS = 60_000;
const MAX_DENIAL_AUDIT_KEYS = 10_000;
const THROTTLED_ACTIONS = new Set(['ip_allowlist.denied', 'realtime.connection.denied']);
const denialAuditAt = new Map<string, number>();

export interface SecurityDenialContext {
  actorType: string;
  actorUserId?: string;
  actorDeviceId?: string;
  ip?: string;
  requestId?: string;
  route?: string;
}

function safeRoute(route: string | undefined): string {
  const value = route ?? '/';
  try {
    return new URL(value, 'http://agency-os.invalid').pathname || '/';
  } catch {
    return value.split('?')[0] || '/';
  }
}

export async function recordSecurityDenial(
  audit: AuditService,
  context: SecurityDenialContext,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const ip = normalizeIp(context.ip);
  const route = safeRoute(context.route);
  if (THROTTLED_ACTIONS.has(action)) {
    const key = `${action}:${ip ?? 'unknown'}:${route}`;
    const now = Date.now();
    const previous = denialAuditAt.get(key);
    if (previous && now - previous < DENIAL_AUDIT_WINDOW_MS) return;
    denialAuditAt.set(key, now);
    if (denialAuditAt.size > MAX_DENIAL_AUDIT_KEYS) {
      for (const [entry, timestamp] of denialAuditAt) {
        if (now - timestamp >= DENIAL_AUDIT_WINDOW_MS) denialAuditAt.delete(entry);
      }
      while (denialAuditAt.size > MAX_DENIAL_AUDIT_KEYS) {
        const oldest = denialAuditAt.keys().next().value;
        if (oldest === undefined) break;
        denialAuditAt.delete(oldest);
      }
    }
  }

  await audit.record({
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    actorDeviceId: context.actorDeviceId,
    action,
    result: 'DENIED',
    ip,
    requestId: context.requestId,
    metadata: { ...metadata, route },
  }).catch(() => undefined);
}
