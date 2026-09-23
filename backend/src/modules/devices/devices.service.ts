import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { randomToken, hashToken, type AccessTokenClaims } from '../../common/auth/crypto.js';
import type { ClientCertIdentity } from '../../common/auth/auth.types.js';
import { DatabaseService } from '../../database/database.service.js';
import { devices } from '../../database/schema/index.js';
import type { DeviceCertificateInput, DeviceCreateInput, DeviceEnrollInput, DeviceHeartbeatInput } from './devices.schemas.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { normalizeIp } from '../../common/auth/ip.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AuthService } from '../auth/auth.service.js';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../database/pg-error.js';

const ENROLLMENT_CODE_TTL_MS = 15 * 60_000;

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly auth: AuthService,
  ) {}

  async create(input: DeviceCreateInput, actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const code = randomToken(24);
    const enrollmentCodeExpiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);
    const [device] = await this.db.db.insert(devices).values({
      hostname: input.hostname,
      label: input.label,
      deviceKind: input.deviceKind,
      enrollmentCodeHash: hashToken(code),
      enrollmentCodeExpiresAt,
      approvedBy: actor.sub,
    }).returning({ id: devices.id, label: devices.label, status: devices.status, deviceKind: devices.deviceKind, enrollmentCodeExpiresAt: devices.enrollmentCodeExpiresAt });
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.created', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id, deviceKind: input.deviceKind } });
    return { ...device, enrollmentCode: code };
  }

  /**
   * One-time enrollment code plus the fingerprint of the certificate the PC
   * generated for itself. No secret is issued: identity is the certificate.
   * Cuando el borde entrego el certificado, la huella y el vencimiento salen de
   * ahi (no del cuerpo) y el cuerpo solo puede confirmarla, no cambiarla.
   */
  async enroll(input: DeviceEnrollInput, certificate: ClientCertIdentity = {}) {
    if (certificate.fingerprint && input.certFingerprint !== certificate.fingerprint) {
      throw new BadRequestException('certFingerprint does not match the presented certificate');
    }
    const fingerprint = certificate.fingerprint ?? input.certFingerprint;
    const certNotAfter = certificate.fingerprint
      ? certificate.notAfter ?? null
      : input.certNotAfter ? new Date(input.certNotAfter) : null;
    const now = new Date();
    let device: { id: string } | undefined;
    try {
      // Ruta publica (sin JWT): la transaccion del interceptor no la cubre, asi que
      // el alta del dispositivo y su auditoria se cierran juntas o no se cierran.
      await this.db.transaction(async () => {
        [device] = await this.db.db.update(devices).set({
          hostname: input.hostname,
          label: input.label ?? input.hostname,
          certFingerprint: fingerprint,
          certNotAfter,
          status: 'APPROVED',
          enrollmentCodeHash: null,
          enrollmentCodeExpiresAt: null,
          revokedAt: null,
          revokedReason: null,
        }).where(and(
          eq(devices.enrollmentCodeHash, hashToken(input.code)),
          eq(devices.status, 'PENDING'),
          gt(devices.enrollmentCodeExpiresAt, now),
        )).returning({ id: devices.id, status: devices.status });
        if (!device) return;
        await this.audit.record({ actorType: 'DEVICE', actorDeviceId: device.id, action: 'device.enrolled', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id } });
      });
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) throw new ConflictException('Certificate fingerprint is already assigned to an active device');
      throw error;
    }
    if (!device) throw new ConflictException('Invalid or expired enrollment code');
    return { deviceId: device.id };
  }

  async registerCertificate(id: string, input: DeviceCertificateInput, actor: Pick<AccessTokenClaims, 'sub'>) {
    let device: { id: string } | undefined;
    try {
      [device] = await this.db.db.update(devices).set({
        certFingerprint: input.certFingerprint,
        certNotAfter: input.certNotAfter ? new Date(input.certNotAfter) : null,
        revokedAt: null,
        revokedReason: null,
      }).where(and(eq(devices.id, id), eq(devices.status, 'APPROVED'))).returning({ id: devices.id, certFingerprint: devices.certFingerprint });
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) throw new ConflictException('Certificate fingerprint is already assigned to an active device');
      throw error;
    }
    if (!device) throw new ConflictException('Device is not approved');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.certificate.registered', entityType: 'device', entityId: device.id, result: 'SUCCESS', metadata: { deviceId: device.id } });
    return { deviceId: device.id };
  }

  async heartbeat(deviceId: string, input: DeviceHeartbeatInput, ip?: string) {
    const normalizedIp = normalizeIp(ip);
    const [device] = await this.db.db.update(devices).set({
      ...input,
      lastSeenAt: new Date(),
      ...(normalizedIp ? { lastIp: normalizedIp } : {}),
    }).where(and(eq(devices.id, deviceId), eq(devices.status, 'APPROVED'))).returning({ id: devices.id, lastSeenAt: devices.lastSeenAt });
    if (!device) throw new ForbiddenException('Device is not approved');
    return device;
  }

  async get(id: string, _actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    const device = await this.db.db.query.devices.findFirst({ where: eq(devices.id, id) });
    if (!device) throw new NotFoundException('Device not found');
    return { ...device, tokenHash: undefined, enrollmentCodeHash: undefined };
  }

  async list(_actor: Pick<AccessTokenClaims, 'sub' | 'role'>) {
    return this.db.db.select({
      id: devices.id,
      hostname: devices.hostname,
      label: devices.label,
      status: devices.status,
      deviceKind: devices.deviceKind,
      certFingerprint: devices.certFingerprint,
      certNotAfter: devices.certNotAfter,
      extensionVersion: devices.extensionVersion,
      helperVersion: devices.helperVersion,
      osVersion: devices.osVersion,
      lastSeenAt: devices.lastSeenAt,
      lastIp: devices.lastIp,
      revokedAt: devices.revokedAt,
      revokedReason: devices.revokedReason,
    }).from(devices).orderBy(asc(devices.label));
  }

  async revoke(id: string, actor: Pick<AccessTokenClaims, 'sub' | 'role'>, reason = 'ADMIN_REVOKE') {
    const [row] = await this.db.db.update(devices).set({ status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, enrollmentCodeHash: null, enrollmentCodeExpiresAt: null }).where(eq(devices.id, id)).returning({ id: devices.id, status: devices.status, revokedAt: devices.revokedAt });
    if (!row) throw new NotFoundException('Device not found');
    // La revocacion tambien mata las sesiones de refresco nacidas en ese equipo:
    // sin esto el refresh token seguiria renovando desde cualquier otro equipo.
    await this.auth.revokeDeviceTokens(row.id);
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'device.revoked', entityType: 'device', entityId: row.id, result: 'SUCCESS', metadata: { deviceId: row.id, reason } });
    this.realtime.disconnectDevice(row.id);
    return row;
  }

}
