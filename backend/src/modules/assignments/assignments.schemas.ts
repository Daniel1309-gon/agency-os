import { z } from 'zod';
import { sessionHeartbeatSchema as sharedSessionHeartbeatSchema, sessionPatchSchema as sharedSessionPatchSchema } from '@agency-os/shared';
export {
  sessionCreateSchema,
  sessionCloseSchema,
  sessionHeartbeatSchema,
  sessionPatchSchema,
  type SessionCreateInput,
  type SessionCloseInput,
  type SessionHeartbeatInput,
  type SessionPatchInput,
} from '@agency-os/shared';

const assignmentWindowSchema = z.object({
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
}).strict();

const assignmentConcreteSchema = z.object({
  profileId: z.string().uuid(),
  operatorId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
}).strict();

const assignmentBatchSchema = z.object({
  profileId: z.string().uuid(),
  operatorId: z.string().uuid(),
  windows: z.array(assignmentWindowSchema).min(1).max(366),
}).strict();

export const assignmentCreateSchema = z.union([assignmentConcreteSchema, assignmentBatchSchema]);

export type AssignmentConcreteInput = z.infer<typeof assignmentConcreteSchema>;
export type AssignmentBatchInput = z.infer<typeof assignmentBatchSchema>;

export const assignmentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  operatorId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
});

export const stationSessionPatchSchema = sharedSessionPatchSchema.refine(
  (input) => input.status === 'ACTIVE' || input.status === 'ERROR',
  { message: 'Station sessions can only become ACTIVE or ERROR', path: ['status'] },
);

export const stationSessionHeartbeatSchema = sharedSessionHeartbeatSchema;

export type AssignmentCreateInput = AssignmentConcreteInput | AssignmentBatchInput;
export type AssignmentHistoryQuery = z.infer<typeof assignmentHistoryQuerySchema>;
export type StationSessionPatchInput = z.infer<typeof stationSessionPatchSchema>;
export type StationSessionHeartbeatInput = z.infer<typeof stationSessionHeartbeatSchema>;
