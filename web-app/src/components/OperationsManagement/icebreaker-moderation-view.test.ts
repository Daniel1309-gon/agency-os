import { describe, expect, it } from 'vitest';
import {
  buildCreateRulePayload,
  buildReviewPayload,
  buildUpdateRulePayload,
  buildViolationsQuery,
  canManageIcebreakerRules,
  reviewVerdictLabel,
  ruleSeverityLabel,
} from './icebreaker-moderation-view';

describe('icebreaker moderation & rules view helpers (FR-25 to FR-27)', () => {
  it('gates rule management strictly to wildcard or icebreaker.rules.manage', () => {
    expect(canManageIcebreakerRules(['*'])).toBe(true);
    expect(canManageIcebreakerRules(['icebreaker.review', 'icebreaker.rules.manage'])).toBe(true);
    expect(canManageIcebreakerRules(['icebreaker.review'])).toBe(false);
    expect(canManageIcebreakerRules([])).toBe(false);
  });

  it('builds violation filter queries cleanly', () => {
    expect(buildViolationsQuery({ from: '2026-11-22', to: '2026-11-23', status: 'OPEN' }))
      .toBe('/icebreakers/violations?from=2026-11-22&to=2026-11-23&status=OPEN&limit=100');
    expect(buildViolationsQuery({ status: '' })).toBe('/icebreakers/violations?limit=100');
  });

  it('validates rule creation/update payloads including regex syntax', () => {
    expect(buildCreateRulePayload({
      code: ' no_wa ',
      name: ' Sin WhatsApp ',
      kind: 'KEYWORD',
      pattern: ' whatsapp ',
      severity: 'BLOCKING',
    })).toEqual({
      code: 'NO_WA',
      name: 'Sin WhatsApp',
      kind: 'KEYWORD',
      pattern: 'whatsapp',
      severity: 'BLOCKING',
    });

    expect(() => buildCreateRulePayload({
      code: 'BAD_RE',
      name: 'Regex rota',
      kind: 'REGEX',
      pattern: '[unclosed',
      severity: 'BLOCKING',
    })).toThrow(/expresión regular/);

    expect(() => buildCreateRulePayload({
      code: 'EMPTY_KW',
      name: 'Sin patrón',
      kind: 'KEYWORD',
      pattern: '   ',
      severity: 'WARNING',
    })).toThrow(/patrón/);

    expect(buildUpdateRulePayload({
      name: 'Revisión manual',
      kind: 'MANUAL',
      pattern: '',
      severity: 'INFO',
    }, 2)).toEqual({ name: 'Revisión manual', kind: 'MANUAL', severity: 'INFO', version: 2 });
  });

  it('validates review payloads and exposes Spanish labels', () => {
    expect(buildReviewPayload('OVERRIDDEN_ALLOW', '  Contexto validado  ')).toEqual({
      verdict: 'OVERRIDDEN_ALLOW',
      reason: 'Contexto validado',
    });
    expect(() => buildReviewPayload('TRUE_POSITIVE', '   ')).toThrow(/justificación/);
    expect(reviewVerdictLabel('FALSE_POSITIVE')).toBe('Falso positivo');
    expect(ruleSeverityLabel('BLOCKING')).toBe('Bloqueante');
  });
});
