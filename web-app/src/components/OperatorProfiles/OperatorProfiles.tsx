import { useCallback, useEffect, useState } from 'react';
import { assignedProfileSchema, prepareSessionMessageSchema, type AssignedProfile } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { StatusPill } from '../StatusPill/StatusPill';

interface ChromeRuntime {
  lastError?: { message?: string };
  sendMessage: (extensionId: string, message: unknown, callback: (response?: { ok?: boolean; error?: string }) => void) => void;
}

function extensionRuntime(): ChromeRuntime | null {
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  return runtime ?? null;
}

function extensionId(): string {
  const id = import.meta.env.VITE_EXTENSION_ID as string | undefined;
  if (!id || !/^[a-p]{32}$/.test(id)) throw new Error('La extensión segura no está configurada en este equipo.');
  return id;
}

function sendToExtension(message: unknown): Promise<void> {
  const runtime = extensionRuntime();
  if (!runtime) throw new Error('La extensión segura no está disponible en este navegador.');
  return new Promise((resolve, reject) => {
    runtime.sendMessage(extensionId(), message, (response) => {
      if (runtime.lastError) {
        reject(new Error('La extensión segura no respondió.'));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || 'La extensión no pudo preparar el perfil.'));
        return;
      }
      resolve();
    });
  });
}

function statusFor(profile: AssignedProfile): { tone: 'active' | 'available' | 'handoff'; label: string } {
  if (profile.session?.status === 'ACTIVE') return { tone: 'active', label: 'Sesión activa' };
  if (profile.session?.status === 'LAUNCHING') return { tone: 'handoff', label: 'Abriendo perfil' };
  if (profile.session?.status === 'ERROR') return { tone: 'handoff', label: 'Reintento disponible' };
  if (profile.session?.status === 'STALE') return { tone: 'handoff', label: 'Sesión vencida; reabrir' };
  return { tone: 'available', label: 'Disponible' };
}

export function OperatorProfiles({ accessToken }: { accessToken: string | null }) {
  const [profiles, setProfiles] = useState<AssignedProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProfileId, setLoadingProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/agent/profiles/assigned');
      setProfiles(assignedProfileSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar tus perfiles asignados.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadProfiles();
  }, [accessToken, loadProfiles]);

  async function prepareProfile(profile: AssignedProfile) {
    setLoadingProfileId(profile.profileId);
    setError(null);
    setNotice(null);
    try {
      let sessionId = profile.session?.id;
      let sessionVersion = profile.session?.version;
      if (!sessionId || profile.session?.status === 'ERROR' || profile.session?.status === 'STALE') {
        const session = await apiClient.request<{ id: string; version: number }>('/agent/sessions/prepare', {
          method: 'POST',
          body: JSON.stringify({
            profileId: profile.profileId,
            assignmentId: profile.assignmentId,
            chromeProfileDir: profile.chromeProfileDir,
          }),
        });
        sessionId = session.id;
        sessionVersion = session.version;
      }
      const token = apiClient.getAccessToken();
      if (!token || !sessionId || !sessionVersion) throw new Error('La sesión segura expiró. Vuelve a iniciar sesión.');
      const launchUrl = `https://talkytimes.com/auth/login?agencyProfile=${encodeURIComponent(profile.profileId)}&agencySession=${encodeURIComponent(sessionId)}`;
      const message = prepareSessionMessageSchema.parse({
        action: 'prepareSession',
        accessToken: token,
        profileId: profile.profileId,
        sessionId,
        chromeProfileDir: profile.chromeProfileDir,
        launchUrl,
        version: sessionVersion,
      });
      await sendToExtension(message);
      setNotice(`Perfil ${profile.profileName} preparado. Completa el clic de ingreso en TalkyTimes.`);
      await loadProfiles();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : nextError instanceof Error ? nextError.message : 'No pudimos abrir el perfil.');
    } finally {
      setLoadingProfileId(null);
    }
  }

  return (
    <section className="panel profile-panel" id="section-01">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Asignaciones activas</p>
          <h2>Mis perfiles asociados</h2>
        </div>
        <button className="quiet-button" type="button" onClick={() => void loadProfiles()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>

      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="profile-list">
        {isLoading && <p className="panel-state">Cargando tus perfiles…</p>}
        {!isLoading && !profiles.length && <p className="panel-state">No tienes perfiles asociados en el turno actual.</p>}
        {!isLoading && profiles.map((profile) => {
          const profileStatus = statusFor(profile);
          const initials = profile.profileName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
          const isBusy = loadingProfileId === profile.profileId;
          return (
          <article className="profile-row" key={profile.assignmentId}>
            <span className="profile-avatar">{initials}</span>
            <div className="profile-row__identity">
              <strong>{profile.profileName}</strong>
              <span>{profile.profileUsername}</span>
            </div>
            <div className="profile-row__status">
              <StatusPill status={profileStatus.tone} label={profileStatus.label} />
              <span>{profile.session?.startedAt ? `Iniciada ${new Date(profile.session.startedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : 'Lista para abrir'}</span>
            </div>
              <button className="row-action" type="button" onClick={() => void prepareProfile(profile)} disabled={isBusy || profileStatus.tone === 'handoff' && profile.session?.status === 'LAUNCHING'}>{isBusy ? 'Preparando…' : profile.session?.status === 'ACTIVE' ? 'Continuar' : 'Abrir perfil'} <span aria-hidden="true">↗</span></button>
          </article>
          );
        })}
      </div>
    </section>
  );
}
