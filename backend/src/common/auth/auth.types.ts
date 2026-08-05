import type { AccessTokenClaims } from './crypto.js';

export interface AuthenticatedRequest {
  user?: AccessTokenClaims;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

export const AUTH_USER = Symbol('agency-os.auth-user');
