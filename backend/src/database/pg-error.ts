/**
 * Los invariantes de PLAN.md §4 viven en Postgres, asi que la unica senal de que
 * una carrera se perdio es el SQLSTATE del error. Drizzle no propaga el error de
 * `pg` tal cual: lo envuelve en un `DrizzleQueryError` con la consulta y los
 * parametros, y deja el original en `cause`. Leer `error.code` directamente
 * devuelve `undefined` siempre, y el 409 que el servicio queria devolver se
 * convierte en un 500.
 */

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_CHECK_VIOLATION = '23514';

const MAX_CAUSE_DEPTH = 5;

/** SQLSTATE del error de Postgres, este envuelto o no. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isPgError(error: unknown, code: string): boolean {
  return pgErrorCode(error) === code;
}
