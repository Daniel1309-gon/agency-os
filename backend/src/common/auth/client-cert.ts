import { createHash, X509Certificate } from 'node:crypto';
import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { devices } from '../../database/schema/index.js';
import type { AuthenticatedRequest, DevicePrincipal } from './auth.types.js';
import { ipInCidr, normalizeIp, parseTrustedProxyCidrs } from './ip.js';
import { AuditService } from '../audit/audit.service.js';
import { recordSecurityDenial } from './denial-audit.js';
import { ALLOW_UNREGISTERED_CLIENT_CERT_KEY, SKIP_CLIENT_CERT_KEY } from './decorators.js';

/**
 * Cloudflare sets this header through a Transform Rule that first removes any
 * client-supplied value and then copies `cf.tls_client_auth.cert_rfc9440`, but
 * only when the certificate is verified and not revoked. The backend trusts it
 * exclusively when the request arrives from a configured proxy hop.
 */
export const CLIENT_CERT_HEADER = 'client-cert';
const RFC9440_MAX_BYTES = 10 * 1024;

export function parseClientCertHeader(value: string | string[] | undefined): Buffer | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || !trimmed.startsWith(':') || !trimmed.endsWith(':')) return null;
  const body = trimmed.slice(1, -1);
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  const der = Buffer.from(body, 'base64');
  if (!der.length || der.length > RFC9440_MAX_BYTES) return null;
  if (der.toString('base64').replace(/=+$/, '') !== body.replace(/=+$/, '')) return null;
  return der;
}

export function certificateFingerprint(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex');
}

/** `validTo` del certificado; null si el DER no es parseable (pruebas con bytes sinteticos). */
export function certificateNotAfter(der: Buffer): Date | null {
  try {
    const date = new Date(new X509Certificate(der).validTo);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function isHexFingerprint(value: string | undefined): value is string {
  return Boolean(value) && /^[0-9a-f]{64}$/.test(value as string);
}

function isSwaggerRequest(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ url?: string; raw?: { url?: string } }>();
  const path = (request.raw?.url ?? request.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/docs' || path.startsWith('/docs/') || path === '/docs-json' || path === '/docs-yaml';
}

/** Only the configured proxy hops may inject the identity header. */
export function isTrustedProxySource(config: Pick<ConfigService, 'get'>, remoteAddress?: string): boolean {
  const remote = normalizeIp(remoteAddress);
  const configured = parseTrustedProxyCidrs(config.get('TRUSTED_PROXY_CIDRS'));
  if (!configured.length) return config.get('NODE_ENV') !== 'production';
  if (!remote) return config.get('NODE_ENV') !== 'production';
  return configured.some((cidr) => ipInCidr(remote, cidr));
}

export async function resolveApprovedDevice(db: DatabaseService, fingerprint: string): Promise<DevicePrincipal | null> {
  const now = new Date();
  const [device] = await db.db
    .select({
      id: devices.id,
      label: devices.label,
      deviceKind: devices.deviceKind,
      certExpiresAt: devices.certNotAfter,
    })
    .from(devices)
    .where(and(
      eq(devices.certFingerprint, fingerprint),
      eq(devices.status, 'APPROVED'),
      or(isNull(devices.certNotAfter), gt(devices.certNotAfter, now)),
      isNull(devices.revokedAt),
    ))
    .limit(1);
  if (!device) return null;
  return {
    id: device.id,
    label: device.label,
    kind: device.deviceKind === 'ADMIN' ? 'ADMIN' : 'STATION',
    fingerprint,
    certNotAfter: device.certExpiresAt,
  };
}

@Injectable()
export class ClientCertGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isSwaggerRequest(context)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CLIENT_CERT_KEY, [context.getHandler(), context.getClass()])) return true;
    const allowUnregistered = this.reflector.getAllAndOverride<boolean>(ALLOW_UNREGISTERED_CLIENT_CERT_KEY, [context.getHandler(), context.getClass()]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers[CLIENT_CERT_HEADER];
    const present = Boolean(Array.isArray(header) ? header[0] : header);

    let fingerprint: string | undefined;
    if (present) {
      if (!this.isFromTrustedProxy(request)) {
        await this.deny(request, 'UNTRUSTED_SOURCE');
        throw new ForbiddenException('Client certificate identity cannot be trusted');
      }
      const der = parseClientCertHeader(header);
      if (!der) {
        await this.deny(request, 'MALFORMED');
        throw new ForbiddenException('Client certificate identity is malformed');
      }
      fingerprint = certificateFingerprint(der);
      request.clientCertNotAfter = certificateNotAfter(der);
    } else {
      const devFingerprint = this.config.get('DEV_CLIENT_CERT_FINGERPRINT');
      if (devFingerprint) {
        if (this.config.get('NODE_ENV') === 'production') throw new Error('DEV_CLIENT_CERT_FINGERPRINT is not allowed in production');
        fingerprint = devFingerprint;
      } else if (this.config.get('NODE_ENV') === 'production') {
        await this.deny(request, 'MISSING');
        throw new ForbiddenException('Client certificate identity is required');
      }
    }

    if (!fingerprint) return true;
    if (!isHexFingerprint(fingerprint)) {
      await this.deny(request, 'MALFORMED');
      throw new ForbiddenException('Client certificate identity is malformed');
    }
    request.clientCertFingerprint = fingerprint;

    // Enrolamiento: la PC aun no existe en `devices`, pero el certificado ya fue
    // verificado en el borde y el codigo de un solo uso es el segundo factor.
    if (allowUnregistered) return true;

    const device = await resolveApprovedDevice(this.db, fingerprint);
    if (!device) {
      await this.deny(request, 'UNKNOWN_OR_EXPIRED');
      throw new ForbiddenException('Client certificate is not authorized');
    }

    request.device = device;
    return true;
  }

  private isFromTrustedProxy(request: AuthenticatedRequest): boolean {
    return isTrustedProxySource(this.config, request.raw?.socket?.remoteAddress);
  }

  private async deny(request: AuthenticatedRequest, denyReason: string): Promise<void> {
    await recordSecurityDenial(this.audit, {
      actorType: request.user ? 'USER' : 'ANONYMOUS',
      actorUserId: request.user?.sub,
      ip: request.ip,
      requestId: request.id,
      route: request.raw?.url,
    }, 'client_cert.denied', { denyReason });
  }
}
