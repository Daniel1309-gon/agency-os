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
import { devices, ipAllowlist, roles } from '../../database/schema/index.js';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { hashToken, verifyAccessToken } from './crypto.js';
import { IP_ALLOWLIST_BYPASS_KEY, IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY, setAuthenticatedUser } from './decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';

function isSwaggerRequest(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ url?: string; raw?: { url?: string } }>();
  const path = (request.raw?.url ?? request.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/docs' || path.startsWith('/docs/') || path === '/docs-json' || path === '/docs-yaml';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService, private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isSwaggerRequest(context)) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required');
    try {
      setAuthenticatedUser(request, verifyAccessToken(value.slice(7), this.config.get('JWT_SECRET')));
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permissions = request.user?.permissions ?? [];
    if (!required.every((permission) => permissions.includes(permission))) {
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }
}

@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['x-device-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) {
      throw new ForbiddenException('Device token required');
    }
    if (!request.user) throw new ForbiddenException('Authenticated operator required');
    const device = await this.db.db.query.devices.findFirst({
      where: and(
        eq(devices.tokenHash, hashToken(token)),
        eq(devices.status, 'APPROVED'),
        eq(devices.assignedOperatorId, request.user.sub),
        sql`${devices.tokenExpiresAt} > now()`,
      ),
    });
    if (!device || !device.assignedOperatorId || !device.tokenExpiresAt || device.tokenExpiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException('Device token is invalid or expired');
    }
    request.device = {
      id: device.id,
      operatorId: device.assignedOperatorId,
      label: device.label,
      tokenExpiresAt: device.tokenExpiresAt,
    };
    return true;
  }
}

@Injectable()
export class IpAllowlistGuard implements CanActivate {
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.reflector.getAllAndOverride<boolean>(IP_ALLOWLIST_BYPASS_KEY, [context.getHandler(), context.getClass()])) return true;
    const active = await this.db.db.select({ id: ipAllowlist.id }).from(ipAllowlist).where(and(eq(ipAllowlist.isActive, true), or(isNull(ipAllowlist.expiresAt), sql`${ipAllowlist.expiresAt} > now()`))).limit(1);
    if (!active.length) throw new ForbiddenException('IP allowlist is not configured');
    let identity = request.user;
    if (!identity) {
      const header = request.headers.authorization;
      const value = Array.isArray(header) ? header[0] : header;
      if (value?.startsWith('Bearer ')) {
        try { identity = verifyAccessToken(value.slice(7), this.config.get('JWT_SECRET')); } catch { /* JwtAuthGuard emits the canonical error. */ }
      }
    }
    const role = identity?.role ? await this.db.db.query.roles.findFirst({ where: eq(roles.code, identity.role) }) : undefined;
    const clientIp = request.ip ?? '';
    if (!clientIp) throw new ForbiddenException('Client IP unavailable');
    const scopes = [and(eq(ipAllowlist.scope, 'ALL'), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`)];
    if (identity) scopes.push(and(eq(ipAllowlist.scope, 'USER'), eq(ipAllowlist.userId, identity.sub), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`));
    if (role) scopes.push(and(eq(ipAllowlist.scope, 'ROLE'), eq(ipAllowlist.roleId, role.id), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`));
    const match = await this.db.db.select({ id: ipAllowlist.id }).from(ipAllowlist).where(and(eq(ipAllowlist.isActive, true), or(isNull(ipAllowlist.expiresAt), sql`${ipAllowlist.expiresAt} > now()`), or(...scopes))).limit(1);
    if (!match.length) throw new ForbiddenException('IP address is not allowed');
    return true;
  }
}
