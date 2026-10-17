import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { assignmentHistoryResponseSchema, managedUserSchema, profileListResponseSchema, type AssignmentRecord, type ManagedUser, type ProfileRecord, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { buildAssignmentWindows, calendarWeekday, canManage, errorMessage, formatRange, groupAssignmentRecords, parseRange, toLocalDateTime, WEEKDAYS, type AssignmentGroup, type AssignmentScheduleInput } from './management-view';

interface AssignmentManagementProps {
  accessToken: string | null;
  user: UserSummary;
  onNavigate: (path: string) => void;
}

interface AssignmentForm extends AssignmentScheduleInput {
  profileId: string;
  operatorId: string;
}

function localDate(value: Date = new Date()): string {
  return toLocalDateTime(value).slice(0, 10);
}

function localTime(value: Date): string {
  return toLocalDateTime(value).slice(11, 16);
}

const timeFormatter = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
const dateFormatter = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
const weekdayLabels = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function groupSchedule(group: AssignmentGroup): { time: string; dates: string; days: string } {
  const first = parseRange(group.records[0]?.validRange);
  const last = parseRange(group.records[group.records.length - 1]?.validRange);
  if (!first || !last) return { time: 'Ventana no disponible', dates: 'Rango no disponible', days: '' };
  const start = new Date(first.from);
  const end = new Date(first.to);
  const lastStart = new Date(last.from);
  const days = [...new Set(group.records.map((item) => calendarWeekday(localDate(new Date(parseRange(item.validRange)?.from ?? item.createdAt)))))]
    .sort((left, right) => left - right)
    .map((day) => weekdayLabels[day])
    .join(', ');
  return {
    time: `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`,
    dates: `Del ${dateFormatter.format(start)} al ${dateFormatter.format(lastStart)}`,
    days,
  };
}

function assignmentStatus(item: AssignmentGroup | AssignmentRecord): string {
  return item.status === 'ACTIVE' ? 'Activa' : item.endReason === 'HANDOFF' ? 'Relevo cerrado' : 'Finalizada';
}

const emptyForm: AssignmentForm = { profileId: '', operatorId: '', fromDate: localDate(), toDate: localDate(), weekdays: [1], dailyFrom: '06:05', dailyTo: '14:05' };

export function AssignmentManagement({ accessToken, user, onNavigate }: AssignmentManagementProps) {
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [form, setForm] = useState<AssignmentForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyAssignmentId, setBusyAssignmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState({ operatorId: '', profileId: '' });

  const operators = useMemo(() => users.filter((item) => item.status === 'ACTIVE' && item.roleCode === 'OPERADOR'), [users]);
  const profileById = useMemo(() => new Map(profiles.map((item) => [item.id, item])), [profiles]);
  const userById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const assignmentGroups = useMemo(() => groupAssignmentRecords(assignments), [assignments]);
  const canUpdate = canManage(user.permissions, 'profiles.update');

  const loadAssignments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // OPS-02: el historial se filtra en el servidor, que ya pagina y aplica el alcance.
      const historyUrl = (page: number) => {
        const params = new URLSearchParams({ page: String(page), pageSize: '100' });
        if (historyFilter.operatorId) params.set('operatorId', historyFilter.operatorId);
        if (historyFilter.profileId) params.set('profileId', historyFilter.profileId);
        return `/assignments?${params.toString()}`;
      };
      const [rawAssignments, rawUsers, rawProfiles] = await Promise.all([
        apiClient.request<unknown>(historyUrl(1)),
        apiClient.request<unknown>('/users'),
        apiClient.request<unknown>('/profiles?page=1&pageSize=100'),
      ]);
      const firstPage = assignmentHistoryResponseSchema.parse(rawAssignments);
      const remainingPages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(firstPage.total / firstPage.pageSize) - 1) }, (_, index) => apiClient.request<unknown>(historyUrl(index + 2))));
      setAssignments([firstPage.items, ...remainingPages.map((page) => assignmentHistoryResponseSchema.parse(page).items)].flat());
      setUsers(managedUserSchema.array().parse(rawUsers));
      setProfiles(profileListResponseSchema.parse(rawProfiles).data);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar las asignaciones.');
    } finally {
      setIsLoading(false);
    }
  }, [historyFilter]);

  useEffect(() => {
    if (accessToken) void loadAssignments();
  }, [accessToken, loadAssignments]);

  function updateField(field: keyof AssignmentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    const firstOperator = operators[0]?.id ?? '';
    const firstProfile = profiles.find((item) => item.status === 'ACTIVE')?.id ?? '';
    setForm({ ...emptyForm, operatorId: firstOperator, profileId: firstProfile });
    setError(null);
    setNotice(null);
    setIsFormOpen(true);
  }

  function openHandoff(item: AssignmentRecord) {
    const range = parseRange(item.validRange);
    const nextOperator = operators.find((operator) => operator.id !== item.operatorId)?.id ?? operators[0]?.id ?? '';
    const handoffAt = range ? new Date(range.to) : new Date();
    const handoffEnd = new Date(handoffAt.getTime() + 8 * 60 * 60 * 1000);
    setForm({ profileId: item.profileId, operatorId: nextOperator, fromDate: localDate(handoffAt), toDate: localDate(handoffAt), weekdays: [calendarWeekday(localDate(handoffAt))], dailyFrom: localTime(handoffAt), dailyTo: localTime(handoffEnd) });
    setError(null);
    setNotice(`Relevo preparado para ${profileById.get(item.profileId)?.displayName ?? 'el perfil'}. Verifica el operador y las fechas antes de guardar.`);
    setIsFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const windows = buildAssignmentWindows(form);
      await apiClient.request('/assignments', { method: 'POST', body: JSON.stringify({ profileId: form.profileId, operatorId: form.operatorId, windows }) });
      setNotice(`${windows.length} tramo${windows.length === 1 ? '' : 's'} creado${windows.length === 1 ? '' : 's'}. Si el primero inicia exactamente cuando termina la asignación anterior, el backend registra el relevo y cierra la sesión saliente.`);
      setIsFormOpen(false);
      await loadAssignments();
    } catch (nextError) {
      const message = nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos guardar la asignación.');
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function endAssignment(item: AssignmentRecord) {
    setBusyAssignmentId(item.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/assignments/${item.id}/end`, { method: 'POST', body: '{}' });
      setNotice('Asignación finalizada y sesiones asociadas cerradas.');
      await loadAssignments();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos finalizar la asignación.'));
    } finally {
      setBusyAssignmentId(null);
    }
  }

  return (
    <section className="panel management-panel" id="section-06" aria-labelledby="assignments-management-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Operación por ventanas</p><h2 id="assignments-management-title">Asignaciones y relevos</h2></div>
        {canUpdate && <button className="primary-button primary-button--compact" type="button" onClick={openCreate}>Nueva asignación <span aria-hidden="true">+</span></button>}
      </header>
      <div className="assignment-management__intro">
        <div>
          <p className="management-panel__note">Cada fila resume una franja recurrente: operador, perfil y período de cobertura. Para un relevo limpio, el inicio del nuevo tramo debe coincidir con el fin del anterior.</p>
          <p className="assignment-management__relationship">Turnos define la jornada del operador. La asignación define qué perfil cubre durante esa ventana; cuando no existe un turno materializado, queda marcada como ventana libre.</p>
        </div>
        <button className="quiet-button" type="button" onClick={() => onNavigate('/app/turnos')}>Ver turnos <span aria-hidden="true">↗</span></button>
      </div>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {isFormOpen && canUpdate && <form className="management-form" onSubmit={(event) => void submit(event)}>
        <div className="management-form__heading"><div><span className="panel-kicker">Nueva ventana</span><strong>Asigna un perfil a un operador</strong></div><button className="quiet-button" type="button" onClick={() => setIsFormOpen(false)}>Cerrar</button></div>
        <div className="management-form__grid">
          <label><span>Perfil</span><select required value={form.profileId} onChange={(event) => updateField('profileId', event.target.value)}><option value="">Selecciona un perfil</option>{profiles.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <label><span>Operador</span><select required value={form.operatorId} onChange={(event) => updateField('operatorId', event.target.value)}><option value="">Selecciona un operador</option>{operators.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
          <label><span>Período desde</span><input required type="date" value={form.fromDate} onChange={(event) => updateField('fromDate', event.target.value)} /></label>
          <label><span>Período hasta</span><input required type="date" value={form.toDate} onChange={(event) => updateField('toDate', event.target.value)} /></label>
          <fieldset className="management-form__wide management-weekdays"><legend>Días de la semana</legend><div className="management-weekdays__options">{WEEKDAYS.map((day) => <label className="management-day-option" key={day.value}><input type="checkbox" checked={form.weekdays.includes(day.value)} onChange={(event) => setForm((current) => ({ ...current, weekdays: event.target.checked ? [...current.weekdays, day.value] : current.weekdays.filter((value) => value !== day.value) }))} /><span>{day.label}</span></label>)}</div></fieldset>
          <label><span>Hora de inicio diaria</span><input required type="time" value={form.dailyFrom} onChange={(event) => updateField('dailyFrom', event.target.value)} /></label>
          <label><span>Hora de fin diaria</span><input required type="time" value={form.dailyTo} onChange={(event) => updateField('dailyTo', event.target.value)} /></label>
        </div>
        <p className="management-form__hint">Se crea un tramo por cada día seleccionado dentro del período. Las horas se interpretan en America/Bogota; si la hora final es menor, el tramo cruza la medianoche.</p>
        <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : 'Guardar asignación'} <span aria-hidden="true">↗</span></button></div>
      </form>}

      <div className="security-filter-form" aria-label="Filtros del historial">
        <label><span>Operador</span><select value={historyFilter.operatorId} onChange={(event) => setHistoryFilter((current) => ({ ...current, operatorId: event.target.value }))}><option value="">Todos los operadores</option>{users.filter((item) => item.roleCode === 'OPERADOR').map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
        <label><span>Perfil</span><select value={historyFilter.profileId} onChange={(event) => setHistoryFilter((current) => ({ ...current, profileId: event.target.value }))}><option value="">Todos los perfiles</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      </div>
      {isLoading && <p className="panel-state">Cargando historial de asignaciones…</p>}
      {!isLoading && !assignments.length && <p className="panel-state">{historyFilter.operatorId || historyFilter.profileId ? 'No hay asignaciones con estos filtros.' : 'No hay asignaciones registradas en tu alcance.'}</p>}
      {!isLoading && assignmentGroups.length > 0 && <div className="management-table assignment-table" role="table" aria-label="Asignaciones y relevos">
        <div className="management-table__head" role="row"><span>Perfil</span><span>Operador</span><span>Ventana</span><span>Estado</span><span aria-hidden="true" /></div>
        {assignmentGroups.map((group) => {
          const profile = profileById.get(group.profileId);
          const operator = userById.get(group.operatorId);
          const schedule = groupSchedule(group);
          const activeRecords = group.records.filter((item) => item.status === 'ACTIVE');
          const isActive = group.status === 'ACTIVE';
          const actionRecord = activeRecords.at(-1);
          const renderActions = (item: AssignmentRecord) => {
            const isBusy = busyAssignmentId === item.id;
            return <>{canUpdate && item.status === 'ACTIVE' && <><button className="row-action" type="button" onClick={() => openHandoff(item)}>Preparar relevo</button><button className="row-action row-action--danger" type="button" onClick={() => void endAssignment(item)} disabled={isBusy}>{isBusy ? '…' : 'Finalizar'}</button></>}</>;
          };
          return <div className="management-table__row assignment-table__row" role="row" key={group.id}>
            <div className="management-identity" role="cell"><span className="profile-avatar profile-avatar--small">{(profile?.displayName ?? 'PF').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{profile?.displayName ?? 'Perfil no disponible'}</strong><small>{group.shiftId ? 'Vinculada a turno' : `${group.records.length} tramo${group.records.length === 1 ? '' : 's'} · Ventana libre`}</small></span></div>
            <span className="management-muted" role="cell">{operator?.fullName ?? 'Operador no disponible'}</span>
            <div className="assignment-schedule" role="cell"><strong>{schedule.time}</strong><small>{schedule.dates}</small><small>{schedule.days}</small></div>
            <span role="cell"><span className={`management-status management-status--${isActive ? 'active' : 'ended'}`}>{assignmentStatus(group)}</span></span>
            <div className="management-actions" role="cell">
              {group.records.length === 1 && actionRecord && renderActions(actionRecord)}
              {group.records.length > 1 && <details className="assignment-details"><summary>Ver {group.records.length} tramos</summary><div className="assignment-details__list">{group.records.map((item) => <div className="assignment-detail" key={item.id}><span>{formatRange(item.validRange)}</span><span className={`management-status management-status--${item.status === 'ACTIVE' ? 'active' : 'ended'}`}>{assignmentStatus(item)}</span><span className="assignment-detail__actions">{renderActions(item)}</span></div>)}</div></details>}
            </div>
          </div>;
        })}
      </div>}
    </section>
  );
}
