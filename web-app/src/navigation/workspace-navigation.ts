import type { RoleCode } from '../types/roles';

export type WorkspacePageId =
  | 'operatorProfiles'
  | 'operatorShift'
  | 'operatorCafeteria'
  | 'team'
  | 'users'
  | 'profiles'
  | 'assignments'
  | 'shifts'
  | 'metrics'
  | 'security'
  | 'ipAllowlist'
  | 'audit'
  | 'cafeteriaOrders'
  | 'cafeteriaMenu'
  | 'cafeteriaSales'
  | 'cafeteriaInventory';

export interface WorkspaceRoute {
  id: WorkspacePageId;
  path: string;
  label: string;
  group: 'Operación' | 'Control' | 'Punto';
  kicker: string;
  title: string;
  description: string;
  permission?: string;
  pending?: boolean;
  longPage?: boolean;
  showDate?: boolean;
}

const operatorRoutes: readonly WorkspaceRoute[] = [
  { id: 'operatorProfiles', path: '/app/perfiles', label: 'Mis perfiles', group: 'Operación', kicker: 'Operación personal', title: 'Mis perfiles asociados', description: 'Abre la cuenta asignada sin ver su contraseña.', permission: 'profiles.read' },
  { id: 'operatorShift', path: '/app/turno', label: 'Mi turno', group: 'Operación', kicker: 'Control de jornada', title: 'Mi turno', description: 'Consulta tu ventana activa y registra tus descansos.', permission: 'shifts.read', showDate: true },
  { id: 'operatorCafeteria', path: '/app/cafeteria', label: 'Cafetería', group: 'Punto', kicker: 'Pausa y consumo', title: 'Pide a cafetería', description: 'Elige tus productos y envía el pedido durante tu jornada.', showDate: true },
];

const coordinationRoutes: readonly WorkspaceRoute[] = [
  { id: 'team', path: '/app/equipo', label: 'Equipo', group: 'Operación', kicker: 'Vista de coordinación', title: 'Tu equipo, en movimiento.', description: 'Supervisa cobertura, estados y alertas de tu cuadrilla.', permission: 'operators.monitor', showDate: true },
  { id: 'users', path: '/app/usuarios', label: 'Usuarios', group: 'Operación', kicker: 'Acceso y equipo', title: 'Usuarios y roles', description: 'Consulta las personas y los roles dentro de tu alcance.', permission: 'users.read' },
  { id: 'profiles', path: '/app/perfiles', label: 'Perfiles', group: 'Operación', kicker: 'Catálogo TalkyTimes', title: 'Perfiles TalkyTimes', description: 'Administra metadatos y vínculos nativos de Chrome.', permission: 'profiles.read', longPage: true },
  { id: 'assignments', path: '/app/asignaciones', label: 'Asignaciones', group: 'Operación', kicker: 'Operación por ventanas', title: 'Asignaciones y relevos', description: 'Programa el tramo real de cada operador y prepara relevos.', permission: 'profiles.read', longPage: true },
  { id: 'shifts', path: '/app/turnos', label: 'Turnos', group: 'Operación', kicker: 'Cobertura operativa', title: 'Turnos y overrides', description: 'Programa jornadas y excepciones horarias con trazabilidad.', permission: 'shifts.read', longPage: true },
  { id: 'audit', path: '/app/auditoria', label: 'Auditoría', group: 'Control', kicker: 'Trazabilidad · solo lectura', title: 'Panel de auditoría', description: 'Revisa acciones operativas con filtros y contexto sanitizado.', permission: 'audit.read', longPage: true },
];

