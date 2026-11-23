import { z } from 'zod';

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine(isValidCalendarDate, 'Invalid calendar date');

export const icebreakerCreateSchema = z.object({ profileId: z.string().uuid().optional(), text: z.string().trim().min(1).max(2000) });
export const icebreakerUpdateSchema = icebreakerCreateSchema.partial().extend({ version: z.number().int().nonnegative() });
export type RuleKind = 'REGEX' | 'KEYWORD' | 'MANUAL';

/**
 * Why a rule's pattern cannot work for its kind, or null when it can. Evaluation
 * treats a regex that does not compile as a match (a broken guard must not pass
 * text), so storing one would block every icebreaker: it is refused up front.
 */
export function rulePatternIssue(kind: RuleKind, pattern: string | null | undefined): string | null {
  const value = pattern?.trim() ? pattern : null;
  if (kind === 'MANUAL') return value === null ? null : 'MANUAL rules take no pattern';
  if (value === null) return `${kind} rules require a pattern`;
  if (kind === 'REGEX') {
    try { new RegExp(value, 'iu'); } catch { return 'Pattern is not a valid regular expression'; }
  }
  return null;
}

const ruleFields = z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(160), kind: z.enum(['REGEX', 'KEYWORD', 'MANUAL']), pattern: z.string().max(500).nullable().optional(), severity: z.enum(['INFO', 'WARNING', 'BLOCKING']) });
export const ruleSchema = ruleFields.superRefine((value, ctx) => {
  const issue = rulePatternIssue(value.kind, value.pattern);
  if (issue) ctx.addIssue({ code: 'custom', path: ['pattern'], message: issue });
});
/** The stored kind is needed to judge a partial change, so the service validates the merged rule. */
export const ruleUpdateSchema = ruleFields.partial().extend({ isActive: z.boolean().optional(), version: z.number().int().positive() });
export const reviewSchema = z.object({ verdict: z.enum(['TRUE_POSITIVE', 'FALSE_POSITIVE', 'OVERRIDDEN_ALLOW']), reason: z.string().trim().min(1).max(1000) });
export const violationsQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  operatorId: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'REVIEWED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: '`from` must be on or before `to`', path: ['to'] });
export type IcebreakerCreateInput = z.infer<typeof icebreakerCreateSchema>;
export type IcebreakerUpdateInput = z.infer<typeof icebreakerUpdateSchema>;
export type RuleInput = z.infer<typeof ruleSchema>;
export type RuleUpdateInput = z.infer<typeof ruleUpdateSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type ViolationsQueryInput = z.infer<typeof violationsQuerySchema>;
