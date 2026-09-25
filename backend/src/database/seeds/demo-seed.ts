import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../../common/auth/crypto.js';
import { ConfigService } from '../../config/config.service.js';
import * as schema from '../schema/index.js';
import {
  cafeteriaProducts,
  crewMembers,
  crews,
  profileAssignments,
  roles,
  shiftOverrides,
  ttProfiles,
  users,
} from '../schema/index.js';
import type { SeedRoleCode } from './role-permissions.js';

type DemoRole = Exclude<SeedRoleCode, 'ADMIN'>;

export const demoAccounts = [
  { email: 'director@agency.test', fullName: 'Diana Directora', role: 'DIRECTOR_OPERATIVO' },
  { email: 'coordinador@agency.test', fullName: 'Carlos Coordinador', role: 'COORDINADOR' },
  { email: 'operador@agency.test', fullName: 'Olivia Operadora', role: 'OPERADOR' },
  { email: 'cafeteria@agency.test', fullName: 'Camila Cafetería', role: 'CAFETERIA' },
] as const satisfies ReadonlyArray<{ email: string; fullName: string; role: DemoRole }>;

export const demoProfiles = [
  {
    displayName: 'Luna Demo',
    loginEmail: 'luna.demo@talkytimes.test',
    externalRef: 'DEMO-LUNA-01',
    country: 'CO',
    chromeProfileDir: 'Profile 1',
  },
  {
    displayName: 'Mar Demo',
    loginEmail: 'mar.demo@talkytimes.test',
    externalRef: 'DEMO-MAR-02',
    country: 'US',
    chromeProfileDir: 'Profile 2',
  },
  {
    displayName: 'Sol Demo',
    loginEmail: 'sol.demo@talkytimes.test',
    externalRef: 'DEMO-SOL-03',
    country: 'CO',
    chromeProfileDir: 'Profile 3',
  },
  {
    displayName: 'Nube Demo',
    loginEmail: 'nube.demo@talkytimes.test',
    externalRef: 'DEMO-NUBE-04',
    country: 'US',
    chromeProfileDir: 'Profile 4',
  },
  {
    displayName: 'Alma Demo',
    loginEmail: 'alma.demo@talkytimes.test',
    externalRef: 'DEMO-ALMA-05',
    country: 'CO',
    chromeProfileDir: 'Profile 5',
  },
  {
    displayName: 'Vera Demo',
    loginEmail: 'vera.demo@talkytimes.test',
    externalRef: 'DEMO-VERA-06',
    country: 'US',
    chromeProfileDir: 'Profile 6',
  },
] as const;

const demoProducts = [
  { sku: 'DEMO-CAFE', name: 'Café americano', description: 'Café negro recién preparado', category: 'Bebidas', priceCop: '3500.00', prepMinutes: 4 },
  { sku: 'DEMO-JUGO', name: 'Jugo natural', description: 'Fruta del día', category: 'Bebidas', priceCop: '6000.00', prepMinutes: 7 },
  { sku: 'DEMO-SANDWICH', name: 'Sándwich de pollo', description: 'Pollo, queso y vegetales', category: 'Comidas', priceCop: '12000.00', prepMinutes: 12 },
  { sku: 'DEMO-FRUTA', name: 'Porción de fruta', description: 'Selección de fruta fresca', category: 'Snacks', priceCop: '5000.00', prepMinutes: 3 },
] as const;

const DEMO_RANGE = '[2000-01-01T00:00:00.000Z,2100-01-01T00:00:00.000Z)';
const DEMO_CREW_NAME = 'Cuadrilla Demo Zenith';

export function validateDemoSeedConfig(nodeEnv: string | undefined, password: string | undefined): string {
  if (nodeEnv !== 'development') throw new Error('Demo seed is only allowed in development');
  if (!password) throw new Error('DEMO_USER_PASSWORD is required');
  if (password.length < 12 || password.length > 72) {
    throw new Error('DEMO_USER_PASSWORD must contain between 12 and 72 characters');
  }
  return password;
}

