export interface OperatorPayrollSummary {
  periodId: string | null;
  points: string;
  netCop: string;
  compensationConfigured: boolean;
}

export interface OperatorPayrollPeriod {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: string;
}

const periodStatusCopy: Record<string, string> = {
  OPEN: 'En curso',
  LOCKED: 'En revisión',
  CLOSED: 'Liquidado',
  PAID: 'Pagado',
};

export function payrollPeriodStatusCopy(status: string): string {
  return periodStatusCopy[status] ?? status;
}

function formatCalendarDate(value: string): string {
  // Calendar dates carry no time zone: format them at UTC noon so the day never shifts.
  return new Date(`${value}T12:00:00Z`)
    .toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
}

export function formatPeriodRange(startsOn: string, endsOn: string): string {
  return `${formatCalendarDate(startsOn)} – ${formatCalendarDate(endsOn)}`;
}

/** Why the figures are zero, when they are zero for a reason the operator should know. */
export function summaryNotice(summary: OperatorPayrollSummary): string | null {
  if (!summary.periodId) return 'No hay un periodo de nómina en curso. Consulta con coordinación.';
  if (!summary.compensationConfigured) return 'Tu comisión todavía no está configurada para este periodo. Consulta con coordinación.';
  return null;
}
