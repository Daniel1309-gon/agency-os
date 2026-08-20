import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { cafeteriaOrderSchema, type CafeteriaOrder, type CafeteriaOrderStatus } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';

const columns: Array<{ status: CafeteriaOrderStatus; label: string }> = [
  { status: 'PLACED', label: 'Recibidos' },
  { status: 'ACCEPTED', label: 'Aceptados' },
  { status: 'PREPARING', label: 'En preparación' },
  { status: 'READY', label: 'Listos' },
];

const nextStatus: Partial<Record<CafeteriaOrderStatus, CafeteriaOrderStatus>> = {
  PLACED: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'DELIVERED',
};

function socketOrigin(): string {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3000/api/v1';
  return new URL(baseUrl).origin;
}

function mergeOrders(current: CafeteriaOrder[], incoming: CafeteriaOrder[]): CafeteriaOrder[] {
  const byId = new Map(current.map((order) => [order.id, order]));
  for (const order of incoming) byId.set(order.id, order);
  return [...byId.values()].sort((left, right) => right.placedAt.localeCompare(left.placedAt));
}

function formatCop(value: string): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value));
}

export function CafeteriaKds({ accessToken }: { accessToken: string | null }) {
  const [orders, setOrders] = useState<CafeteriaOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/cafeteria/orders');
      setOrders(cafeteriaOrderSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar los pedidos de cafetería.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    void loadOrders();
    const socket: Socket = io(`${socketOrigin()}/operations`, {
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    const onSnapshot = (payload: unknown) => {
      const parsed = cafeteriaOrderSchema.array().safeParse(payload);
      if (parsed.success) setOrders((current) => mergeOrders(current, parsed.data));
    };
    const onChanged = (payload: unknown) => {
      const parsed = cafeteriaOrderSchema.safeParse(payload);
      if (parsed.success) setOrders((current) => mergeOrders(current, [parsed.data]));
    };
    socket.on('cafeteria.orders.snapshot', onSnapshot);
    socket.on('cafeteria.order.created', onChanged);
    socket.on('cafeteria.order.changed', onChanged);
    return () => {
      socket.off('cafeteria.orders.snapshot', onSnapshot);
      socket.off('cafeteria.order.created', onChanged);
      socket.off('cafeteria.order.changed', onChanged);
      socket.disconnect();
    };
  }, [accessToken, loadOrders]);

  const activeOrders = useMemo(() => orders.filter((order) => !['DELIVERED', 'CANCELLED', 'EXPIRED'].includes(order.status)), [orders]);

  async function advance(order: CafeteriaOrder) {
    const status = nextStatus[order.status];
    if (!status) return;
    setUpdatingId(order.id);
    setError(null);
    try {
      await apiClient.request(`/cafeteria/orders/${order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadOrders();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos actualizar el pedido.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <section className="panel kds-panel" id="section-01" aria-labelledby="kds-title">
      <header className="panel-header kds-panel__header">
        <div>
          <p className="panel-kicker">Operación en tiempo real</p>
          <h2 id="kds-title">Kitchen Display System</h2>
        </div>
        <button className="quiet-button" type="button" onClick={() => void loadOrders()} disabled={isLoading}>Actualizar <span aria-hidden="true">↻</span></button>
      </header>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {isLoading && <p className="panel-state">Cargando pedidos…</p>}
      {!isLoading && !activeOrders.length && <p className="panel-state">No hay pedidos pendientes. Los nuevos aparecerán aquí automáticamente.</p>}
      {!isLoading && activeOrders.length > 0 && (
        <div className="kds-board">
          {columns.map((column) => {
            const columnOrders = activeOrders.filter((order) => order.status === column.status);
            return (
              <section className="kds-column" key={column.status} aria-labelledby={`kds-${column.status}`}>
                <header className="kds-column__header"><h3 id={`kds-${column.status}`}>{column.label}</h3><span>{columnOrders.length.toString().padStart(2, '0')}</span></header>
                <div className="kds-column__orders">
                  {columnOrders.map((order) => {
                    const targetStatus = nextStatus[order.status];
                    return (
                      <article className="kds-order" key={order.id}>
                        <div className="kds-order__topline"><strong>#{order.orderNumber}</strong><time dateTime={order.placedAt}>{new Date(order.placedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</time></div>
                        <ul className="kds-order__items">
                          {order.items.map((item) => <li key={`${order.id}-${item.productId}`}><span>{item.quantity} × {item.productNameSnapshot}</span><small>{formatCop(item.lineTotalCop)}</small></li>)}
                        </ul>
                        {order.notes && <p className="kds-order__notes">{order.notes}</p>}
                        <div className="kds-order__footer"><strong>{formatCop(order.totalCop)}</strong><button className="row-action" type="button" onClick={() => void advance(order)} disabled={!targetStatus || updatingId === order.id}>{updatingId === order.id ? 'Guardando…' : targetStatus === 'DELIVERED' ? 'Entregar' : `Pasar a ${columns.find((item) => item.status === targetStatus)?.label.toLowerCase() ?? targetStatus}`}</button></div>
                      </article>
                    );
                  })}
                  {!columnOrders.length && <p className="kds-column__empty">Sin pedidos</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
