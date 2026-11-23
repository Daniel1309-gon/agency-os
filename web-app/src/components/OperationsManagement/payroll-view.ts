import {
  payrollLineRecordSchema,
  payrollPeriodRecordSchema,
  payrollPeriodStatusSchema,
  type PayrollLineRecord,
  type PayrollPeriodRecord,
  type PayrollPeriodStatus,
} from '@agency-os/shared';

export {
  payrollLineRecordSchema,
  payrollPeriodRecordSchema,
  payrollPeriodStatusSchema,
  type PayrollLineRecord,
  type PayrollPeriodRecord,
  type PayrollPeriodStatus,
};

const STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  OPEN: 'Abierto',
  LOCKED: 'Bloqueado',
  CLOSED: 'Cerrado',
  PAID: 'Pagado',
};

export function payrollStatusLabel(status: PayrollPeriodStatus): string {
  return STATUS_LABELS[status];
}

export function canExportPayroll(permissions: readonly string[]): boolean {
  return permissions.includes('*') || permissions.includes('payroll.configure');
}

export function defaultExportFilename(period: Pick<PayrollPeriodRecord, 'startsOn' | 'endsOn'>): string {
  return `payroll-${period.startsOn}_${period.endsOn}.xlsx`;
}

export function formatPayrollCop(value: string | number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value));
}
