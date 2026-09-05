import { useEffect, useRef, type ReactNode } from 'react';
import type { UserSummary } from '@agency-os/shared';
import { AppShell } from '../../components/AppShell/AppShell';
import { CafeteriaKds } from '../../components/CafeteriaKds/CafeteriaKds';
import { CafeteriaOverview } from '../../components/CafeteriaOverview/CafeteriaOverview';
import { ManagementOverview } from '../../components/ManagementOverview/ManagementOverview';
import { MetricCard } from '../../components/MetricCard/MetricCard';
import { OperatorCafeteriaPanel } from '../../components/OperatorCafeteriaPanel/OperatorCafeteriaPanel';
import { OperatorProfiles } from '../../components/OperatorProfiles/OperatorProfiles';
import { OperatorShiftPanel } from '../../components/OperatorShift/OperatorShiftPanel';
import { AssignmentManagement } from '../../components/OperationsManagement/AssignmentManagement';
import { ProfileManagement } from '../../components/OperationsManagement/ProfileManagement';
import { ShiftManagement } from '../../components/OperationsManagement/ShiftManagement';
import { UserManagement } from '../../components/OperationsManagement/UserManagement';
import { AuditLogPanel } from '../../components/SecurityManagement/AuditLogPanel';
import { IpAllowlistPanel } from '../../components/SecurityManagement/IpAllowlistPanel';
import { SecurityOverview } from '../../components/SecurityManagement/SecurityOverview';
import { TeamOverview } from '../../components/TeamOverview/TeamOverview';
import { useOperatorStatuses } from '../../components/TeamOverview/use-operator-statuses';
import { roleLabels, type RoleCode } from '../../types/roles';
import { getWorkspaceRoutes, resolveWorkspaceRoute, type WorkspaceRoute } from '../../navigation/workspace-navigation';

interface DashboardPageProps {
  user: UserSummary;
  accessToken: string | null;
  pathname: string;
  onNavigate: (path: string) => void;
  onReplace: (path: string) => void;
  onLogout: () => void;
}

interface WorkspaceContentProps {
  route: WorkspaceRoute;
  accessToken: string | null;
  user: UserSummary;
  onNavigate: (path: string) => void;
}

function CoordinatorTeamPage({ accessToken }: { accessToken: string | null }) {
  const { statuses, isLoading, isRealtime, error, refresh } = useOperatorStatuses(accessToken);
  const visibleCount = statuses.length;
  const connectedCount = statuses.filter((operator) => operator.status !== 'OFFLINE').length;
  const coveredCount = statuses.filter((operator) => operator.status === 'ONLINE' || operator.status === 'BREAK').length;
  const alertCount = statuses.filter((operator) => operator.status === 'ALERT').length;
  const coverage = visibleCount ? Math.round((coveredCount / visibleCount) * 100) : 0;
  const firstAlert = statuses.find((operator) => operator.status === 'ALERT');

  return <div className="coordinator-layout">
    <div className="metric-grid metric-grid--three">
      <MetricCard label="Cobertura actual" value={isLoading ? '—' : `${coverage}%`} detail={isLoading ? 'Calculando estados visibles' : `${coveredCount} de ${visibleCount} operadores activos`} accent="blue" direction={coverage >= 90 ? 'up' : coverage ? 'down' : 'steady'} />
      <MetricCard label="Equipo conectado" value={isLoading ? '—' : `${connectedCount} / ${visibleCount}`} detail={isRealtime ? 'Actualización en tiempo real' : 'Último snapshot disponible'} accent="navy" direction="steady" />
      <MetricCard label="Alertas pendientes" value={isLoading ? '—' : alertCount.toString().padStart(2, '0')} detail={alertCount ? 'Requieren seguimiento hoy' : 'Sin alertas activas'} accent="orange" direction={alertCount ? 'down' : 'steady'} />
    </div>
    <TeamOverview statuses={statuses} isLoading={isLoading} isRealtime={isRealtime} error={error} onRefresh={refresh} />
    <section className="coord-callout" aria-live="polite">
      <span className="coord-callout__mark" aria-hidden="true">{firstAlert ? '!' : '✓'}</span>
      <div>
        <strong>{firstAlert ? `Seguimiento prioritario · ${firstAlert.fullName}` : 'Operación estable'}</strong>
        <p>{firstAlert ? 'Revisa la alerta registrada antes de asignar el siguiente relevo.' : 'El semáforo no registra alertas activas en tu cuadrilla.'}</p>
      </div>
      <button className="row-action" type="button" onClick={() => void refresh()} disabled={isLoading}>{isLoading ? 'Actualizando…' : 'Actualizar'} <span aria-hidden="true">↻</span></button>
    </section>
  </div>;
}

