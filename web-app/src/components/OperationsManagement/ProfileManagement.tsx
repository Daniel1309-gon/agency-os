import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { profileListResponseSchema, type ProfileRecord, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, errorMessage } from './management-view';

interface ProfileManagementProps {
  accessToken: string | null;
  user: UserSummary;
}

interface ProfileForm {
  displayName: string;
  loginEmail: string;
  externalRef: string;
  country: string;
  chromeProfileDir: string;
  notes: string;
}

const emptyForm: ProfileForm = { displayName: '', loginEmail: '', externalRef: '', country: 'CO', chromeProfileDir: 'Default', notes: '' };

export function ProfileManagement({ accessToken, user }: ProfileManagementProps) {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/profiles?page=1&pageSize=100');
      setProfiles(profileListResponseSchema.parse(raw).data);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar los perfiles.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadProfiles();
  }, [accessToken, loadProfiles]);

  const filteredProfiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    if (!normalized) return profiles;
    return profiles.filter((item) => `${item.displayName} ${item.loginEmail} ${item.externalRef ?? ''}`.toLocaleLowerCase('es').includes(normalized));
  }, [profiles, query]);
  const canCreate = canManage(user.permissions, 'profiles.create');
  const canUpdate = canManage(user.permissions, 'profiles.update');

  function updateField(field: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setEditingVersion(0);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
    setIsFormOpen(true);
  }

  function openEdit(item: ProfileRecord) {
    setEditingId(item.id);
    setEditingVersion(item.version);
    setForm({ displayName: item.displayName, loginEmail: item.loginEmail, externalRef: item.externalRef ?? '', country: item.country ?? '', chromeProfileDir: item.chromeProfileDir ?? '', notes: item.notes ?? '' });
    setError(null);
    setNotice(null);
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
      const payload = { displayName: form.displayName, loginEmail: form.loginEmail, externalRef: form.externalRef || undefined, country: form.country || undefined, chromeProfileDir: form.chromeProfileDir || undefined, notes: form.notes || undefined };
      if (editingId) {
        await apiClient.request(`/profiles/${editingId}`, { method: 'PATCH', body: JSON.stringify({ ...payload, version: editingVersion }) });
        setNotice('Perfil actualizado correctamente.');
      } else {
        await apiClient.request('/profiles', { method: 'POST', body: JSON.stringify(payload) });
        setNotice('Perfil creado. Recuerda asociar su credencial desde el vault seguro.');
      }
      closeForm();
      await loadProfiles();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos guardar el perfil.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function deactivate(item: ProfileRecord) {
    setBusyProfileId(item.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/profiles/${item.id}/deactivate`, { method: 'POST', body: '{}' });
      setNotice(`${item.displayName} quedó retirado del catálogo.`);
      await loadProfiles();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos retirar el perfil.'));
    } finally {
      setBusyProfileId(null);
    }
  }

  return (
    <section className="panel management-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="section-05" aria-labelledby="profiles-management-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Catálogo TalkyTimes</p><h2 id="profiles-management-title">Crear y modificar perfiles</h2></div>
        {canCreate && <button className="primary-button primary-button--compact" type="button" onClick={openCreate}>Nuevo perfil <span aria-hidden="true">+</span></button>}
      </header>
      <p className="management-panel__note">Aquí solo se administran metadatos y la carpeta nativa de Chrome. Las contraseñas nunca se muestran ni se guardan en el navegador.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {isFormOpen && (canCreate || canUpdate) && <form className="management-form" onSubmit={(event) => void submit(event)}>
        <div className="management-form__heading"><div><span className="panel-kicker">{editingId ? 'Editar metadatos' : 'Nuevo perfil'}</span><strong>{editingId ? 'Actualiza el vínculo operativo' : 'Registra una cuenta de TalkyTimes'}</strong></div><button className="quiet-button" type="button" onClick={closeForm}>Cerrar</button></div>
        <div className="management-form__grid">
          <label><span>Nombre visible</span><input required value={form.displayName} onChange={(event) => updateField('displayName', event.target.value)} /></label>
          <label><span>Correo de TalkyTimes</span><input required type="email" value={form.loginEmail} onChange={(event) => updateField('loginEmail', event.target.value)} /></label>
          <label><span>Referencia externa</span><input value={form.externalRef} onChange={(event) => updateField('externalRef', event.target.value)} /></label>
          <label><span>País ISO</span><input maxLength={2} value={form.country} onChange={(event) => updateField('country', event.target.value.toUpperCase())} /></label>
          <label><span>Perfil nativo de Chrome</span><select value={form.chromeProfileDir} onChange={(event) => updateField('chromeProfileDir', event.target.value)}><option value="">Sin vincular</option><option>Default</option>{Array.from({ length: 8 }, (_, index) => <option key={index}>Profile {index + 1}</option>)}</select></label>
          <label className="management-form__wide"><span>Notas operativas</span><textarea maxLength={2000} value={form.notes} onChange={(event) => updateField('notes', event.target.value)} rows={2} /></label>
        </div>
        <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear perfil'} <span aria-hidden="true">↗</span></button></div>
      </form>}

      <div className="management-toolbar"><label className="management-search"><span>Buscar perfil</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o referencia" /></label><button className="quiet-button" type="button" onClick={() => void loadProfiles()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button></div>
      {isLoading && <p className="panel-state">Cargando perfiles…</p>}
      {!isLoading && !filteredProfiles.length && <p className="panel-state">No hay perfiles que coincidan con la búsqueda.</p>}
      {!isLoading && filteredProfiles.length > 0 && <div className="management-table" role="table" aria-label="Catálogo administrable de perfiles">
        <div className="management-table__head" role="row"><span>Perfil</span><span>Estado</span><span>Chrome</span><span>Actualizado</span><span aria-hidden="true" /></div>
        {filteredProfiles.map((item) => {
          const initials = item.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
          const isBusy = busyProfileId === item.id;
          return <div className="management-table__row" role="row" key={item.id}>
            <div className="management-identity" role="cell"><span className="profile-avatar profile-avatar--small">{initials}</span><span><strong>{item.displayName}</strong><small>{item.loginEmail}</small></span></div>
            <span role="cell"><span className={`management-status management-status--${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? 'Activo' : item.status === 'INACTIVE' ? 'Inactivo' : item.status === 'SUSPENDED' ? 'Suspendido' : 'Retirado'}</span></span>
            <span className="management-muted" role="cell">{item.chromeProfileDir || 'Pendiente'}</span>
            <span className="management-muted" role="cell">{new Date(item.updatedAt).toLocaleDateString('es-CO')}</span>
            <div className="management-actions" role="cell">{canUpdate && <button className="row-action" type="button" onClick={() => openEdit(item)}>Editar</button>}{canUpdate && item.status === 'ACTIVE' && <button className="row-action row-action--danger" type="button" onClick={() => void deactivate(item)} disabled={isBusy}>{isBusy ? '…' : 'Retirar'}</button>}</div>
          </div>;
        })}
      </div>}
    </section>
  );
}
