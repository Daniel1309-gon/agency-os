import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  icebreakerRuleRecordSchema,
  icebreakerViolationRecordSchema,
  type IcebreakerReviewVerdict,
  type IcebreakerRuleKind,
  type IcebreakerRuleRecord,
  type IcebreakerRuleSeverity,
  type IcebreakerViolationRecord,
  type UserSummary,
} from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { errorMessage } from './management-view';
import {
  buildCreateRulePayload,
  buildReviewPayload,
  buildUpdateRulePayload,
  buildViolationsQuery,
  canManageIcebreakerRules,
  reviewVerdictLabel,
  ruleSeverityLabel,
  type RuleFormValues,
} from './icebreaker-moderation-view';

const EMPTY_RULE: RuleFormValues = { code: '', name: '', kind: 'KEYWORD', pattern: '', severity: 'BLOCKING' };
const VERDICTS: readonly IcebreakerReviewVerdict[] = ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'OVERRIDDEN_ALLOW'];

/** FR-25 to FR-27: cola de revisión de infracciones y administración de reglas de icebreakers. */
export function IcebreakerModeration({ accessToken, user }: { accessToken: string | null; user: UserSummary }) {
  const allowRules = canManageIcebreakerRules(user.permissions);
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'REVIEWED' | ''>('OPEN');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [violations, setViolations] = useState<IcebreakerViolationRecord[]>([]);
  const [rules, setRules] = useState<IcebreakerRuleRecord[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<IcebreakerReviewVerdict>('TRUE_POSITIVE');
  const [reason, setReason] = useState('');
  const [ruleForm, setRuleForm] = useState<RuleFormValues>(EMPTY_RULE);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRule, setEditRule] = useState<Omit<RuleFormValues, 'code'>>({ name: '', kind: 'KEYWORD', pattern: '', severity: 'BLOCKING' });
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (from && to && from > to) {
      setError('La fecha inicial debe ser anterior o igual a la fecha final.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rawViolations = await apiClient.request<unknown>(buildViolationsQuery({ from, to, status: statusFilter }));
      setViolations(icebreakerViolationRecordSchema.array().parse(rawViolations));
      if (allowRules) {
        const rawRules = await apiClient.request<unknown>('/icebreaker-rules');
        setRules(icebreakerRuleRecordSchema.array().parse(rawRules));
      }
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar la cola de revisión.'));
    } finally {
      setIsLoading(false);
    }
  }, [allowRules, from, statusFilter, to]);

  useEffect(() => {
    if (accessToken) void loadAll();
  }, [accessToken, loadAll]);

  async function submitReview(icebreakerId: string) {
    setBusyId(icebreakerId);
    setError(null);
    setNotice(null);
    try {
      const payload = buildReviewPayload(verdict, reason);
      await apiClient.request(`/icebreakers/${icebreakerId}/reviews`, { method: 'POST', body: JSON.stringify(payload) });
      setReviewingId(null);
      setReason('');
      setNotice(`Revisión registrada (${reviewVerdictLabel(verdict)}).`);
      await loadAll();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos registrar la revisión.'));
    } finally {
      setBusyId(null);
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    setBusyId('create-rule');
    setError(null);
    setNotice(null);
    try {
      const payload = buildCreateRulePayload(ruleForm);
      await apiClient.request('/icebreaker-rules', { method: 'POST', body: JSON.stringify(payload) });
      setRuleForm(EMPTY_RULE);
      setNotice(`Regla ${payload.code} creada.`);
      await loadAll();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear la regla.'));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRule(rule: IcebreakerRuleRecord) {
    setBusyId(rule.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/icebreaker-rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !rule.isActive, version: rule.version }),
      });
      setNotice(`Regla ${rule.code} ${rule.isActive ? 'pausada' : 'activada'}.`);
      await loadAll();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos actualizar la regla.'));
    } finally {
      setBusyId(null);
    }
  }

  async function saveRuleEdit(rule: IcebreakerRuleRecord) {
    setBusyId(rule.id);
    setError(null);
    setNotice(null);
    try {
      const payload = buildUpdateRulePayload(editRule, rule.version);
      await apiClient.request(`/icebreaker-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditingRuleId(null);
      setNotice(`Regla ${rule.code} actualizada.`);
      await loadAll();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos guardar los cambios de la regla.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="coordinator-layout">
      <section className="panel management-panel" id="icebreaker-violations" aria-labelledby="icebreaker-violations-title">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">Moderación · FR-25 / FR-27</p>
            <h2 id="icebreaker-violations-title">Infracciones de icebreakers</h2>
          </div>
          <button className="quiet-button" type="button" onClick={() => void loadAll()} disabled={isLoading}>
            Actualizar <span aria-hidden="true">↻</span>
          </button>
        </header>

        <div className="management-form__grid">
          <label><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label>
            <span>Estado</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'OPEN' | 'REVIEWED' | '')}>
              <option value="OPEN">Pendientes</option>
              <option value="REVIEWED">Revisadas</option>
              <option value="">Todas</option>
            </select>
          </label>
        </div>

        {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}

        {isLoading ? (
          <p className="empty-state">Cargando infracciones…</p>
        ) : violations.length === 0 ? (
          <p className="empty-state">No hay infracciones registradas con los filtros actuales.</p>
        ) : (
          <div className="management-table" role="table" aria-label="Infracciones de icebreakers">
            <div className="management-table__head" role="row">
              <span role="columnheader">Operador / Perfil</span>
              <span role="columnheader">Regla</span>
              <span role="columnheader">Texto</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader">Acción</span>
            </div>
            {violations.map((item) => (
              <div className="management-table__row" role="row" key={item.id}>
                <span role="cell">
                  <strong>{item.operatorName ?? item.operatorId.slice(0, 8)}</strong>
                  <small>{item.profileName ?? 'Sin perfil'}</small>
                </span>
                <span role="cell">
                  <strong>{item.ruleName}</strong>
                  <small><code>{item.ruleCode}</code> · {ruleSeverityLabel(item.severity)}</small>
                </span>
                <span role="cell">{item.icebreakerText}</span>
                <span role="cell">
                  <span className={`status-pill${item.status === 'REVIEWED' ? ' status-pill--quiet' : ''}`}>
                    {item.status === 'OPEN' ? 'Pendiente' : 'Revisada'}
                  </span>
                </span>
                <span role="cell" className="management-table__actions">
                  {item.status === 'OPEN' ? (
                    reviewingId === item.icebreakerId ? (
                      <div className="management-form">
                        <select aria-label="Veredicto" value={verdict} onChange={(event) => setVerdict(event.target.value as IcebreakerReviewVerdict)}>
                          {VERDICTS.map((v) => <option key={v} value={v}>{reviewVerdictLabel(v)}</option>)}
                        </select>
                        <input aria-label="Justificación" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo de la decisión" />
                        <button className="primary-button primary-button--compact" type="button" onClick={() => void submitReview(item.icebreakerId)} disabled={busyId === item.icebreakerId}>Guardar</button>
                        <button className="quiet-button" type="button" onClick={() => setReviewingId(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <button className="quiet-button" type="button" onClick={() => { setReviewingId(item.icebreakerId); setVerdict('TRUE_POSITIVE'); setReason(''); }}>Revisar</button>
                    )
                  ) : (
                    <small>{item.icebreakerStatus}</small>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {allowRules && (
        <section className="panel management-panel" id="icebreaker-rules" aria-labelledby="icebreaker-rules-title">
          <header className="panel-header">
            <div>
              <p className="panel-kicker">Catálogo de normas · FR-26</p>
              <h2 id="icebreaker-rules-title">Reglas de TalkyTimes</h2>
            </div>
          </header>

          <form className="management-form" onSubmit={(event) => void createRule(event)}>
            <h3>Nueva regla</h3>
            <div className="management-form__grid">
              <label><span>Código</span><input value={ruleForm.code} onChange={(event) => setRuleForm((c) => ({ ...c, code: event.target.value }))} placeholder="NO_CONTACT" required /></label>
              <label><span>Nombre</span><input value={ruleForm.name} onChange={(event) => setRuleForm((c) => ({ ...c, name: event.target.value }))} placeholder="Prohibido compartir contacto" required /></label>
              <label>
                <span>Tipo</span>
                <select value={ruleForm.kind} onChange={(event) => setRuleForm((c) => ({ ...c, kind: event.target.value as IcebreakerRuleKind }))}>
                  <option value="KEYWORD">Palabra clave</option>
                  <option value="REGEX">Expresión regular</option>
                  <option value="MANUAL">Revisión manual</option>
                </select>
              </label>
              <label><span>Patrón</span><input value={ruleForm.pattern} onChange={(event) => setRuleForm((c) => ({ ...c, pattern: event.target.value }))} placeholder="whatsapp" /></label>
              <label>
                <span>Severidad</span>
                <select value={ruleForm.severity} onChange={(event) => setRuleForm((c) => ({ ...c, severity: event.target.value as IcebreakerRuleSeverity }))}>
                  <option value="BLOCKING">Bloqueante</option>
                  <option value="WARNING">Advertencia</option>
                  <option value="INFO">Informativa</option>
                </select>
              </label>
            </div>
            <button className="primary-button primary-button--compact" type="submit" disabled={busyId === 'create-rule'}>
              {busyId === 'create-rule' ? 'Guardando…' : 'Crear regla'}
            </button>
          </form>

          {rules.length === 0 ? (
            <p className="empty-state">No hay reglas configuradas todavía.</p>
          ) : (
            <div className="management-table" role="table" aria-label="Reglas de icebreakers">
              <div className="management-table__head" role="row">
                <span role="columnheader">Regla</span>
                <span role="columnheader">Tipo / Patrón</span>
                <span role="columnheader">Severidad</span>
                <span role="columnheader">Estado</span>
                <span role="columnheader">Acciones</span>
              </div>
              {rules.map((rule) => {
                const isEditing = editingRuleId === rule.id;
                return (
                  <div className="management-table__row" role="row" key={rule.id}>
                    <span role="cell">
                      {isEditing ? (
                        <input aria-label={`Nombre de ${rule.code}`} value={editRule.name} onChange={(event) => setEditRule((c) => ({ ...c, name: event.target.value }))} />
                      ) : (
                        <><strong>{rule.name}</strong> <small><code>{rule.code}</code></small></>
                      )}
                    </span>
                    <span role="cell">
                      {isEditing ? (
                        <>
                          <select aria-label={`Tipo de ${rule.code}`} value={editRule.kind} onChange={(event) => setEditRule((c) => ({ ...c, kind: event.target.value as IcebreakerRuleKind }))}>
                            <option value="KEYWORD">Palabra clave</option>
                            <option value="REGEX">Expresión regular</option>
                            <option value="MANUAL">Revisión manual</option>
                          </select>
                          <input aria-label={`Patrón de ${rule.code}`} value={editRule.kind === 'MANUAL' ? '' : editRule.pattern} disabled={editRule.kind === 'MANUAL'} onChange={(event) => setEditRule((c) => ({ ...c, pattern: event.target.value }))} />
                        </>
                      ) : (
                        <>{rule.kind}{rule.pattern ? <> · <code>{rule.pattern}</code></> : ''}</>
                      )}
                    </span>
                    <span role="cell">
                      {isEditing ? (
                        <select aria-label={`Severidad de ${rule.code}`} value={editRule.severity} onChange={(event) => setEditRule((c) => ({ ...c, severity: event.target.value as IcebreakerRuleSeverity }))}>
                          <option value="BLOCKING">Bloqueante</option>
                          <option value="WARNING">Advertencia</option>
                          <option value="INFO">Informativa</option>
                        </select>
                      ) : ruleSeverityLabel(rule.severity)}
                    </span>
                    <span role="cell"><span className={`status-pill${rule.isActive ? '' : ' status-pill--quiet'}`}>{rule.isActive ? 'Activa' : 'Pausada'}</span></span>
                    <span role="cell" className="management-table__actions">
                      {isEditing ? (
                        <>
                          <button className="primary-button primary-button--compact" type="button" onClick={() => void saveRuleEdit(rule)} disabled={busyId === rule.id}>Guardar</button>
                          <button className="quiet-button" type="button" onClick={() => setEditingRuleId(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button className="quiet-button" type="button" onClick={() => { setEditingRuleId(rule.id); setEditRule({ name: rule.name, kind: rule.kind, pattern: rule.pattern ?? '', severity: rule.severity }); }}>Editar</button>
                          <button className="quiet-button" type="button" onClick={() => void toggleRule(rule)} disabled={busyId === rule.id}>{rule.isActive ? 'Pausar' : 'Activar'}</button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
