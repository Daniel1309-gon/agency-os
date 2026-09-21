import { describe, expect, it } from 'vitest';
import { defaultWorkspaceRoute, getWorkspaceRoutes, groupWorkspaceRoutes, isPlainLeftClick, resolveWorkspaceRoute } from './workspace-navigation';

const noModifiers = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

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
      '/app/cuadrillas',
      '/app/turnos',
      '/app/seguridad',
      '/app/acceso-ip',
      '/app/auditoria',
    ]);
  });

  it('hides the crew section from roles without crews.read', () => {
    expect(getWorkspaceRoutes('ADMIN', ['*']).some((route) => route.path === '/app/cuadrillas')).toBe(true);
    expect(getWorkspaceRoutes('COORDINADOR', ['crews.read']).map((route) => route.path)).toContain('/app/cuadrillas');
    expect(getWorkspaceRoutes('OPERADOR', ['profiles.read', 'shifts.read']).map((route) => route.path)).not.toContain('/app/cuadrillas');
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

  it('groups routes in declaration order for the navbar', () => {
    const groups = groupWorkspaceRoutes(getWorkspaceRoutes('ADMIN', ['*']));

    expect(groups.map(([group]) => group)).toEqual(['Operación', 'Control']);
    expect(groups[0][1].map((route) => route.path)).toEqual(['/app/metricas', '/app/usuarios', '/app/perfiles', '/app/asignaciones', '/app/cuadrillas', '/app/turnos']);
    expect(groups[1][1].map((route) => route.path)).toEqual(['/app/seguridad', '/app/acceso-ip', '/app/auditoria']);
  });

  it('intercepts only plain primary clicks so new-tab gestures keep working', () => {
    expect(isPlainLeftClick(noModifiers)).toBe(true);
    expect(isPlainLeftClick({ ...noModifiers, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...noModifiers, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...noModifiers, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...noModifiers, shiftKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...noModifiers, altKey: true })).toBe(false);
  });
});
