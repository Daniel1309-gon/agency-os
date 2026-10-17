import { z } from 'zod';

export const profileCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  loginEmail: z.string().trim().email().max(320),
  externalRef: z.string().trim().max(160).optional(),
  country: z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
  chromeProfileDir: z.string().trim().regex(/^(Default|Profile \d{1,3})$/, 'Invalid Chrome profile directory').optional(),
  notes: z.string().max(2000).optional(),
});

export const profileUpdateSchema = profileCreateSchema.partial().extend({ version: z.number().int().nonnegative() });

export type ProfileCreateInput = z.infer<typeof profileCreateSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
