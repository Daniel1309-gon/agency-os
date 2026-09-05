import type { OperatorStatusSnapshot } from '@agency-os/shared';
import { StatusPill } from '../StatusPill/StatusPill';
import { operatorStatusCopy } from './operator-status-view';

interface TeamOverviewProps {
  statuses: OperatorStatusSnapshot[];
  isLoading: boolean;
  isRealtime: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatChangedAt(changedAt: string | null): string {
  if (!changedAt) return 'Derivado de la sesión';
  return `Actualizado ${new Date(changedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
}

export function TeamOverview({ statuses, isLoading, isRealtime, error, onRefresh }: TeamOverviewProps) {
  return (
    <section className="panel team-panel" id="section-01">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Estado de la cuadrilla · {isRealtime ? 'actualización en vivo' : 'último snapshot'}</p>
          <h2>Semáforo de operadores</h2>
        </div>
        <button className="quiet-button" type="button" onClick={() => void onRefresh()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>

      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {isLoading && <p className="panel-state">Cargando estados operativos…</p>}
      {!isLoading && !statuses.length && <p className="panel-state">No hay operadores visibles en tu alcance.</p>}
      {!isLoading && statuses.length > 0 && <div className="team-table" role="table" aria-label="Estado de operadores">
        <div className="team-table__head" role="row">
          <span>Persona</span><span>Estado</span><span>Señal</span><span>Actualización</span><span aria-hidden="true" />
        </div>
        {statuses.map((operator) => {
          const copy = operatorStatusCopy(operator.status);
          const initials = operator.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
          return <div className="team-table__row" role="row" key={operator.operatorId}>
            <div className="team-member" role="cell"><span className="profile-avatar profile-avatar--small">{initials}</span><span><strong>{operator.fullName}</strong><small>Operadora</small></span></div>
            <span role="cell"><StatusPill status={operator.status.toLowerCase() as 'online' | 'break' | 'alert' | 'offline'} label={copy.label} /></span>
            <span className="team-muted" role="cell">{copy.explanation}</span>
            <span className="team-muted" role="cell">{formatChangedAt(operator.changedAt)}</span>
            <span className="row-more row-more--static" aria-hidden="true">{operator.status === 'ALERT' ? '!' : '·'}</span>
          </div>
        })}
      </div>}
    </section>
  );
}
