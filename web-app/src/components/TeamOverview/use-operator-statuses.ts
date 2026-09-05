import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { operatorStatusSnapshotSchema, type OperatorStatusSnapshot } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
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
      auth: { token: accessToken },
      transports: ['websocket'],
      autoConnect: false,
    });
    let disposed = false;
    const onSnapshot = (payload: unknown) => {
      const parsed = operatorStatusSnapshotSchema.array().safeParse(payload);
      if (parsed.success) setStatuses(parsed.data);
    };
    const onChanged = (payload: unknown) => {
      const parsed = operatorStatusSnapshotSchema.safeParse(payload);
      if (parsed.success) setStatuses((current) => mergeOperatorStatuses(current, [parsed.data]));
    };

    socket.on('connect', () => setIsRealtime(true));
    socket.on('disconnect', () => setIsRealtime(false));
    socket.on('connect_error', () => setIsRealtime(false));
    socket.on('operators.snapshot', onSnapshot);
    socket.on('operator.status.changed', onChanged);
    queueMicrotask(() => {
      if (!disposed) socket.connect();
    });

    return () => {
      disposed = true;
      socket.off('operators.snapshot', onSnapshot);
      socket.off('operator.status.changed', onChanged);
      socket.disconnect();
    };
  }, [accessToken, refresh]);

  return { statuses, isLoading, isRealtime, error, refresh };
}
