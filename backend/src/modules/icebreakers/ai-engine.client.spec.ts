import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiEngineClient } from './ai-engine.client.js';
import type { ConfigService } from '../../config/config.service.js';

function client(values: Partial<Record<string, string>> = {}): AiEngineClient {
  const config = {
    get: (key: string) => values[key] ?? (key === 'AI_ENGINE_URL' ? 'https://ai.agency.test/' : 'ai-token'),
  } as unknown as ConfigService;
  return new AiEngineClient(config);
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiEngineClient', () => {
  it('falls back to local rules when no engine is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(client({ AI_ENGINE_URL: '' }).evaluate('hola', [])).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the text and rules with the bearer token, without a double slash', async () => {
    respondWith({ status: 'APPROVED', score: 0.8 });

    await client().evaluate('hola guapo', [{ code: 'NO_CONTACT', severity: 'BLOCKING' }]);

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ai.agency.test/evaluate');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ai-token');
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hola guapo',
      rules: [{ code: 'NO_CONTACT', severity: 'BLOCKING' }],
    });
  });

  it('parses a well formed evaluation', async () => {
    respondWith({ status: 'BLOCKED', score: 0.15, result: { reason: 'contacto externo' }, model: 'x-1', tokenCostUsd: 0.0002 });

    await expect(client().evaluate('dame tu whatsapp', [])).resolves.toEqual({
      status: 'BLOCKED',
      score: 0.15,
      result: { reason: 'contacto externo' },
      model: 'x-1',
      tokenCostUsd: 0.0002,
    });
  });

  it('throws on a non-2xx response instead of treating it as approved', async () => {
    // Un motor caido no puede publicar icebreakers sin evaluar.
    respondWith({ error: 'boom' }, 503);
    await expect(client().evaluate('hola', [])).rejects.toThrow(/HTTP 503/);
  });

  it('rejects a response that does not match the contract', async () => {
    const invalid: unknown[] = [
      { status: 'MAYBE', score: 0.5 },
      { status: 'APPROVED', score: 1.5 },
      { status: 'APPROVED', score: -1 },
      { status: 'APPROVED' },
      { score: 0.5 },
      'not json at all',
    ];
    for (const body of invalid) {
      respondWith(body);
      await expect(client().evaluate('hola', [])).rejects.toThrow(/invalid evaluation/);
    }
  });

  it('defaults the result object when the engine omits it', async () => {
    respondWith({ status: 'APPROVED', score: 1 });
    await expect(client().evaluate('hola', [])).resolves.toMatchObject({ result: {} });
  });
});
