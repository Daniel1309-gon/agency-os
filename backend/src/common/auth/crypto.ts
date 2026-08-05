import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const encoder = new TextEncoder();

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function parseBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export interface AccessTokenClaims {
  sub: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
  jti: string;
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'jti'>,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds, jti: randomBytes(16).toString('hex') }),
  );
  const input = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(input).digest();
  return `${input}.${base64Url(signature)}`;
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const actual = parseBase64Url(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid token signature');
  }
  const decoded = JSON.parse(parseBase64Url(payload).toString('utf8')) as AccessTokenClaims;
  if (!decoded.sub || !decoded.exp || decoded.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token');
  }
  return decoded;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHmac('sha256', 'agency-os-token-hash').update(token).digest('hex');
}

/**
 * Contrasenas con scrypt (decision #19 de agents.md). Node 22 no trae bcrypt y
 * scrypt es memory-hard, que es la propiedad que bcrypt no tiene.
 *
 * Los parametros van dentro del hash, no en configuracion: subir el costo mas
 * adelante no invalida los hashes ya emitidos, cada uno se verifica con los
 * parametros con los que se creo. `log2N` es el unico valor que se configura;
 * r y p quedan en los valores de referencia de OWASP (r=8, p=1), con N=2^17 por
 * defecto — 128 MiB, el minimo que OWASP acepta con p=1.
 *
 * Formato: scrypt$<log2N>$<r>$<p>$<salt b64url>$<digest b64url>
 */
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_DEFAULT_LOG2N = 17;
const SCRYPT_KEYLEN = 64;

// Node rechaza el hash si 128*N*r supera maxmem. Se pide el doble de lo que
// necesita el calculo para que un cambio de parametros no tumbe el login.
function scryptOptions(log2N: number): { N: number; r: number; p: number; maxmem: number } {
  const N = 2 ** log2N;
  return { N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * N * SCRYPT_R };
}

export async function hashPassword(password: string, log2N: number = SCRYPT_DEFAULT_LOG2N): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, scryptOptions(log2N));
  return `scrypt$${log2N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts[0] !== 'scrypt') return false;

  // Formato heredado scrypt$<cost>$<salt>$<digest>, donde N se derivaba de un
  // "cost" de bcrypt. Se acepta al verificar para no dejar fuera a los usuarios
  // creados antes de la decision #19; al cambiar de contrasena se reescribe con
  // el formato nuevo.
  const legacy = parts.length === 4;
  if (!legacy && parts.length !== 6) return false;

  const [, first, second, third, fourth, fifth] = parts;
  const log2N = legacy ? Math.min(Math.max(Number(first) + 2, 12), 18) : Number(first);
  const r = legacy ? 8 : Number(second);
  const p = legacy ? 1 : Number(third);
  const saltValue = legacy ? second : fourth;
  const digestValue = legacy ? third : fifth;
  if (!Number.isInteger(log2N) || log2N < 12 || log2N > 20) return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 16) return false;
  if (!saltValue || !digestValue) return false;

  const expected = Buffer.from(digestValue, 'base64url');
  const N = 2 ** log2N;
  const actual = await scryptAsync(password, Buffer.from(saltValue, 'base64url'), expected.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Un hash emitido con parametros distintos a los vigentes se reescribe al proximo login. */
export function needsRehash(encoded: string, log2N: number = SCRYPT_DEFAULT_LOG2N): boolean {
  const parts = encoded.split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return true;
  return Number(parts[1]) !== log2N || Number(parts[2]) !== SCRYPT_R || Number(parts[3]) !== SCRYPT_P;
}

export function constantTimeHash(value: string): string {
  return createHmac('sha256', encoder.encode('agency-os')).update(value).digest('hex');
}
