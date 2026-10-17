import { useCallback, useEffect, useState } from 'react';
import { profileListResponseSchema, type ProfileRecord } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { StatusPill } from '../StatusPill/StatusPill';
import { formatProfileDate, profileStatusCopy } from './profile-catalog-view';

export function ProfileCatalog({ accessToken, sectionId = 'section-03' }: { accessToken: string | null; sectionId?: string }) {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/profiles?page=1&pageSize=100');
      setProfiles(profileListResponseSchema.parse(raw).data);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar el catálogo de perfiles.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadProfiles();
  }, [accessToken, loadProfiles]);

  const activeCount = profiles.filter((profile) => profile.status === 'ACTIVE').length;

  return (
    <section className="panel profile-catalog" id={sectionId} aria-labelledby="profile-catalog-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Gestión de acceso · metadatos</p><h2 id="profile-catalog-title">Perfiles TalkyTimes</h2></div>
        <button className="quiet-button" type="button" onClick={() => void loadProfiles()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>

      <p className="profile-catalog__note">Las credenciales viven únicamente en el vault y no forman parte de este catálogo.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {isLoading && <p className="panel-state">Cargando perfiles…</p>}
      {!isLoading && !profiles.length && <p className="panel-state">No hay perfiles visibles en tu alcance.</p>}
      {!isLoading && profiles.length > 0 && <>
        <div className="profile-catalog__summary" aria-label="Resumen de perfiles">
          <div><span>Total visibles</span><strong>{profiles.length}</strong></div>
          <div><span>Activos</span><strong>{activeCount}</strong></div>
          <div><span>Sin vínculo Chrome</span><strong>{profiles.filter((profile) => !profile.chromeProfileDir).length}</strong></div>
        </div>
        <div className="profile-catalog__table" role="table" aria-label="Catálogo de perfiles TalkyTimes">
          <div className="profile-catalog__head" role="row"><span>Perfil</span><span>Estado</span><span>Chrome</span><span>Actualizado</span></div>
          {profiles.map((profile) => {
            const status = profileStatusCopy(profile.status);
            return <div className="profile-catalog__row" role="row" key={profile.id}>
              <div role="cell" className="profile-catalog__identity"><span className="profile-avatar profile-avatar--small">{profile.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{profile.displayName}</strong><small>{profile.loginEmail}</small></span></div>
              <span role="cell"><StatusPill status={status.tone} label={status.label} /></span>
              <span role="cell" className="profile-catalog__muted">{profile.chromeProfileDir || 'Pendiente'}</span>
              <span role="cell" className="profile-catalog__muted">{formatProfileDate(profile.updatedAt)}</span>
            </div>;
          })}
        </div>
      </>}
    </section>
  );
}
