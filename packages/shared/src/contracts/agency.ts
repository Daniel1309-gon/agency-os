import { z } from 'zod';

export const roleCodeSchema = z.enum(['ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR', 'OPERADOR', 'CAFETERIA']);
export type RoleCode = z.infer<typeof roleCodeSchema>;

export const operatorStatusSchema = z.enum(['ONLINE', 'BREAK', 'ALERT', 'OFFLINE']);
export type OperatorStatus = z.infer<typeof operatorStatusSchema>;

export const operatorStatusSnapshotSchema = z.object({
  operatorId: z.string().uuid(),
  fullName: z.string(),
  status: operatorStatusSchema,
  reason: z.string(),
  changedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type OperatorStatusSnapshot = z.infer<typeof operatorStatusSnapshotSchema>;

export const profileSessionStatusSchema = z.enum(['LAUNCHING', 'ACTIVE', 'ERROR', 'STALE', 'CLOSED']);
export type ProfileSessionStatus = z.infer<typeof profileSessionStatusSchema>;

export const shiftStatusSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;

export const shiftSummarySchema = z.object({
  id: z.string().uuid(),
  operatorId: z.string().uuid(),
  businessDate: z.string().date(),
  scheduledRange: z.string().nullable(),
  actualStartAt: z.string().datetime({ offset: true }).nullable(),
  actualEndAt: z.string().datetime({ offset: true }).nullable(),
  status: shiftStatusSchema,
  effectiveMinutes: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable(),
}).strict();
export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

export const breakStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type BreakStatus = z.infer<typeof breakStatusSchema>;

export const breakSummarySchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  type: z.string(),
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().nonnegative().nullable(),
  status: breakStatusSchema,
}).strict();
export type BreakSummary = z.infer<typeof breakSummarySchema>;

export const profileStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'RETIRED']);
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

export const profileRecordSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  loginEmail: z.string().email(),
  externalRef: z.string().nullable(),
  country: z.string().nullable(),
  status: profileStatusSchema,
  chromeProfileDir: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type ProfileRecord = z.infer<typeof profileRecordSchema>;

export const profileListResponseSchema = z.object({
  data: z.array(profileRecordSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type ProfileListResponse = z.infer<typeof profileListResponseSchema>;

export const cafeteriaOrderStatusSchema = z.enum(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED', 'EXPIRED']);
export type CafeteriaOrderStatus = z.infer<typeof cafeteriaOrderStatusSchema>;

const chromeProfileDirSchema = z.string().trim().regex(/^(Default|Profile \d{1,3})$/, 'Invalid Chrome profile directory');
const talkyTimesLaunchUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'talkytimes.com' && url.pathname.startsWith('/auth/login');
}, 'Invalid TalkyTimes launch URL');

export const prepareSessionMessageSchema = z.object({
  action: z.literal('prepareSession'),
  accessToken: z.string().min(1),
  profileId: z.string().uuid(),
  sessionId: z.string().uuid(),
  chromeProfileDir: chromeProfileDirSchema,
  launchUrl: talkyTimesLaunchUrlSchema,
  version: z.number().int().positive(),
});
export type PrepareSessionMessage = z.infer<typeof prepareSessionMessageSchema>;

export const launchProfileMessageSchema = z.object({
  action: z.literal('launchProfile'),
  profileId: z.string().uuid(),
  sessionId: z.string().uuid(),
  chromeProfileDir: chromeProfileDirSchema,
  launchUrl: talkyTimesLaunchUrlSchema,
});
export type LaunchProfileMessage = z.infer<typeof launchProfileMessageSchema>;

export const operationalMetricsSchema = z.object({
  operatorsOnline: z.number().int().nonnegative(),
  operatorsScheduled: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
  coveredShifts: z.number().int().nonnegative(),
  pendingOrders: z.number().int().nonnegative(),
  measuredAt: z.string(),
});
export type OperationalMetrics = z.infer<typeof operationalMetricsSchema>;

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  role: roleCodeSchema,
  permissions: z.array(z.string()),
  mustChangePassword: z.boolean(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const assignedProfileSchema = z.object({
  assignmentId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileName: z.string(),
  profileUsername: z.string(),
  status: profileStatusSchema,
  chromeProfileDir: z.string(),
  shiftId: z.string().uuid().nullable(),
  validFrom: z.string(),
  validTo: z.string(),
  session: z.object({
    id: z.string().uuid(),
    status: profileSessionStatusSchema,
    version: z.number().int().positive(),
    startedAt: z.string().nullable(),
    errorCode: z.string().nullable(),
  }).nullable(),
}).strict();
export type AssignedProfile = z.infer<typeof assignedProfileSchema>;

export const cafeteriaProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string(),
  priceCop: z.string(),
  prepMinutes: z.number().nullable().optional(),
  pickupDeadlineMinutes: z.number().nullable().optional(),
  imageUri: z.string().nullable().optional(),
  isAvailable: z.boolean().optional(),
});
export type CafeteriaProduct = z.infer<typeof cafeteriaProductSchema>;

export const cafeteriaOrderItemSchema = z.object({
  productId: z.string().uuid(),
  productNameSnapshot: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCop: z.string(),
  lineTotalCop: z.string(),
  notes: z.string().nullable().optional(),
});
export type CafeteriaOrderItem = z.infer<typeof cafeteriaOrderItemSchema>;

export const cafeteriaOrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.number().int(),
  operatorId: z.string().uuid(),
  status: cafeteriaOrderStatusSchema,
  placedAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  readyAt: z.string().nullable().optional(),
  pickupDeadlineAt: z.string().nullable().optional(),
  deliveredAt: z.string().nullable().optional(),
  totalCop: z.string(),
  notes: z.string().nullable().optional(),
  items: z.array(cafeteriaOrderItemSchema),
});
export type CafeteriaOrder = z.infer<typeof cafeteriaOrderSchema>;
