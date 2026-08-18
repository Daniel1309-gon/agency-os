import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomToken, hashToken, type AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { crewMembers, crews, devices, roles, users } from '../../database/schema/index.js';
import type { DeviceCreateInput, DeviceEnrollInput, DeviceHeartbeatInput } from './devices.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(input: DeviceCreateInput, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    if (input.assignedOperatorId) {
      const [operator] = await this.db.db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, input.assignedOperatorId), eq(users.status, 'ACTIVE'), eq(roles.code, 'OPERADOR'))).limit(1);
      if (!operator) throw new ConflictException('Device assignee must be an active operator');
    }
    await this.assertOperatorScope(input.assignedOperatorId, actor);
    const code = randomToken(24);
    const [device] = await this.db.db.insert(devices).values({ ...input, enrollmentCodeHash: hashToken(code) }).returning({ id: devices.id, label: devices.label, status: devices.status });
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.created', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id, operatorId: input.assignedOperatorId } });
    return { ...device, enrollmentCode: code };
  }

  async enroll(input: DeviceEnrollInput) {
    const deviceToken = randomToken();
    const expiresAt = new Date(Date.now() + 90 * 86_400_000);
    const [device] = await this.db.db.update(devices).set({ hostname: input.hostname, label: input.label, status: 'APPROVED', enrollmentCodeHash: null, tokenHash: hashToken(deviceToken), tokenIssuedAt: new Date(), tokenExpiresAt: expiresAt }).where(and(eq(devices.enrollmentCodeHash, hashToken(input.code)), eq(devices.status, 'PENDING'))).returning({ id: devices.id, status: devices.status });
    if (!device) throw new ConflictException('Invalid or expired enrollment code');
    await this.audit.record({ actorType: 'DEVICE', actorDeviceId: device.id, action: 'device.enrolled', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id } });
    return { deviceId: device.id, deviceToken, expiresAt };
  }

  async heartbeat(token: string, input: DeviceHeartbeatInput, ip?: string) {
    const [device] = await this.db.db.update(devices).set({ ...input, lastSeenAt: new Date(), lastIp: ip }).where(and(eq(devices.tokenHash, hashToken(token)), eq(devices.status, 'APPROVED'))).returning({ id: devices.id, lastSeenAt: devices.lastSeenAt });
    if (!device) throw new ForbiddenException('Device is not approved');
    return device;
  }

  async get(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const device = await this.db.db.query.devices.findFirst({ where: and(eq(devices.id, id), this.deviceScope(actor)) });
    if (!device) throw new NotFoundException('Device not found');
    return { ...device, tokenHash: undefined, enrollmentCodeHash: undefined };
  }

  async list(actor: Pick<AccessTokenClaims, 'sub' | 'role'>) { return this.db.db.select({ id: devices.id, hostname: devices.hostname, label: devices.label, assignedOperatorId: devices.assignedOperatorId, status: devices.status, extensionVersion: devices.extensionVersion, helperVersion: devices.helperVersion, osVersion: devices.osVersion, lastSeenAt: devices.lastSeenAt, lastIp: devices.lastIp, tokenIssuedAt: devices.tokenIssuedAt, tokenExpiresAt: devices.tokenExpiresAt, revokedAt: devices.revokedAt, revokedReason: devices.revokedReason }).from(devices).where(this.deviceScope(actor)).orderBy(asc(devices.label)); }

  async revoke(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>, reason = 'ADMIN_REVOKE') {
    const [row] = await this.db.db.update(devices).set({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, tokenHash: null }).where(and(eq(devices.id, id), this.deviceScope(actor))).returning({ id: devices.id, status: devices.status, revokedAt: devices.revokedAt });
    if (!row) throw new NotFoundException('Device not found');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.revoked', entityType: 'device', entityId: row.id, result: 'SUCCESS', metadata: { deviceId: row.id, reason } });
    return row;
  }

  private deviceScope(actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    if (actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO') return eq(devices.id, devices.id);
    if (actor.role !== 'COORDINADOR') return eq(devices.assignedOperatorId, actor.sub);
    return sql`exists (
      select 1 from crew_members member
      inner join crews crew on crew.id = member.crew_id
      where member.user_id = ${devices.assignedOperatorId}
        and crew.coordinator_id = ${actor.sub}
        and crew.is_active = true
        and member.valid_range @> now()
    )`;
  }

  private async assertOperatorScope(operatorId: string | null | undefined, actor: Pick<AccessTokenClaims, 'sub' | 'role'>): Promise<void> {
    if (actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO') return;
    if (!operatorId || actor.role !== 'COORDINADOR') throw new ForbiddenException('Device is outside the actor crew scope');
    const [row] = await this.db.db.select({ id: crewMembers.id }).from(crewMembers).innerJoin(crews, eq(crews.id, crewMembers.crewId)).where(and(eq(crewMembers.userId, operatorId), eq(crews.coordinatorId, actor.sub), eq(crews.isActive, true), sql`${crewMembers.validRange} @> now()`)).limit(1);
    if (!row) throw new ForbiddenException('Device is outside the actor crew scope');
  }
}
