import { z } from 'zod';

// El tope de 72 bytes venia de la truncacion silenciosa de bcrypt. scrypt no
// trunca (decision #19), asi que el limite solo acota el costo de la peticion.
const PASSWORD_MAX = 256;

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const refreshSchema = z.preprocess((value) => value ?? {}, z.object({ refreshToken: z.string().min(20).optional() }));

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: z.string().min(12).max(PASSWORD_MAX),
});
export const passwordResetSchema = z.object({ userId: z.string().uuid(), newPassword: z.string().min(12).max(PASSWORD_MAX) });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
