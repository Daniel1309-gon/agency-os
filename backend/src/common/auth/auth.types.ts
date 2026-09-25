import type { AccessTokenClaims } from './crypto.js';

export interface AuthenticatedRequest {
  user?: AccessTokenClaims;
  device?: DevicePrincipal;
  /** Huella verificada del certificado, disponible en rutas de enrolamiento. */
  clientCertFingerprint?: string;
  clientCertNotAfter?: Date | null;
  ip?: string;
  id?: string;
  raw?: { url?: string; socket?: { remoteAddress?: string } };
  headers: Record<string, string | string[] | undefined>;
}

export interface DevicePrincipal {
  id: string;
  label: string;
  kind: 'STATION' | 'ADMIN';
  /** SHA-256 of the mTLS client certificate, lowercase hex. */
  fingerprint: string;
  certNotAfter: Date | null;
}

/** Certificado ya verificado en el borde, para rutas de enrolamiento. */
export interface ClientCertIdentity {
  fingerprint?: string;
  notAfter?: Date | null;
}

export const AUTH_USER = Symbol('agency-os.auth-user');
