import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cafeteriaOrderSchema, cafeteriaProductSchema, type CafeteriaOrder, type CafeteriaProduct } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { useCafeteriaOrderStream } from '../../realtime/use-cafeteria-order-stream';
import { applyOrderSnapshot, mergeOrders } from '../CafeteriaKds/cafeteria-orders-view';
import { canOperatorCancel, operatorOrderStatusCopy, pickupCopy, recentOrders } from './operator-orders-view';

/** How many of the operator's own orders the screen follows. Matches the server page size. */
const MY_ORDERS_SHOWN = 10;

interface AccountSummary {
  balanceCop: string;
  monthConsumedCop: string;
}

function formatCop(value: string): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value));
}

export function OperatorCafeteriaPanel({ accessToken }: { accessToken: string | null }) {
  const [menu, setMenu] = useState<CafeteriaProduct[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<CafeteriaOrder[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  const loadOrders = useCallback(async () => {
    const raw = await apiClient.request<unknown>('/cafeteria/orders/me');
    const parsed = cafeteriaOrderSchema.array().parse(raw);
    setOrders((current) => applyOrderSnapshot(current, parsed));
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    loadOrders().catch(() => setError('No pudimos cargar tus pedidos.'));
  }, [accessToken, loadOrders]);

  // The server sends this socket only the operator's own orders.
  useCafeteriaOrderStream(accessToken, {
    onSnapshot: (snapshot) => setOrders((current) => applyOrderSnapshot(current, snapshot)),
    onChanged: (order) => setOrders((current) => mergeOrders(current, [order])),
  });

  const shownOrders = useMemo(() => recentOrders(orders, MY_ORDERS_SHOWN), [orders]);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.all([
      apiClient.request<unknown>('/cafeteria/menu'),
      apiClient.request<AccountSummary>('/cafeteria/accounts/me'),
    ])
      .then(([rawMenu, nextAccount]) => {
        setMenu(cafeteriaProductSchema.array().parse(rawMenu));
        setAccount(nextAccount);
      })
      .catch(() => setError('No pudimos cargar tu menú de cafetería.'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  const selectedItems = useMemo(() => menu.filter((product) => (quantities[product.id] ?? 0) > 0).map((product) => ({ productId: product.id, quantity: quantities[product.id] ?? 0 })), [menu, quantities]);
  const total = useMemo(() => menu.reduce((sum, product) => sum + Number(product.priceCop) * (quantities[product.id] ?? 0), 0), [menu, quantities]);

  async function placeOrder() {
    if (!selectedItems.length) return;
    setIsSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      await apiClient.request('/cafeteria/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({ items: selectedItems }),
      });
      setQuantities({});
      idempotencyKey.current = crypto.randomUUID();
      // The create response is a summary, not a full order: reload the list so the new
      // order shows even while the socket is reconnecting.
      await loadOrders().catch(() => undefined);
      const nextAccount = await apiClient.request<AccountSummary>('/cafeteria/accounts/me');
      setAccount(nextAccount);
      setNotice('Pedido recibido. Sigue su estado en "Mis pedidos".');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos registrar el pedido.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelOrder(order: CafeteriaOrder) {
    setCancellingId(order.id);
    setNotice(null);
    setError(null);
    try {
      await apiClient.request(`/cafeteria/orders/${order.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelado por el operador' }),
      });
      // Same as placing: the cancel response is partial, so the list is reloaded.
      await loadOrders().catch(() => undefined);
      setNotice(`Pedido #${order.orderNumber} cancelado.`);
    } catch (nextError) {
      // 409: the kitchen accepted it first; reload so the screen shows the real status.
      if (nextError instanceof ApiError && nextError.status === 409) {
        await loadOrders().catch(() => undefined);
        setError('Cafetería ya aceptó este pedido y no se puede cancelar desde aquí. Habla con cafetería.');
      } else {
        setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cancelar el pedido.');
      }
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="panel operator-cafeteria-panel" id="section-03" aria-labelledby="operator-cafeteria-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Pausa y consumo</p><h2 id="operator-cafeteria-title">Pide a cafetería</h2></div>
        {account && <div className="cafeteria-balance"><span>Consumido este mes</span><strong>{formatCop(account.monthConsumedCop)}</strong></div>}
      </header>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {isLoading && <p className="panel-state">Cargando menú…</p>}
      {!isLoading && <div className="operator-menu-list">
        {menu.map((product) => {
          const quantity = quantities[product.id] ?? 0;
          return <article className="operator-menu-row" key={product.id}><div><strong>{product.name}</strong><span>{product.category} · {formatCop(product.priceCop)}</span></div><div className="quantity-control"><button type="button" aria-label={`Quitar ${product.name}`} onClick={() => setQuantities((current) => ({ ...current, [product.id]: Math.max(0, quantity - 1) }))} disabled={!quantity}>−</button><output aria-label={`Cantidad de ${product.name}`}>{quantity}</output><button type="button" aria-label={`Agregar ${product.name}`} onClick={() => setQuantities((current) => ({ ...current, [product.id]: Math.min(20, quantity + 1) }))}>+</button></div></article>;
        })}
      </div>}
      <footer className="operator-cafeteria-panel__footer"><strong>Total seleccionado {formatCop(total.toFixed(2))}</strong><button className="primary-button" type="button" onClick={() => void placeOrder()} disabled={!selectedItems.length || isSubmitting}>{isSubmitting ? 'Enviando…' : 'Enviar pedido'} <span aria-hidden="true">↗</span></button></footer>
      <section className="operator-orders" aria-labelledby="operator-orders-title">
        <h3 id="operator-orders-title">Mis pedidos</h3>
        {!shownOrders.length && <p className="panel-state">Todavía no tienes pedidos. Los que envíes aparecerán aquí con su estado.</p>}
        {shownOrders.length > 0 && <ul className="operator-orders__list">
          {shownOrders.map((order) => {
            const status = operatorOrderStatusCopy(order.status);
            const pickup = pickupCopy(order);
            return (
              <li className={`operator-order${status.inProgress ? ' operator-order--active' : ''}`} key={order.id}>
                <div className="operator-order__topline">
                  <strong>#{order.orderNumber}</strong>
                  <time dateTime={order.placedAt}>{new Date(order.placedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })}</time>
                  <span className="operator-order__status" aria-label={`Estado: ${status.label}`}>{status.label}</span>
                </div>
                <span className="operator-order__items">{order.items.map((item) => `${item.quantity} × ${item.productNameSnapshot}`).join(', ')}</span>
                {pickup && <span className="operator-order__pickup">{pickup}</span>}
                <div className="operator-order__footer">
                  <strong>{formatCop(order.totalCop)}</strong>
                  {canOperatorCancel(order) && <button className="row-action" type="button" onClick={() => void cancelOrder(order)} disabled={cancellingId === order.id}>{cancellingId === order.id ? 'Cancelando…' : 'Cancelar'}</button>}
                </div>
              </li>
            );
          })}
        </ul>}
      </section>
    </section>
  );
}
