import { z } from 'zod';
import { isValidTimeZone } from './tableau-parse.js';

const POINTS_HOURLY_COLUMNS = ['profileId', 'sourceHour', 'points'] as const;
const SCHEDULE_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const viewFields = z.object({
  name: z.string().trim().min(1).max(160),
  siteId: z.string().trim().min(1).max(160),
  viewId: z.string().trim().min(1).max(320),
  sourceTimezone: z.string().trim().min(1).max(80).refine(isValidTimeZone, 'sourceTimezone must be an IANA timezone, e.g. America/Bogota'),
  kind: z.enum(['POINTS_HOURLY', 'METRICS', 'PAYROLL', 'ICEBREAKERS']),
  scheduleTime: z.string().regex(SCHEDULE_TIME_REGEX, 'scheduleTime must be HH:MM (24-hour)').optional(),
  scheduleTimezone: z.string().trim().min(1).max(80).refine(isValidTimeZone, 'scheduleTimezone must be an IANA timezone').optional(),
  freshnessSlaMinutes: z.number().int().min(15).max(1440).optional(),
  columnMapping: z.record(z.string(), z.string().trim().min(1).max(160)).optional(),
});

// sourceTimezone has no default: it is the timezone of the client's worksheet, and
// assuming one misattributes points at every handover.
export const tableauViewSchema = viewFields
  .extend({
    scheduleTime: z.string().regex(SCHEDULE_TIME_REGEX, 'scheduleTime must be HH:MM (24-hour)').default('09:15'),
    scheduleTimezone: z.string().trim().min(1).max(80).refine(isValidTimeZone, 'scheduleTimezone must be an IANA timezone').default('America/Bogota'),
    freshnessSlaMinutes: z.number().int().min(15).max(1440).default(120),
    columnMapping: z.record(z.string(), z.string().trim().min(1).max(160)).default({}),
  })
  .refine((value) => value.kind !== 'POINTS_HOURLY' || POINTS_HOURLY_COLUMNS.every((key) => value.columnMapping[key]), {
    message: `a POINTS_HOURLY view must map ${POINTS_HOURLY_COLUMNS.join(', ')}`,
    path: ['columnMapping'],
  });

// Built from viewFields without defaults: zod 4 applies .default() inside .partial().
export const tableauViewUpdateSchema = viewFields.partial().extend({ isActive: z.boolean().optional() });

export const tableauRunSchema = z.object({ viewId: z.string().uuid(), businessDate: z.string().date() });
export const tableauRunsQuerySchema = z.object({
  viewId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type TableauViewInput = z.infer<typeof tableauViewSchema>;
export type TableauViewUpdateInput = z.infer<typeof tableauViewUpdateSchema>;
export type TableauRunInput = z.infer<typeof tableauRunSchema>;
export type TableauRunsQueryInput = z.infer<typeof tableauRunsQuerySchema>;
