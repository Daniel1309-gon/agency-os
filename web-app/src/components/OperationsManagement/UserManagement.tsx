import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { managedUserSchema, roleRecordSchema, type ManagedUser, type RoleRecord, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { roleLabels } from '../../types/roles';
import { canManage, errorMessage } from './management-view';

interface UserManagementProps {
  accessToken: string | null;
  user: UserSummary;
}

interface UserForm {
  fullName: string;
  email: string;
  password: string;
  roleCode: string;
  phone: string;
}

const emptyForm: UserForm = { fullName: '', email: '', password: '', roleCode: 'OPERADOR', phone: '' };

function statusLabel(status: ManagedUser['status']): string {
  return status === 'ACTIVE' ? 'Activo' : status === 'SUSPENDED' ? 'Suspendido' : 'Deshabilitado';
}

export function UserManagement({ accessToken, user }: UserManagementProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const requests: [Promise<unknown>, Promise<unknown> | null] = [apiClient.request<unknown>('/users'), canManage(user.permissions, 'rbac.read') ? apiClient.request<unknown>('/roles') : null];
      const [rawUsers, rawRoles] = await Promise.all(requests);
      setUsers(managedUserSchema.array().parse(rawUsers));
      setRoles(rawRoles ? roleRecordSchema.array().parse(rawRoles) : []);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar los usuarios.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadUsers();
  }, [accessToken, loadUsers]);

  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    if (!normalized) return users;
    return users.filter((item) => `${item.fullName} ${item.email}`.toLocaleLowerCase('es').includes(normalized));
  }, [query, users]);
  const canCreate = canManage(user.permissions, 'users.create');
  const canUpdate = canManage(user.permissions, 'users.update');
  const canDisable = canManage(user.permissions, 'users.disable');

  function updateField(field: keyof UserForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setNotice(null);
    setError(null);
    setIsFormOpen(true);
  }

  function openEdit(item: ManagedUser) {
    setEditingId(item.id);
    setForm({
      fullName: item.fullName,
      email: item.email,
      password: '',
      roleCode: item.roleCode,
      phone: item.phone ?? '',
    });
    setNotice(null);
    setError(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await apiClient.request(`/users/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ fullName: form.fullName, phone: form.phone || undefined, roleCode: form.roleCode }),
        });
        setNotice('Usuario actualizado correctamente.');
      } else {
        await apiClient.request('/users', {
          method: 'POST',
          body: JSON.stringify({ fullName: form.fullName, email: form.email, password: form.password, roleCode: form.roleCode, phone: form.phone || undefined }),
        });
        setNotice('Usuario creado. Deberá cambiar la contraseña en su primer acceso.');
      }
      closeForm();
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos guardar el usuario.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function disable(item: ManagedUser) {
    setBusyUserId(item.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/users/${item.id}/disable`, { method: 'POST', body: '{}' });
      setNotice(`${item.fullName} quedó deshabilitado.`);
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos deshabilitar el usuario.'));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="panel management-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="section-04" aria-labelledby="users-management-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Acceso y equipo</p><h2 id="users-management-title">Usuarios y roles</h2></div>
        {canCreate && <button className="primary-button primary-button--compact" type="button" onClick={openCreate}>Nuevo usuario <span aria-hidden="true">+</span></button>}
      </header>
      <p className="management-panel__note">Gestiona operadores y coordinadores sin exponer contraseñas existentes. Las nuevas credenciales se entregan para cambio obligatorio.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {isFormOpen && (canCreate || canUpdate) && <form className="management-form" onSubmit={(event) => void submit(event)}>
        <div className="management-form__heading"><div><span className="panel-kicker">{editingId ? 'Editar registro' : 'Alta de usuario'}</span><strong>{editingId ? 'Actualiza los datos operativos' : 'Crea un acceso con rol explícito'}</strong></div><button className="quiet-button" type="button" onClick={closeForm}>Cerrar</button></div>
        <div className="management-form__grid">
          <label><span>Nombre completo</span><input required value={form.fullName} onChange={(event) => updateField('fullName', event.target.value)} /></label>
          <label><span>Correo</span><input required={!editingId} disabled={Boolean(editingId)} type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} /></label>
          {!editingId && <label><span>Contraseña inicial</span><input required minLength={12} maxLength={72} type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} /></label>}
          <label><span>Rol</span><select value={form.roleCode} onChange={(event) => updateField('roleCode', event.target.value)}>{roles.map((role) => <option key={role.id} value={role.code}>{roleLabels[role.code] ?? role.name}</option>)}</select></label>
          <label><span>Teléfono</span><input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></label>
        </div>
        <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear usuario'} <span aria-hidden="true">↗</span></button></div>
      </form>}

      <div className="management-toolbar"><label className="management-search"><span>Buscar usuario</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o correo" /></label><button className="quiet-button" type="button" onClick={() => void loadUsers()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button></div>
      {isLoading && <p className="panel-state">Cargando usuarios…</p>}
      {!isLoading && !filteredUsers.length && <p className="panel-state">No hay usuarios que coincidan con la búsqueda.</p>}
      {!isLoading && filteredUsers.length > 0 && <div className="management-table" role="table" aria-label="Usuarios de Agency OS">
        <div className="management-table__head" role="row"><span>Persona</span><span>Rol</span><span>Estado</span><span>Último acceso</span><span aria-hidden="true" /></div>
        {filteredUsers.map((item) => {
          const role = roleById.get(item.roleId);
          const initials = item.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
          const isBusy = busyUserId === item.id;
          return <div className="management-table__row" role="row" key={item.id}>
            <div className="management-identity" role="cell"><span className="profile-avatar profile-avatar--small">{initials}</span><span><strong>{item.fullName}</strong><small>{item.email}</small></span></div>
            <span className="management-muted" role="cell">{role ? roleLabels[role.code] ?? role.name : roleLabels[item.roleCode]}</span>
            <span role="cell"><span className={`management-status management-status--${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></span>
            <span className="management-muted" role="cell">{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleDateString('es-CO') : 'Sin acceso'}</span>
            <div className="management-actions" role="cell">{canUpdate && <button className="row-action" type="button" onClick={() => openEdit(item)}>Editar</button>}{canDisable && item.status === 'ACTIVE' && <button className="row-action row-action--danger" type="button" onClick={() => void disable(item)} disabled={isBusy}>{isBusy ? '…' : 'Deshabilitar'}</button>}</div>
          </div>;
        })}
      </div>}
    </section>
  );
}
