import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { assignmentHistoryResponseSchema, managedUserSchema, profileListResponseSchema, type AssignmentRecord, type ManagedUser, type ProfileRecord, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, errorMessage, formatRange, parseRange, toIsoDateTime, toLocalDateTime } from './management-view';

interface AssignmentManagementProps {
  accessToken: string | null;
  user: UserSummary;
}

interface AssignmentForm {
  profileId: string;
  operatorId: string;
  validFrom: string;
  validTo: string;
}

function localPlusHours(hours: number): string {
  return toLocalDateTime(new Date(Date.now() + hours * 60 * 60 * 1000));
}

const emptyForm: AssignmentForm = { profileId: '', operatorId: '', validFrom: toLocalDateTime(new Date()), validTo: localPlusHours(8) };

export function AssignmentManagement({ accessToken, user }: AssignmentManagementProps) {
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

  const operators = useMemo(() => users.filter((item) => item.status === 'ACTIVE' && item.roleCode === 'OPERADOR'), [users]);
  const profileById = useMemo(() => new Map(profiles.map((item) => [item.id, item])), [profiles]);
  const userById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const canUpdate = canManage(user.permissions, 'profiles.update');

  const loadAssignments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rawAssignments, rawUsers, rawProfiles] = await Promise.all([
        apiClient.request<unknown>('/assignments?page=1&pageSize=100'),
        apiClient.request<unknown>('/users'),
        apiClient.request<unknown>('/profiles?page=1&pageSize=100'),
      ]);
      setAssignments(assignmentHistoryResponseSchema.parse(rawAssignments).items);
      setUsers(managedUserSchema.array().parse(rawUsers));
      setProfiles(profileListResponseSchema.parse(rawProfiles).data);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar las asignaciones.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadAssignments();
  }, [accessToken, loadAssignments]);

  function updateField(field: keyof AssignmentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    const firstOperator = operators[0]?.id ?? '';
    const firstProfile = profiles.find((item) => item.status === 'ACTIVE')?.id ?? '';
    setForm({ ...emptyForm, operatorId: firstOperator, profileId: firstProfile, validFrom: toLocalDateTime(new Date()), validTo: localPlusHours(8) });
    setError(null);
    setNotice(null);
    setIsFormOpen(true);
  }

  function openHandoff(item: AssignmentRecord) {
    const range = parseRange(item.validRange);
    const nextOperator = operators.find((operator) => operator.id !== item.operatorId)?.id ?? operators[0]?.id ?? '';
    setForm({ profileId: item.profileId, operatorId: nextOperator, validFrom: range ? toLocalDateTime(range.to) : toLocalDateTime(new Date()), validTo: range ? toLocalDateTime(new Date(new Date(range.to).getTime() + 8 * 60 * 60 * 1000)) : localPlusHours(8) });
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
      await apiClient.request('/assignments', { method: 'POST', body: JSON.stringify({ profileId: form.profileId, operatorId: form.operatorId, validFrom: toIsoDateTime(form.validFrom), validTo: toIsoDateTime(form.validTo) }) });
      setNotice('Asignación creada. Si inicia exactamente cuando termina la anterior, el backend registra el relevo y cierra la sesión saliente.');
      setIsFormOpen(false);
      await loadAssignments();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos guardar la asignación.'));
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
    <section className="panel management-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="section-06" aria-labelledby="assignments-management-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Operación por ventanas</p><h2 id="assignments-management-title">Asignaciones y relevos</h2></div>
        {canUpdate && <button className="primary-button primary-button--compact" type="button" onClick={openCreate}>Nueva asignación <span aria-hidden="true">+</span></button>}
      </header>
      <p className="management-panel__note">Programa el tramo real de cada operador. Para un relevo limpio, el inicio del nuevo tramo debe coincidir con el fin del anterior.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {isFormOpen && canUpdate && <form className="management-form" onSubmit={(event) => void submit(event)}>
        <div className="management-form__heading"><div><span className="panel-kicker">Nueva ventana</span><strong>Asigna un perfil a un operador</strong></div><button className="quiet-button" type="button" onClick={() => setIsFormOpen(false)}>Cerrar</button></div>
        <div className="management-form__grid">
          <label><span>Perfil</span><select required value={form.profileId} onChange={(event) => updateField('profileId', event.target.value)}><option value="">Selecciona un perfil</option>{profiles.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <label><span>Operador</span><select required value={form.operatorId} onChange={(event) => updateField('operatorId', event.target.value)}><option value="">Selecciona un operador</option>{operators.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
          <label><span>Inicio del tramo</span><input required type="datetime-local" value={form.validFrom} onChange={(event) => updateField('validFrom', event.target.value)} /></label>
          <label><span>Fin del tramo</span><input required type="datetime-local" value={form.validTo} onChange={(event) => updateField('validTo', event.target.value)} /></label>
        </div>
        <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : 'Guardar asignación'} <span aria-hidden="true">↗</span></button></div>
      </form>}

      {isLoading && <p className="panel-state">Cargando historial de asignaciones…</p>}
      {!isLoading && !assignments.length && <p className="panel-state">No hay asignaciones registradas en tu alcance.</p>}
      {!isLoading && assignments.length > 0 && <div className="management-table" role="table" aria-label="Asignaciones y relevos">
        <div className="management-table__head" role="row"><span>Perfil</span><span>Operador</span><span>Ventana</span><span>Estado</span><span aria-hidden="true" /></div>
        {assignments.map((item) => {
          const profile = profileById.get(item.profileId);
          const operator = userById.get(item.operatorId);
          const isActive = item.status === 'ACTIVE';
          const isBusy = busyAssignmentId === item.id;
          return <div className="management-table__row" role="row" key={item.id}>
            <div className="management-identity" role="cell"><span className="profile-avatar profile-avatar--small">{(profile?.displayName ?? 'PF').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{profile?.displayName ?? 'Perfil no disponible'}</strong><small>{item.shiftId ? 'Vinculada a turno' : 'Ventana libre'}</small></span></div>
            <span className="management-muted" role="cell">{operator?.fullName ?? 'Operador no disponible'}</span>
            <span className="management-muted" role="cell">{formatRange(item.validRange)}</span>
            <span role="cell"><span className={`management-status management-status--${isActive ? 'active' : 'ended'}`}>{isActive ? 'Activa' : item.endReason === 'HANDOFF' ? 'Relevo cerrado' : 'Finalizada'}</span></span>
            <div className="management-actions" role="cell">{canUpdate && isActive && <><button className="row-action" type="button" onClick={() => openHandoff(item)}>Preparar relevo</button><button className="row-action row-action--danger" type="button" onClick={() => void endAssignment(item)} disabled={isBusy}>{isBusy ? '…' : 'Finalizar'}</button></>}</div>
          </div>;
        })}
      </div>}
    </section>
  );
}
