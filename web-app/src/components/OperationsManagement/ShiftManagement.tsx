import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createdShiftSchema, managedUserSchema, shiftOverrideRecordSchema, shiftTemplateRecordSchema, type CreatedShift, type ManagedUser, type ShiftOverrideRecord, type ShiftTemplateRecord, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, errorMessage, formatRange, toIsoDateTime, toLocalDateTime } from './management-view';

interface ShiftManagementProps {
  accessToken: string | null;
  user: UserSummary;
}

interface ShiftForm {
  operatorId: string;
  businessDate: string;
  scheduledFrom: string;
  scheduledTo: string;
  templateId: string;
  breakType: string;
  breakAt: string;
  notes: string;
}

interface OverrideForm {
  operatorId: string;
  validFrom: string;
  validTo: string;
  type: 'OVERTIME' | 'EXTENDED_SHIFT' | 'SPECIAL_PERMISSION';
  reason: string;
}

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localPlusHours(hours: number): string {
  return toLocalDateTime(new Date(Date.now() + hours * 60 * 60 * 1000));
}

const emptyShiftForm: ShiftForm = { operatorId: '', businessDate: localDate(), scheduledFrom: toLocalDateTime(new Date()), scheduledTo: localPlusHours(8), templateId: '', breakType: '', breakAt: '', notes: '' };
const emptyOverrideForm: OverrideForm = { operatorId: '', validFrom: toLocalDateTime(new Date()), validTo: localPlusHours(1), type: 'OVERTIME', reason: '' };

function typeLabel(type: OverrideForm['type']): string {
  return type === 'OVERTIME' ? 'Hora extra' : type === 'EXTENDED_SHIFT' ? 'Turno extendido' : 'Permiso especial';
}

