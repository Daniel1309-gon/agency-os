import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiClient } from '../../services/api-client';
import { MetricCard } from '../MetricCard/MetricCard';
import { formatPeriodRange, payrollPeriodStatusCopy, summaryNotice, type OperatorPayrollPeriod, type OperatorPayrollSummary } from './operator-payroll-view';

function formatCop(value: string): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value));
}

function formatPoints(value: string): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(value));
}

/**
 * FR-28: the operator sees their points after commission and the net COP for a period.
 * The server never sends raw points, gross COP, the rate or the commission.
 */
export function OperatorPayrollPanel({ accessToken }: { accessToken: string | null }) {
  const [periods, setPeriods] = useState<OperatorPayrollPeriod[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [summary, setSummary] = useState<OperatorPayrollSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async (periodId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const query = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
      const next = await apiClient.request<OperatorPayrollSummary>(`/payroll/me/summary${query}`);
      setSummary(next);
      if (!periodId && next.periodId) setSelectedId(next.periodId);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar tu nómina.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    apiClient.request<OperatorPayrollPeriod[]>('/payroll/me/periods')
      .then(setPeriods)
      .catch(() => setError('No pudimos cargar los periodos de nómina.'));
    // No period selected: the server answers for the period in course today.
    void loadSummary('');
  }, [accessToken, loadSummary]);

  function selectPeriod(periodId: string) {
    setSelectedId(periodId);
    void loadSummary(periodId);
  }

  const period = periods.find((item) => item.id === (summary?.periodId ?? selectedId));
  const notice = summary ? summaryNotice(summary) : null;

  return (
    <section className="panel operator-payroll" id="section-04" aria-labelledby="operator-payroll-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Puntos y pago</p><h2 id="operator-payroll-title">Mi nómina</h2></div>
        <button className="quiet-button" type="button" onClick={() => void loadSummary(selectedId)} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>
      {periods.length > 0 && (
        <label className="operator-payroll__period">
          <span>Periodo</span>
          <select value={selectedId} onChange={(event) => selectPeriod(event.target.value)}>
            {!selectedId && <option value="">Periodo en curso</option>}
            {periods.map((item) => <option key={item.id} value={item.id}>{item.name} · {payrollPeriodStatusCopy(item.status)}</option>)}
          </select>
        </label>
      )}
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {isLoading && <p className="panel-state">Cargando tu nómina…</p>}
      {!isLoading && summary && (
        <>
          {period && <p className="panel-state">{period.name} · {formatPeriodRange(period.startsOn, period.endsOn)} · {payrollPeriodStatusCopy(period.status)}</p>}
          {notice && <p className="form-notice" role="status">{notice}</p>}
          {!notice && (
            <div className="operator-payroll__figures">
              <MetricCard label="Mis puntos" value={formatPoints(summary.points)} detail="Puntos del periodo según tu comisión." accent="navy" />
              <MetricCard label="Mi pago estimado" value={formatCop(summary.netCop)} detail="Valor en COP antes de descontar cafetería y ajustes." accent="blue" />
            </div>
          )}
          <p className="panel-state">Las cifras se actualizan con los datos de Tableau del día anterior. El valor final es el del periodo liquidado.</p>
        </>
      )}
    </section>
  );
}
