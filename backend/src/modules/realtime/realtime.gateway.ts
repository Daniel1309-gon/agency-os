import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, type OnGatewayConnection, type OnGatewayDisconnect, type OnGatewayInit } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { crewMembers, crews, ipAllowlist, roles, users } from '../../database/schema/index.js';
import { verifyAccessToken, type AccessTokenClaims } from '../../common/auth/crypto.js';
import { CLIENT_CERT_HEADER, certificateFingerprint, isHexFingerprint, isTrustedProxySource, parseClientCertHeader, resolveApprovedDevice } from '../../common/auth/client-cert.js';
import type { DevicePrincipal } from '../../common/auth/auth.types.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { recordSecurityDenial } from '../../common/auth/denial-audit.js';
import { resolveClientIp } from '../../common/auth/ip.js';
import { RealtimeService } from './realtime.service.js';

interface AuthenticatedSocket extends Socket {
  data: { user?: AccessTokenClaims; device?: DevicePrincipal; lifetime?: NodeJS.Timeout };
}

// Plan §2 C1: cada conexion vive 45-60 s con cierres repartidos, para revalidar
// permisos sin mantener sockets indefinidos. Nunca sobrevive al JWT.
// Los overrides por env son solo para pruebas (lifetime corto en integracion).
const SOCKET_LIFETIME_MIN_MS = Number(process.env.SOCKET_LIFETIME_MIN_MS ?? 45_000);
const SOCKET_LIFETIME_JITTER_MS = Number(process.env.SOCKET_LIFETIME_JITTER_MS ?? 15_000);

@WebSocketGateway({ namespace: '/operations', transports: ['websocket'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : '';
      const user = verifyAccessToken(token, this.config.get('JWT_SECRET'));
      const clientIp = this.clientIp(client);
      const device = await this.resolveDevice(client);
      // Acceso mTLS: la identidad del equipo reemplaza a la allowlist de IP
      // (plan §2 B2). Sin certificado de dispositivo, la IP sigue siendo puerta.
      if (!(await this.isActiveUser(user)) || !this.originAllowed(client.handshake.headers.origin) || (!device && !(await this.ipAllowed(clientIp, user)))) {
        throw new Error('Connection policy denied');
      }
      client.data.user = user;
      client.data.device = device ?? undefined;
      const rooms = [`user:${user.sub}`, `role:${user.role}`];
      if (device) rooms.push(`device:${device.id}`);
      await client.join(rooms);
      const crewIds = await this.authorizedCrewIds(user);
      if (crewIds.length) await client.join(crewIds.map((id) => `crew:${id}`));
      client.emit('operators.snapshot', await this.realtime.snapshotFor(user));
      if (user.role === 'CAFETERIA' || user.role === 'OPERADOR') {
        client.emit('cafeteria.orders.snapshot', await this.realtime.snapshotCafeteriaFor(user));
      }
      this.scheduleLifetime(client, user);
    } catch {
      await recordSecurityDenial(this.audit, {
        actorType: 'ANONYMOUS',
        ip: this.clientIp(client),
        route: '/operations',
      }, 'realtime.connection.denied');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    if (client.data.lifetime) clearTimeout(client.data.lifetime);
  }

  @SubscribeMessage('operators.snapshot')
  async snapshot(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.data.user) return [];
    return this.realtime.snapshotFor(client.data.user);
  }

  private scheduleLifetime(client: AuthenticatedSocket, user: AccessTokenClaims): void {
    const jitterMs = SOCKET_LIFETIME_MIN_MS + Math.floor(Math.random() * SOCKET_LIFETIME_JITTER_MS);
    const untilTokenExpiryMs = user.exp * 1000 - Date.now();
    const delay = Math.max(1_000, Math.min(jitterMs, untilTokenExpiryMs));
    client.data.lifetime = setTimeout(() => client.disconnect(true), delay);
  }

  /**
   * Identity comes from the same verified header as HTTP. In production the
   * header is mandatory; the development fingerprint is the explicit escape.
   */
  private async resolveDevice(client: AuthenticatedSocket): Promise<DevicePrincipal | null> {
    const header = client.handshake.headers[CLIENT_CERT_HEADER];
    const present = Boolean(Array.isArray(header) ? header[0] : header);
    if (!present) {
      const devFingerprint = this.config.get('DEV_CLIENT_CERT_FINGERPRINT');
      if (devFingerprint && this.config.get('NODE_ENV') !== 'production') return resolveApprovedDevice(this.db, devFingerprint);
      if (this.config.get('NODE_ENV') === 'production') throw new Error('Client certificate identity is required');
      return null;
    }
    if (!isTrustedProxySource(this.config, client.handshake.address)) throw new Error('Untrusted client certificate source');
    const der = parseClientCertHeader(header);
    if (!der) throw new Error('Malformed client certificate');
    const fingerprint = certificateFingerprint(der);
    if (!isHexFingerprint(fingerprint)) throw new Error('Malformed client certificate');
    const device = await resolveApprovedDevice(this.db, fingerprint);
    if (!device) throw new Error('Client certificate is not authorized');
    return device;
  }

  private originAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    const allowed = this.config.get('CORS_ORIGINS').split(',').map((item) => item.trim()).filter(Boolean);
    const extensionId = this.config.get('EXTENSION_ID');
    if (extensionId) allowed.push(`chrome-extension://${extensionId}`);
    return allowed.includes(origin);
  }

  private async isActiveUser(user: AccessTokenClaims): Promise<boolean> {
    const [active] = await this.db.db.select({ id: users.id, authVersion: users.authVersion }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, user.sub), eq(users.status, 'ACTIVE'), isNull(users.deletedAt), eq(roles.code, user.role))).limit(1);
    return Boolean(active) && active.authVersion === user.av;
  }

  private clientIp(client: AuthenticatedSocket): string | undefined {
    return resolveClientIp(
      client.handshake.address,
      client.handshake.headers['x-forwarded-for'],
      this.config.get('TRUSTED_PROXY_CIDRS'),
    );
  }

  private async ipAllowed(clientIp: string | undefined, user: AccessTokenClaims): Promise<boolean> {
    if (!clientIp) return false;
    const role = await this.db.db.query.roles.findFirst({ where: eq(roles.code, user.role) });
    const scopes = [and(eq(ipAllowlist.scope, 'ALL'), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`)];
    scopes.push(and(eq(ipAllowlist.scope, 'USER'), eq(ipAllowlist.userId, user.sub), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`));
    if (role) scopes.push(and(eq(ipAllowlist.scope, 'ROLE'), eq(ipAllowlist.roleId, role.id), sql`${ipAllowlist.cidr} >>= ${clientIp}::inet`));
    const match = await this.db.db.select({ id: ipAllowlist.id }).from(ipAllowlist).where(and(eq(ipAllowlist.isActive, true), or(isNull(ipAllowlist.expiresAt), sql`${ipAllowlist.expiresAt} > now()`), or(...scopes))).limit(1);
    return match.length > 0;
  }

  private async authorizedCrewIds(user: AccessTokenClaims): Promise<string[]> {
    if (user.role === 'COORDINADOR') {
      const rows = await this.db.db.select({ id: crews.id }).from(crews).where(and(eq(crews.coordinatorId, user.sub), eq(crews.isActive, true)));
      return rows.map((row) => row.id);
    }
    if (user.role === 'OPERADOR') {
      const rows = await this.db.db.select({ id: crewMembers.crewId }).from(crewMembers).where(and(eq(crewMembers.userId, user.sub), sql`${crewMembers.validRange} @> now()`));
      return rows.map((row) => row.id);
    }
    return [];
  }
}
