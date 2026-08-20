import { useEffect, useMemo, useRef, useState } from 'react';
import { cafeteriaProductSchema, type CafeteriaProduct } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';

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
  const idempotencyKey = useRef(crypto.randomUUID());

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
      const nextAccount = await apiClient.request<AccountSummary>('/cafeteria/accounts/me');
      setAccount(nextAccount);
      setNotice('Pedido recibido. Cafetería actualizará aquí su estado.');
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : 'No pudimos registrar el pedido.');
    } finally {
      setIsSubmitting(false);
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
    </section>
  );
}
