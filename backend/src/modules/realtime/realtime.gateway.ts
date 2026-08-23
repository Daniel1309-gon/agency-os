import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, type OnGatewayConnection, type OnGatewayInit } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { crewMembers, crews, ipAllowlist, roles, users } from '../../database/schema/index.js';
import { verifyAccessToken, type AccessTokenClaims } from '../../common/auth/crypto.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { recordSecurityDenial } from '../../common/auth/denial-audit.js';
import { resolveClientIp } from '../../common/auth/ip.js';
import { RealtimeService } from './realtime.service.js';

interface AuthenticatedSocket extends Socket {
  data: { user?: AccessTokenClaims };
}

@WebSocketGateway({ namespace: '/operations', transports: ['websocket'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
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
      if (!(await this.isActiveUser(user)) || !this.originAllowed(client.handshake.headers.origin) || !(await this.ipAllowed(clientIp, user))) {
        throw new Error('Connection policy denied');
      }
      client.data.user = user;
      await client.join([`user:${user.sub}`, `role:${user.role}`]);
      const crewIds = await this.authorizedCrewIds(user);
      if (crewIds.length) await client.join(crewIds.map((id) => `crew:${id}`));
      client.emit('operators.snapshot', await this.realtime.snapshotFor(user));
      if (user.role === 'CAFETERIA' || user.role === 'OPERADOR') {
        client.emit('cafeteria.orders.snapshot', await this.realtime.snapshotCafeteriaFor(user));
      }
    } catch {
      await recordSecurityDenial(this.audit, {
        actorType: 'ANONYMOUS',
        ip: this.clientIp(client),
        route: '/operations',
      }, 'realtime.connection.denied');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('operators.snapshot')
  async snapshot(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.data.user) return [];
    return this.realtime.snapshotFor(client.data.user);
  }

  private originAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    const allowed = this.config.get('CORS_ORIGINS').split(',').map((item) => item.trim()).filter(Boolean);
    const extensionId = this.config.get('EXTENSION_ID');
    if (extensionId) allowed.push(`chrome-extension://${extensionId}`);
    return allowed.includes(origin);
  }

  private async isActiveUser(user: AccessTokenClaims): Promise<boolean> {
    const [active] = await this.db.db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, user.sub), eq(users.status, 'ACTIVE'), isNull(users.deletedAt), eq(roles.code, user.role))).limit(1);
    return Boolean(active);
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
