import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { crewRecordSchema, type CrewRecord, type ManagedUser } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { buildCrewPayload, errorMessage, type CrewFormValues } from './management-view';

interface CrewFormProps {
  /** Un coordinador no elige: el servidor lo asigna a sí mismo y rechaza a otro. */
  canChooseCoordinator: boolean;
  coordinators: ManagedUser[];
  onCreated: (crew: CrewRecord) => void;
  className?: string;
}

function initialValues(): CrewFormValues {
  return { name: '', coordinatorId: '' };
}

export function CrewForm({ canChooseCoordinator, coordinators, onCreated, className = '' }: CrewFormProps) {
  const [values, setValues] = useState<CrewFormValues>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateField<K extends keyof CrewFormValues>(field: K, value: CrewFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = buildCrewPayload(values);
      const raw = await apiClient.request<unknown>('/crews', { method: 'POST', body: JSON.stringify(payload) });
      const created = crewRecordSchema.parse(raw);
      setNotice(canChooseCoordinator ? `Cuadrilla «${created.name}» creada.` : `Cuadrilla «${created.name}» creada a tu nombre.`);
      setValues(initialValues());
      onCreated(created);
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear la cuadrilla.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className={`panel management-form ${className}`.trim()} onSubmit={(event) => void submit(event)}>
      <div className="management-form__heading">
        <div><span className="panel-kicker">Agrupación de operadores</span><strong>Crear cuadrilla</strong></div>
        <span className="management-form__hint">{canChooseCoordinator ? 'Podés elegir el coordinador' : 'Queda a tu nombre'}</span>
      </div>
      <div className="management-form__grid">
        <label><span>Nombre</span><input required maxLength={160} value={values.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Cuadrilla Tarde" /></label>
        {canChooseCoordinator && <label><span>Coordinador</span><select value={values.coordinatorId} onChange={(event) => updateField('coordinatorId', event.target.value)}><option value="">Sin asignar</option>{coordinators.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>}
      </div>
      <p className="management-form__hint">{canChooseCoordinator ? 'Sin coordinador la cuadrilla queda sin responsable asignado.' : 'El servidor te asigna como coordinador de la cuadrilla.'}</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Creando…' : 'Crear cuadrilla'} <Plus className="h-4 w-4" aria-hidden="true" /></button></div>
    </form>
  );
}
