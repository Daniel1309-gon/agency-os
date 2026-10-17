import { useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import { crewMemberRecordSchema, type CrewMemberRecord, type CrewRecord, type ManagedUser } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { buildCrewMemberPayload, errorMessage, localDateString, type CrewMemberFormValues } from './management-view';

interface CrewMemberFormProps {
  crews: CrewRecord[];
  operators: ManagedUser[];
  crewId: string;
  onSelectCrew: (crewId: string) => void;
  onAdded: () => void;
  className?: string;
}

const DEFAULT_MEMBERSHIP_DAYS = 90;

function initialValues(): CrewMemberFormValues {
  return {
    userId: '',
    validFrom: localDateString(),
    validTo: localDateString(new Date(Date.now() + DEFAULT_MEMBERSHIP_DAYS * 86_400_000)),
  };
}

export function CrewMemberForm({ crews, operators, crewId, onSelectCrew, onAdded, className = '' }: CrewMemberFormProps) {
  const [values, setValues] = useState<CrewMemberFormValues>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateField<K extends keyof CrewMemberFormValues>(field: K, value: CrewMemberFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = buildCrewMemberPayload(values);
      const raw = await apiClient.request<unknown>(`/crews/${crewId}/members`, { method: 'POST', body: JSON.stringify(payload) });
      const created = crewMemberRecordSchema.parse(raw);
      const crewName = crews.find((crew) => crew.id === crewId)?.name ?? 'la cuadrilla';
      const operatorName = operators.find((operator) => operator.id === created.userId)?.fullName ?? 'Operador';
      setNotice(`${operatorName} quedó en ${crewName}.`);
      // Se limpia el operador para no reenviarlo; las fechas se conservan porque
      // los miembros de una cuadrilla suelen compartir la misma vigencia.
      setValues((current) => ({ ...initialValues(), validFrom: current.validFrom, validTo: current.validTo }));
      onAdded();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos agregar el operador.'));
    } finally {
      setIsSaving(false);
    }
  }

  const hasCrews = crews.length > 0;

  return (
    <form className={`panel management-form ${className}`.trim()} onSubmit={(event) => void submit(event)}>
      <div className="management-form__heading">
        <div><span className="panel-kicker">Vigencia por operador</span><strong>Agregar miembro</strong></div>
        <span className="management-form__hint">Un operador no puede estar en dos cuadrillas a la vez</span>
      </div>
      <div className="management-form__grid">
        <label><span>Cuadrilla</span><select required value={crewId} onChange={(event) => onSelectCrew(event.target.value)}><option value="">Selecciona una cuadrilla</option>{crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select></label>
        <label><span>Operador</span><select required value={values.userId} onChange={(event) => updateField('userId', event.target.value)}><option value="">Selecciona un operador</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.fullName}</option>)}</select></label>
        <label><span>Vigente desde</span><input required type="date" value={values.validFrom} onChange={(event) => updateField('validFrom', event.target.value)} /></label>
        <label><span>Vigente hasta (incluido)</span><input required type="date" value={values.validTo} onChange={(event) => updateField('validTo', event.target.value)} /></label>
      </div>
      {!hasCrews && <p className="management-form__hint">Todavía no hay cuadrillas: crea la primera para poder sumarle operadores.</p>}
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving || !hasCrews}>{isSaving ? 'Agregando…' : 'Agregar a la cuadrilla'} <UserPlus className="h-4 w-4" aria-hidden="true" /></button></div>
    </form>
  );
}
