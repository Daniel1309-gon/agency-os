import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { channelRecordSchema, managedUserSchema, scheduledMessageRecordSchema, type ChannelRecord, type ManagedUser, type ScheduledMessageRecord, type ScheduledMessageStatus, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { WEEKDAYS, canManage, errorMessage, toLocalDateTime } from './management-view';
import { buildScheduledMessagePayload, recurrenceLabel, scheduledAtLabel, scheduledStatusLabel, type ScheduledMessageFormValues } from './scheduled-messages-view';

interface ScheduledMessagesPanelProps {
  accessToken: string | null;
  user: UserSummary;
}

type TargetKind = 'CHANNEL' | 'OPERATOR';

const emptyForm: ScheduledMessageFormValues = {
  channelId: '',
  targetUserId: '',
  body: '',
  scheduledFor: toLocalDateTime(new Date(Date.now() + 10 * 60_000)),
  frequency: 'NONE',
  weekdays: [],
  until: '',
};

function statusClass(status: ScheduledMessageStatus): string {
  if (status === 'SENT') return 'management-status management-status--active';
  if (status === 'FAILED') return 'management-status management-status--suspended';
  if (status === 'SKIPPED' || status === 'CANCELLED') return 'management-status management-status--ended';
  return 'management-status';
}

export function ScheduledMessagesPanel({ accessToken, user }: ScheduledMessagesPanelProps) {
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [messages, setMessages] = useState<ScheduledMessageRecord[]>([]);
  const [form, setForm] = useState<ScheduledMessageFormValues>(emptyForm);
  const [targetKind, setTargetKind] = useState<TargetKind>('CHANNEL');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const operators = useMemo(() => users.filter((item) => item.status === 'ACTIVE' && item.roleCode === 'OPERADOR'), [users]);
  const channelById = useMemo(() => new Map(channels.map((item) => [item.id, item])), [channels]);
  const userById = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const canSchedule = canManage(user.permissions, 'chat.manage');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rawChannels, rawUsers, rawMessages] = await Promise.all([
        apiClient.request<unknown>('/rocketchat/channels'),
        apiClient.request<unknown>('/users'),
        apiClient.request<unknown>('/scheduled-messages'),
      ]);
      setChannels(channelRecordSchema.array().parse(rawChannels));
      setUsers(managedUserSchema.array().parse(rawUsers));
      setMessages(scheduledMessageRecordSchema.array().parse(rawMessages));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar los canales y mensajes programados.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadData();
  }, [accessToken, loadData]);

  function updateField<K extends keyof ScheduledMessageFormValues>(field: K, value: ScheduledMessageFormValues[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleWeekday(weekday: number) {
    setForm((current) => ({
      ...current,
      weekdays: current.weekdays.includes(weekday) ? current.weekdays.filter((day) => day !== weekday) : [...current.weekdays, weekday],
    }));
  }

  async function createMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = buildScheduledMessagePayload(targetKind === 'CHANNEL' ? { ...form, targetUserId: '' } : { ...form, channelId: '' });
      await apiClient.request('/scheduled-messages', { method: 'POST', body: JSON.stringify(payload) });
      setNotice(payload.recurrenceRule ? 'Serie programada. Cada ocurrencia se entrega por Rocket.Chat.' : 'Mensaje programado para su envío por Rocket.Chat.');
      setForm({ ...emptyForm, scheduledFor: form.scheduledFor, body: '' });
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos programar el mensaje.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function cancelMessage(message: ScheduledMessageRecord) {
    setBusyId(message.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/scheduled-messages/${message.id}`, { method: 'DELETE' });
      setNotice(message.recurrenceRule ? 'Serie cancelada: no se enviarán más ocurrencias.' : 'Mensaje cancelado.');
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cancelar el mensaje.'));
    } finally {
      setBusyId(null);
    }
  }

  function targetLabel(message: ScheduledMessageRecord): string {
    if (message.channelId) return channelById.get(message.channelId)?.name ?? 'Canal';
    return userById.get(message.targetUserId ?? '')?.fullName ?? 'Operador';
  }

  return (
    <section className="management-schedule motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" aria-labelledby="scheduled-messages-title">
      <div className="management-section-heading"><div><p className="panel-kicker">Comunicación interna</p><h2 id="scheduled-messages-title">Mensajes programados</h2><p>Avisos puntuales o recurrentes entregados por Rocket.Chat.</p></div><button className="quiet-button" type="button" onClick={() => void loadData()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button></div>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {isLoading && <p className="panel-state">Cargando canales y mensajes…</p>}
      {!isLoading && <div className="management-schedule__grid">
        <form className="panel management-form" onSubmit={(event) => void createMessage(event)}>
          <div className="management-form__heading"><div><span className="panel-kicker">Nuevo aviso</span><strong>Programar mensaje</strong></div><span className="management-form__hint">{messages.filter((item) => item.status === 'PENDING').length} pendientes</span></div>
          <div className="management-form__grid">
            <label><span>Destino</span><select value={targetKind} onChange={(event) => setTargetKind(event.target.value as TargetKind)}><option value="CHANNEL">Canal</option><option value="OPERATOR">Operador</option></select></label>
            {targetKind === 'CHANNEL'
              ? <label><span>Canal</span><select required value={form.channelId} onChange={(event) => updateField('channelId', event.target.value)}><option value="">Selecciona un canal</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              : <label><span>Operador</span><select required value={form.targetUserId} onChange={(event) => updateField('targetUserId', event.target.value)}><option value="">Selecciona un operador</option>{operators.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>}
            <label><span>Envío</span><input required type="datetime-local" value={form.scheduledFor} onChange={(event) => updateField('scheduledFor', event.target.value)} /></label>
            <label><span>Repetición</span><select value={form.frequency} onChange={(event) => updateField('frequency', event.target.value as ScheduledMessageFormValues['frequency'])}><option value="NONE">Una vez</option><option value="DAILY">Cada día</option><option value="WEEKLY">Semanal</option></select></label>
            {form.frequency !== 'NONE' && <label><span>Repetir hasta (incluido)</span><input type="date" value={form.until} onChange={(event) => updateField('until', event.target.value)} /></label>}
            {form.frequency === 'WEEKLY' && <fieldset className="management-form__wide"><legend>Días de la semana</legend><div className="weekday-picker">{WEEKDAYS.map((day) => <label key={day.value}><input type="checkbox" checked={form.weekdays.includes(day.value)} onChange={() => toggleWeekday(day.value)} />{day.label}</label>)}</div></fieldset>}
            <label className="management-form__wide"><span>Mensaje</span><textarea required rows={3} maxLength={4000} value={form.body} onChange={(event) => updateField('body', event.target.value)} placeholder="Texto que recibirán en Rocket.Chat" /></label>
          </div>
          {canSchedule ? <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Programando…' : 'Programar'} <Plus className="h-4 w-4" aria-hidden="true" /></button></div> : <p className="management-form__hint">Tu rol puede consultar los mensajes, pero no programarlos.</p>}
        </form>

        <section className="panel" aria-label="Mensajes programados">
          <header className="panel-header"><div><p className="panel-kicker">Cola y historial</p><h3>Mensajes de la serie</h3></div></header>
          {!messages.length && <p className="panel-state">Todavía no hay mensajes programados.</p>}
          {messages.length > 0 && <div className="management-mini-list">{messages.map((item) => <div className="management-mini-row" key={item.id}>
            <span><strong>{targetLabel(item)} · {recurrenceLabel(item.recurrenceRule)}</strong><small>{scheduledAtLabel(item.scheduledFor)} · {item.body}</small>{item.lastError && <small role="note">{item.lastError}</small>}</span>
            <span className={statusClass(item.status)}>{scheduledStatusLabel(item.status)}</span>
            {item.status === 'PENDING' && canSchedule && <button className="row-action row-action--danger" type="button" onClick={() => void cancelMessage(item)} disabled={busyId === item.id}>{busyId === item.id ? '…' : 'Cancelar'}</button>}
          </div>)}</div>}
        </section>
      </div>}
    </section>
  );
}
