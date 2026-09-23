import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '../services/api-client';
import { AuthProvider } from './AuthProvider';

// Exercise the provider callbacks without adding a DOM dependency. Browser QA
// covers rendering; these slots capture the state produced by each async flow.
const state = vi.hoisted(() => ({ values: [] as unknown[], effects: [] as Array<() => unknown> }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.values.push(initial) - 1;
    return [initial, (value: unknown) => { state.values[index] = value; }];
  },
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => unknown) => { state.effects.push(effect); },
}));

beforeEach(() => {
  vi.restoreAllMocks();
  state.values = [];
  state.effects = [];
  apiClient.setAccessToken(null);
});

describe('login session state', () => {
  it('becomes anonymous when the API reports an expired session', () => {
    apiClient.setAccessToken('old');
    AuthProvider({ children: null });
    const unsubscribe = state.effects[0]() as () => void;
    apiClient.endSession();
    expect(state.values[0]).toBeNull();
    expect(state.values[1]).toBe('anonymous');
    expect(apiClient.getAccessToken()).toBeNull();
    unsubscribe();
  });

  it.each([401, 403, 429, 500, 'network'])('keeps the login available when login fails with %s', async (failure) => {
    const error = typeof failure === 'number'
      ? new ApiError(failure, { code: 'LOGIN_FAILED', message: 'Login rejected' })
      : new TypeError('Failed to fetch');
    vi.spyOn(apiClient, 'login').mockRejectedValue(error);
    const { login } = AuthProvider({ children: null }).props.value;

    await expect(login('operator@example.com', 'test-password')).rejects.toThrow();

    expect(state.values[1]).toBe('anonymous');
    expect(state.values[2]).toBe(false);
    expect(state.values[3]).toEqual(expect.any(String));
    expect(apiClient.getAccessToken()).toBeNull();
  });

  it.each([500, 'network', 401])('handles /me failure %s after a successful login', async (failure) => {
    vi.spyOn(apiClient, 'login').mockImplementation(async () => {
      apiClient.setAccessToken('new-session');
      return { accessToken: 'new-session', expiresIn: 900, user: null };
    });
    vi.spyOn(apiClient, 'request').mockRejectedValue(typeof failure === 'number'
      ? new ApiError(failure, { code: 'ME_FAILED', message: 'User lookup failed' })
      : new TypeError('Failed to fetch'));
    const { login } = AuthProvider({ children: null }).props.value;

    await expect(login('operator@example.com', 'test-password')).rejects.toThrow();

    expect(state.values[1]).toBe(failure === 401 ? 'anonymous' : 'recoverable');
    expect(apiClient.getAccessToken()).toBe(failure === 401 ? null : 'new-session');
  });
});
