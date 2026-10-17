import { useEffect, useState, type FormEvent } from 'react';
import { ipAllowlistRecordSchema, managedUserSchema, roleRecordSchema, type IpAllowlistRecord, type ManagedUser, type RoleRecord, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, errorMessage } from '../OperationsManagement/management-view';
import { formatSecurityDate, scopeLabel } from './security-view';

interface IpAllowlistPanelProps {
  accessToken: string | null;
  user: UserSummary;
}

type Scope = 'ALL' | 'ROLE' | 'USER';
interface AllowlistForm {
  label: string;
  cidr: string;
  scope: Scope;
  roleId: string;
  userId: string;
  expiresAt: string;
}

const emptyForm: AllowlistForm = { label: '', cidr: '', scope: 'ALL', roleId: '', userId: '', expiresAt: '' };

function isExpired(item: IpAllowlistRecord): boolean {
  return Boolean(item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now());
}

export function IpAllowlistPanel({ accessToken, user }: IpAllowlistPanelProps) {
  const [entries, setEntries] = useState<IpAllowlistRecord[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [form, setForm] = useState<AllowlistForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const userRequest = canManage(user.permissions, 'users.read') ? apiClient.request<unknown>('/users') : Promise.resolve([]);
      const roleRequest = canManage(user.permissions, 'rbac.read') ? apiClient.request<unknown>('/roles') : Promise.resolve([]);
      const [rawEntries, rawUsers, rawRoles] = await Promise.all([apiClient.request<unknown>('/settings/ip-allowlist'), userRequest, roleRequest]);
      setEntries(ipAllowlistRecordSchema.array().parse(rawEntries));
      setUsers(managedUserSchema.array().parse(rawUsers));
      setRoles(roleRecordSchema.array().parse(rawRoles));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar la allowlist IP.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [accessToken, user.permissions]);

  function updateField(field: keyof AllowlistForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    setForm(emptyForm);
    setNotice(null);
    setError(null);
    setIsFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!form.label.trim() || !form.cidr.trim()) {
      setError('La etiqueta y el CIDR son obligatorios.');
      return;
    }
    if (form.scope === 'ROLE' && !form.roleId) {
      setError('Selecciona el rol al que aplica la regla.');
      return;
    }
    if (form.scope === 'USER' && !form.userId) {
      setError('Selecciona el usuario al que aplica la regla.');
      return;
    }
    setIsSaving(true);
    try {
      await apiClient.request('/settings/ip-allowlist', {
        method: 'POST',
        body: JSON.stringify({
          label: form.label.trim(),
          cidr: form.cidr.trim(),
          scope: form.scope,
          ...(form.scope === 'ROLE' ? { roleId: form.roleId } : {}),
          ...(form.scope === 'USER' ? { userId: form.userId } : {}),
          ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
        }),
      });
      setNotice('Regla IP creada y auditada.');
      setIsFormOpen(false);
      setForm(emptyForm);
      await load();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear la regla IP.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function disable(item: IpAllowlistRecord) {
    if (entries.filter((entry) => entry.isActive && !isExpired(entry)).length <= 1) {
      setError('No se puede deshabilitar la última regla activa. Agrega y verifica otra red antes de retirar esta.');
      return;
    }
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/settings/ip-allowlist/${item.id}/disable`, { method: 'POST', body: '{}' });
      setNotice(`La regla «${item.label}» quedó deshabilitada.`);
      await load();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos deshabilitar la regla IP.'));
    } finally {
      setBusyId(null);
    }
  }

  const roleById = new Map(roles.map((role) => [role.id, role.name]));
  const userById = new Map(users.map((item) => [item.id, item.fullName]));

  return (
    <section className="panel security-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="ip-allowlist" aria-labelledby="ip-allowlist-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Perímetro de acceso</p><h2 id="ip-allowlist-title">Allowlist IP</h2></div>
        <button className="primary-button primary-button--compact" type="button" onClick={openCreate}>Agregar red <span aria-hidden="true">+</span></button>
      </header>
      <p className="management-panel__note">Solo las redes activas y no vencidas pueden entrar a la API. Agrega y verifica una red nueva antes de deshabilitar la anterior para no bloquear la operación.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {isFormOpen && <form className="management-form" onSubmit={(event) => void submit(event)}>
        <div className="management-form__heading"><div><span className="panel-kicker">Nueva regla</span><strong>Autoriza una red de confianza</strong></div><button className="quiet-button" type="button" onClick={() => setIsFormOpen(false)}>Cerrar</button></div>
        <div className="management-form__grid">
          <label><span>Etiqueta</span><input required maxLength={160} value={form.label} onChange={(event) => updateField('label', event.target.value)} placeholder="Oficina principal" /></label>
          <label><span>Red CIDR</span><input required maxLength={64} value={form.cidr} onChange={(event) => updateField('cidr', event.target.value)} placeholder="203.0.113.10/32" /></label>
          <label><span>Alcance</span><select value={form.scope} onChange={(event) => updateField('scope', event.target.value)}><option value="ALL">Toda la operación</option><option value="ROLE">Rol específico</option><option value="USER">Usuario específico</option></select></label>
          {form.scope === 'ROLE' && <label><span>Rol</span><select required value={form.roleId} onChange={(event) => updateField('roleId', event.target.value)}><option value="">Selecciona un rol</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>}
          {form.scope === 'USER' && <label><span>Usuario</span><select required value={form.userId} onChange={(event) => updateField('userId', event.target.value)}><option value="">Selecciona un usuario</option>{users.map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.email}</option>)}</select></label>}
          <label><span>Vencimiento opcional</span><input type="datetime-local" value={form.expiresAt} onChange={(event) => updateField('expiresAt', event.target.value)} /></label>
        </div>
        <p className="management-form__hint">El CIDR se valida nuevamente en el backend. Las reglas vencidas dejan de aplicar automáticamente.</p>
        <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : 'Crear regla'} <span aria-hidden="true">↗</span></button></div>
      </form>}

      {isLoading && <p className="panel-state">Cargando redes autorizadas…</p>}
      {!isLoading && !entries.length && <p className="panel-state">No hay reglas registradas. La API protegida permanecerá cerrada hasta configurar una.</p>}
      {!isLoading && entries.length > 0 && <div className="security-table security-table--allowlist" role="table" aria-label="Allowlist IP">
        <div className="security-table__head" role="row"><span>Red autorizada</span><span>Alcance</span><span>Vigencia</span><span>Estado</span><span>Acciones</span></div>
        {entries.map((item) => {
          const expired = isExpired(item);
          const active = item.isActive && !expired;
          const target = item.scope === 'ROLE' ? roleById.get(item.roleId ?? '') ?? 'Rol no disponible' : item.scope === 'USER' ? userById.get(item.userId ?? '') ?? 'Usuario no disponible' : 'Todos los usuarios';
          return <div className="security-table__row" role="row" key={item.id}>
            <div role="cell"><strong>{item.label}</strong><small>{item.cidr}</small></div>
            <div role="cell"><strong>{scopeLabel(item.scope)}</strong><small>{target}</small></div>
            <span className="management-muted" role="cell">{item.expiresAt ? formatSecurityDate(item.expiresAt) : 'Sin vencimiento'}</span>
            <span className={`security-device-status ${active ? 'is-approved' : 'is-revoked'}`} role="cell">{active ? 'Activa' : expired ? 'Vencida' : 'Deshabilitada'}</span>
            <div className="management-actions" role="cell">{active && <button className="row-action row-action--danger" type="button" onClick={() => void disable(item)} disabled={busyId === item.id}>{busyId === item.id ? '…' : 'Deshabilitar'}</button>}</div>
          </div>;
        })}
      </div>}
    </section>
  );
}
