import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, isPgError } from '../../database/pg-error.js';
import { appSettings, auditLog, featureFlags, ipAllowlist, operatorCompensation, permissions, roles, users } from '../../database/schema/index.js';
import { hashPassword } from '../../common/auth/crypto.js';
import { ConfigService } from '../../config/config.service.js';
import type { CompensationInput, FeatureFlagInput, IpAllowlistInput, SettingInput, UserCreateInput, UserPatchInput } from './admin.schemas.js';

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService) {}

  async listUsers() { return this.db.db.select({ id: users.id, email: users.email, fullName: users.fullName, nationalId: users.nationalId, phone: users.phone, roleId: users.roleId, status: users.status, mustChangePassword: users.mustChangePassword, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(isNull(users.deletedAt)).orderBy(asc(users.fullName)); }
  async roles() { return this.db.db.select({ id: roles.id, code: roles.code, name: roles.name, hierarchyLevel: roles.hierarchyLevel, isSystem: roles.isSystem }).from(roles).orderBy(asc(roles.hierarchyLevel)); }
  async permissions() { return this.db.db.select({ id: permissions.id, code: permissions.code, module: permissions.module, description: permissions.description }).from(permissions).orderBy(asc(permissions.module), asc(permissions.code)); }

  async createUser(input: UserCreateInput, actorId: string) {
    const role = await this.db.db.query.roles.findFirst({ where: eq(roles.code, input.roleCode) });
    if (!role) throw new NotFoundException('Role not found');
    try {
      const [row] = await this.db.db.insert(users).values({ email: input.email.trim().toLowerCase(), fullName: input.fullName, passwordHash: await hashPassword(input.password, this.config.get('PASSWORD_SCRYPT_LOG2N')), nationalId: input.nationalId, phone: input.phone, roleId: role.id, mustChangePassword: true, createdBy: actorId, updatedBy: actorId }).returning({ id: users.id, email: users.email, fullName: users.fullName, roleId: users.roleId, mustChangePassword: users.mustChangePassword });
      return row;
    } catch (error) { if (isPgError(error, PG_UNIQUE_VIOLATION)) throw new ConflictException('Email already exists'); throw error; }
  }

  async updateUser(id: string, input: UserPatchInput, actorId: string) {
    const roleId = input.roleCode ? (await this.db.db.query.roles.findFirst({ where: eq(roles.code, input.roleCode) }))?.id : undefined;
    if (input.roleCode && !roleId) throw new NotFoundException('Role not found');
    const [row] = await this.db.db.update(users).set({ fullName: input.fullName, phone: input.phone, roleId, updatedBy: actorId, updatedAt: new Date(), version: 1 }).where(and(eq(users.id, id), isNull(users.deletedAt))).returning({ id: users.id, email: users.email, fullName: users.fullName, roleId: users.roleId });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  async disableUser(id: string) { const [row] = await this.db.db.update(users).set({ status: 'DISABLED', updatedAt: new Date() }).where(and(eq(users.id, id), isNull(users.deletedAt))).returning({ id: users.id, status: users.status }); if (!row) throw new NotFoundException('User not found'); return row; }

  async listCompensation(operatorId: string) {
    return this.db.db.select({ id: operatorCompensation.id, operatorId: operatorCompensation.operatorId, commissionRate: operatorCompensation.commissionRate, pointsToCopRate: operatorCompensation.pointsToCopRate, monthlyGoalPoints: operatorCompensation.monthlyGoalPoints, maxConcurrentProfiles: operatorCompensation.maxConcurrentProfiles, validRange: operatorCompensation.validRange, note: operatorCompensation.note, createdBy: operatorCompensation.createdBy, createdAt: operatorCompensation.createdAt }).from(operatorCompensation).where(eq(operatorCompensation.operatorId, operatorId)).orderBy(desc(operatorCompensation.createdAt));
  }

  async addCompensation(operatorId: string, input: CompensationInput, actorId: string) {
    const validFrom = input.validFrom ?? new Date().toISOString();
    const validRange = `[${validFrom},${input.validTo ?? ''})`;
    try {
      const [row] = await this.db.db.insert(operatorCompensation).values({ operatorId, commissionRate: input.commissionRate.toFixed(4), pointsToCopRate: input.pointsToCopRate.toFixed(4), monthlyGoalPoints: input.monthlyGoalPoints?.toFixed(4), maxConcurrentProfiles: input.maxConcurrentProfiles, validRange, note: input.note, createdBy: actorId }).returning({ id: operatorCompensation.id, operatorId: operatorCompensation.operatorId, commissionRate: operatorCompensation.commissionRate, pointsToCopRate: operatorCompensation.pointsToCopRate, validRange: operatorCompensation.validRange });
      return row;
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Compensation range overlaps an existing rate');
      throw error;
    }
  }

  async audit(filters: { from?: string; to?: string; action?: string; actorId?: string }) {
    const conditions = [];
    if (filters.from) conditions.push(sql`${auditLog.occurredAt} >= ${new Date(filters.from)}`);
    if (filters.to) conditions.push(sql`${auditLog.occurredAt} < ${new Date(filters.to)}`);
    if (filters.action) conditions.push(eq(auditLog.action, filters.action));
    if (filters.actorId) conditions.push(eq(auditLog.actorUserId, filters.actorId));
    return this.db.db.select({ id: auditLog.id, occurredAt: auditLog.occurredAt, actorType: auditLog.actorType, actorUserId: auditLog.actorUserId, actorDeviceId: auditLog.actorDeviceId, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId, result: auditLog.result, ip: auditLog.ip, requestId: auditLog.requestId, metadata: auditLog.metadata }).from(auditLog).where(and(...conditions)).orderBy(desc(auditLog.occurredAt)).limit(500);
  }

  async settings() { const rows = await this.db.db.select({ key: appSettings.key, value: appSettings.value, description: appSettings.description, isSecret: appSettings.isSecret, updatedAt: appSettings.updatedAt }).from(appSettings); return rows.map((row) => row.isSecret ? { ...row, value: '[REDACTED]' } : row); }
  async setSetting(key: string, input: SettingInput, actorId: string) { const [row] = await this.db.db.insert(appSettings).values({ key, value: input.value, description: input.description, isSecret: input.isSecret ?? false, updatedBy: actorId }).onConflictDoUpdate({ target: appSettings.key, set: { value: input.value, description: input.description, isSecret: input.isSecret ?? false, updatedBy: actorId, updatedAt: new Date() } }).returning({ key: appSettings.key, value: appSettings.value, isSecret: appSettings.isSecret }); return row.isSecret ? { ...row, value: '[REDACTED]' } : row; }
  async flags() { return this.db.db.select().from(featureFlags); }
  async setFlag(key: string, input: FeatureFlagInput, actorId: string) { const [row] = await this.db.db.insert(featureFlags).values({ key, isEnabled: input.isEnabled, rollout: input.rollout ?? {}, description: input.description, updatedBy: actorId }).onConflictDoUpdate({ target: featureFlags.key, set: { isEnabled: input.isEnabled, rollout: input.rollout ?? {}, description: input.description, updatedBy: actorId, updatedAt: new Date() } }).returning(); return row; }
  async listAllowlist() { return this.db.db.select({ id: ipAllowlist.id, label: ipAllowlist.label, cidr: ipAllowlist.cidr, scope: ipAllowlist.scope, roleId: ipAllowlist.roleId, userId: ipAllowlist.userId, isActive: ipAllowlist.isActive, expiresAt: ipAllowlist.expiresAt }).from(ipAllowlist); }
  async addAllowlist(input: IpAllowlistInput, actorId: string) { if (input.scope === 'ROLE' && !input.roleId) throw new ConflictException('roleId is required for ROLE scope'); if (input.scope === 'USER' && !input.userId) throw new ConflictException('userId is required for USER scope'); const [row] = await this.db.db.insert(ipAllowlist).values({ ...input, expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined, createdBy: actorId }).returning({ id: ipAllowlist.id, label: ipAllowlist.label, cidr: ipAllowlist.cidr, scope: ipAllowlist.scope }); return row; }
  async removeAllowlist(id: string) { const [row] = await this.db.db.update(ipAllowlist).set({ isActive: false }).where(eq(ipAllowlist.id, id)).returning({ id: ipAllowlist.id }); if (!row) throw new NotFoundException('Allowlist entry not found'); return row; }
}
