import { afterEach, describe, expect, it, vi } from 'vitest';
import { RocketChatClient } from './rocketchat.client.js';
import type { ConfigService } from '../../config/config.service.js';

const config = {
  get: (key: string) =>
    ({ ROCKETCHAT_BASE_URL: 'https://chat.example.test', ROCKETCHAT_TOKEN: 'token', ROCKETCHAT_USER_ID: 'user' })[key] ?? '',
} as unknown as ConfigService;

function stubFetch() {
  // Los parametros van declarados: sin ellos TypeScript infiere [] para mock.calls y no se
  // puede leer el cuerpo enviado.
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentMessage(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0];
  return (JSON.parse(String(init.body)) as { message: Record<string, unknown> }).message;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RocketChatClient threads the reply when it answers a message', () => {
  it('sends tmid so the answer notifies the thread and not the whole channel', async () => {
    const fetchMock = stubFetch();
    await new RocketChatClient(config).sendMessage('room-1', 'respuesta', 'agency-outbox-7', 'origen-42');

    expect(sentMessage(fetchMock)).toEqual({ rid: 'room-1', msg: 'respuesta', _id: 'agency-outbox-7', tmid: 'origen-42' });
  });

  it('omits tmid entirely when there is no originating message', async () => {
    // Un aviso de break no cuelga de nada; mandar tmid vacio lo rompería.
    const fetchMock = stubFetch();
    await new RocketChatClient(config).sendMessage('room-1', 'aviso', 'agency-outbox-8');

    const message = sentMessage(fetchMock);
    expect(message).toEqual({ rid: 'room-1', msg: 'aviso', _id: 'agency-outbox-8' });
    expect('tmid' in message).toBe(false);
  });
});
