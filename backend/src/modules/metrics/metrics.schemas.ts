import { z } from 'zod';
export { metricBatchSchema, type MetricBatchInput } from '@agency-os/shared';

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine(isValidCalendarDate, 'Invalid calendar date');

export const metricQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  profileId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: '`from` must be on or before `to`', path: ['to'] });

export const rankingQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: '`from` must be on or before `to`', path: ['to'] });

export const timeseriesQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(366).default(90),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: '`from` must be on or before `to`', path: ['to'] });

export const reconciliationQuerySchema = z.object({
  date: calendarDateSchema.optional(),
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: '`from` must be on or before `to`', path: ['to'] });

export type MetricQueryInput = z.infer<typeof metricQuerySchema>;
export type RankingQueryInput = z.infer<typeof rankingQuerySchema>;
export type TimeseriesQueryInput = z.infer<typeof timeseriesQuerySchema>;
export type ReconciliationQueryInput = z.infer<typeof reconciliationQuerySchema>;
