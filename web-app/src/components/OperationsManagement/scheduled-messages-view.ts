import type { RecurrenceRule, ScheduledMessageStatus } from '@agency-os/shared';
import { calendarWeekday, toIsoDateTime, weekdaySummary } from './management-view';

export interface ScheduledMessageFormValues {
  channelId: string;
  targetUserId: string;
  body: string;
  scheduledFor: string;
  frequency: 'NONE' | 'DAILY' | 'WEEKLY';
  weekdays: number[];
  until: string;
}

export interface ScheduledMessagePayload {
  channelId?: string;
  targetUserId?: string;
  body: string;
  scheduledFor: string;
  recurrenceRule?: RecurrenceRule;
}

/** Cuerpo de `POST /scheduled-messages`. Un destino y una regla como máximo. */
export function buildScheduledMessagePayload(values: ScheduledMessageFormValues): ScheduledMessagePayload {
  const body = values.body.trim();
  if (!body) throw new Error('El mensaje no puede estar vacío.');
  if (body.length > 4000) throw new Error('El mensaje no puede superar 4000 caracteres.');
  if (Boolean(values.channelId) === Boolean(values.targetUserId)) throw new Error('Elige un canal o un operador, no ambos.');

  const payload: ScheduledMessagePayload = { body, scheduledFor: toIsoDateTime(values.scheduledFor) };
  if (values.channelId) payload.channelId = values.channelId;
  else payload.targetUserId = values.targetUserId;

  if (values.frequency !== 'NONE') {
    const rule: RecurrenceRule = { frequency: values.frequency };
    if (values.frequency === 'WEEKLY') {
      const weekdays = [...new Set(values.weekdays)].sort((left, right) => left - right);
      if (!weekdays.length) throw new Error('Selecciona al menos un día de la semana.');
      rule.weekdays = weekdays;
    }
    if (values.until) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.until)) throw new Error('La fecha límite no es válida.');
      rule.until = values.until;
      if (values.scheduledFor.slice(0, 10) > values.until) throw new Error('La fecha límite no puede ser anterior al primer envío.');
    }
    if (rule.weekdays && !rule.weekdays.includes(calendarWeekday(values.scheduledFor.slice(0, 10)))) throw new Error('El primer envío debe caer en uno de los días elegidos.');
    payload.recurrenceRule = rule;
  }
  return payload;
}

export function recurrenceLabel(rule: RecurrenceRule | null): string {
  if (!rule) return 'Una vez';
  if (rule.frequency === 'DAILY') return 'Cada día';
  return `Semanal · ${weekdaySummary(rule.weekdays ?? [])}`;
}

const STATUS_LABELS: Record<ScheduledMessageStatus, string> = {
  PENDING: 'Programado',
  QUEUED: 'En cola',
  SENT: 'Enviado',
  FAILED: 'Falló',
  SKIPPED: 'Omitido',
  CANCELLED: 'Cancelado',
};

export function scheduledStatusLabel(status: ScheduledMessageStatus): string {
  return STATUS_LABELS[status];
}

export function scheduledAtLabel(scheduledFor: string): string {
  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
