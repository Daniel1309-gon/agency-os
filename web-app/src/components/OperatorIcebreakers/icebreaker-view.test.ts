import { describe, expect, it } from 'vitest';
import { ICEBREAKER_MAX_LENGTH, evaluationSummary, icebreakerActions, icebreakerStatusCopy, validateIcebreakerText } from './icebreaker-view';

const ID = '11111111-1111-4111-8111-111111111111';

describe('operator icebreaker view model (FR-21 to FR-24)', () => {
  it('labels every status in Spanish', () => {
    expect(icebreakerStatusCopy('DRAFT').label).toBe('Borrador');
    expect(icebreakerStatusCopy('BLOCKED')).toEqual({ label: 'Bloqueado', tone: 'alert' });
    expect(icebreakerStatusCopy('APPROVED').label).toBe('Aprobado');
    expect(icebreakerStatusCopy('PUBLISHED').label).toBe('Publicado');
  });

  it('mirrors the API rules for editing, evaluating and publishing', () => {
    expect(icebreakerActions('DRAFT')).toEqual({ canEdit: true, canEvaluate: true, canPublish: false });
    expect(icebreakerActions('BLOCKED')).toEqual({ canEdit: true, canEvaluate: true, canPublish: false });
    expect(icebreakerActions('APPROVED')).toEqual({ canEdit: false, canEvaluate: true, canPublish: true });
    expect(icebreakerActions('PUBLISHED')).toEqual({ canEdit: false, canEvaluate: false, canPublish: false });
  });

  it('trims the text and refuses an empty or oversized one', () => {
    expect(validateIcebreakerText('  Hola  ')).toEqual({ text: 'Hola' });
    expect(validateIcebreakerText('   ')).toEqual({ error: 'Escribe el icebreaker antes de guardarlo.' });
    expect(validateIcebreakerText('x'.repeat(ICEBREAKER_MAX_LENGTH + 1))).toEqual({ error: `El icebreaker no puede superar ${ICEBREAKER_MAX_LENGTH} caracteres.` });
  });

  it('names the broken rules and shows the score', () => {
    expect(evaluationSummary({
      id: ID,
      status: 'BLOCKED',
      blocking: true,
      matchedRules: ['NO_CONTACT', 'SOFT'],
      violations: [{ code: 'NO_CONTACT', name: 'Prohibido pedir datos de contacto', severity: 'BLOCKING' }, { code: 'SOFT', name: 'Evitar emojis excesivos', severity: 'WARNING' }],
      score: 0.123,
      source: 'AI_ENGINE',
    })).toEqual({
      title: 'Bloqueado: incumple las normas de TalkyTimes y no se puede publicar.',
      details: ['Bloqueante: Prohibido pedir datos de contacto', 'Advertencia: Evitar emojis excesivos', 'Puntaje: 12/100'],
    });
    expect(evaluationSummary({ id: ID, status: 'APPROVED', blocking: false, matchedRules: [], violations: [], source: 'LOCAL_RULES' })).toEqual({ title: 'Aprobado: ya puedes publicarlo.', details: [] });
    // A score alone is not a warning.
    expect(evaluationSummary({ id: ID, status: 'APPROVED', blocking: false, matchedRules: [], violations: [], score: 0.82, source: 'AI_ENGINE' })).toEqual({ title: 'Aprobado: ya puedes publicarlo.', details: ['Puntaje: 82/100'] });
  });
});
