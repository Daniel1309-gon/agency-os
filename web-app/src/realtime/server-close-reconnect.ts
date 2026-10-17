import type { Socket } from 'socket.io-client';

interface ReconnectOptions {
  socket: Socket;
  reason: string;
  isDisposed: () => boolean;
  renewSession: () => Promise<void>;
  onSessionExpired: () => void;
  attempt: number;
}

// Un cierre deliberado no lo reintenta Socket.IO; los otros cierres también
// pasan por aquí porque los hooks desactivan su reconexión automática.
export function reconnectDelay(attempt: number): number {
  const base = Math.min(15_000, 500 * 2 ** Math.min(attempt, 20));
  return Math.min(15_000, Math.floor(base * (0.75 + Math.random() * 0.5)));
}

export function scheduleServerCloseReconnect({
  socket, reason, isDisposed, renewSession, onSessionExpired, attempt,
}: ReconnectOptions): ReturnType<typeof setTimeout> | null {
  if (reason === 'io client disconnect' || isDisposed()) return null;
  return setTimeout(() => {
    void (async () => {
      if (isDisposed() || !socket.disconnected) return;
      try {
        await renewSession();
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (status === 401 || status === 403) {
          if (!isDisposed()) onSessionExpired();
          return;
        }
        // Red, 5xx y 429: el siguiente intento aumenta el backoff.
      }
      if (!isDisposed() && socket.disconnected) socket.connect();
    })();
  }, reconnectDelay(attempt));
}
