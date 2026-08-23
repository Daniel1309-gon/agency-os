import { z } from 'zod';

export const deviceCreateSchema = z.object({ hostname: z.string().trim().min(1).max(255), label: z.string().trim().min(1).max(160) });
export const deviceEnrollSchema = z.object({ code: z.string().min(20).max(128), hostname: z.string().trim().min(1).max(255), label: z.string().trim().min(1).max(160) });
export const deviceHeartbeatSchema = z.object({ extensionVersion: z.string().max(64).optional(), helperVersion: z.string().max(64).optional(), osVersion: z.string().max(128).optional() });
export const deviceRevokeSchema = z.object({ reason: z.string().trim().min(1).max(64).optional() });
export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DeviceEnrollInput = z.infer<typeof deviceEnrollSchema>;
export type DeviceHeartbeatInput = z.infer<typeof deviceHeartbeatSchema>;
export type DeviceRevokeInput = z.infer<typeof deviceRevokeSchema>;
