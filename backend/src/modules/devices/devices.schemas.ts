import { z } from 'zod';

export const certFingerprintSchema = z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, 'certFingerprint must be a lowercase SHA-256 hex digest');
const certNotAfterSchema = z.string().datetime({ offset: true });

export const deviceCreateSchema = z.object({
  hostname: z.string().trim().min(1).max(255),
  label: z.string().trim().min(1).max(160),
  deviceKind: z.enum(['STATION', 'ADMIN']).default('STATION'),
});
export const deviceEnrollSchema = z.object({
  code: z.string().min(20).max(128),
  hostname: z.string().trim().min(1).max(255),
  label: z.string().trim().min(1).max(160).optional(),
  certFingerprint: certFingerprintSchema,
  certNotAfter: certNotAfterSchema.optional(),
});
export const deviceCertificateSchema = z.object({
  certFingerprint: certFingerprintSchema,
  certNotAfter: certNotAfterSchema.optional(),
});
export const deviceHeartbeatSchema = z.object({
  extensionVersion: z.string().max(64).optional(),
  helperVersion: z.string().max(64).optional(),
  osVersion: z.string().max(128).optional(),
});
export const deviceRevokeSchema = z.object({ reason: z.string().trim().min(1).max(64).optional() });

export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DeviceEnrollInput = z.infer<typeof deviceEnrollSchema>;
export type DeviceCertificateInput = z.infer<typeof deviceCertificateSchema>;
export type DeviceHeartbeatInput = z.infer<typeof deviceHeartbeatSchema>;
export type DeviceRevokeInput = z.infer<typeof deviceRevokeSchema>;
