import type { UserSummary } from '@agency-os/shared';
import { AppShell } from '../../components/AppShell/AppShell';
import { CafeteriaOverview } from '../../components/CafeteriaOverview/CafeteriaOverview';
import { ManagementOverview } from '../../components/ManagementOverview/ManagementOverview';
import { MetricCard } from '../../components/MetricCard/MetricCard';
import { OperatorCafeteriaPanel } from '../../components/OperatorCafeteriaPanel/OperatorCafeteriaPanel';
import { OperatorProfiles } from '../../components/OperatorProfiles/OperatorProfiles';
import { TeamOverview } from '../../components/TeamOverview/TeamOverview';
import { roleDescriptions, roleLabels, type RoleCode } from '../../types/roles';

interface DashboardPageProps {
  user: UserSummary;
  accessToken: string | null;
  onLogout: () => void;
}

const pageCopy: Record<RoleCode, { kicker: string; title: string; description: string }> = {
  OPERADOR: { kicker: 'Operación personal', title: 'Tu jornada, en orden.', description: roleDescriptions.OPERADOR },
  COORDINADOR: { kicker: 'Vista de coordinación', title: 'Tu equipo, en movimiento.', description: roleDescriptions.COORDINADOR },
  CAFETERIA: { kicker: 'Punto de cafetería', title: 'El pulso del día.', description: roleDescriptions.CAFETERIA },
  DIRECTOR_OPERATIVO: { kicker: 'Dirección operativa', title: 'La operación de un vistazo.', description: roleDescriptions.DIRECTOR_OPERATIVO },
  ADMIN: { kicker: 'Control central', title: 'Todo bajo control.', description: roleDescriptions.ADMIN },
};

function OperatorWorkspace({ accessToken }: { accessToken: string | null }) {
  return (
    <div className="operator-layout">
      <section className="shift-banner">
        <div className="shift-banner__copy"><p className="panel-kicker">Turno actual · martes 18 de agosto</p><h2>06:05 — 14:05</h2><p>Te quedan 4 h 20 min. El próximo relevo está programado para las 14:05.</p></div>
        <div className="shift-banner__status"><span className="shift-clock">09:45</span><span className="status-pill status-pill--active"><i aria-hidden="true" />En curso</span></div>
      </section>
      <div className="metric-grid metric-grid--three">
        <MetricCard label="Perfiles asociados" value="04" detail="2 sesiones activas ahora" accent="blue" direction="steady" />
        <MetricCard label="Mensajes respondidos" value="186" detail="+14% vs. tu turno anterior" accent="navy" direction="up" />
        <MetricCard label="Meta del turno" value="78%" detail="Faltan 22 puntos para completar" accent="orange" direction="up" />
      </div>
      <div className="operator-grid"><OperatorProfiles accessToken={accessToken} /><aside className="panel next-panel" id="section-02"><p className="panel-kicker">Siguiente evento</p><h2>Relevo de perfil</h2><div className="next-event"><span className="next-event__time">14:05</span><div><strong>Turno vigente</strong><span>La plataforma cerrará la sesión al finalizar.</span></div></div><p className="next-panel__note">No compartas credenciales. La extensión prepara el perfil y tú haces el clic final en TalkyTimes.</p><button className="primary-button primary-button--full" type="button">Ver detalle del turno <span aria-hidden="true">↗</span></button></aside></div>
      <OperatorCafeteriaPanel accessToken={accessToken} />
    </div>
  );
}

function CoordinatorWorkspace() {
  return <div className="coordinator-layout"><div className="metric-grid metric-grid--three"><MetricCard label="Cobertura actual" value="92%" detail="11 de 12 posiciones cubiertas" accent="blue" direction="up" /><MetricCard label="Equipo conectado" value="3 / 4" detail="1 persona inicia a las 14:05" accent="navy" direction="steady" /><MetricCard label="Alertas pendientes" value="02" detail="Requieren revisión hoy" accent="orange" direction="down" /></div><TeamOverview /><section className="coord-callout"><span className="coord-callout__mark">!</span><div><strong>Una acción para tu turno</strong><p>Confirma el relevo de Nube 03 antes de las 13:45 para mantener la cobertura continua.</p></div><button className="row-action" type="button">Revisar <span aria-hidden="true">↗</span></button></section></div>;
}

export default function DashboardPage({ user, accessToken: _accessToken, onLogout }: DashboardPageProps) {
  const role: RoleCode = user.role;
  const copy = pageCopy[role];
  const isManagement = role === 'ADMIN' || role === 'DIRECTOR_OPERATIVO';

  return (
    <AppShell role={role} user={user} onLogout={onLogout}>
      <div className="dashboard-content">
        <header className="dashboard-header">
          <div><p className="dashboard-eyebrow">{copy.kicker} <span>/</span> {roleLabels[role]}</p><h1>{copy.title}</h1><p>{copy.description}</p></div>
          <div className="dashboard-date"><span className="dashboard-date__dot" />Martes, 18 ago 2026</div>
        </header>
        {role === 'OPERADOR' && <OperatorWorkspace accessToken={_accessToken} />}
        {role === 'COORDINADOR' && <CoordinatorWorkspace />}
        {role === 'CAFETERIA' && <CafeteriaOverview accessToken={_accessToken} />}
        {isManagement && <ManagementOverview accessToken={_accessToken} />}
      </div>
    </AppShell>
  );
}
