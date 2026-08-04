import { pgTable, uuid, text } from 'drizzle-orm/pg-core';
import { roles } from './roles.js';

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  module: text('module').notNull(),
  description: text('description'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id),
  },
  (t) => ({
    pk: { name: 'role_permissions_pkey', columns: [t.roleId, t.permissionId] },
  }),
);
