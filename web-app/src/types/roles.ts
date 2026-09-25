import type { RoleCode } from '@agency-os/shared';

export type { RoleCode } from '@agency-os/shared';

export const roleLabels: Record<RoleCode, string> = {
  OPERADOR: 'Operador',
  COORDINADOR: 'Coordinador',
  CAFETERIA: 'Cafetería',
  DIRECTOR_OPERATIVO: 'Director Operativo',
  ADMIN: 'Administrador',
};

export const roleDescriptions: Record<RoleCode, string> = {
  OPERADOR: 'Tus perfiles asignados y la operación de tu turno.',
  COORDINADOR: 'Cobertura, equipo y seguimiento de la operación.',
  CAFETERIA: 'Menú, ventas e inventario del punto de cafetería.',
  DIRECTOR_OPERATIVO: 'Métricas globales para dirigir la operación.',
  ADMIN: 'Métricas globales, seguridad y salud del sistema.',
};

export const isManagementRole = (role: RoleCode) =>
  role === 'DIRECTOR_OPERATIVO' || role === 'ADMIN';
