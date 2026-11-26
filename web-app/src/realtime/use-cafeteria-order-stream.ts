import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { cafeteriaOrderSchema, type CafeteriaOrder } from '@agency-os/shared';
import { apiClient } from '../services/api-client';
import { scheduleServerCloseReconnect } from './server-close-reconnect';

function socketOrigin(): string {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3000/api/v1';
  return new URL(baseUrl).origin;
}

export interface CafeteriaOrderStreamHandlers {
  /** A full list the server considers authoritative for this user (kitchen: all; operator: their own). */
  onSnapshot: (orders: CafeteriaOrder[]) => void;
  /** One order created or changed. */
  onChanged: (order: CafeteriaOrder) => void;
}

/**
 * Subscribes to cafeteria order events on the `/operations` namespace. The server
 * scopes what each socket receives: the kitchen gets every order, an operator only
 * their own. It closes the socket every 45-60 s to revalidate, so the hook reconnects
 * with the current JWT after renewing the session.
 */
export function useCafeteriaOrderStream(accessToken: string | null, handlers: CafeteriaOrderStreamHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!accessToken) return;
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
    // Renueva antes de reconectar: el servidor cierra tambien al vencer el JWT.
    const renewSession = () => apiClient.request('/auth/me').then(() => undefined);
    const onSnapshot = (payload: unknown) => {
      const parsed = cafeteriaOrderSchema.array().safeParse(payload);
      if (parsed.success) handlersRef.current.onSnapshot(parsed.data);
    };
    const onChanged = (payload: unknown) => {
      const parsed = cafeteriaOrderSchema.safeParse(payload);
      if (parsed.success) handlersRef.current.onChanged(parsed.data);
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
    });
    socket.on('disconnect', (reason) => {
      queueReconnect(reason);
    });
    socket.on('connect_error', () => {
      queueReconnect('connect_error');
    });
    socket.on('cafeteria.orders.snapshot', onSnapshot);
    socket.on('cafeteria.order.created', onChanged);
    socket.on('cafeteria.order.changed', onChanged);
    queueMicrotask(() => {
      if (!disposed) socket.connect();
    });
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.off('cafeteria.orders.snapshot', onSnapshot);
      socket.off('cafeteria.order.created', onChanged);
      socket.off('cafeteria.order.changed', onChanged);
      socket.disconnect();
    };
  }, [accessToken]);
}