export function ShiftManagement({ accessToken, user }: ShiftManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplateRecord[]>([]);
  const [createdShifts, setCreatedShifts] = useState<CreatedShift[]>([]);
  const [createdOverrides, setCreatedOverrides] = useState<ShiftOverrideRecord[]>([]);
  const [shiftForm, setShiftForm] = useState<ShiftForm>(emptyShiftForm);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(emptyOverrideForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingShift, setIsSavingShift] = useState(false);
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [busyOverrideId, setBusyOverrideId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const operators = useMemo(() => users.filter((item) => item.status === 'ACTIVE' && item.roleCode === 'OPERADOR'), [users]);
  const userById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const canManageShifts = canManage(user.permissions, 'shifts.manage');
  const canApproveOverrides = canManage(user.permissions, 'shifts.approve_overtime');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rawUsers, rawTemplates] = await Promise.all([
        apiClient.request<unknown>('/users'),
        apiClient.request<unknown>('/shift-templates'),
      ]);
      setUsers(managedUserSchema.array().parse(rawUsers));
      setTemplates(shiftTemplateRecordSchema.array().parse(rawTemplates));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar los operadores y plantillas.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadData();
  }, [accessToken, loadData]);

  function updateShiftField(field: keyof ShiftForm, value: string) {
    setShiftForm((current) => ({ ...current, [field]: value }));
  }

  function updateOverrideField(field: keyof OverrideForm, value: string) {
    setOverrideForm((current) => ({ ...current, [field]: value as OverrideForm[typeof field] }));
  }

  async function createShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingShift(true);
    setError(null);
    setNotice(null);
    try {
      const breaks = shiftForm.breakAt && shiftForm.breakType ? [{ type: shiftForm.breakType, scheduledAt: toIsoDateTime(shiftForm.breakAt) }] : [];
      const raw = await apiClient.request<unknown>('/shifts', { method: 'POST', body: JSON.stringify({ operatorId: shiftForm.operatorId, businessDate: shiftForm.businessDate, scheduledFrom: toIsoDateTime(shiftForm.scheduledFrom), scheduledTo: toIsoDateTime(shiftForm.scheduledTo), templateId: shiftForm.templateId || undefined, notes: shiftForm.notes || undefined, breaks }) });
      const created = createdShiftSchema.parse(raw);
      setCreatedShifts((current) => [created, ...current].slice(0, 5));
      setNotice('Turno creado y disponible para las asignaciones de perfiles.');
      setShiftForm({ ...emptyShiftForm, operatorId: shiftForm.operatorId, businessDate: shiftForm.businessDate });
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear el turno.'));
    } finally {
      setIsSavingShift(false);
    }
  }

  async function createOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingOverride(true);
    setError(null);
    setNotice(null);
    try {
      const raw = await apiClient.request<unknown>('/shift-overrides', { method: 'POST', body: JSON.stringify({ operatorId: overrideForm.operatorId, validFrom: toIsoDateTime(overrideForm.validFrom), validTo: toIsoDateTime(overrideForm.validTo), type: overrideForm.type, reason: overrideForm.reason }) });
      const created = shiftOverrideRecordSchema.parse(raw);
      setCreatedOverrides((current) => [created, ...current].slice(0, 5));
      setNotice('Override creado y auditado.');
      setOverrideForm({ ...emptyOverrideForm, operatorId: overrideForm.operatorId });
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear el override.'));
    } finally {
      setIsSavingOverride(false);
    }
  }

  async function revokeOverride(item: ShiftOverrideRecord) {
    setBusyOverrideId(item.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/shift-overrides/${item.id}`, { method: 'DELETE' });
      setCreatedOverrides((current) => current.map((entry) => entry.id === item.id ? { ...entry, revokedAt: new Date().toISOString() } : entry));
      setNotice('Override revocado.');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos revocar el override.'));
    } finally {
      setBusyOverrideId(null);
    }
  }

  return (
    <section className="management-schedule motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="section-07" aria-labelledby="schedule-management-title">
      <div className="management-section-heading"><div><p className="panel-kicker">Cobertura operativa</p><h2 id="schedule-management-title">Turnos y overrides</h2><p>Programa jornadas y excepciones horarias con trazabilidad.</p></div><button className="quiet-button" type="button" onClick={() => void loadData()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button></div>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {isLoading && <p className="panel-state">Cargando operadores y plantillas…</p>}
      {!isLoading && <div className="management-schedule__grid">
        <form className="panel management-form" onSubmit={(event) => void createShift(event)}>
          <div className="management-form__heading"><div><span className="panel-kicker">Nueva jornada</span><strong>Crear turno</strong></div><span className="management-form__hint">{templates.length} plantillas activas</span></div>
          <div className="management-form__grid">
            <label><span>Operador</span><select required value={shiftForm.operatorId} onChange={(event) => updateShiftField('operatorId', event.target.value)}><option value="">Selecciona un operador</option>{operators.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
            <label><span>Fecha operativa</span><input required type="date" value={shiftForm.businessDate} onChange={(event) => updateShiftField('businessDate', event.target.value)} /></label>
            <label><span>Inicio</span><input required type="datetime-local" value={shiftForm.scheduledFrom} onChange={(event) => updateShiftField('scheduledFrom', event.target.value)} /></label>
            <label><span>Fin</span><input required type="datetime-local" value={shiftForm.scheduledTo} onChange={(event) => updateShiftField('scheduledTo', event.target.value)} /></label>
            <label><span>Plantilla</span><select value={shiftForm.templateId} onChange={(event) => updateShiftField('templateId', event.target.value)}><option value="">Sin plantilla</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.startTime}–{item.endTime}</option>)}</select></label>
            <label><span>Tipo de descanso</span><input value={shiftForm.breakType} placeholder="REST" onChange={(event) => updateShiftField('breakType', event.target.value)} /></label>
            <label><span>Hora de descanso</span><input type="datetime-local" value={shiftForm.breakAt} onChange={(event) => updateShiftField('breakAt', event.target.value)} /></label>
            <label className="management-form__wide"><span>Notas</span><textarea rows={2} maxLength={1000} value={shiftForm.notes} onChange={(event) => updateShiftField('notes', event.target.value)} /></label>
          </div>
          {canManageShifts ? <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSavingShift}>{isSavingShift ? 'Creando…' : 'Crear turno'} <span aria-hidden="true">↗</span></button></div> : <p className="management-form__hint">Tu rol puede consultar la cobertura, pero no crear turnos.</p>}
        </form>

        <form className="panel management-form" onSubmit={(event) => void createOverride(event)}>
          <div className="management-form__heading"><div><span className="panel-kicker">Excepción aprobada</span><strong>Crear override</strong></div><span className="management-form__hint">Requiere aprobación</span></div>
          <div className="management-form__grid">
            <label><span>Operador</span><select required value={overrideForm.operatorId} onChange={(event) => updateOverrideField('operatorId', event.target.value)}><option value="">Selecciona un operador</option>{operators.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
            <label><span>Tipo</span><select value={overrideForm.type} onChange={(event) => updateOverrideField('type', event.target.value)}><option value="OVERTIME">Hora extra</option><option value="EXTENDED_SHIFT">Turno extendido</option><option value="SPECIAL_PERMISSION">Permiso especial</option></select></label>
            <label><span>Desde</span><input required type="datetime-local" value={overrideForm.validFrom} onChange={(event) => updateOverrideField('validFrom', event.target.value)} /></label>
            <label><span>Hasta</span><input required type="datetime-local" value={overrideForm.validTo} onChange={(event) => updateOverrideField('validTo', event.target.value)} /></label>
            <label className="management-form__wide"><span>Motivo</span><textarea required rows={3} maxLength={1000} value={overrideForm.reason} onChange={(event) => updateOverrideField('reason', event.target.value)} placeholder="Describe por qué se autoriza la excepción" /></label>
          </div>
          {canApproveOverrides ? <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSavingOverride}>{isSavingOverride ? 'Creando…' : 'Crear override'} <span aria-hidden="true">↗</span></button></div> : <p className="management-form__hint">Tu rol no tiene permiso para aprobar overrides.</p>}
        </form>
      </div>}

      {(createdShifts.length > 0 || createdOverrides.length > 0) && <div className="management-schedule__history">
        {createdShifts.length > 0 && <section className="panel"><header className="panel-header"><div><p className="panel-kicker">Confirmaciones recientes</p><h3>Turnos creados en esta sesión</h3></div></header><div className="management-mini-list">{createdShifts.map((item) => <div className="management-mini-row" key={item.id}><span><strong>{userById.get(item.operatorId)?.fullName ?? 'Operador'}</strong><small>{item.businessDate} · {formatRange(item.scheduledRange)}</small></span><span className="management-status management-status--active">Programado</span></div>)}</div></section>}
        {createdOverrides.length > 0 && <section className="panel"><header className="panel-header"><div><p className="panel-kicker">Excepciones recientes</p><h3>Overrides creados en esta sesión</h3></div></header><div className="management-mini-list">{createdOverrides.map((item) => <div className="management-mini-row" key={item.id}><span><strong>{userById.get(item.operatorId)?.fullName ?? 'Operador'} · {typeLabel(item.type)}</strong><small>{formatRange(item.range)} · {item.reason}</small></span>{item.revokedAt ? <span className="management-status management-status--ended">Revocado</span> : canApproveOverrides && <button className="row-action row-action--danger" type="button" onClick={() => void revokeOverride(item)} disabled={busyOverrideId === item.id}>{busyOverrideId === item.id ? '…' : 'Revocar'}</button>}</div>)}</div></section>}
      </div>}
    </section>
  );
}
