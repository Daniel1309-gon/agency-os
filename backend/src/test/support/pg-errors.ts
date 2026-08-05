import { expect } from 'vitest';

/** SQLSTATE que producen los invariantes de PLAN.md §4. */
export const PG = {
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  notNullViolation: '23502',
  insufficientPrivilege: '42501',
} as const;

/** Drizzle envuelve el error de `pg`; el SQLSTATE queda en la causa. */
export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function constraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const name = (current as { constraint?: unknown }).constraint;
    if (typeof name === 'string') return name;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Afirma que Postgres — no el codigo de aplicacion — rechazo la escritura, y
 * con que constraint. Que falle no basta: tiene que fallar por la razon que la
 * prueba dice estar probando.
 */
export async function expectRejectedBy(
  code: string,
  run: () => Promise<unknown>,
  constraint?: string,
): Promise<unknown> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'Postgres accepted a write that an invariant should have rejected').toBeDefined();
  expect(sqlState(thrown)).toBe(code);
  if (constraint) expect(constraintName(thrown)).toBe(constraint);
  return thrown;
}
