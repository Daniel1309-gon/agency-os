import type { IcebreakerReviewVerdict, IcebreakerRuleKind, IcebreakerRuleSeverity } from '@agency-os/shared';

export interface RuleFormValues {
  code: string;
  name: string;
  kind: IcebreakerRuleKind;
  pattern: string;
  severity: IcebreakerRuleSeverity;
}

export interface CreateRulePayload {
  code: string;
  name: string;
  kind: IcebreakerRuleKind;
  pattern?: string;
  severity: IcebreakerRuleSeverity;
}

export interface UpdateRulePayload {
  name: string;
  kind: IcebreakerRuleKind;
  pattern?: string;
  severity: IcebreakerRuleSeverity;
  version: number;
}

const VERDICT_LABELS: Record<IcebreakerReviewVerdict, string> = {
  TRUE_POSITIVE: 'Incumplimiento confirmado',
  FALSE_POSITIVE: 'Falso positivo',
  OVERRIDDEN_ALLOW: 'Autorizar publicación',
};

const SEVERITY_LABELS: Record<IcebreakerRuleSeverity, string> = {
  INFO: 'Informativa',
  WARNING: 'Advertencia',
  BLOCKING: 'Bloqueante',
};

export function reviewVerdictLabel(verdict: IcebreakerReviewVerdict): string {
  return VERDICT_LABELS[verdict];
}

export function ruleSeverityLabel(severity: IcebreakerRuleSeverity): string {
  return SEVERITY_LABELS[severity];
}

export function canManageIcebreakerRules(permissions: readonly string[]): boolean {
  return permissions.includes('*') || permissions.includes('icebreaker.rules.manage');
}

export function buildViolationsQuery(filters: { from?: string; to?: string; status?: 'OPEN' | 'REVIEWED' | ''; limit?: number }): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.status) params.set('status', filters.status);
  params.set('limit', String(filters.limit ?? 100));
  return `/icebreakers/violations?${params.toString()}`;
}

function validatePattern(kind: IcebreakerRuleKind, rawPattern: string): string | undefined {
  const pattern = rawPattern.trim();
  if (!pattern) {
    if (kind !== 'MANUAL') throw new Error('Las reglas de palabra clave o expresión regular requieren un patrón.');
    return undefined;
  }
  if (pattern.length > 500) throw new Error('El patrón no puede superar 500 caracteres.');
  if (kind === 'REGEX') {
    try {
      new RegExp(pattern, 'iu');
    } catch {
      throw new Error('La expresión regular no es válida.');
    }
  }
  return pattern;
}

export function buildCreateRulePayload(values: RuleFormValues): CreateRulePayload {
  const code = values.code.trim().toUpperCase();
  const name = values.name.trim();
  if (!code || code.length > 80) throw new Error('El código de la regla es obligatorio (máximo 80 caracteres).');
  if (!name || name.length > 160) throw new Error('El nombre de la regla es obligatorio (máximo 160 caracteres).');
  const pattern = validatePattern(values.kind, values.pattern);
  return { code, name, kind: values.kind, ...(pattern ? { pattern } : {}), severity: values.severity };
}

export function buildUpdateRulePayload(values: Omit<RuleFormValues, 'code'>, version: number): UpdateRulePayload {
  const name = values.name.trim();
  if (!name || name.length > 160) throw new Error('El nombre de la regla es obligatorio (máximo 160 caracteres).');
  const pattern = validatePattern(values.kind, values.pattern);
  return { name, kind: values.kind, ...(pattern ? { pattern } : {}), severity: values.severity, version };
}

export function buildReviewPayload(verdict: IcebreakerReviewVerdict, rawReason: string): { verdict: IcebreakerReviewVerdict; reason: string } {
  const reason = rawReason.trim();
  if (!reason) throw new Error('Escribe una justificación para registrar la revisión.');
  if (reason.length > 1000) throw new Error('La justificación no puede superar 1000 caracteres.');
  return { verdict, reason };
}
