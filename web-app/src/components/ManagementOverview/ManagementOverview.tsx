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

      </>}
    </div>
  );
}
