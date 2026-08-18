import { z } from 'zod';

export const assignmentCreateSchema = z.object({
  profileId: z.string().uuid(),
  operatorId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
});

export const assignmentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  operatorId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
});

export const sessionCreateSchema = z.object({ profileId: z.string().uuid(), assignmentId: z.string().uuid(), chromeProfileDir: z.string().trim().min(1).max(160) });
export const sessionPatchSchema = z.object({ status: z.enum(['LAUNCHING', 'ACTIVE', 'ERROR', 'CLOSED']), errorCode: z.string().max(80).optional(), errorDetail: z.string().max(500).optional() });
export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>;
export type AssignmentHistoryQuery = z.infer<typeof assignmentHistoryQuerySchema>;
export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;
export type SessionPatchInput = z.infer<typeof sessionPatchSchema>;
