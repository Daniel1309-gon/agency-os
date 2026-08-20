import { useEffect, useState } from 'react';
import { operationalMetricsSchema, type OperationalMetrics } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { MetricCard } from '../MetricCard/MetricCard';

export function ManagementOverview({ accessToken }: { accessToken: string | null }) {
  const [metrics, setMetrics] = useState<OperationalMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void apiClient.request<unknown>('/metrics/operations')
      .then((raw) => setMetrics(operationalMetricsSchema.parse(raw)))
      .catch((nextError) => setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar las métricas operativas.'));
  }, [accessToken]);

  const coverage = metrics && metrics.operatorsScheduled > 0
    ? Math.round((metrics.coveredShifts / metrics.operatorsScheduled) * 100)
    : 0;

  return (
    <div className="management-layout">
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {!metrics && !error && <p className="panel-state">Cargando métricas operativas…</p>}
      {metrics && <>
        <div className="metric-grid metric-grid--four">
          <MetricCard label="Operadores conectados" value={metrics.operatorsOnline.toString().padStart(2, '0')} detail={`${metrics.operatorsScheduled} posiciones programadas`} accent="blue" direction="steady" />
          <MetricCard label="Sesiones activas" value={metrics.activeSessions.toString().padStart(2, '0')} detail="Perfiles en LAUNCHING o ACTIVE" accent="navy" direction="steady" />
          <MetricCard label="Cobertura de turnos" value={`${coverage}%`} detail={`${metrics.coveredShifts} de ${metrics.operatorsScheduled} cubiertas`} accent="orange" direction={coverage >= 90 ? 'up' : 'down'} />
          <MetricCard label="Pedidos pendientes" value={metrics.pendingOrders.toString().padStart(2, '0')} detail="En cola de cafetería" accent="blue" direction={metrics.pendingOrders ? 'up' : 'steady'} />
        </div>

        <div className="management-grid">
          <section className="panel chart-panel" id="section-01">
            <header className="panel-header"><div><p className="panel-kicker">Lectura operativa · ahora</p><h2>Estado de la operación</h2></div><span className="live-indicator"><i /> En vivo</span></header>
            <div className="operation-summary-grid">
              <div><span>Conexiones</span><strong>{metrics.operatorsOnline} operadores</strong><small>con actividad detectada</small></div>
              <div><span>Sesiones</span><strong>{metrics.activeSessions} perfiles</strong><small>lanzamiento o sesión activa</small></div>
              <div><span>Cobertura</span><strong>{coverage}%</strong><small>de los turnos vigentes</small></div>
              <div><span>Cafetería</span><strong>{metrics.pendingOrders} pedidos</strong><small>requieren seguimiento</small></div>
            </div>
          </section>

          <aside className="panel activity-panel" id="section-02">
            <header className="panel-header"><div><p className="panel-kicker">Fuente de datos</p><h2>Semáforo operativo</h2></div><span className="live-indicator"><i /> Actualizado</span></header>
            <div className="activity-list">
              <div className="activity-item"><span className="activity-item__dot activity-item__dot--blue" /><div><strong>Sesiones</strong><span>{metrics.activeSessions ? 'Hay perfiles en operación' : 'Sin sesiones activas'}</span></div><time>Ahora</time></div>
              <div className="activity-item"><span className={`activity-item__dot activity-item__dot--${coverage >= 90 ? 'blue' : 'orange'}`} /><div><strong>Cobertura de turnos</strong><span>{coverage >= 90 ? 'Dentro del objetivo operativo' : 'Requiere atención'}</span></div><time>Ahora</time></div>
              <div className="activity-item"><span className={`activity-item__dot activity-item__dot--${metrics.pendingOrders ? 'orange' : 'navy'}`} /><div><strong>Pedidos</strong><span>{metrics.pendingOrders ? 'Hay pedidos en la cola KDS' : 'Cola despejada'}</span></div><time>Ahora</time></div>
            </div>
          </aside>
        </div>

        <section className="operation-strip" id="section-03">
          <div><span className="operation-strip__icon">◈</span><span><strong>Datos operativos de Entrega 1</strong><small>Tableau, revenue e históricos de icebreakers quedan para Entrega 2.</small></span></div>
          <span className="status-pill status-pill--active"><i aria-hidden="true" />Operativa</span>
        </section>
      </>}
    </div>
  );
}
