import type { ReactNode } from 'react';
import type { UserSummary } from '@agency-os/shared';
import { BrandMark } from '../BrandMark/BrandMark';
import { MobileNav } from './MobileNav';
import { UserMenu } from './UserMenu';
import { roleLabels, type RoleCode } from '../../types/roles';
import { groupWorkspaceRoutes, isPlainLeftClick, type WorkspaceRoute } from '../../navigation/workspace-navigation';

interface AppShellProps {
  role: RoleCode;
  user: UserSummary;
  navigation: readonly WorkspaceRoute[];
  activeRoute: WorkspaceRoute;
  showDate?: boolean;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

function todayLabel(): string {
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
}

export function AppShell({ role, user, navigation, activeRoute, showDate, onNavigate, onLogout, children }: AppShellProps) {
  const groups = groupWorkspaceRoutes(navigation);

  function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>, path: string) {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    onNavigate(path);
  }

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="Navegación principal">
        <div className="workspace-sidebar__body">
          <a
            href="/"
            className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1 text-left transition-all hover:bg-white/[0.06] active:scale-[0.99]"
            onClick={(event) => handleLinkClick(event, '/')}
          >
            <BrandMark className="h-9 w-9" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-semibold text-zinc-100">Agency OS</span>
              <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium text-zinc-400">TEAM</span>
            </span>
          </a>

          <div className="workspace-sidebar__role">
            <span className="sidebar-label">Sesión actual</span>
            <strong>{user.fullName}</strong>
            <span className="sidebar-role-label">{roleLabels[role]}</span>
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
        </div>
      </aside>

      <main className="workspace-main">
        <MobileNav
          navigation={navigation}
          activeRoute={activeRoute}
          onNavigate={onNavigate}
          userMenu={<UserMenu user={user} role={role} onLogout={onLogout} variant="initials" />}
        />

        <div className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>Agency OS</span><b>/</b><span>{activeRoute.label}</span></div>

          <div className="ml-auto flex items-center gap-3 self-end sm:self-auto">
            {showDate && (
              <div className="hidden items-center gap-2 text-xs font-medium text-zinc-500 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                <span>{todayLabel()}</span>
              </div>
            )}

            <UserMenu user={user} role={role} onLogout={onLogout} />
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
