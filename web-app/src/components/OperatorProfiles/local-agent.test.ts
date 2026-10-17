import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeLocalAgentSession, focusLocalAgentSession, sendToLocalAgent } from './local-agent';

const session = {
  profileId: '123e4567-e89b-12d3-a456-426614174000',
  sessionId: '123e4567-e89b-12d3-a456-426614174001',
  chromeProfileDir: 'Profile 3',
  launchUrl: 'https://talkytimes.com/auth/login',
  version: 2,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('local agent lifecycle bridge', () => {
  it('sends only the session handoff to start and no credential material', async () => {
    vi.stubEnv('VITE_LOCAL_AGENT_URL', 'http://127.0.0.1:45831');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendToLocalAgent(session);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:45831/v1/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sessions: [session] }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain('secret');
  });

  it('uses focus and close commands for an already opened session', async () => {
    vi.stubEnv('VITE_LOCAL_AGENT_URL', 'http://127.0.0.1:45831');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await focusLocalAgentSession(session.sessionId, session.version);
    await closeLocalAgentSession(session);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:45831/v1/focus',
      'http://127.0.0.1:45831/v1/close',
    ]);
  });

  it('hides agent diagnostics behind a safe user error', async () => {
    vi.stubEnv('VITE_LOCAL_AGENT_URL', 'http://127.0.0.1:45831');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'password=secret' }), { status: 500 }));

    await expect(sendToLocalAgent(session)).rejects.toThrow('El agente local no pudo abrir el perfil.');
  });
});
