import type { AccessTokenClaims } from './crypto.js';

export interface AuthenticatedRequest {
  user?: AccessTokenClaims;
  device?: DevicePrincipal;
  ip?: string;
  id?: string;
  raw?: { url?: string };
  headers: Record<string, string | string[] | undefined>;
}

export interface DevicePrincipal {
  id: string;
  operatorId: string;
  label: string;
  tokenExpiresAt: Date;
}

export const AUTH_USER = Symbol('agency-os.auth-user');
