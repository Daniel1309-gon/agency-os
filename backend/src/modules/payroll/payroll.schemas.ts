import { z } from 'zod';

export const periodCreateSchema = z.object({ name: z.string().trim().min(1).max(120), startsOn: z.string().date(), endsOn: z.string().date(), defaultPointsToCopRate: z.number().positive().max(1_000_000) });
export const adjustmentSchema = z.object({ type: z.enum(['BONUS', 'PENALTY', 'ADVANCE', 'CORRECTION']), amountCop: z.number().finite(), reason: z.string().trim().min(1).max(1000) });
export const goalSchema = z.object({ scope: z.enum(['OPERATOR', 'CREW']), operatorId: z.string().uuid().optional(), crewId: z.string().uuid().optional(), periodId: z.string().uuid(), targetPoints: z.number().positive(), bonusType: z.string().trim().min(1).max(16), bonusCop: z.number().nonnegative().optional(), tiers: z.array(z.unknown()).optional() }).superRefine((value, ctx) => { if (value.scope === 'OPERATOR' && !value.operatorId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'operatorId is required for OPERATOR goals' }); if (value.scope === 'CREW' && !value.crewId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'crewId is required for CREW goals' }); });
export const pointsAdjustmentSchema = z.object({ operatorId: z.string().uuid(), profileId: z.string().uuid(), businessDate: z.string().date(), points: z.number().finite(), reason: z.string().trim().min(1).max(1000), referenceId: z.string().max(160).optional() });
export const competitionSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(1000).optional(), metric: z.string().trim().min(1).max(24), scope: z.enum(['GLOBAL', 'CREW']), crewId: z.string().uuid().optional(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), rules: z.record(z.unknown()).default({}), prizeScheme: z.record(z.unknown()).default({}) }).refine((value) => value.startsAt < value.endsAt, 'endsAt must be after startsAt');
export type PeriodCreateInput = z.infer<typeof periodCreateSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type GoalInput = z.infer<typeof goalSchema>;
export type PointsAdjustmentInput = z.infer<typeof pointsAdjustmentSchema>;
export type CompetitionInput = z.infer<typeof competitionSchema>;
