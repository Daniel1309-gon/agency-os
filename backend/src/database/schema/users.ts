import { pgTable, uuid, text, boolean, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core';
import { roles } from './roles.js';

export const userStatusEnum = pgEnum('user_status', [
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
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
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
