import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import * as schema from '../schema/index.js';
import { appSettings, featureFlags, permissions, rolePermissions, roles } from '../schema/index.js';
import { users } from '../schema/index.js';
import { hashPassword } from '../../common/auth/crypto.js';
import { rolePermissionCodes } from './role-permissions.js';

const permissionDefinitions = [
  ['users.read', 'users', 'Read users'],
  ['users.create', 'users', 'Create users'],
  ['users.update', 'users', 'Update users'],
  ['users.disable', 'users', 'Disable users'],
  ['rbac.read', 'rbac', 'Read roles and permissions'],
  ['crews.read', 'crews', 'Read crews'],
  ['crews.manage', 'crews', 'Manage crews'],
  ['profiles.read', 'profiles', 'Read profiles'],
  ['profiles.create', 'profiles', 'Create profiles'],
  ['profiles.update', 'profiles', 'Update profiles'],
  ['vault.credential.issue', 'vault', 'Issue a one-use credential grant'],
  ['vault.rotate', 'vault', 'Rotate profile credentials'],
  ['vault.read_meta', 'vault', 'Read credential metadata'],
  ['devices.manage', 'devices', 'Manage devices'],
  ['shifts.read', 'shifts', 'Read shifts'],
  ['shifts.manage', 'shifts', 'Manage shifts'],
  ['shifts.approve_overtime', 'shifts', 'Approve overtime'],
  ['operators.monitor', 'operators', 'Monitor operator status'],
  ['metrics.audit', 'metrics', 'Read metric reconciliation'],
  ['reports.read', 'reports', 'Read effective-time reports'],
  ['etl.manage', 'etl', 'Manage Tableau ETL'],
  ['icebreaker.review', 'icebreakers', 'Review icebreakers'],
  ['icebreaker.rules.manage', 'icebreakers', 'Manage icebreaker rules'],
  ['payroll.read', 'payroll', 'Read payroll'],
  ['payroll.configure', 'payroll', 'Configure compensation and goals'],
  ['payroll.adjust', 'payroll', 'Adjust payroll'],
  ['payroll.close', 'payroll', 'Close payroll periods'],
  ['cafeteria.manage', 'cafeteria', 'Manage cafeteria'],
  ['chat.manage', 'chat', 'Manage RocketChat channels'],
  ['security.manage', 'security', 'Manage IP allowlist'],
  ['audit.read', 'audit', 'Read audit log'],
  ['settings.manage', 'settings', 'Manage settings and feature flags'],
] as const;

const roleDefinitions = [
  ['ADMIN', 'Administrador', 1, true],
  ['DIRECTOR_OPERATIVO', 'Director Operativo', 2, true],
  ['COORDINADOR', 'Coordinador', 3, true],
  ['OPERADOR', 'Operador', 4, true],
  ['CAFETERIA', 'Cafetería', 5, true],
] as const;

async function seed(): Promise<void> {
  const config = new ConfigService();
  const pool = new Pool({ connectionString: config.get('DATABASE_URL') });
  const db = drizzle({ client: pool, schema });
  try {
    await db.insert(roles).values(roleDefinitions.map(([code, name, hierarchyLevel, isSystem]) => ({ code, name, hierarchyLevel, isSystem }))).onConflictDoUpdate({
      target: roles.code,
      set: { name: sql`excluded.name`, hierarchyLevel: sql`excluded.hierarchy_level`, isSystem: sql`excluded.is_system` },
    });
    await db.insert(permissions).values(permissionDefinitions.map(([code, module, description]) => ({ code, module, description }))).onConflictDoUpdate({
      target: permissions.code,
      set: { module: sql`excluded.module`, description: sql`excluded.description` },
    });

    const roleRows = await db.select({ id: roles.id, code: roles.code }).from(roles);
    const permissionRows = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
    const permissionIds = new Map(permissionRows.map((row) => [row.code, row.id]));
    const all = permissionDefinitions.map(([code]) => permissionIds.get(code)).filter((id): id is string => Boolean(id));
    const rolePermissionRows = roleRows.flatMap((role) => {
      const configured = rolePermissionCodes[role.code as keyof typeof rolePermissionCodes] ?? [];
      const codes = configured.includes('*')
        ? all
        : configured.map((code) => permissionIds.get(code)).filter((id): id is string => Boolean(id));
      return codes.map((permissionId) => ({ roleId: role.id, permissionId }));
    });
    if (rolePermissionRows.length) await db.insert(rolePermissions).values(rolePermissionRows).onConflictDoNothing();
    const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (bootstrapEmail || bootstrapPassword) {
      if (!bootstrapEmail || !bootstrapPassword) throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be provided together');
      const adminRole = roleRows.find((role) => role.code === 'ADMIN');
      if (!adminRole) throw new Error('ADMIN role seed failed');
      await db.insert(users).values({ email: bootstrapEmail.toLowerCase(), fullName: 'Agency OS Administrator', passwordHash: await hashPassword(bootstrapPassword, config.get('PASSWORD_SCRYPT_LOG2N')), roleId: adminRole.id, mustChangePassword: false }).onConflictDoNothing();
    }
    await db.insert(appSettings).values([
      { key: 'points_to_cop_rate', value: 1, description: 'Default COP per point', isSecret: false },
      { key: 'metrics.reconciliation_tolerance', value: 0.01, description: 'Allowed points difference', isSecret: false },
      { key: 'auth.login_rate_limit', value: { max: 5, windowSeconds: 900 }, description: 'Login rate limit', isSecret: false },
      { key: 'shifts.grace_minutes', value: 0, description: 'Shift handoff grace period', isSecret: false },
    ]).onConflictDoNothing();
    await db.insert(featureFlags).values([
      { key: 'fr39.interactions', isEnabled: false, description: 'Interaction automation gated by spike' },
      { key: 'feature9.chat_verification', isEnabled: false, description: 'Feature 9 gated by spike' },
      { key: 'icebreakers.blocking_score', isEnabled: false, description: 'Blocking score gate' },
      { key: 'tableau.etl', isEnabled: false, description: 'Tableau ETL until views are confirmed' },
    ]).onConflictDoNothing();
  } finally {
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
