import { z } from 'zod';

export const credentialRotationSchema = z.object({
  username: z.string().trim().min(1).max(320),
  secret: z.string().min(1).max(256),
});

export const credentialGrantSchema = z.object({
  profileId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

export const credentialRedeemSchema = z.object({ grantId: z.string().uuid() });

export type CredentialRotationInput = z.infer<typeof credentialRotationSchema>;
export type CredentialGrantInput = z.infer<typeof credentialGrantSchema>;
export type CredentialRedeemInput = z.infer<typeof credentialRedeemSchema>;
