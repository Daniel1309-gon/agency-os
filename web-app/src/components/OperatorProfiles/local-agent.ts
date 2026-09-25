export interface LocalAgentSession {
  profileId: string;
  sessionId: string;
  chromeProfileDir: string;
  launchUrl: string;
  version: number;
}

function agentUrl(): string | null {
  const configured = import.meta.env.VITE_LOCAL_AGENT_URL as string | undefined;
  return configured?.trim().replace(/\/$/, '') || null;
}

export function localAgentEnabled(): boolean {
  return agentUrl() !== null;
}

async function agentRequest(path: string, body: unknown, failure: string): Promise<void> {
  const baseUrl = agentUrl();
  if (!baseUrl) throw new Error('El agente local no está configurado en este navegador.');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No pudimos conectar con el agente local.');
  }

  const payload: unknown = await response.json().catch(() => undefined);
  const ok = typeof payload === 'object' && payload !== null && 'ok' in payload && (payload as { ok?: unknown }).ok === true;
  if (!response.ok || !ok) {
    throw new Error(failure);
  }
}

export function sendToLocalAgent(session: LocalAgentSession): Promise<void> {
  return agentRequest('/v1/start', { sessions: [session] }, 'El agente local no pudo abrir el perfil.');
}

export function focusLocalAgentSession(sessionId: string, version: number): Promise<void> {
  return agentRequest('/v1/focus', { sessionId, version }, 'El agente local no pudo enfocar el perfil.');
}

export function closeLocalAgentSession(session: Pick<LocalAgentSession, 'sessionId' | 'version'>): Promise<void> {
  return agentRequest('/v1/close', { sessionId: session.sessionId, version: session.version }, 'El agente local no pudo cerrar el perfil.');
}
