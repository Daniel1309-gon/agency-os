import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { reconnectDelay, scheduleServerCloseReconnect } from './server-close-reconnect';

const socket = () => ({ disconnected: true, connect: vi.fn() }) as unknown as Socket;
const options = (overrides: Record<string, unknown> = {}) => ({
  socket: socket(), reason: 'io server disconnect', isDisposed: () => false,
  renewSession: vi.fn(async () => undefined), onSessionExpired: vi.fn(), attempt: 0,
  ...overrides,
});

describe('scheduleServerCloseReconnect', () => {
  afterEach(() => vi.useRealTimers());

  it('renueva antes de reconectar tras el cierre del servidor', async () => {
    vi.useFakeTimers();
    const args = options();
    scheduleServerCloseReconnect(args);
    await vi.runAllTimersAsync();
    expect(args.renewSession).toHaveBeenCalledOnce();
    expect(args.socket.connect).toHaveBeenCalledOnce();
  });

  it.each([401, 403])('termina la sesión sin reconectar si refresh devuelve %i', async (status) => {
    vi.useFakeTimers();
    const args = options({ renewSession: vi.fn().mockRejectedValue({ status }) });
    scheduleServerCloseReconnect(args);
    await vi.runAllTimersAsync();
    expect(args.socket.connect).not.toHaveBeenCalled();
    expect(args.onSessionExpired).toHaveBeenCalledOnce();
  });

  it('reconecta con backoff tras un fallo de red, incluso en connect_error', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const args = options({ reason: 'connect_error', attempt: 3, renewSession: vi.fn().mockRejectedValue(new TypeError('network')) });
    scheduleServerCloseReconnect(args);
    await vi.advanceTimersByTimeAsync(reconnectDelay(3) + 1);
    expect(args.socket.connect).toHaveBeenCalledOnce();
    expect(args.onSessionExpired).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('crece por intento y no supera 15 segundos', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(reconnectDelay(2)).toBeGreaterThan(reconnectDelay(1));
    expect(reconnectDelay(20)).toBe(15_000);
    vi.restoreAllMocks();
  });

  it('no reconecta un desmontaje ni un cierre voluntario', async () => {
    vi.useFakeTimers();
    const args = options({ isDisposed: () => true });
    scheduleServerCloseReconnect(args);
    expect(scheduleServerCloseReconnect(options({ reason: 'io client disconnect' }))).toBeNull();
    await vi.runAllTimersAsync();
    expect(args.socket.connect).not.toHaveBeenCalled();
  });
});
