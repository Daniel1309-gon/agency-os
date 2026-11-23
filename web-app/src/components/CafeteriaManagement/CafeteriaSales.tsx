import { useCallback, useEffect, useMemo, useState } from 'react';
import { cafeteriaOrderSchema, type CafeteriaOrder, type CafeteriaOrderStatus } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { MetricCard } from '../MetricCard/MetricCard';
import { errorMessage, localDateString } from '../OperationsManagement/management-view';
import {
  buildSalesOrdersQuery,
  cafeteriaOrderStatusLabel,
  formatCafeteriaCop,
  summarizeCafeteriaSales,
} from './cafeteria-management-view';

const STATUS_OPTIONS: Array<{ value: '' | CafeteriaOrderStatus; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'DELIVERED', label: 'Entregados' },
  { value: 'CANCELLED', label: 'Cancelados' },
  { value: 'EXPIRED', label: 'Expirados' },
  { value: 'PLACED', label: 'Recibidos' },
  { value: 'PREPARING', label: 'En preparación' },
  { value: 'READY', label: 'Listos' },
];

function formatBogotaTime(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A5: historial y cierre de ventas de cafetería filtrado por fechas de Bogotá. */
export function CafeteriaSales({ accessToken }: { accessToken: string | null }) {
  const today = useMemo(() => localDateString(), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<'' | CafeteriaOrderStatus>('');
  const [orders, setOrders] = useState<CafeteriaOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSales = useCallback(async () => {
    if (from && to && from > to) {
      setError('La fecha inicial debe ser anterior o igual a la fecha final.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const path = buildSalesOrdersQuery({ from, to, status: status || undefined });
      const raw = await apiClient.request<unknown>(path);
      setOrders(cafeteriaOrderSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar el historial de ventas.'));
    } finally {
      setIsLoading(false);
    }
  }, [from, status, to]);

  useEffect(() => {
    if (accessToken) void loadSales();
  }, [accessToken, loadSales]);

  const summary = useMemo(() => summarizeCafeteriaSales(orders), [orders]);

  return (
    <div className="coordinator-layout">
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Ventas entregadas" value={isLoading ? '—' : formatCafeteriaCop(summary.deliveredTotalCop)} detail={`${summary.deliveredCount} pedidos cobrados`} accent="blue" direction={summary.deliveredTotalCop > 0 ? 'up' : 'steady'} />
        <MetricCard label="Ticket promedio" value={isLoading ? '—' : formatCafeteriaCop(summary.averageTicketCop)} detail="Solo pedidos entregados" accent="navy" direction="steady" />
        <MetricCard label="Cancelados / expirados" value={isLoading ? '—' : `${summary.cancelledCount} / ${summary.expiredCount}`} detail="Sin débito en nómina" accent="orange" direction={summary.cancelledCount + summary.expiredCount > 0 ? 'down' : 'steady'} />
        <MetricCard label="Pedidos en rango" value={isLoading ? '—' : String(summary.totalOrders)} detail={`${summary.inProgressCount} en curso`} accent="navy" direction="steady" />
      </div>

      <section className="panel management-panel" id="cafeteria-sales" aria-labelledby="cafeteria-sales-title">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">Cierre y trazabilidad · Hora Bogotá</p>
            <h2 id="cafeteria-sales-title">Historial de ventas</h2>
          </div>
          <button className="quiet-button" type="button" onClick={() => void loadSales()} disabled={isLoading}>
            Actualizar <span aria-hidden="true">↻</span>
          </button>
        </header>

        <div className="management-form__grid">
          <label><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label>
            <span>Estado</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as '' | CafeteriaOrderStatus)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value || 'ALL'} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}

        {summary.topItems.length > 0 && (
          <p className="management-panel__note">
            <strong>Más vendidos:</strong>{' '}
            {summary.topItems.map((item) => `${item.name} ×${item.quantity} (${formatCafeteriaCop(item.revenueCop)})`).join(' · ')}
          </p>
        )}

        {isLoading ? (
          <p className="empty-state">Cargando ventas…</p>
        ) : orders.length === 0 ? (
          <p className="empty-state">No hay pedidos para el rango seleccionado.</p>
        ) : (
          <div className="management-table" role="table" aria-label="Historial de pedidos de cafetería">
            <div className="management-table__head" role="row">
              <span role="columnheader">Pedido</span>
              <span role="columnheader">Fecha</span>
              <span role="columnheader">Operador</span>
              <span role="columnheader">Detalle</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader">Total</span>
            </div>
            {orders.map((order) => (
              <div className="management-table__row" role="row" key={order.id}>
                <span role="cell"><strong>#{order.orderNumber}</strong></span>
                <span role="cell">{formatBogotaTime(order.placedAt)}</span>
                <span role="cell">{order.operatorName ?? order.operatorId.slice(0, 8)}</span>
                <span role="cell">{order.items.map((item) => `${item.quantity}× ${item.productNameSnapshot}`).join(', ')}</span>
                <span role="cell"><span className="status-pill">{cafeteriaOrderStatusLabel(order.status)}</span></span>
                <span role="cell"><strong>{formatCafeteriaCop(order.totalCop)}</strong></span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
