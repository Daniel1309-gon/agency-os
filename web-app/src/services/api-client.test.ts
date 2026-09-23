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

  it('keeps the refreshed token when the retried request fails with a server error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(response({ accessToken: 'access-2', expiresIn: 900, user: { id: 'u-1' } }))
      .mockResolvedValueOnce(response({ error: { code: 'INTERNAL_ERROR', message: 'temporary failure' } }, 500));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setAccessToken('access-1');

    await expect(client.request('/protected')).rejects.toMatchObject({ status: 500 });
    expect(client.getAccessToken()).toBe('access-2');
  });

  it('keeps the current token when refresh fails because the network is unavailable', async () => {
    const networkError = new Error('network unavailable');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockRejectedValueOnce(networkError);
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setAccessToken('access-1');

    await expect(client.request('/protected')).rejects.toBe(networkError);
    expect(client.getAccessToken()).toBe('access-1');
  });

  it('clears the token when the refreshed request is still unauthorized', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(response({ accessToken: 'access-2', expiresIn: 900, user: { id: 'u-1' } }))
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHENTICATED', message: 'revoked' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setAccessToken('access-1');

    await expect(client.request('/protected')).rejects.toMatchObject({ status: 401 });
    expect(client.getAccessToken()).toBeNull();
  });

  it('emits session expiration once when a shared refresh returns 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'UNAUTHENTICATED', message: 'revoked' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setAccessToken('old');
    const expired = vi.fn();
    client.onSessionExpired(expired);

    await Promise.allSettled([client.refresh(), client.refresh()]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledOnce();
    expect(client.getAccessToken()).toBeNull();
  });

  it('does not expire a session when the retried request is forbidden', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(response({ accessToken: 'new', expiresIn: 900, user: {} }))
      .mockResolvedValueOnce(response({ error: { code: 'FORBIDDEN', message: 'revoked' } }, 403));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    const expired = vi.fn();
    client.onSessionExpired(expired);
    client.setAccessToken('old');
    await expect(client.request('/protected')).rejects.toMatchObject({ status: 403 });
    expect(expired).not.toHaveBeenCalled();
    expect(client.getAccessToken()).toBe('new');
  });

  it('does not emit session expiration for a failed login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'BAD_LOGIN', message: 'bad' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    const expired = vi.fn();
    client.onSessionExpired(expired);
    await expect(client.login('a@b.test', 'bad')).rejects.toMatchObject({ status: 401 });
    expect(expired).not.toHaveBeenCalled();
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
