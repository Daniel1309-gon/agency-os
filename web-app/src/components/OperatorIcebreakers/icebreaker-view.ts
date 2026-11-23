import type { IcebreakerEvaluationResult, IcebreakerStatus } from '@agency-os/shared';

/** Same bound as the API (`icebreakerCreateSchema.text`). */
export const ICEBREAKER_MAX_LENGTH = 2000;

/** Tones reuse the existing StatusPill palette. */
const STATUS_COPY: Record<IcebreakerStatus, { label: string; tone: 'handoff' | 'alert' | 'available' | 'active' }> = {
  DRAFT: { label: 'Borrador', tone: 'handoff' },
  BLOCKED: { label: 'Bloqueado', tone: 'alert' },
  APPROVED: { label: 'Aprobado', tone: 'available' },
  PUBLISHED: { label: 'Publicado', tone: 'active' },
};

export function icebreakerStatusCopy(status: IcebreakerStatus) {
  return STATUS_COPY[status];
}

/** What the operator may do next, mirroring the API rules (FR-22, FR-24). */
export function icebreakerActions(status: IcebreakerStatus): { canEdit: boolean; canEvaluate: boolean; canPublish: boolean } {
  return {
    canEdit: status === 'DRAFT' || status === 'BLOCKED',
    canEvaluate: status !== 'PUBLISHED',
    canPublish: status === 'APPROVED',
  };
}

/** Trims and bounds the text before it reaches the API; returns a Spanish error instead of throwing. */
export function validateIcebreakerText(text: string): { text: string } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Escribe el icebreaker antes de guardarlo.' };
  if (trimmed.length > ICEBREAKER_MAX_LENGTH) return { error: `El icebreaker no puede superar ${ICEBREAKER_MAX_LENGTH} caracteres.` };
  return { text: trimmed };
}

/** FR-22: the operator sees which rule was broken, by name, plus the score when the AI engine gave one. */
export function evaluationSummary(result: IcebreakerEvaluationResult): { title: string; details: string[] } {
  const details = result.violations.map((violation) => `${violation.severity === 'BLOCKING' ? 'Bloqueante' : 'Advertencia'}: ${violation.name}`);
  if (result.score !== undefined) details.push(`Puntaje: ${Math.round(result.score * 100)}/100`);
  if (result.status === 'BLOCKED') return { title: 'Bloqueado: incumple las normas de TalkyTimes y no se puede publicar.', details };
  return { title: result.violations.length ? 'Aprobado con advertencias: ya puedes publicarlo.' : 'Aprobado: ya puedes publicarlo.', details };
}
