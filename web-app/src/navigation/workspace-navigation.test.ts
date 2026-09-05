import { describe, expect, it } from 'vitest';
import { defaultWorkspaceRoute, getWorkspaceRoutes, resolveWorkspaceRoute } from './workspace-navigation';

describe('workspace navigation', () => {
  it('orders the first useful route by role', () => {
    expect(defaultWorkspaceRoute('OPERADOR', ['profiles.read']).path).toBe('/app/perfiles');
    expect(defaultWorkspaceRoute('COORDINADOR', ['operators.monitor']).path).toBe('/app/equipo');
    expect(defaultWorkspaceRoute('CAFETERIA', ['cafeteria.manage']).path).toBe('/app/pedidos');
    expect(defaultWorkspaceRoute('DIRECTOR_OPERATIVO', ['metrics.audit']).path).toBe('/app/metricas');
    expect(defaultWorkspaceRoute('ADMIN', ['*']).path).toBe('/app/metricas');
    expect(getWorkspaceRoutes('ADMIN', ['*']).map((route) => route.path)).toEqual([
      '/app/metricas',
      '/app/usuarios',
      '/app/perfiles',
      '/app/asignaciones',
      '/app/turnos',
      '/app/seguridad',
      '/app/acceso-ip',
      '/app/auditoria',
    ]);
  });

  it('filters routes by effective permission', () => {
    const routes = getWorkspaceRoutes('ADMIN', ['metrics.audit', 'audit.read']);

    expect(routes.map((route) => route.path)).toEqual(['/app/metricas', '/app/auditoria']);
  });

  it('keeps pending cafeteria pages visible without granting APIs', () => {
    const routes = getWorkspaceRoutes('CAFETERIA', ['cafeteria.manage']);

    expect(routes.filter((route) => route.pending).map((route) => route.path)).toEqual(['/app/ventas', '/app/inventario']);
    expect(routes.find((route) => route.path === '/app/ventas')?.permission).toBeUndefined();
  });

  it('resolves unknown and forbidden paths to the role default', () => {
    expect(resolveWorkspaceRoute('OPERADOR', ['profiles.read'], '/app/metricas').path).toBe('/app/perfiles');
    expect(resolveWorkspaceRoute('ADMIN', ['*'], '/app/no-existe').path).toBe('/app/metricas');
  });
});
