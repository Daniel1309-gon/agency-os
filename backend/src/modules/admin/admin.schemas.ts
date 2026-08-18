import { z } from 'zod';

export const userCreateSchema = z.object({ email: z.string().email().max(320), fullName: z.string().trim().min(1).max(160), password: z.string().min(12).max(72), roleCode: z.string().trim().min(1).max(80), nationalId: z.string().max(40).optional(), phone: z.string().max(40).optional(), rocketchatUserId: z.string().max(160).optional(), rocketchatDirectRoomId: z.string().max(160).optional() });
export const userPatchSchema = z.object({ fullName: z.string().trim().min(1).max(160).optional(), phone: z.string().max(40).optional(), roleCode: z.string().max(80).optional(), rocketchatUserId: z.string().max(160).optional(), rocketchatDirectRoomId: z.string().max(160).optional() });
export const settingSchema = z.object({ value: z.unknown(), description: z.string().max(500).optional(), isSecret: z.boolean().optional() });
export const featureFlagSchema = z.object({ isEnabled: z.boolean(), rollout: z.record(z.unknown()).optional(), description: z.string().max(500).optional() });
export const ipAllowlistSchema = z.object({ label: z.string().trim().min(1).max(160), cidr: z.string().trim().min(1).max(64), scope: z.enum(['ALL', 'ROLE', 'USER']).default('ALL'), roleId: z.string().uuid().optional(), userId: z.string().uuid().optional(), expiresAt: z.string().datetime({ offset: true }).optional() });
export const compensationSchema = z.object({ commissionRate: z.number().positive().max(1), pointsToCopRate: z.number().positive().max(1_000_000), monthlyGoalPoints: z.number().nonnegative().optional(), maxConcurrentProfiles: z.number().int().positive().max(32).default(1), validFrom: z.string().datetime({ offset: true }).optional(), validTo: z.string().datetime({ offset: true }).optional(), note: z.string().max(1000).optional() }).refine((value) => !value.validFrom || !value.validTo || value.validFrom < value.validTo, 'validTo must be after validFrom');
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserPatchInput = z.infer<typeof userPatchSchema>;
export type SettingInput = z.infer<typeof settingSchema>;
export type FeatureFlagInput = z.infer<typeof featureFlagSchema>;
export type IpAllowlistInput = z.infer<typeof ipAllowlistSchema>;
export type CompensationInput = z.infer<typeof compensationSchema>;
