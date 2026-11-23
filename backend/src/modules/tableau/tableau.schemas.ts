import { z } from 'zod';
import { isValidTimeZone } from './tableau-parse.js';

const POINTS_HOURLY_COLUMNS = ['profileId', 'sourceHour', 'points'] as const;

// sourceTimezone has no default: it is the timezone of the client's worksheet, and
// assuming one misattributes points at every handover.
export const tableauViewSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    siteId: z.string().trim().min(1).max(160),
    viewId: z.string().trim().min(1).max(320),
    sourceTimezone: z.string().trim().min(1).max(80).refine(isValidTimeZone, 'sourceTimezone must be an IANA timezone, e.g. America/Bogota'),
    kind: z.enum(['POINTS_HOURLY', 'METRICS', 'PAYROLL', 'ICEBREAKERS']),
    columnMapping: z.record(z.string(), z.string().trim().min(1).max(160)).default({}),
  })
  .refine((value) => value.kind !== 'POINTS_HOURLY' || POINTS_HOURLY_COLUMNS.every((key) => value.columnMapping[key]), {
    message: `a POINTS_HOURLY view must map ${POINTS_HOURLY_COLUMNS.join(', ')}`,
    path: ['columnMapping'],
  });
export const tableauRunSchema = z.object({ viewId: z.string().uuid(), businessDate: z.string().date() });
export type TableauViewInput = z.infer<typeof tableauViewSchema>;
export type TableauRunInput = z.infer<typeof tableauRunSchema>;
