import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  // log2(N) de scrypt (decision #19). 17 => N=2^17, 128 MiB, minimo OWASP con p=1.
  PASSWORD_SCRYPT_LOG2N: z.coerce.number().int().min(14).max(20).default(17),
  VAULT_KEK: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  EXTENSION_ID: z.string().regex(/^[a-p]{32}$/).optional().or(z.literal('')).default(''),
  TABLEAU_API_BASE_URL: z.string().url().optional().or(z.literal('')).default(''),
  TABLEAU_AUTH_TOKEN: z.string().optional().or(z.literal('')).default(''),
  AI_ENGINE_URL: z.string().url().optional().or(z.literal('')).default(''),
  AI_ENGINE_TOKEN: z.string().optional().or(z.literal('')).default(''),
  ROCKETCHAT_BASE_URL: z.string().url().optional().or(z.literal('')).default(''),
  ROCKETCHAT_TOKEN: z.string().optional().or(z.literal('')).default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof configSchema>;
