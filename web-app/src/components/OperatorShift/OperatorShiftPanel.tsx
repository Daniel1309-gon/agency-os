import { useCallback, useEffect, useState } from 'react';
import { breakSummarySchema, shiftSummarySchema, type BreakSummary, type ShiftSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { StatusPill } from '../StatusPill/StatusPill';
import { breakStatusCopy, formatLocalTime, parseScheduledRange, shiftStatusCopy } from './shift-view';

export function OperatorShiftPanel({ accessToken }: { accessToken: string | null }) {
  const [shift, setShift] = useState<ShiftSummary | null>(null);
  const [breaks, setBreaks] = useState<BreakSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingBreakId, setUpdatingBreakId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadShift = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rawShift = await apiClient.request<unknown>('/shifts/me/current');
      const currentShift = shiftSummarySchema.optional().parse(rawShift) ?? null;
      setShift(currentShift);
      if (!currentShift) {
        setBreaks([]);
        return;
      }
      const rawBreaks = await apiClient.request<unknown>(`/breaks/${currentShift.id}`);
      setBreaks(breakSummarySchema.array().parse(rawBreaks));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar tu turno actual.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadShift();
  }, [accessToken, loadShift]);

  async function updateBreak(breakItem: BreakSummary) {
    const action = breakStatusCopy(breakItem.status).action;
    if (!action) return;
    setUpdatingBreakId(breakItem.id);
    setError(null);
    try {
      await apiClient.request(`/breaks/${breakItem.id}/${breakItem.status === 'PENDING' ? 'start' : 'end'}`, { method: 'POST', body: '{}' });
      await loadShift();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos actualizar el break.');
    } finally {
      setUpdatingBreakId(null);
    }
  }

  const range = parseScheduledRange(shift?.scheduledRange ?? null);
  const shiftCopy = shift ? shiftStatusCopy(shift.status) : null;

  return (
    <section className="panel operator-shift-panel" id="section-02" aria-labelledby="operator-shift-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Control de jornada</p><h2 id="operator-shift-title">Mi turno</h2></div>
        <button className="quiet-button" type="button" onClick={() => void loadShift()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {isLoading && <p className="panel-state">Cargando tu jornada…</p>}
      {!isLoading && !shift && <div className="shift-empty" role="status"><strong>No hay un turno en curso.</strong><span>Cuando coordinación active tu jornada aparecerá aquí, junto con tus descansos asignados.</span></div>}
      {!isLoading && shift && <>
        <div className="operator-shift-summary">
          <div><span className="panel-kicker">Ventana programada</span><strong>{range ? `${formatLocalTime(range.from)} — ${formatLocalTime(range.to)}` : 'Horario no disponible'}</strong><small>Jornada del {shift.businessDate}</small></div>
          {shiftCopy && <StatusPill status={shiftCopy.tone} label={shiftCopy.label} />}
        </div>
        <div className="break-list" aria-label="Descansos asignados">
          <div className="break-list__header"><span>Descansos</span><span>{breaks.length} asignados</span></div>
          {!breaks.length && <p className="panel-state">No tienes descansos asignados en este turno.</p>}
          {breaks.map((breakItem) => {
            const copy = breakStatusCopy(breakItem.status);
            const isUpdating = updatingBreakId === breakItem.id;
            return <div className="break-row" key={breakItem.id}>
              <div><strong>{breakItem.type === 'REST' ? 'Descanso' : breakItem.type}</strong><span>{breakItem.scheduledAt ? `Programado ${formatLocalTime(breakItem.scheduledAt)}` : 'Sin hora programada'}</span></div>
              <StatusPill status={breakItem.status === 'IN_PROGRESS' ? 'break' : breakItem.status === 'COMPLETED' ? 'available' : 'handoff'} label={copy.label} />
              {copy.action && <button className="row-action" type="button" onClick={() => void updateBreak(breakItem)} disabled={isUpdating}>{isUpdating ? 'Guardando…' : copy.action} <span aria-hidden="true">↗</span></button>}
            </div>;
          })}
        </div>
      </>}
    </section>
  );
}