export async function seedDemo(): Promise<void> {
  const password = validateDemoSeedConfig(process.env.NODE_ENV, process.env.DEMO_USER_PASSWORD);
  const config = new ConfigService();
  const pool = new Pool({ connectionString: config.get('DATABASE_URL'), max: 1 });
  const db = drizzle({ client: pool, schema });

  try {
    const ownerRole = process.env.DATABASE_OWNER_ROLE ?? 'agency_owner';
    if (!/^[a-z_][a-z0-9_]*$/.test(ownerRole)) throw new Error('DATABASE_OWNER_ROLE contains an invalid PostgreSQL identifier');
    const ownerExists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ownerRole]);
    if (ownerExists.rowCount) await pool.query(`SET ROLE "${ownerRole}"`);
    await db.transaction(async (tx) => {
      const roleRows = await tx.select({ id: roles.id, code: roles.code }).from(roles);
      const roleIds = new Map(roleRows.map((role) => [role.code, role.id]));
      const missingRoles = demoAccounts.filter((account) => !roleIds.has(account.role));
      if (missingRoles.length) throw new Error('Run db:seed before db:seed:demo');

      const accountIds = new Map<DemoRole, string>();

      for (const account of demoAccounts) {
        const roleId = roleIds.get(account.role);
        if (!roleId) throw new Error(`Role ${account.role} is not available`);
        // Generar cada hash por separado conserva una sal distinta por usuario,
        // aunque las cuentas demo compartan la misma contraseña local.
        const passwordHash = await hashPassword(password, config.get('PASSWORD_SCRYPT_LOG2N'));
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, account.email), isNull(users.deletedAt)))
          .limit(1);

        if (existing) {
          await tx.update(users).set({
            fullName: account.fullName,
            passwordHash,
            roleId,
            status: 'ACTIVE',
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
            updatedAt: new Date(),
          }).where(eq(users.id, existing.id));
          accountIds.set(account.role, existing.id);
          continue;
        }

        const [created] = await tx.insert(users).values({
          email: account.email,
          fullName: account.fullName,
          passwordHash,
          roleId,
          status: 'ACTIVE',
          mustChangePassword: false,
        }).returning({ id: users.id });
        accountIds.set(account.role, created.id);
      }

      const directorId = accountIds.get('DIRECTOR_OPERATIVO');
      const coordinatorId = accountIds.get('COORDINADOR');
      const operatorId = accountIds.get('OPERADOR');
      if (!directorId || !coordinatorId || !operatorId) throw new Error('Demo accounts were not created');

      const [existingCrew] = await tx.select({ id: crews.id }).from(crews).where(eq(crews.name, DEMO_CREW_NAME)).limit(1);
      const crewId = existingCrew
        ? existingCrew.id
        : (await tx.insert(crews).values({
            name: DEMO_CREW_NAME,
            coordinatorId,
            isActive: true,
            createdBy: directorId,
            updatedBy: directorId,
          }).returning({ id: crews.id }))[0].id;
      if (existingCrew) {
        await tx.update(crews).set({ coordinatorId, isActive: true, updatedBy: directorId, updatedAt: new Date() }).where(eq(crews.id, crewId));
      }

      const [membership] = await tx.select({ id: crewMembers.id }).from(crewMembers).where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, operatorId))).limit(1);
      if (membership) {
        await tx.update(crewMembers).set({ validRange: DEMO_RANGE }).where(eq(crewMembers.id, membership.id));
      } else {
        await tx.insert(crewMembers).values({ crewId, userId: operatorId, validRange: DEMO_RANGE });
      }

      const [accessOverride] = await tx.select({ id: shiftOverrides.id }).from(shiftOverrides).where(and(eq(shiftOverrides.operatorId, operatorId), eq(shiftOverrides.type, 'DEMO_ACCESS'))).limit(1);
      if (accessOverride) {
        await tx.update(shiftOverrides).set({ range: DEMO_RANGE, approvedBy: directorId }).where(eq(shiftOverrides.id, accessOverride.id));
      } else {
        await tx.insert(shiftOverrides).values({
          operatorId,
          range: DEMO_RANGE,
          type: 'DEMO_ACCESS',
          reason: 'Acceso local para recorrer el flujo de Entrega 1',
          approvedBy: directorId,
        });
      }

      for (const profile of demoProfiles) {
        const [existingProfile] = await tx.select({ id: ttProfiles.id }).from(ttProfiles).where(and(eq(ttProfiles.loginEmail, profile.loginEmail), isNull(ttProfiles.deletedAt))).limit(1);
        const profileId = existingProfile
          ? existingProfile.id
          : (await tx.insert(ttProfiles).values({
              ...profile,
              status: 'ACTIVE',
              notes: 'Perfil ficticio para demostración local; no contiene credenciales del vault.',
              createdBy: directorId,
              updatedBy: directorId,
            }).returning({ id: ttProfiles.id }))[0].id;

        if (existingProfile) {
          await tx.update(ttProfiles).set({
            displayName: profile.displayName,
            externalRef: profile.externalRef,
            country: profile.country,
            chromeProfileDir: profile.chromeProfileDir,
            status: 'ACTIVE',
            updatedBy: directorId,
            updatedAt: new Date(),
          }).where(eq(ttProfiles.id, profileId));
        }

        const [assignment] = await tx.select({ id: profileAssignments.id }).from(profileAssignments).where(and(
          eq(profileAssignments.profileId, profileId),
          eq(profileAssignments.operatorId, operatorId),
          isNull(profileAssignments.endedAt),
        )).limit(1);
        if (assignment) {
          await tx.update(profileAssignments).set({ validRange: DEMO_RANGE, status: 'ACTIVE' }).where(eq(profileAssignments.id, assignment.id));
        } else {
          await tx.insert(profileAssignments).values({
            profileId,
            operatorId,
            validRange: DEMO_RANGE,
            status: 'ACTIVE',
            assignedBy: directorId,
          });
        }
      }

      for (const product of demoProducts) {
        await tx.insert(cafeteriaProducts).values({ ...product, isAvailable: true }).onConflictDoUpdate({
          target: cafeteriaProducts.sku,
          set: {
            name: product.name,
            description: product.description,
            category: product.category,
            priceCop: product.priceCop,
            prepMinutes: product.prepMinutes,
            isAvailable: true,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });
      }
    });
  } finally {
    await pool.end();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  seedDemo()
    .then(() => console.info(`Demo seed ready: ${demoAccounts.map((account) => account.email).join(', ')}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
