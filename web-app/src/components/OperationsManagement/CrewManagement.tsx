import { useCallback, useEffect, useMemo, useState } from 'react';
import { crewMemberRecordSchema, crewRecordSchema, managedUserSchema, type CrewMemberRecord, type CrewRecord, type ManagedUser, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, daySpanLabel } from './management-view';
import { CrewForm } from './CrewForm';
import { CrewMemberForm } from './CrewMemberForm';

interface CrewManagementProps {
  accessToken: string | null;
  user: UserSummary;
}

export function CrewManagement({ accessToken, user }: CrewManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [crews, setCrews] = useState<CrewRecord[]>([]);
  const [selectedCrewId, setSelectedCrewId] = useState('');
  const [members, setMembers] = useState<CrewMemberRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const operators = useMemo(() => users.filter((item) => item.status === 'ACTIVE' && item.roleCode === 'OPERADOR'), [users]);
  const coordinators = useMemo(() => users.filter((item) => item.status === 'ACTIVE' && item.roleCode === 'COORDINADOR'), [users]);
  const userById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const canManageCrews = canManage(user.permissions, 'crews.manage');
  const canChooseCoordinator = user.role === 'ADMIN' || user.role === 'DIRECTOR_OPERATIVO';
  const selectedCrew = crews.find((crew) => crew.id === selectedCrewId) ?? null;

  const loadCrews = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rawUsers, rawCrews] = await Promise.all([
        apiClient.request<unknown>('/users'),
        apiClient.request<unknown>('/crews'),
      ]);
      setUsers(managedUserSchema.array().parse(rawUsers));
      const parsedCrews = crewRecordSchema.array().parse(rawCrews);
      setCrews(parsedCrews);
      setSelectedCrewId((current) => parsedCrews.some((crew) => crew.id === current) ? current : parsedCrews[0]?.id ?? '');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar las cuadrillas.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (crewId: string) => {
    if (!crewId) {
      setMembers([]);
      return;
    }
    setIsLoadingMembers(true);
    try {
      const raw = await apiClient.request<unknown>(`/crews/${crewId}/members`);
      setMembers(crewMemberRecordSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar los miembros de la cuadrilla.');
    } finally {
      setIsLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadCrews();
  }, [accessToken, loadCrews]);

  useEffect(() => {
    if (accessToken) void loadMembers(selectedCrewId);
  }, [accessToken, selectedCrewId, loadMembers]);

  function handleCrewCreated(created: CrewRecord) {
    setCrews((current) => [created, ...current]);
    setSelectedCrewId(created.id);
    setNotice(`Cuadrilla «${created.name}» creada. Ya podés sumarle operadores.`);
  }

  async function reloadAfterMembership() {
    await loadMembers(selectedCrewId);
    await loadCrews();
  }

  async function removeMember(member: CrewMemberRecord) {
    if (!selectedCrewId) return;
    setBusyUserId(member.userId);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/crews/${selectedCrewId}/members/${member.userId}`, { method: 'DELETE' });
      setNotice(`${userById.get(member.userId)?.fullName ?? 'El operador'} salió de la cuadrilla. Su vigencia se cerró hoy.`);
      await reloadAfterMembership();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos quitar al operador.');
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="management-layout">
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {isLoading && <p className="panel-state">Cargando cuadrillas…</p>}

      {!isLoading && <div className="management-schedule__grid">
        {canManageCrews && <CrewForm canChooseCoordinator={canChooseCoordinator} coordinators={coordinators} onCreated={handleCrewCreated} />}
        {canManageCrews && <CrewMemberForm crews={crews} operators={operators} crewId={selectedCrewId} onSelectCrew={setSelectedCrewId} onAdded={() => void reloadAfterMembership()} />}

        <section className="panel" aria-labelledby="crew-list-title">
          <header className="panel-header">
            <div><p className="panel-kicker">Cuadrillas activas</p><h3 id="crew-list-title">{crews.length} en tu alcance</h3></div>
            <button className="quiet-button" type="button" onClick={() => void loadCrews()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
          </header>
          {!crews.length && <p className="panel-state">Todavía no hay cuadrillas. {canManageCrews ? 'Crea la primera para agrupar operadores.' : 'Pide a un coordinador que cree una.'}</p>}
          {crews.length > 0 && <div className="management-mini-list">
            {crews.map((crew) => <div className="management-mini-row" key={crew.id}>
              <span>
                <strong>{crew.name}</strong>
                <small>{crew.coordinatorId ? `Coordina ${userById.get(crew.coordinatorId)?.fullName ?? 'un usuario fuera de tu alcance'}` : 'Sin coordinador asignado'}</small>
              </span>
              {crew.id === selectedCrewId
                ? <span className="management-status management-status--active">Seleccionada</span>
                : <button className="row-action" type="button" onClick={() => setSelectedCrewId(crew.id)}>Ver miembros</button>}
            </div>)}
          </div>}
        </section>

        <section className="panel" aria-labelledby="crew-members-title">
          <header className="panel-header">
            <div><p className="panel-kicker">Vigentes hoy</p><h3 id="crew-members-title">{selectedCrew ? `Miembros de ${selectedCrew.name}` : 'Miembros'}</h3></div>
            {selectedCrew && <button className="quiet-button" type="button" onClick={() => void loadMembers(selectedCrewId)} disabled={isLoadingMembers}>Actualizar <span aria-hidden="true">↻</span></button>}
          </header>
          {!selectedCrew && <p className="panel-state">Elige una cuadrilla para ver sus miembros.</p>}
          {selectedCrew && isLoadingMembers && <p className="panel-state">Cargando miembros…</p>}
          {selectedCrew && !isLoadingMembers && !members.length && <p className="panel-state">Esta cuadrilla no tiene operadores vigentes.</p>}
          {selectedCrew && !isLoadingMembers && members.length > 0 && <div className="management-mini-list">
            {members.map((member) => {
              const operator = userById.get(member.userId);
              const isBusy = busyUserId === member.userId;
              return <div className="management-mini-row" key={member.id}>
                <span>
                  <strong>{operator?.fullName ?? 'Operador fuera de tu alcance'}</strong>
                  <small>{operator?.email ?? 'Sin correo disponible'} · {daySpanLabel(member.validRange)}</small>
                </span>
                {canManageCrews
                  ? <button className="row-action row-action--danger" type="button" onClick={() => void removeMember(member)} disabled={isBusy}>{isBusy ? '…' : 'Quitar'}</button>
                  : <span className="management-status management-status--active">Vigente</span>}
              </div>;
            })}
          </div>}
        </section>
      </div>}
    </div>
  );
}
