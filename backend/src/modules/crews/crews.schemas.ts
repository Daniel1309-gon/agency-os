import { z } from 'zod';

export const crewSchema = z.object({ name: z.string().trim().min(1).max(160), coordinatorId: z.string().uuid().optional() });
export const crewMemberSchema = z.object({ userId: z.string().uuid(), validFrom: z.string().datetime({ offset: true }), validTo: z.string().datetime({ offset: true }) });
export type CrewInput = z.infer<typeof crewSchema>;
export type CrewMemberInput = z.infer<typeof crewMemberSchema>;