function PendingWorkspacePage({ route, onNavigate }: { route: WorkspaceRoute; onNavigate: (path: string) => void }) {
  const fallbackPath = route.id === 'cafeteriaSales' ? '/app/pedidos' : '/app/menu';
  const fallbackLabel = route.id === 'cafeteriaSales' ? 'Ir a pedidos' : 'Ir al menú';

  return <section className="panel pending-workspace" aria-labelledby="pending-workspace-title">
    <span className="pending-workspace__mark" aria-hidden="true">·</span>
    <div>
      <p className="panel-kicker">{route.kicker}</p>
      <h2 id="pending-workspace-title">{route.title}</h2>
      <p>{route.description}</p>
      <span className="status-pill status-pill--quiet">Disponible más adelante</span>
      <a className="primary-button primary-button--compact" href={fallbackPath} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(fallbackPath);
      }}>{fallbackLabel} <span aria-hidden="true">↗</span></a>
    </div>
  </section>;
}

function WorkspaceContent({ route, accessToken, user, onNavigate }: WorkspaceContentProps): ReactNode {
  if (route.pending) return <PendingWorkspacePage route={route} onNavigate={onNavigate} />;

  switch (route.id) {
    case 'operatorProfiles': return <OperatorProfiles accessToken={accessToken} />;
    case 'operatorShift': return <OperatorShiftPanel accessToken={accessToken} />;
    case 'operatorCafeteria': return <OperatorCafeteriaPanel accessToken={accessToken} />;
    case 'team': return <CoordinatorTeamPage accessToken={accessToken} />;
    case 'users': return <UserManagement accessToken={accessToken} user={user} />;
    case 'profiles': return <ProfileManagement accessToken={accessToken} user={user} />;
    case 'assignments': return <AssignmentManagement accessToken={accessToken} user={user} />;
    case 'shifts': return <ShiftManagement accessToken={accessToken} user={user} />;
    case 'metrics': return <ManagementOverview accessToken={accessToken} />;
    case 'security': return <SecurityOverview accessToken={accessToken} user={user} />;
    case 'ipAllowlist': return <IpAllowlistPanel accessToken={accessToken} user={user} />;
    case 'audit': return <AuditLogPanel accessToken={accessToken} user={user} />;
    case 'cafeteriaOrders': return <CafeteriaKds accessToken={accessToken} />;
    case 'cafeteriaMenu': return <CafeteriaOverview accessToken={accessToken} />;
  }
}

export default function DashboardPage({ user, accessToken, pathname, onNavigate, onReplace, onLogout }: DashboardPageProps) {
  const role: RoleCode = user.role;
  const navigation = getWorkspaceRoutes(role, user.permissions);
  const activeRoute = resolveWorkspaceRoute(role, user.permissions, pathname);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (pathname !== activeRoute.path) onReplace(activeRoute.path);
  }, [activeRoute.path, onReplace, pathname]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [activeRoute.path]);

  return (
    <AppShell role={role} user={user} navigation={navigation} activeRoute={activeRoute} onNavigate={onNavigate} onLogout={onLogout}>
      <div className={`dashboard-content${activeRoute.longPage ? ' dashboard-content--long' : ''}`}>
        <header className="dashboard-header">
          <div><p className="dashboard-eyebrow">{activeRoute.kicker} <span>/</span> {roleLabels[role]}</p><h1 ref={titleRef} tabIndex={-1}>{activeRoute.title}</h1><p>{activeRoute.description}</p></div>
          {activeRoute.showDate && <div className="dashboard-date"><span className="dashboard-date__dot" />{new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</div>}
        </header>
        <div className="workspace-page-content">
          <WorkspaceContent route={activeRoute} accessToken={accessToken} user={user} onNavigate={onNavigate} />
        </div>
      </div>
    </AppShell>
  );
}
