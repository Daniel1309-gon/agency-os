import type { ReactNode } from 'react';
import type { UserSummary } from '@agency-os/shared';
import { BrandMark } from '../BrandMark/BrandMark';
import { roleLabels, type RoleCode } from '../../types/roles';

interface AppShellProps {
  role: RoleCode;
  user: UserSummary;
  onLogout: () => void;
  children: ReactNode;
}

interface NavigationItem {
  label: string;
  marker: string;
}

const navigationByRole: Record<RoleCode, NavigationItem[]> = {
  OPERADOR: [
    { label: 'Mis perfiles', marker: '01' },
    { label: 'Mi turno', marker: '02' },
  ],
  COORDINADOR: [
    { label: 'Resumen de equipo', marker: '01' },
    { label: 'Turnos y cobertura', marker: '02' },
    { label: 'Perfiles', marker: '03' },
  ],
  CAFETERIA: [
    { label: 'Menú de hoy', marker: '01' },
    { label: 'Ventas', marker: '02' },
    { label: 'Inventario', marker: '03' },
  ],
  DIRECTOR_OPERATIVO: [
    { label: 'Métricas globales', marker: '01' },
    { label: 'Operación', marker: '02' },
    { label: 'Auditoría', marker: '03' },
  ],
  ADMIN: [
    { label: 'Métricas globales', marker: '01' },
    { label: 'Salud del sistema', marker: '02' },
    { label: 'Seguridad', marker: '03' },
  ],
};

export function AppShell({ role, user, onLogout, children }: AppShellProps) {
  const navigation = navigationByRole[role];

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="Navegación principal">
        <div>
          <div className="workspace-brand">
            <BrandMark />
            <div>
              <p className="workspace-brand__name">Agency OS</p>
              <p className="workspace-brand__caption">Zenith Ocean</p>
            </div>
          </div>

          <div className="workspace-sidebar__role">
            <span className="sidebar-label">Sesión actual</span>
            <strong>{user.fullName}</strong>
            <span className="sidebar-role-label">{roleLabels[role]}</span>
            <span className="sidebar-online"><i aria-hidden="true" /> Sistema operativo</span>
          </div>

          <nav className="workspace-nav">
            <span className="sidebar-label">Workspace</span>
            {navigation.map((item, index) => (
              <a className={index === 0 ? 'workspace-nav__item is-active' : 'workspace-nav__item'} href={`#section-${item.marker}`} key={item.marker}>
                <span className="workspace-nav__marker">{item.marker}</span>
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>

        <div className="workspace-sidebar__footer">
          <div className="sidebar-security">
            <span className="sidebar-security__mark">✓</span>
            <span><strong>Acceso protegido</strong><small>Sesión auditada</small></span>
          </div>
          <button className="logout-button" type="button" onClick={onLogout}>Cerrar sesión <span aria-hidden="true">↗</span></button>
        </div>
      </aside>

      <main className="workspace-main">
        <div className="workspace-mobile-bar">
          <div className="workspace-brand">
            <BrandMark />
            <div>
              <p className="workspace-brand__name">Agency OS</p>
              <p className="workspace-brand__caption">{roleLabels[role]}</p>
            </div>
          </div>
          <button className="mobile-logout" type="button" onClick={onLogout} aria-label="Cerrar sesión">↗</button>
        </div>

        <div className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>Agency OS</span><b>/</b><span>{roleLabels[role]}</span></div>
          <div className="workspace-identity" aria-label="Usuario autenticado">
            <span className="workspace-identity__initials" aria-hidden="true">{user.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
            <span>{user.fullName}</span>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
