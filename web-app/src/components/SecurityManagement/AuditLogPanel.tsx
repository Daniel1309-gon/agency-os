import { useEffect, useState, type FormEvent } from 'react';
import { auditLogResponseSchema, managedUserSchema, type AuditRecord, type ManagedUser, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, errorMessage } from '../OperationsManagement/management-view';
import { auditActionLabel, auditActorLabel, auditResultLabel, formatMetadata, formatSecurityDate } from './security-view';

interface AuditLogPanelProps {
  accessToken: string | null;
  user: UserSummary;
}

interface AuditFilters {
  from: string;
  to: string;
  action: string;
  actorId: string;
}

const emptyFilters: AuditFilters = { from: '', to: '', action: '', actorId: '' };
const auditActions = [
  'auth.login.succeeded', 'auth.login.denied', 'auth.token.denied', 'permission.denied',
  'ip_allowlist.denied', 'device.access.denied', 'device.enrolled', 'device.revoked',
  'user.created', 'user.updated', 'user.disabled', 'vault.credential.redeemed',
  'vault.credential.denied', 'assignment.created', 'assignment.ended', 'session.opened', 'session.closed',
];

function dateFilter(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function queryFor(filters: AuditFilters, cursor?: string): string {
  const params = new URLSearchParams({ limit: '25' });
  const from = dateFilter(filters.from);
  const to = dateFilter(filters.to, true);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (filters.action) params.set('action', filters.action);
  if (filters.actorId) params.set('actorId', filters.actorId);
  if (cursor) params.set('cursor', cursor);
  return `/audit-log?${params.toString()}`;
}

function resultClass(result: string): string {
  return result === 'SUCCESS' ? 'is-success' : result === 'DENIED' ? 'is-denied' : 'is-failure';
}

export function AuditLogPanel({ accessToken, user }: AuditLogPanelProps) {
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [draft, setDraft] = useState<AuditFilters>(emptyFilters);
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const userRequest = canManage(user.permissions, 'users.read') ? apiClient.request<unknown>('/users') : Promise.resolve(null);
    Promise.all([apiClient.request<unknown>(queryFor(filters)), userRequest])
      .then(([rawAudit, rawUsers]) => {
        if (cancelled) return;
        const parsedAudit = auditLogResponseSchema.parse(rawAudit);
        setEvents(parsedAudit.data);
        setNextCursor(parsedAudit.pagination.nextCursor);
        setUsers(rawUsers ? managedUserSchema.array().parse(rawUsers) : []);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar la auditoría.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [accessToken, filters, user.permissions]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...draft });
  }

  async function loadMore() {
    if (!accessToken || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>(queryFor(filters, nextCursor));
      const parsed = auditLogResponseSchema.parse(raw);
      setEvents((current) => [...current, ...parsed.data]);
      setNextCursor(parsed.pagination.nextCursor);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar más eventos.'));
    } finally {
      setIsLoadingMore(false);
    }
  }

  const nameById = new Map(users.map((item) => [item.id, item.fullName]));

  return (
    <section className="panel security-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="audit-log" aria-labelledby="audit-log-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Trazabilidad · solo lectura</p><h2 id="audit-log-title">Panel de auditoría</h2></div>
        <span className="security-badge security-badge--quiet">Bitácora inmutable</span>
      </header>
      <p className="management-panel__note">Consulta quién hizo cada acción, desde qué origen y con qué resultado. Las credenciales y los tokens nunca se muestran aquí.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}

      <form className="security-filter-form" onSubmit={submitFilters}>
        <label><span>Desde</span><input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>Hasta</span><input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
        <label><span>Acción</span><select value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}><option value="">Todas las acciones</option>{auditActions.map((action) => <option key={action} value={action}>{auditActionLabel(action)}</option>)}</select></label>
        <label><span>Actor</span><select value={draft.actorId} onChange={(event) => setDraft((current) => ({ ...current, actorId: event.target.value }))}><option value="">Todos los actores</option>{users.map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.email}</option>)}</select></label>
        <div className="security-filter-form__actions"><button className="primary-button primary-button--compact" type="submit">Aplicar filtros <span aria-hidden="true">↗</span></button><button className="quiet-button" type="button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); }}>Limpiar</button></div>
      </form>

      {isLoading && <p className="panel-state">Cargando eventos de seguridad…</p>}
      {!isLoading && !events.length && <p className="panel-state">No hay eventos con estos filtros.</p>}
      {!isLoading && events.length > 0 && <>
        <div className="security-table" role="table" aria-label="Bitácora de auditoría">
          <div className="security-table__head" role="row"><span>Evento</span><span>Actor</span><span>Resultado</span><span>Origen</span><span>Momento</span></div>
          {events.map((event) => <div className="security-table__row" role="row" key={`${event.id}-${event.occurredAt}`}>
            <div role="cell"><strong>{auditActionLabel(event.action)}</strong><small>{event.entityType ? `${event.entityType}${event.entityId ? ` · ${event.entityId.slice(0, 8)}` : ''}` : formatMetadata(event.metadata)}</small></div>
            <div role="cell"><strong>{auditActorLabel(event.actorType)}</strong><small>{event.actorUserId ? nameById.get(event.actorUserId) ?? `${event.actorUserId.slice(0, 8)}…` : event.actorDeviceId ? `Dispositivo ${event.actorDeviceId.slice(0, 8)}…` : 'Sin identidad'}</small></div>
            <span className={`security-result ${resultClass(event.result)}`} role="cell">{auditResultLabel(event.result)}</span>
            <div role="cell"><strong>{event.ip ?? 'IP no disponible'}</strong><small>{event.requestId ? `Solicitud ${event.requestId.slice(0, 12)}…` : 'Sin requestId'}</small></div>
            <time role="cell" dateTime={event.occurredAt}>{formatSecurityDate(event.occurredAt)}<small>{event.entityType ? formatMetadata(event.metadata) : ' '}</small></time>
          </div>)}
        </div>
        {nextCursor && <button className="quiet-button security-load-more" type="button" onClick={() => void loadMore()} disabled={isLoadingMore}>{isLoadingMore ? 'Cargando…' : 'Cargar eventos anteriores'} <span aria-hidden="true">↓</span></button>}
      </>}
    </section>
  );
}
