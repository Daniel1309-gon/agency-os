import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { shiftTemplateRecordSchema, type CrewRecord, type ShiftTemplateRecord } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { WEEKDAYS, buildShiftTemplatePayload, crossesMidnightFrom, errorMessage, localDateString, type ShiftTemplateFormValues } from './management-view';

interface ShiftTemplateFormProps {
  crews: CrewRecord[];
  /** La cuadrilla la controla el padre: es la misma que se acaba de crear o elegir. */
  crewId: string;
  onSelectCrew: (crewId: string) => void;
  onCreated: (template: ShiftTemplateRecord) => void;
  className?: string;
}

/** Las horas por defecto son el primer turno real de la operación (06:05–14:05). */
function initialValues(): ShiftTemplateFormValues {
  return { name: '', startTime: '06:05', endTime: '14:05', breakMinutes: '', validFrom: localDateString(), validTo: '', weekdays: [] };
}

export function ShiftTemplateForm({ crews, crewId, onSelectCrew, onCreated, className = '' }: ShiftTemplateFormProps) {
  const [values, setValues] = useState<ShiftTemplateFormValues>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateField<K extends keyof ShiftTemplateFormValues>(field: K, value: ShiftTemplateFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function toggleWeekday(day: number, isChecked: boolean) {
    setValues((current) => ({ ...current, weekdays: isChecked ? [...current.weekdays, day] : current.weekdays.filter((value) => value !== day) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = buildShiftTemplatePayload({ ...values, crewId });
      const raw = await apiClient.request<unknown>('/shift-templates', { method: 'POST', body: JSON.stringify(payload) });
      const created = shiftTemplateRecordSchema.parse(raw);
      onCreated(created);
      setNotice(`Plantilla «${created.name}» creada y lista para usarse en un turno.`);
      setValues((current) => ({ ...initialValues(), validFrom: current.validFrom, weekdays: current.weekdays }));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear la plantilla.'));
    } finally {
      setIsSaving(false);
    }
  }

  const crossesMidnight = crossesMidnightFrom(values.startTime, values.endTime);

  return (
    <form className={`panel management-form ${className}`.trim()} onSubmit={(event) => void submit(event)}>
      <div className="management-form__heading">
        <div><span className="panel-kicker">Plantilla reutilizable</span><strong>Crear plantilla de turno</strong></div>
        <span className="management-form__hint">Queda disponible al crear un turno</span>
      </div>
      <div className="management-form__grid">
        <label className="management-form__wide"><span>Cuadrilla</span><select value={crewId} onChange={(event) => onSelectCrew(event.target.value)}><option value="">Sin cuadrilla</option>{crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select></label>
        <label><span>Nombre</span><input required maxLength={160} value={values.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Turno mañana L–V" /></label>
        <label><span>Descanso (minutos)</span><input type="number" min={0} max={480} step={5} value={values.breakMinutes} onChange={(event) => updateField('breakMinutes', event.target.value)} placeholder="0" /></label>
        <label><span>Hora de inicio</span><input required type="time" value={values.startTime} onChange={(event) => updateField('startTime', event.target.value)} /></label>
        <label><span>Hora de fin</span><input required type="time" value={values.endTime} onChange={(event) => updateField('endTime', event.target.value)} /></label>
        <fieldset className="management-form__wide management-weekdays"><legend>Días de la semana</legend><div className="management-weekdays__options">{WEEKDAYS.map((day) => <label className="management-day-option" key={day.value}><input type="checkbox" checked={values.weekdays.includes(day.value)} onChange={(event) => toggleWeekday(day.value, event.target.checked)} /><span>{day.label}</span></label>)}</div></fieldset>
        <label><span>Vigente desde</span><input required type="date" value={values.validFrom} onChange={(event) => updateField('validFrom', event.target.value)} /></label>
        <label><span>Vigente hasta</span><input type="date" value={values.validTo} onChange={(event) => updateField('validTo', event.target.value)} /></label>
      </div>
      <p className="management-form__hint">{crossesMidnight ? 'Termina al día siguiente: se guarda como turno que cruza la medianoche.' : 'Deja «Vigente hasta» vacío para una plantilla sin fecha de cierre.'}</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="management-form__actions"><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Creando…' : 'Crear plantilla'} <Plus className="h-4 w-4" aria-hidden="true" /></button></div>
    </form>
  );
}
