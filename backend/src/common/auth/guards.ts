import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { devices, ipAllowlist, roles, users } from '../../database/schema/index.js';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { hashToken, verifyAccessToken } from './crypto.js';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY, REQUIRED_ROLES_KEY, setAuthenticatedUser, SKIP_IP_ALLOWLIST_KEY, STATION_AUTH_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizeIp, resolveClientIp } from './ip.js';
import { recordSecurityDenial } from './denial-audit.js';

async function recordDenied(
  audit: AuditService,
  request: AuthenticatedRequest,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await recordSecurityDenial(audit, {
    actorType: request.user ? 'USER' : 'ANONYMOUS',
    actorUserId: request.user?.sub,
    actorDeviceId: request.device?.id,
    ip: request.ip,
    requestId: request.id,
    route: request.raw?.url,
  }, action, metadata);
}

function isSwaggerRequest(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ url?: string; raw?: { url?: string } }>();
  const path = (request.raw?.url ?? request.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/docs' || path.startsWith('/docs/') || path === '/docs-json' || path === '/docs-yaml';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService, private readonly reflector: Reflector, private readonly audit: AuditService, private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isSwaggerRequest(context)) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const isStation = this.reflector.getAllAndOverride<boolean>(STATION_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isStation) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith('Bearer ')) {
      await recordDenied(this.audit, request, 'auth.token.denied', { denyReason: 'MISSING_TOKEN' });
      throw new UnauthorizedException('Authentication required');
    }
    try {
      const claims = verifyAccessToken(value.slice(7), this.config.get('JWT_SECRET'));
      setAuthenticatedUser(request, claims);
      const [active] = await this.db.db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, claims.sub), eq(users.status, 'ACTIVE'), isNull(users.deletedAt), eq(roles.code, claims.role))).limit(1);
      if (!active) throw new Error('Inactive user or stale role');
      return true;
    } catch {
      await recordDenied(this.audit, request, 'auth.token.denied', { denyReason: 'INVALID_TOKEN' });
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permissions = request.user?.permissions ?? [];
    if (!required.every((permission) => permissions.includes(permission))) {
      await recordDenied(this.audit, request, 'permission.denied', { permission: required });
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || !required.includes(request.user.role)) {
      await recordDenied(this.audit, request, 'role.denied', { requiredRole: required });
      throw new ForbiddenException('Role is not allowed');
    }
    return true;
  }
}

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly db: DatabaseService, private readonly audit: AuditService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['x-device-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) {
      await recordDenied(this.audit, request, 'device.access.denied', { denyReason: 'MISSING_TOKEN' });
      throw new ForbiddenException('Device token required');
    }
    const isStation = this.reflector.getAllAndOverride<boolean>(STATION_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!request.user && !isStation) {
      await recordDenied(this.audit, request, 'device.access.denied', { denyReason: 'MISSING_USER' });
      throw new ForbiddenException('Authenticated operator required');
    }
    if (token.length > 128) {
      await recordDenied(this.audit, request, 'device.access.denied', { denyReason: 'INVALID_OR_EXPIRED' });
      throw new ForbiddenException('Device token is invalid or expired');
    }
    const device = await this.db.db.query.devices.findFirst({
      where: and(
        eq(devices.tokenHash, hashToken(token)),
        eq(devices.status, 'APPROVED'),
        sql`${devices.tokenExpiresAt} > now()`,
      ),
    });
    if (!device || !device.tokenExpiresAt || device.tokenExpiresAt.getTime() <= Date.now()) {
      await recordDenied(this.audit, request, 'device.access.denied', { denyReason: 'INVALID_OR_EXPIRED' });
      throw new ForbiddenException('Device token is invalid or expired');
    }
    request.device = {
      id: device.id,
      label: device.label,
      tokenExpiresAt: device.tokenExpiresAt,
    };
    return true;
  }
}

@Injectable()
export class IpAllowlistGuard implements CanActivate {
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService, private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.reflector.getAllAndOverride<boolean>(SKIP_IP_ALLOWLIST_KEY, [context.getHandler(), context.getClass()])) return true;
    const active = await this.db.db.select({ id: ipAllowlist.id }).from(ipAllowlist).where(and(eq(ipAllowlist.isActive, true), or(isNull(ipAllowlist.expiresAt), sql`${ipAllowlist.expiresAt} > now()`))).limit(1);
    if (!active.length) {
      await recordDenied(this.audit, request, 'ip_allowlist.denied', { denyReason: 'NOT_CONFIGURED' });
      throw new ForbiddenException('IP allowlist is not configured');
    }
    let identity = request.user;
    if (!identity) {
      const header = request.headers.authorization;
      const value = Array.isArray(header) ? header[0] : header;
      if (value?.startsWith('Bearer ')) {
        try { identity = verifyAccessToken(value.slice(7), this.config.get('JWT_SECRET')); } catch { /* JwtAuthGuard emits the canonical error. */ }
      }
    }
    const role = identity?.role ? await this.db.db.query.roles.findFirst({ where: eq(roles.code, identity.role) }) : undefined;
    const clientIp = request.raw?.socket?.remoteAddress
      ? resolveClientIp(request.raw.socket.remoteAddress, request.headers['x-forwarded-for'], this.config.get('TRUSTED_PROXY_CIDRS'))
      : normalizeIp(request.ip);
    if (!clientIp) {
      await recordDenied(this.audit, request, 'ip_allowlist.denied', { denyReason: 'IP_UNAVAILABLE' });
      throw new ForbiddenException('Client IP unavailable');
    }
    const scopes = [and(eq(ipAllowlist.scope, 'ALL'), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`)];
    if (identity) scopes.push(and(eq(ipAllowlist.scope, 'USER'), eq(ipAllowlist.userId, identity.sub), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`));
    if (role) scopes.push(and(eq(ipAllowlist.scope, 'ROLE'), eq(ipAllowlist.roleId, role.id), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`));
    const match = await this.db.db.select({ id: ipAllowlist.id }).from(ipAllowlist).where(and(eq(ipAllowlist.isActive, true), or(isNull(ipAllowlist.expiresAt), sql`${ipAllowlist.expiresAt} > now()`), or(...scopes))).limit(1);
    if (!match.length) {
      await recordDenied(this.audit, request, 'ip_allowlist.denied', { denyReason: 'NO_MATCH' });
      throw new ForbiddenException('IP address is not allowed');
    }
    return true;
  }
}
