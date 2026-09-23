import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { operatorStatusSnapshotSchema, type OperatorStatusSnapshot } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { scheduleServerCloseReconnect } from '../../realtime/server-close-reconnect';
import { mergeOperatorStatuses } from './operator-status-view';

interface OperatorStatusesState {
  statuses: OperatorStatusSnapshot[];
  isLoading: boolean;
  isRealtime: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function socketOrigin(): string {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3000/api/v1';
  return new URL(baseUrl).origin;
}

export function useOperatorStatuses(accessToken: string | null): OperatorStatusesState {
  const [statuses, setStatuses] = useState<OperatorStatusSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRealtime, setIsRealtime] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/operators/status');
      setStatuses(operatorStatusSnapshotSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar el semáforo operativo.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setStatuses([]);
      setIsLoading(false);
      setIsRealtime(false);
      return undefined;
    }

    void refresh();
    const socket: Socket = io(`${socketOrigin()}/operations`, {
      // El token se resuelve en cada intento: el servidor cierra el socket cada
      // 45-60 s para revalidar y la reconexion usa el JWT vigente.
      auth: (done) => done({ token: apiClient.getAccessToken() ?? '' }),
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // El api-client deduplica la renovacion: con el token vigente es un 200 barato.
    const renewSession = () => apiClient.request('/auth/me').then(() => undefined);
    const onSnapshot = (payload: unknown) => {
      const parsed = operatorStatusSnapshotSchema.array().safeParse(payload);
      if (parsed.success) setStatuses(parsed.data);
    };
    const onChanged = (payload: unknown) => {
      const parsed = operatorStatusSnapshotSchema.safeParse(payload);
      if (parsed.success) setStatuses((current) => mergeOperatorStatuses(current, [parsed.data]));
    };

    const queueReconnect = (reason: string) => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = scheduleServerCloseReconnect({
        socket, reason, isDisposed: () => disposed, renewSession,
        onSessionExpired: () => apiClient.endSession(), attempt: reconnectAttempt++,
      });
    };
    socket.on('connect', () => {
      reconnectAttempt = 0;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      setIsRealtime(true);
    });
    socket.on('disconnect', (reason) => {
      setIsRealtime(false);
      queueReconnect(reason);
    });
    socket.on('connect_error', () => {
      setIsRealtime(false);
      queueReconnect('connect_error');
    });
    socket.on('operators.snapshot', onSnapshot);
    socket.on('operator.status.changed', onChanged);
    queueMicrotask(() => {
      if (!disposed) socket.connect();
    });

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.off('operators.snapshot', onSnapshot);
      socket.off('operator.status.changed', onChanged);
      socket.disconnect();
    };
  }, [accessToken, refresh]);

  return { statuses, isLoading, isRealtime, error, refresh };
}
