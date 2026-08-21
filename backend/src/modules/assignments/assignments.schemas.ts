import { z } from 'zod';
export {
  sessionCreateSchema,
  sessionPatchSchema,
  type SessionCreateInput,
  type SessionPatchInput,
} from '@agency-os/shared';

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

export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>;
export type AssignmentHistoryQuery = z.infer<typeof assignmentHistoryQuerySchema>;
