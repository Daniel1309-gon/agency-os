import { useCallback, useEffect, useState } from 'react';
import type { UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { errorMessage } from './management-view';
import {
  canExportPayroll,
  defaultExportFilename,
  formatPayrollCop,
  payrollLineRecordSchema,
  payrollPeriodRecordSchema,
  payrollStatusLabel,
  type PayrollLineRecord,
  type PayrollPeriodRecord,
} from './payroll-view';

interface PayrollManagementProps {
  accessToken: string | null;
  user: UserSummary;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A12 (FR-31): listado de periodos de nómina, detalle de líneas y descarga Excel (.xlsx). */
export function PayrollManagement({ accessToken, user }: PayrollManagementProps) {
  const [periods, setPeriods] = useState<PayrollPeriodRecord[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriodRecord | null>(null);
  const [lines, setLines] = useState<PayrollLineRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLinesId, setLoadingLinesId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const allowExport = canExportPayroll(user.permissions);

  const loadPeriods = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/payroll/periods');
      setPeriods(payrollPeriodRecordSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar los periodos de nómina.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadPeriods();
  }, [accessToken, loadPeriods]);

  async function inspectPeriod(period: PayrollPeriodRecord) {
    setLoadingLinesId(period.id);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>(`/payroll/periods/${period.id}/lines`);
      setLines(payrollLineRecordSchema.array().parse(raw));
      setSelectedPeriod(period);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar las líneas del periodo.'));
    } finally {
      setLoadingLinesId(null);
    }
  }

  async function exportExcel(period: PayrollPeriodRecord) {
    setExportingId(period.id);
    setError(null);
    setNotice(null);
    try {
      const { blob, filename } = await apiClient.requestBlob(`/payroll/periods/${period.id}/export`);
      const resolvedFilename = filename ?? defaultExportFilename(period);
      triggerBrowserDownload(blob, resolvedFilename);
      setNotice(`Archivo ${resolvedFilename} descargado correctamente.`);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos exportar la nómina a Excel.'));
    } finally {
      setExportingId(null);
    }
  }

  return (
    <section className="panel management-panel" id="payroll" aria-labelledby="payroll-title">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Liquidación · FR-31</p>
          <h2 id="payroll-title">Periodos de nómina</h2>
        </div>
        <button className="quiet-button" type="button" onClick={() => void loadPeriods()} disabled={isLoading}>
          Actualizar <span aria-hidden="true">↻</span>
        </button>
      </header>

      <p className="management-panel__note">
        Consulta los periodos liquidados y descarga el archivo Excel oficial (.xlsx) con el resumen del periodo, ajustes y descuentos de cafetería.
      </p>

      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {isLoading ? (
        <p className="empty-state">Cargando periodos de nómina…</p>
      ) : periods.length === 0 ? (
        <p className="empty-state">No hay periodos de nómina registrados todavía.</p>
      ) : (
        <div className="management-table" role="table" aria-label="Periodos de nómina">
          <div className="management-table__head" role="row">
            <span role="columnheader">Periodo</span>
            <span role="columnheader">Rango</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader">Acciones</span>
          </div>
          {periods.map((period) => (
            <div className="management-table__row" role="row" key={period.id}>
              <span role="cell"><strong>{period.name}</strong></span>
              <span role="cell">{period.startsOn} → {period.endsOn}</span>
              <span role="cell"><span className="status-pill">{payrollStatusLabel(period.status)}</span></span>
              <span role="cell" className="management-table__actions">
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => void inspectPeriod(period)}
                  disabled={loadingLinesId === period.id}
                >
                  {loadingLinesId === period.id ? 'Cargando…' : 'Ver líneas'}
                </button>
                {allowExport && (
                  <button
                    className="primary-button primary-button--compact"
                    type="button"
                    onClick={() => void exportExcel(period)}
                    disabled={exportingId === period.id}
                  >
                    {exportingId === period.id ? 'Exportando…' : 'Exportar Excel (.xlsx)'}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {selectedPeriod && (
        <div className="management-subpanel" aria-live="polite">
          <h3>Líneas calculadas · {selectedPeriod.name}</h3>
          {lines.length === 0 ? (
            <p className="empty-state">Este periodo no tiene líneas calculadas todavía.</p>
          ) : (
            <div className="management-table" role="table" aria-label={`Líneas de ${selectedPeriod.name}`}>
              <div className="management-table__head" role="row">
                <span role="columnheader">Operador</span>
                <span role="columnheader">Puntos</span>
                <span role="columnheader">Neto COP</span>
                <span role="columnheader">Cafetería COP</span>
                <span role="columnheader">Estado</span>
              </div>
              {lines.map((line) => (
                <div className="management-table__row" role="row" key={line.id}>
                  <span role="cell"><code>{line.operatorId.slice(0, 8)}</code></span>
                  <span role="cell">{Number(line.pointsTotal).toFixed(2)}</span>
                  <span role="cell">{formatPayrollCop(line.netCop)}</span>
                  <span role="cell">{formatPayrollCop(line.cafeteriaDebitCop ?? '0')}</span>
                  <span role="cell">{line.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
