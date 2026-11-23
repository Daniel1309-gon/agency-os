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

describe('RocketChatClient.listRoomMembers (ADR 0010 / E1-13)', () => {
  it('paginates groups.members read-only for private crew rooms and channels.members for public rooms', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ _id: `u-${i}`, username: `op${i}`, name: `Op ${i}` }));
    const page2 = [{ _id: 'u-100', username: 'op100', name: 'Op 100' }];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('offset=0')) {
        return new Response(JSON.stringify({ success: true, members: page1, total: 101 }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, members: page2, total: 101 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const members = await new RocketChatClient(config).listRoomMembers('grp-1', 'GROUP');
    expect(members).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/groups.members?roomId=grp-1&count=100&offset=0');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/groups.members?roomId=grp-1&count=100&offset=100');

    const channelFetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ success: true, members: [{ _id: 'c-1', username: 'ana' }], total: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', channelFetch);
    const channelMembers = await new RocketChatClient(config).listRoomMembers('ch-1', 'CHANNEL');
    expect(channelMembers).toEqual([{ id: 'c-1', username: 'ana', name: null }]);
    expect(String(channelFetch.mock.calls[0][0])).toContain('/api/v1/channels.members?roomId=ch-1');
  });
});