const managementRoutes: readonly WorkspaceRoute[] = [
  { id: 'metrics', path: '/app/metricas', label: 'Métricas', group: 'Operación', kicker: 'Dirección operativa', title: 'La operación de un vistazo.', description: 'Consulta las señales que orientan las decisiones del día.', permission: 'metrics.audit', showDate: true },
  { id: 'users', path: '/app/usuarios', label: 'Usuarios', group: 'Operación', kicker: 'Acceso y equipo', title: 'Usuarios y roles', description: 'Administra los accesos y roles de Agency OS.', permission: 'users.read' },
  { id: 'profiles', path: '/app/perfiles', label: 'Perfiles', group: 'Operación', kicker: 'Catálogo TalkyTimes', title: 'Perfiles TalkyTimes', description: 'Administra metadatos y vínculos nativos de Chrome.', permission: 'profiles.read' },
  { id: 'assignments', path: '/app/asignaciones', label: 'Asignaciones', group: 'Operación', kicker: 'Operación por ventanas', title: 'Asignaciones y relevos', description: 'Programa el tramo real de cada operador y prepara relevos.', permission: 'profiles.read' },
  { id: 'shifts', path: '/app/turnos', label: 'Turnos', group: 'Operación', kicker: 'Cobertura operativa', title: 'Turnos y overrides', description: 'Programa jornadas y excepciones horarias con trazabilidad.', permission: 'shifts.read' },
  { id: 'audit', path: '/app/auditoria', label: 'Auditoría', group: 'Control', kicker: 'Trazabilidad · solo lectura', title: 'Panel de auditoría', description: 'Revisa acciones operativas con filtros y contexto sanitizado.', permission: 'audit.read' },
];

const adminSecurityRoutes: readonly WorkspaceRoute[] = [
  { id: 'security', path: '/app/seguridad', label: 'Seguridad', group: 'Control', kicker: 'Perímetro y estaciones', title: 'Estado de seguridad', description: 'Comprueba la salud de servicios y estaciones enroladas.', permission: 'devices.manage', longPage: true },
  { id: 'ipAllowlist', path: '/app/acceso-ip', label: 'Acceso por IP', group: 'Control', kicker: 'Perímetro de acceso', title: 'Allowlist IP', description: 'Administra las redes autorizadas para entrar a Agency OS.', permission: 'security.manage', longPage: true },
];

const adminRoutes: readonly WorkspaceRoute[] = [
  ...managementRoutes.filter((route) => route.id !== 'audit'),
  ...adminSecurityRoutes,
  ...managementRoutes.filter((route) => route.id === 'audit'),
];

const cafeteriaRoutes: readonly WorkspaceRoute[] = [
  { id: 'cafeteriaOrders', path: '/app/pedidos', label: 'Pedidos', group: 'Punto', kicker: 'Operación en tiempo real', title: 'Pedidos de hoy', description: 'Mueve cada pedido por su estado hasta la entrega.', permission: 'cafeteria.manage', showDate: true },
  { id: 'cafeteriaMenu', path: '/app/menu', label: 'Menú', group: 'Punto', kicker: 'Disponibilidad · hoy', title: 'Menú de hoy', description: 'Consulta los productos publicados y sus tiempos de preparación.', permission: 'cafeteria.manage', showDate: true },
  { id: 'cafeteriaSales', path: '/app/ventas', label: 'Ventas', group: 'Punto', kicker: 'Entrega 2', title: 'Ventas', description: 'El historial y el cierre de ventas estarán disponibles en una entrega posterior.', pending: true },
  { id: 'cafeteriaInventory', path: '/app/inventario', label: 'Inventario', group: 'Punto', kicker: 'Entrega 2', title: 'Inventario', description: 'El control de existencias estará disponible en una entrega posterior.', pending: true },
];

const routesByRole: Record<RoleCode, readonly WorkspaceRoute[]> = {
  OPERADOR: operatorRoutes,
  COORDINADOR: coordinationRoutes,
  CAFETERIA: cafeteriaRoutes,
  DIRECTOR_OPERATIVO: managementRoutes,
  ADMIN: adminRoutes,
};

function hasAccess(route: WorkspaceRoute, permissions: readonly string[]): boolean {
  return !route.permission || permissions.includes('*') || permissions.includes(route.permission);
}

export function getWorkspaceRoutes(role: RoleCode, permissions: readonly string[]): WorkspaceRoute[] {
  return routesByRole[role].filter((route) => hasAccess(route, permissions));
}

export function defaultWorkspaceRoute(role: RoleCode, permissions: readonly string[]): WorkspaceRoute {
  return getWorkspaceRoutes(role, permissions)[0] ?? routesByRole[role][0];
}

export function resolveWorkspaceRoute(role: RoleCode, permissions: readonly string[], pathname: string): WorkspaceRoute {
  return getWorkspaceRoutes(role, permissions).find((route) => route.path === pathname) ?? defaultWorkspaceRoute(role, permissions);
}
