import { useCallback, useEffect, useState } from 'react';
import { outboxListResponseSchema, outboxSummarySchema, type OutboxEventRecord, type OutboxStatus, type OutboxSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { errorMessage } from '../OperationsManagement/management-view';
import { formatSecurityDate } from './security-view';

const STATUS_LABELS: Record<OutboxStatus, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'Enviando',
  SENT: 'Entregado',
  FAILED: 'Reintentando',
  DEAD: 'Sin entregar',
};

const EVENT_LABELS: Record<string, string> = {
  'rocketchat.message.send': 'Mensaje Rocket.Chat',
};

function queryFor(status: OutboxStatus | '', cursor?: string): string {
  const params = new URLSearchParams({ limit: '25' });
  if (status) params.set('status', status);
  if (cursor) params.set('cursor', cursor);
  return `/ops/outbox?${params.toString()}`;
}

function statusClass(status: OutboxStatus): string {
  return status === 'SENT' ? 'is-success' : status === 'DEAD' ? 'is-failure' : status === 'FAILED' ? 'is-denied' : '';
}

/** E1-05: cola de entregas del outbox y reintento manual de lo que falló. */
export function OutboxPanel({ accessToken }: { accessToken: string | null }) {
  const [status, setStatus] = useState<OutboxStatus | ''>('DEAD');
  const [events, setEvents] = useState<OutboxEventRecord[]>([]);
  const [summary, setSummary] = useState<OutboxSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const [rawList, rawSummary] = await Promise.all([
        apiClient.request<unknown>(queryFor(status, cursor)),
        cursor ? Promise.resolve(null) : apiClient.request<unknown>('/ops/outbox/summary'),
      ]);
      const list = outboxListResponseSchema.parse(rawList);
      setEvents((current) => cursor ? [...current, ...list.data] : list.data);
      setNextCursor(list.pagination.nextCursor);
      if (rawSummary) setSummary(outboxSummarySchema.parse(rawSummary));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar la cola de entregas.'));
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (accessToken) void load();
  }, [accessToken, load]);

  async function requeue(event: OutboxEventRecord) {
    setBusyId(event.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/ops/outbox/${event.id}/requeue`, { method: 'POST', body: '{}' });
      setNotice(`La entrega #${event.id} volvió a la cola con sus intentos en cero.`);
      await load();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos reintentar la entrega.'));
    } finally {
      setBusyId(null);
    }
  }

  const countFor = (value: OutboxStatus) => summary?.byStatus.find((item) => item.status === value)?.count ?? 0;

  return (
    <section className="panel security-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="outbox" aria-labelledby="outbox-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Outbox · Rocket.Chat</p><h2 id="outbox-title">Cola de entregas</h2></div>
        <button className="quiet-button" type="button" onClick={() => void load()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>
      <p className="management-panel__note">Cada aviso sale por una cola durable con reintentos. Tras 8 intentos queda «Sin entregar» hasta que alguien lo reintente aquí. El contenido de los mensajes no se muestra.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {summary && <div className="security-summary-grid">
        <div><span>Sin entregar</span><strong>{countFor('DEAD').toString().padStart(2, '0')}</strong><small>requieren reintento manual</small></div>
        <div><span>En cola o reintentando</span><strong>{(countFor('PENDING') + countFor('FAILED') + countFor('PROCESSING')).toString().padStart(2, '0')}</strong><small>{summary.oldestPendingAt ? `La más antigua desde ${formatSecurityDate(summary.oldestPendingAt)}` : 'Nada esperando'}</small></div>
        <div><span>Jobs fallidos</span><strong>{summary.failedJobs.length.toString().padStart(2, '0')}</strong><small>se repiten en su próxima ventana</small></div>
      </div>}

      <div className="security-filter-form">
        <label><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value as OutboxStatus | '')}><option value="">Todos</option>{(Object.keys(STATUS_LABELS) as OutboxStatus[]).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
      </div>

      {isLoading && !events.length && <p className="panel-state">Cargando entregas…</p>}
      {!isLoading && !events.length && <p className="panel-state">No hay entregas con este estado.</p>}
      {events.length > 0 && <>
        <div className="security-table" role="table" aria-label="Entregas del outbox">
          <div className="security-table__head" role="row"><span>Entrega</span><span>Estado</span><span>Intentos</span><span>Último error</span><span>Acciones</span></div>
          {events.map((event) => <div className="security-table__row" role="row" key={event.id}>
            <div role="cell"><strong>#{event.id} · {EVENT_LABELS[event.eventType] ?? event.eventType}</strong><small>{event.aggregateType} · creada {formatSecurityDate(event.createdAt)}</small></div>
            <span className={`security-result ${statusClass(event.status)}`} role="cell">{STATUS_LABELS[event.status]}</span>
            <span className="management-muted" role="cell">{event.attempts}</span>
            <div role="cell"><small>{event.lastError ?? '—'}</small></div>
            <div className="management-actions" role="cell">
              {(event.status === 'DEAD' || event.status === 'FAILED') && <button className="row-action" type="button" onClick={() => void requeue(event)} disabled={busyId === event.id}>{busyId === event.id ? '…' : 'Reintentar'}</button>}
            </div>
          </div>)}
        </div>
        {nextCursor && <button className="quiet-button security-load-more" type="button" onClick={() => void load(nextCursor)} disabled={isLoading}>{isLoading ? 'Cargando…' : 'Cargar entregas anteriores'} <span aria-hidden="true">↓</span></button>}
      </>}

      {summary && summary.failedJobs.length > 0 && <>
        <div className="security-section-heading"><div><p className="panel-kicker">Scheduler</p><h3>Jobs fallidos</h3></div><span className="management-muted">Solo lectura</span></div>
        <div className="security-table" role="table" aria-label="Jobs fallidos">
          <div className="security-table__head" role="row"><span>Job</span><span>Estado</span><span>Intentos</span><span>Último error</span><span>Ventana</span></div>
          {summary.failedJobs.map((job) => <div className="security-table__row" role="row" key={job.id}>
            <div role="cell"><strong>{job.jobName}</strong><small>{job.runKey}</small></div>
            <span className={`security-result ${job.status === 'DEAD' ? 'is-failure' : 'is-denied'}`} role="cell">{job.status === 'DEAD' ? 'Abandonado' : 'Reintentando'}</span>
            <span className="management-muted" role="cell">{job.attempts}</span>
            <div role="cell"><small>{job.lastError ?? '—'}</small></div>
            <time role="cell" dateTime={job.scheduledFor}>{formatSecurityDate(job.scheduledFor)}</time>
          </div>)}
        </div>
      </>}
    </section>
  );
}
