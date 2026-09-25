import { useCallback, useEffect, useState } from 'react';
import { breakSummarySchema, shiftSummarySchema, type BreakSummary, type ShiftSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { StatusPill } from '../StatusPill/StatusPill';
import { breakStatusCopy, formatLocalTime, parseScheduledRange, shiftStatusCopy } from './shift-view';

/** OPS-06: dos ventanas de 4 h desde la hora programada y un tope de 20 min. */
const BREAK_WINDOW_MS = 4 * 3_600_000;
const BREAK_MAX_MS = 20 * 60_000;

function countdown(remainingMs: number): string {
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function OperatorShiftPanel({ accessToken }: { accessToken: string | null }) {
  const [shift, setShift] = useState<ShiftSummary | null>(null);
  const [breaks, setBreaks] = useState<BreakSummary[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
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

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  async function startBreak() {
    setIsStarting(true);
    setError(null);
    try {
      await apiClient.request('/breaks/start', { method: 'POST', body: '{}' });
      await loadShift();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos iniciar el break.');
    } finally {
      setIsStarting(false);
    }
  }

  async function updateBreak(breakItem: BreakSummary) {
    const action = breakStatusCopy(breakItem.status).action;
    if (!action) return;
    setUpdatingBreakId(breakItem.id);
    setError(null);
    try {
      await apiClient.request(`/breaks/${breakItem.id}/end`, { method: 'POST', body: '{}' });
      await loadShift();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos actualizar el break.');
    } finally {
      setUpdatingBreakId(null);
    }
  }

  const range = parseScheduledRange(shift?.scheduledRange ?? null);
  const shiftCopy = shift ? shiftStatusCopy(shift.status) : null;
  const activeBreak = breaks.find((item) => item.status === 'IN_PROGRESS') ?? null;
  const windowIndex = range && shift?.status === 'IN_PROGRESS'
    ? (now < range.from.getTime() ? 0 : Math.floor((now - range.from.getTime()) / BREAK_WINDOW_MS))
    : null;
  const windowStart = range && windowIndex !== null ? new Date(range.from.getTime() + windowIndex * BREAK_WINDOW_MS) : null;
  const windowEnd = windowStart ? new Date(windowStart.getTime() + BREAK_WINDOW_MS) : null;
  const inWindow = windowIndex !== null && windowIndex <= 1;
  const takenInWindow = windowStart
    ? breaks.some((item) => item.startedAt && new Date(item.startedAt).getTime() >= windowStart.getTime() && item.status !== 'CANCELLED')
    : false;
  const remainingMs = activeBreak?.startedAt ? Math.max(0, new Date(activeBreak.startedAt).getTime() + BREAK_MAX_MS - now) : 0;

  return (
    <section className="panel operator-shift-panel" id="section-02" aria-labelledby="operator-shift-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Control de jornada</p><h2 id="operator-shift-title">Mi turno</h2></div>
        <button className="quiet-button" type="button" onClick={() => void loadShift()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {isLoading && <p className="panel-state">Cargando tu jornada…</p>}
      {!isLoading && !shift && <div className="shift-empty" role="status"><strong>No hay un turno en curso.</strong><span>Cuando coordinación active tu jornada aparecerá aquí, junto con tus ventanas de break.</span></div>}
      {!isLoading && shift && <>
        <div className="operator-shift-summary">
          <div><span className="panel-kicker">Ventana programada</span><strong>{range ? `${formatLocalTime(range.from)} — ${formatLocalTime(range.to)}` : 'Horario no disponible'}</strong><small>Jornada del {shift.businessDate}</small></div>
          {shiftCopy && <StatusPill status={shiftCopy.tone} label={shiftCopy.label} />}
        </div>
        <div className="break-window" aria-label="Break del turno">
          {range && shift.status === 'IN_PROGRESS' && inWindow && windowEnd && <p className="panel-state">Ventana {(windowIndex ?? 0) + 1} de break · hasta las {formatLocalTime(windowEnd)}</p>}
          {range && shift.status === 'IN_PROGRESS' && !inWindow && <p className="panel-state">Las ventanas de break de este turno ya pasaron.</p>}
          {activeBreak && <p className="panel-state" role="status">Break en curso · termina en {countdown(remainingMs)}</p>}
          {inWindow && !activeBreak && !takenInWindow && <button className="primary-button" type="button" onClick={() => void startBreak()} disabled={isStarting}>{isStarting ? 'Iniciando…' : 'Iniciar break'}</button>}
          {inWindow && !activeBreak && takenInWindow && <p className="panel-state">Ya tomaste el break de esta ventana.</p>}
        </div>
        <div className="break-list" aria-label="Breaks del turno">
          <div className="break-list__header"><span>Breaks</span><span>{breaks.length} en este turno</span></div>
          {!breaks.length && <p className="panel-state">Todavía no tomaste ningún break en este turno.</p>}
          {breaks.map((breakItem) => {
            const copy = breakStatusCopy(breakItem.status);
            const isUpdating = updatingBreakId === breakItem.id;
            return <div className="break-row" key={breakItem.id}>
              <div><strong>{breakItem.type === 'REST' ? 'Descanso' : breakItem.type}</strong><span>{breakItem.startedAt ? `Iniciado ${formatLocalTime(breakItem.startedAt)}` : 'Sin iniciar'}{breakItem.durationMinutes !== null ? ` · ${breakItem.durationMinutes} min` : ''}</span></div>
              <StatusPill status={breakItem.status === 'IN_PROGRESS' ? 'break' : breakItem.status === 'COMPLETED' ? 'available' : 'handoff'} label={copy.label} />
              {copy.action && <button className="row-action" type="button" onClick={() => void updateBreak(breakItem)} disabled={isUpdating}>{isUpdating ? 'Guardando…' : copy.action} <span aria-hidden="true">↗</span></button>}
            </div>;
          })}
        </div>
      </>}
    </section>
  );
}
