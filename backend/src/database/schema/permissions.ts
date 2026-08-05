import { pgTable, uuid, text, primaryKey } from 'drizzle-orm/pg-core';
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
    // La versión anterior de esta tabla declaraba `pk` como un objeto plano
    // ({ name, columns }), que no es la API de Drizzle — drizzle-kit lo
    // ignoraba en silencio y la migración generada creó la tabla sin
    // primary key, permitiendo duplicar (role_id, permission_id).
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
);
