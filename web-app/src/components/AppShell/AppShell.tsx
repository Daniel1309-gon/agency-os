import type { ReactNode } from 'react';
import type { UserSummary } from '@agency-os/shared';
import { BrandMark } from '../BrandMark/BrandMark';
import { roleLabels, type RoleCode } from '../../types/roles';
import type { WorkspaceRoute } from '../../navigation/workspace-navigation';

interface AppShellProps {
  role: RoleCode;
  user: UserSummary;
  navigation: readonly WorkspaceRoute[];
  activeRoute: WorkspaceRoute;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

function groupedRoutes(navigation: readonly WorkspaceRoute[]): Array<[string, WorkspaceRoute[]]> {
  const groups = new Map<string, WorkspaceRoute[]>();
  for (const route of navigation) groups.set(route.group, [...(groups.get(route.group) ?? []), route]);
  return [...groups.entries()];
}

function shouldHandleLink(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function AppShell({ role, user, navigation, activeRoute, onNavigate, onLogout, children }: AppShellProps) {
  const groups = groupedRoutes(navigation);

  function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>, path: string) {
    if (!shouldHandleLink(event)) return;
    event.preventDefault();
    onNavigate(path);
  }

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

          <nav className="workspace-nav" aria-label="Secciones del workspace">
            {groups.map(([group, routes]) => <div className="workspace-nav__group" key={group}>
              {groups.length > 1 && <span className="sidebar-label workspace-nav__group-label">{group}</span>}
              {routes.map((route) => <a className={route.path === activeRoute.path ? 'workspace-nav__item is-active' : 'workspace-nav__item'} href={route.path} key={route.id} aria-current={route.path === activeRoute.path ? 'page' : undefined} onClick={(event) => handleLinkClick(event, route.path)}>
                <span>{route.label}</span>
                {route.pending && <small className="workspace-nav__status">Pendiente</small>}
              </a>)}
            </div>)}
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

        <nav className="workspace-mobile-nav" aria-label="Secciones del workspace">
          <label htmlFor="workspace-page-select">Sección actual</label>
          <select id="workspace-page-select" value={activeRoute.path} onChange={(event) => onNavigate(event.target.value)}>
            {groups.map(([group, routes]) => <optgroup label={group} key={group}>
              {routes.map((route) => <option value={route.path} key={route.id}>{route.label}{route.pending ? ' · Pendiente' : ''}</option>)}
            </optgroup>)}
          </select>
        </nav>

        <div className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>Agency OS</span><b>/</b><span>{activeRoute.label}</span></div>
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
