import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { randomToken, hashToken, type AccessTokenClaims } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { devices } from '../../database/schema/index.js';
import type { DeviceCreateInput, DeviceEnrollInput, DeviceHeartbeatInput } from './devices.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { normalizeIp } from '../../common/auth/ip.js';

const ENROLLMENT_CODE_TTL_MS = 15 * 60_000;
const DEVICE_TOKEN_TTL_MS = 90 * 86_400_000;

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(input: DeviceCreateInput, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const code = randomToken(24);
    const enrollmentCodeExpiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);
    const [device] = await this.db.db.insert(devices).values({
      ...input,
      enrollmentCodeHash: hashToken(code),
      enrollmentCodeExpiresAt,
      approvedBy: actor.sub,
    }).returning({ id: devices.id, label: devices.label, status: devices.status, enrollmentCodeExpiresAt: devices.enrollmentCodeExpiresAt });
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.created', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id } });
    return { ...device, enrollmentCode: code };
  }

  async enroll(input: DeviceEnrollInput) {
    const deviceToken = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_TOKEN_TTL_MS);
    const [device] = await this.db.db.update(devices).set({
      hostname: input.hostname,
      label: input.label,
      status: 'APPROVED',
      enrollmentCodeHash: null,
      enrollmentCodeExpiresAt: null,
      tokenHash: hashToken(deviceToken),
      tokenIssuedAt: now,
      tokenExpiresAt: expiresAt,
      revokedAt: null,
      revokedReason: null,
    }).where(and(
      eq(devices.enrollmentCodeHash, hashToken(input.code)),
      eq(devices.status, 'PENDING'),
      gt(devices.enrollmentCodeExpiresAt, now),
    )).returning({ id: devices.id, status: devices.status });
    if (!device) throw new ConflictException('Invalid or expired enrollment code');
    await this.audit.record({ actorType: 'DEVICE', actorDeviceId: device.id, action: 'device.enrolled', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id } });
    return { deviceId: device.id, deviceToken, expiresAt };
  }

  async heartbeat(token: string, input: DeviceHeartbeatInput, ip?: string) {
    const normalizedIp = normalizeIp(ip);
    const [device] = await this.db.db.update(devices).set({
      ...input,
      lastSeenAt: new Date(),
      ...(normalizedIp ? { lastIp: normalizedIp } : {}),
    }).where(and(
      eq(devices.tokenHash, hashToken(token)),
      eq(devices.status, 'APPROVED'),
      gt(devices.tokenExpiresAt, new Date()),
    )).returning({ id: devices.id, lastSeenAt: devices.lastSeenAt });
    if (!device) throw new ForbiddenException('Device is not approved');
    return device;
  }

  async rotate(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const deviceToken = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_TOKEN_TTL_MS);
    const [device] = await this.db.db.update(devices).set({
      tokenHash: hashToken(deviceToken),
      tokenIssuedAt: now,
      tokenExpiresAt: expiresAt,
      revokedAt: null,
      revokedReason: null,
    }).where(and(eq(devices.id, id), eq(devices.status, 'APPROVED'))).returning({ id: devices.id });
    if (!device) throw new NotFoundException('Approved device not found');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.token_rotated', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id } });
    return { deviceId: device.id, deviceToken, expiresAt };
  }

  async get(id: string, _actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const device = await this.db.db.query.devices.findFirst({ where: eq(devices.id, id) });
    if (!device) throw new NotFoundException('Device not found');
    return { ...device, tokenHash: undefined, enrollmentCodeHash: undefined };
  }

  async list(_actor: Pick<AccessTokenClaims, 'sub' | 'role'>) { return this.db.db.select({ id: devices.id, hostname: devices.hostname, label: devices.label, status: devices.status, extensionVersion: devices.extensionVersion, helperVersion: devices.helperVersion, osVersion: devices.osVersion, lastSeenAt: devices.lastSeenAt, lastIp: devices.lastIp, tokenIssuedAt: devices.tokenIssuedAt, tokenExpiresAt: devices.tokenExpiresAt, revokedAt: devices.revokedAt, revokedReason: devices.revokedReason }).from(devices).orderBy(asc(devices.label)); }

  async revoke(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>, reason = 'ADMIN_REVOKE') {
    const [row] = await this.db.db.update(devices).set({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, enrollmentCodeHash: null, enrollmentCodeExpiresAt: null, tokenHash: null, tokenExpiresAt: null }).where(eq(devices.id, id)).returning({ id: devices.id, status: devices.status, revokedAt: devices.revokedAt });
    if (!row) throw new NotFoundException('Device not found');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.revoked', entityType: 'device', entityId: row.id, result: 'SUCCESS', metadata: { deviceId: row.id, reason } });
    return row;
  }

}
