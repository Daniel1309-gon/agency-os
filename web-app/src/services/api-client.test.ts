import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the access token in the client and sends refresh requests with cookies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ accessToken: 'access-1', expiresIn: 900, user: { id: 'u-1' } }))
      .mockResolvedValueOnce(response({ accessToken: 'access-2', expiresIn: 900, user: { id: 'u-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');

    await client.login('operator@example.com', 'password');
    await client.refresh();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.test/api/v1/auth/login',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.test/api/v1/auth/refresh',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('headers.Authorization');
  });

  it('rotates once after a 401 and retries the original request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(response({ accessToken: 'access-2', expiresIn: 900, user: { id: 'u-1' } }))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setAccessToken('access-1');

    await expect(client.request('/protected')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toBeInstanceOf(Headers);
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Headers).get('authorization')).toBe('Bearer access-1');
    expect(((fetchMock.mock.calls[2][1] as RequestInit).headers as Headers).get('authorization')).toBe('Bearer access-2');
  });

  it('does not persist credentials through browser storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ accessToken: 'access-1', expiresIn: 900, user: { id: 'u-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');

    await client.login('operator@example.com', 'password');

    const localSetItem = vi.fn();
    const sessionSetItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem: localSetItem });
    vi.stubGlobal('sessionStorage', { setItem: sessionSetItem });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(sessionSetItem).not.toHaveBeenCalled();
  });
});
