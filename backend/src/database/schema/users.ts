import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  pgEnum,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { roles } from './roles.js';

export const userStatusEnum = pgEnum('user_status', [
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
]);

// citext (case-insensitive text) requiere `CREATE EXTENSION citext`, agregado
// en la migracion. Sin esto "Carol@x.com" y "carol@x.com" son usuarios
// distintos para Postgres, aunque el resto del sistema los trate como el
// mismo (login, notificaciones, el propio RLS de PLAN.md §6.5).
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    nationalId: text('national_id'),
    phone: text('phone'),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    rocketchatUserId: text('rocketchat_user_id'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Sin este indice, antes, se podian crear dos usuarios con el mismo
    // email (ninguna restriccion lo impedia). Parcial porque un email dado
    // de baja (soft-delete) debe poder reutilizarse por otro usuario nuevo.
    emailUnique: uniqueIndex('users_email_unique')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);
