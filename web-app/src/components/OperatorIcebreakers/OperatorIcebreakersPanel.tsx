import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { assignedProfileSchema, icebreakerEvaluationResultSchema, icebreakerSummarySchema, type AssignedProfile, type IcebreakerSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { StatusPill } from '../StatusPill/StatusPill';
import { ICEBREAKER_MAX_LENGTH, evaluationSummary, icebreakerActions, icebreakerStatusCopy, validateIcebreakerText } from './icebreaker-view';

type Feedback = { icebreakerId: string; title: string; details: string[]; blocked: boolean };

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** FR-21 to FR-24: the operator writes an icebreaker for an assigned profile, evaluates it, fixes it and publishes it. */
export function OperatorIcebreakersPanel({ accessToken }: { accessToken: string | null }) {
  const [items, setItems] = useState<IcebreakerSummary[]>([]);
  const [profiles, setProfiles] = useState<AssignedProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/icebreakers');
      setItems(icebreakerSummarySchema.array().parse(raw).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    } catch (nextError) {
      setError(apiMessage(nextError, 'No pudimos cargar tus icebreakers.'));
    } finally {
      setIsLoading(false);
    }
    // Assigned profiles need an active shift; without one the operator can still write a draft without a profile.
    try {
      const raw = await apiClient.request<unknown>('/agent/profiles/assigned');
      setProfiles(assignedProfileSchema.array().parse(raw));
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void load();
  }, [accessToken, load]);

  const profileNames = useMemo(() => new Map(profiles.map((profile) => [profile.profileId, profile.profileName])), [profiles]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const checked = validateIcebreakerText(text);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.request('/icebreakers', { method: 'POST', body: JSON.stringify({ text: checked.text, ...(profileId ? { profileId } : {}) }) });
      setText('');
      await load();
    } catch (nextError) {
      setError(apiMessage(nextError, 'No pudimos guardar el icebreaker.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEdit(item: IcebreakerSummary) {
    const checked = validateIcebreakerText(editText);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await apiClient.request(`/icebreakers/${item.id}`, { method: 'PATCH', body: JSON.stringify({ text: checked.text, version: item.version }) });
      setEditingId(null);
      if (feedback?.icebreakerId === item.id) setFeedback(null);
      await load();
    } catch (nextError) {
      setError(apiMessage(nextError, 'No pudimos guardar los cambios. Recarga e inténtalo de nuevo.'));
    } finally {
      setBusyId(null);
    }
  }

  async function evaluate(item: IcebreakerSummary) {
    setBusyId(item.id);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>(`/icebreakers/${item.id}/evaluate`, { method: 'POST', body: '{}' });
      const result = icebreakerEvaluationResultSchema.parse(raw);
      const summary = evaluationSummary(result);
      setFeedback({ icebreakerId: item.id, ...summary, blocked: result.status === 'BLOCKED' });
      await load();
    } catch (nextError) {
      setError(apiMessage(nextError, 'No pudimos evaluar el icebreaker.'));
    } finally {
      setBusyId(null);
    }
  }

  async function publish(item: IcebreakerSummary) {
    setBusyId(item.id);
    setError(null);
    try {
      await apiClient.request(`/icebreakers/${item.id}/publish`, { method: 'POST', body: '{}' });
      setFeedback(null);
      await load();
    } catch (nextError) {
      setError(apiMessage(nextError, 'No pudimos publicar el icebreaker.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel management-panel" aria-labelledby="operator-icebreakers-title">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Validación de normas · TalkyTimes</p>
          <h2 id="operator-icebreakers-title">Mis icebreakers</h2>
        </div>
        <button className="quiet-button" type="button" onClick={() => void load()} disabled={isLoading}>
          Actualizar <span aria-hidden="true">↻</span>
        </button>
      </header>

      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}

      <form className="management-form" onSubmit={(event) => void create(event)}>
        <h3>Nuevo icebreaker</h3>
        <label>
          <span>Perfil</span>
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">Sin perfil</option>
            {profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.profileName}</option>)}
          </select>
        </label>
        <label>
          <span>Texto ({text.trim().length}/{ICEBREAKER_MAX_LENGTH})</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={ICEBREAKER_MAX_LENGTH} placeholder="Escribe un mensaje de apertura natural y respetuoso." required />
        </label>
        <button className="primary-button primary-button--compact" type="submit" disabled={isSaving}>{isSaving ? 'Guardando…' : 'Guardar borrador'}</button>
      </form>

      {isLoading ? (
        <p className="empty-state">Cargando tus icebreakers…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">Todavía no has escrito icebreakers.</p>
      ) : (
        <ul className="icebreaker-list" aria-label="Mis icebreakers">
          {items.map((item) => {
            const copy = icebreakerStatusCopy(item.status);
            const actions = icebreakerActions(item.status);
            const isEditing = editingId === item.id;
            const busy = busyId === item.id;
            return (
              <li className="icebreaker-card" key={item.id}>
                <div className="icebreaker-card__meta">
                  <StatusPill status={copy.tone} label={copy.label} />
                  <small>{item.profileId ? profileNames.get(item.profileId) ?? 'Perfil asignado anteriormente' : 'Sin perfil'}</small>
                </div>
                {isEditing ? (
                  <textarea aria-label="Editar icebreaker" value={editText} onChange={(event) => setEditText(event.target.value)} rows={4} maxLength={ICEBREAKER_MAX_LENGTH} />
                ) : (
                  <p className="icebreaker-card__text">{item.text}</p>
                )}
                {feedback?.icebreakerId === item.id && (
                  <div className={`form-notice${feedback.blocked ? ' form-notice--error' : ''}`} role="status">
                    <strong>{feedback.title}</strong>
                    {feedback.details.length > 0 && <ul>{feedback.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
                  </div>
                )}
                <div className="management-table__actions">
                  {isEditing ? (
                    <>
                      <button className="primary-button primary-button--compact" type="button" onClick={() => void saveEdit(item)} disabled={busy}>Guardar</button>
                      <button className="quiet-button" type="button" onClick={() => setEditingId(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      {actions.canEdit && <button className="quiet-button" type="button" onClick={() => { setEditingId(item.id); setEditText(item.text); }} disabled={busy}>Editar</button>}
                      {actions.canEvaluate && <button className="quiet-button" type="button" onClick={() => void evaluate(item)} disabled={busy}>{busy ? 'Evaluando…' : 'Evaluar'}</button>}
                      {actions.canPublish && <button className="primary-button primary-button--compact" type="button" onClick={() => void publish(item)} disabled={busy}>Publicar</button>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
