import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { randomToken, hashToken } from '../../common/auth/crypto.js';
import { DatabaseService } from '../../database/database.service.js';
import { devices } from '../../database/schema/index.js';
import type { DeviceCreateInput, DeviceEnrollInput, DeviceHeartbeatInput } from './devices.schemas.js';

@Injectable()
export class DevicesService {
  constructor(private readonly db: DatabaseService) {}

  async create(input: DeviceCreateInput, actorId: string) {
    const code = randomToken(24);
    const [device] = await this.db.db.insert(devices).values({ ...input, enrollmentCodeHash: hashToken(code) }).returning({ id: devices.id, label: devices.label, status: devices.status });
    return { ...device, enrollmentCode: code };
  }

  async enroll(input: DeviceEnrollInput) {
    const deviceToken = randomToken();
    const expiresAt = new Date(Date.now() + 90 * 86_400_000);
    const [device] = await this.db.db.update(devices).set({ hostname: input.hostname, label: input.label, status: 'APPROVED', enrollmentCodeHash: null, tokenHash: hashToken(deviceToken), tokenIssuedAt: new Date(), tokenExpiresAt: expiresAt }).where(and(eq(devices.enrollmentCodeHash, hashToken(input.code)), eq(devices.status, 'PENDING'))).returning({ id: devices.id, status: devices.status });
    if (!device) throw new ConflictException('Invalid or expired enrollment code');
    return { deviceId: device.id, deviceToken, expiresAt };
  }

  async heartbeat(token: string, input: DeviceHeartbeatInput, ip?: string) {
    const [device] = await this.db.db.update(devices).set({ ...input, lastSeenAt: new Date(), lastIp: ip }).where(and(eq(devices.tokenHash, hashToken(token)), eq(devices.status, 'APPROVED'))).returning({ id: devices.id, lastSeenAt: devices.lastSeenAt });
    if (!device) throw new ForbiddenException('Device is not approved');
    return device;
  }

  async get(id: string) {
    const device = await this.db.db.query.devices.findFirst({ where: eq(devices.id, id) });
    if (!device) throw new NotFoundException('Device not found');
    return { ...device, tokenHash: undefined, enrollmentCodeHash: undefined };
  }

  async list() { return this.db.db.select({ id: devices.id, hostname: devices.hostname, label: devices.label, assignedOperatorId: devices.assignedOperatorId, status: devices.status, extensionVersion: devices.extensionVersion, helperVersion: devices.helperVersion, osVersion: devices.osVersion, lastSeenAt: devices.lastSeenAt, lastIp: devices.lastIp, tokenIssuedAt: devices.tokenIssuedAt, tokenExpiresAt: devices.tokenExpiresAt, revokedAt: devices.revokedAt, revokedReason: devices.revokedReason }).from(devices).orderBy(asc(devices.label)); }
  async revoke(id: string, reason = 'ADMIN_REVOKE') { const [row] = await this.db.db.update(devices).set({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, tokenHash: null }).where(eq(devices.id, id)).returning({ id: devices.id, status: devices.status, revokedAt: devices.revokedAt }); if (!row) throw new NotFoundException('Device not found'); return row; }
}
