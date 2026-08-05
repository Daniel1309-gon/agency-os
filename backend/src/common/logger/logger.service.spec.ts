import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoggerService } from './logger.service.js';

const SECRET = 'la-contrasena-en-claro-del-perfil';

/** Captura lo que pino escribe realmente a stdout, no lo que le pasamos. */
function captureOutput(run: (logger: LoggerService) => void, level = 'debug'): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    run(new LoggerService(level));
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoggerService redaction', () => {
  it('never writes a secret held under a sensitive key, even at debug level', () => {
    // Criterio de entrega de PLAN.md §9: logger en debug durante un redeem y el
    // secreto no aparece en la salida.
    const output = captureOutput((logger) => {
      logger.debug('credential redeemed', { username: 'perfil@talky.test', secret: SECRET, grantId: 'g-1' });
    });

    expect(output).not.toContain(SECRET);
    expect(output).toContain('[REDACTED]');
    // Lo que no es secreto tiene que seguir siendo diagnosticable.
    expect(output).toContain('g-1');
  });

  it('redacts secrets nested inside objects and arrays', () => {
    const output = captureOutput((logger) => {
      logger.info('vault', {
        request: { headers: { authorization: `Bearer ${SECRET}`, 'x-device-token': SECRET } },
        grants: [{ credential: SECRET }, { plaintext: SECRET }],
      });
    });

    expect(output).not.toContain(SECRET);
  });

  it('redacts the environment secrets by name', () => {
    const output = captureOutput((logger) => {
      logger.error('config dump', { JWT_SECRET: SECRET, VAULT_KEK: SECRET, password_hash: SECRET });
    });

    expect(output).not.toContain(SECRET);
  });

  it('honours the configured level', () => {
    const quiet = captureOutput((logger) => logger.debug('not emitted', { a: 1 }), 'info');
    expect(quiet).toBe('');

    const loud = captureOutput((logger) => logger.info('emitted', { a: 1 }), 'info');
    expect(loud).toContain('emitted');
  });

  it('is safe with no context at all', () => {
    const output = captureOutput((logger) => logger.warn('bare message'));
    expect(output).toContain('bare message');
  });
});
