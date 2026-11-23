import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  metricReconciliationRowSchema,
  operationalMetricsSchema,
  profileRankingRowSchema,
  profileTimeseriesPointSchema,
  type MetricReconciliationRow,
  type OperationalMetrics,
  type ProfileRankingRow,
  type ProfileTimeseriesPoint,
  type UserSummary,
} from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { MetricCard } from '../MetricCard/MetricCard';
import { localDateString } from '../OperationsManagement/management-view';
import {
  buildMetricsRangeQuery,
  canViewGlobalReconciliation,
  defaultMetricsWindow,
  formatResponseRate,
  reconciliationStatusLabel,
} from './metrics-view';

/** A7 (FR-20 / MET-07): KPIs operativos, ranking por perfil, serie diaria y conciliación por audiencia. */
export function ManagementOverview({ accessToken, user }: { accessToken: string | null; user: UserSummary }) {
  const initialWindow = useMemo(() => defaultMetricsWindow(localDateString(), 7), []);
  const showReconciliation = canViewGlobalReconciliation(user.role);
  const [from, setFrom] = useState(initialWindow.from);
  const [to, setTo] = useState(initialWindow.to);
  const [metrics, setMetrics] = useState<OperationalMetrics | null>(null);
  const [ranking, setRanking] = useState<ProfileRankingRow[]>([]);
  const [reconciliation, setReconciliation] = useState<MetricReconciliationRow[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRankingRow | null>(null);
  const [timeseries, setTimeseries] = useState<ProfileTimeseriesPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingSeriesId, setLoadingSeriesId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dashboardReqRef = useRef(0);
  const seriesReqRef = useRef(0);

  const loadDashboard = useCallback(async () => {
    const reqId = ++dashboardReqRef.current;
    seriesReqRef.current += 1;
    setLoadingSeriesId(null);
    if (from && to && from > to) {
      setIsLoading(false);
      setError('La fecha inicial debe ser anterior o igual a la fecha final.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [rawOps, rawRanking, rawRecon] = await Promise.all([
        apiClient.request<unknown>('/metrics/operations'),
        apiClient.request<unknown>(buildMetricsRangeQuery('/metrics/ranking', { from, to, limit: 100 })),
        showReconciliation
          ? apiClient.request<unknown>(buildMetricsRangeQuery('/metrics/reconciliation', { from, to, limit: 100 }))
          : Promise.resolve([]),
      ]);
      if (reqId !== dashboardReqRef.current) return;
      setMetrics(operationalMetricsSchema.parse(rawOps));
      setRanking(profileRankingRowSchema.array().parse(rawRanking));
      setReconciliation(showReconciliation ? metricReconciliationRowSchema.array().parse(rawRecon) : []);
      setSelectedProfile(null);
      setTimeseries([]);
    } catch (nextError) {
      if (reqId !== dashboardReqRef.current) return;
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar las métricas operativas.');
    } finally {
      if (reqId === dashboardReqRef.current) setIsLoading(false);
    }
  }, [from, showReconciliation, to]);

  useEffect(() => {
    if (accessToken) void loadDashboard();
  }, [accessToken, loadDashboard]);

  async function inspectProfile(row: ProfileRankingRow) {
    const reqId = ++seriesReqRef.current;
    setLoadingSeriesId(row.profileId);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>(buildMetricsRangeQuery(`/metrics/profiles/${row.profileId}/timeseries`, { from, to, limit: 180 }));
      if (reqId !== seriesReqRef.current) return;
      setTimeseries(profileTimeseriesPointSchema.array().parse(raw));
      setSelectedProfile(row);
    } catch (nextError) {
      if (reqId !== seriesReqRef.current) return;
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar la serie diaria del perfil.');
    } finally {
      if (reqId === seriesReqRef.current) setLoadingSeriesId(null);
    }
  }

  const coverage = metrics && metrics.operatorsScheduled > 0
    ? Math.round((metrics.coveredShifts / metrics.operatorsScheduled) * 100)
    : 0;

  return (
    <div className="management-layout coordinator-layout">
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {!metrics && !error && <p className="panel-state">Cargando métricas operativas…</p>}
      {metrics && (
        <div className="metric-grid metric-grid--four">
          <MetricCard label="Operadores conectados" value={metrics.operatorsOnline.toString().padStart(2, '0')} detail={`${metrics.operatorsScheduled} posiciones programadas`} accent="blue" direction="steady" />
          <MetricCard label="Sesiones activas" value={metrics.activeSessions.toString().padStart(2, '0')} detail="Perfiles en LAUNCHING o ACTIVE" accent="navy" direction="steady" />
          <MetricCard label="Cobertura de turnos" value={`${coverage}%`} detail={`${metrics.coveredShifts} de ${metrics.operatorsScheduled} cubiertas`} accent="orange" direction={coverage >= 90 ? 'up' : 'down'} />
          <MetricCard label="Pedidos pendientes" value={metrics.pendingOrders.toString().padStart(2, '0')} detail="En cola de cafetería" accent="blue" direction={metrics.pendingOrders ? 'up' : 'steady'} />
        </div>
      )}

      <section className="panel management-panel" id="metrics-profiles" aria-labelledby="metrics-profiles-title">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">{showReconciliation ? 'Alcance global · Extensión' : 'Alcance de tu cuadrilla · Extensión'}</p>
            <h2 id="metrics-profiles-title">Rendimiento por perfil</h2>
          </div>
          <button className="quiet-button" type="button" onClick={() => void loadDashboard()} disabled={isLoading}>
            Actualizar <span aria-hidden="true">↻</span>
          </button>
        </header>

        <div className="management-form__grid">
          <label><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>

        {isLoading ? (
          <p className="empty-state">Cargando rendimiento por perfil…</p>
        ) : ranking.length === 0 ? (
          <p className="empty-state">No hay métricas registradas para este rango de fechas.</p>
        ) : (
          <div className="management-table metrics-six-col-table" role="table" aria-label="Rendimiento por perfil">
            <div className="management-table__head" role="row">
              <span role="columnheader">Perfil</span>
              <span role="columnheader">Puntos</span>
              <span role="columnheader">Mensajes</span>
              <span role="columnheader">Respuestas</span>
              <span role="columnheader">Tasa</span>
              <span role="columnheader">Detalle</span>
            </div>
            {ranking.map((row) => (
              <div className="management-table__row" role="row" key={row.profileId}>
                <span role="cell"><strong>{row.displayName}</strong></span>
                <span role="cell">{Number(row.points).toFixed(2)}</span>
                <span role="cell">{row.messagesSent}</span>
                <span role="cell">{row.responses}</span>
                <span role="cell">{formatResponseRate(row.responseRate)}</span>
                <span role="cell" className="management-table__actions">
                  <button className="quiet-button" type="button" onClick={() => void inspectProfile(row)} disabled={loadingSeriesId === row.profileId}>
                    {loadingSeriesId === row.profileId ? 'Cargando…' : 'Ver serie'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {selectedProfile && (
          <div className="management-subpanel" aria-live="polite">
            <h3>Serie diaria · {selectedProfile.displayName}</h3>
            {timeseries.length === 0 ? (
              <p className="empty-state">Sin puntos diarios para este perfil en el rango.</p>
            ) : (
              <div className="management-table" role="table" aria-label={`Serie diaria de ${selectedProfile.displayName}`}>
                <div className="management-table__head" role="row">
                  <span role="columnheader">Fecha</span>
                  <span role="columnheader">Fuente</span>
                  <span role="columnheader">Puntos</span>
                  <span role="columnheader">Mensajes / Resp.</span>
                  <span role="columnheader">Icebreakers</span>
                </div>
                {timeseries.map((point) => (
                  <div className="management-table__row" role="row" key={`${point.businessDate}-${point.source}`}>
                    <span role="cell">{point.businessDate}</span>
                    <span role="cell"><span className="status-pill">{point.source}</span></span>
                    <span role="cell">{Number(point.points).toFixed(2)}</span>
                    <span role="cell">{point.messagesSent} / {point.responses} ({formatResponseRate(point.responseRate)})</span>
                    <span role="cell">{point.icebreakersSent} / {point.icebreakersReplied}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {showReconciliation && (
        <section className="panel management-panel" id="metrics-reconciliation" aria-labelledby="metrics-reconciliation-title">
          <header className="panel-header">
            <div>
              <p className="panel-kicker">Auditoría de fuentes · Extensión vs Tableau</p>
              <h2 id="metrics-reconciliation-title">Conciliación de puntos</h2>
            </div>
          </header>
          {reconciliation.length === 0 ? (
            <p className="empty-state">No hay registros de conciliación en este rango.</p>
          ) : (
            <div className="management-table metrics-six-col-table" role="table" aria-label="Conciliación de puntos">
              <div className="management-table__head" role="row">
                <span role="columnheader">Fecha</span>
                <span role="columnheader">Perfil</span>
                <span role="columnheader">Extensión</span>
                <span role="columnheader">Tableau</span>
                <span role="columnheader">Diferencia</span>
                <span role="columnheader">Estado</span>
              </div>
              {reconciliation.map((row) => (
                <div className="management-table__row" role="row" key={row.id}>
                  <span role="cell">{row.businessDate}</span>
                  <span role="cell"><strong>{row.displayName ?? row.profileId.slice(0, 8)}</strong></span>
                  <span role="cell">{Number(row.extensionPoints).toFixed(2)}</span>
                  <span role="cell">{Number(row.tableauPoints).toFixed(2)}</span>
                  <span role="cell">{Number(row.differencePoints).toFixed(2)}</span>
                  <span role="cell"><span className={`status-pill${row.status === 'OK' ? '' : ' status-pill--quiet'}`}>{reconciliationStatusLabel(row.status)}</span></span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
