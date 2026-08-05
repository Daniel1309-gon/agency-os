import { z } from 'zod';

export const icebreakerCreateSchema = z.object({ profileId: z.string().uuid().optional(), text: z.string().trim().min(1).max(2000) });
export const icebreakerUpdateSchema = icebreakerCreateSchema.partial().extend({ version: z.number().int().nonnegative() });
export const ruleSchema = z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(160), kind: z.enum(['REGEX', 'KEYWORD', 'MANUAL']), pattern: z.string().max(500).optional(), severity: z.enum(['INFO', 'WARNING', 'BLOCKING']) });
export const ruleUpdateSchema = ruleSchema.partial().extend({ version: z.number().int().positive() });
export const reviewSchema = z.object({ verdict: z.enum(['TRUE_POSITIVE', 'FALSE_POSITIVE', 'OVERRIDDEN_ALLOW']), reason: z.string().trim().min(1).max(1000) });
export type IcebreakerCreateInput = z.infer<typeof icebreakerCreateSchema>;
export type IcebreakerUpdateInput = z.infer<typeof icebreakerUpdateSchema>;
export type RuleInput = z.infer<typeof ruleSchema>;
export type RuleUpdateInput = z.infer<typeof ruleUpdateSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
