import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { cafeteriaProductSchema, type CafeteriaProduct } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { errorMessage } from '../OperationsManagement/management-view';
import { buildCreateProductPayload, formatCafeteriaCop, type CafeteriaProductFormValues } from './cafeteria-management-view';

const EMPTY_FORM: CafeteriaProductFormValues = {
  sku: '',
  name: '',
  category: '',
  description: '',
  priceCop: '',
  prepMinutes: '',
  pickupDeadlineMinutes: '30',
};

/** A5 (FR-32): gestión de catálogo y disponibilidad de cafetería. */
export function CafeteriaInventory({ accessToken }: { accessToken: string | null }) {
  const [products, setProducts] = useState<CafeteriaProduct[]>([]);
  const [form, setForm] = useState<CafeteriaProductFormValues>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editDeadline, setEditDeadline] = useState('30');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await apiClient.request<unknown>('/cafeteria/products');
      setProducts(cafeteriaProductSchema.array().parse(raw));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos cargar el catálogo de cafetería.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) void loadProducts();
  }, [accessToken, loadProducts]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      const payload = buildCreateProductPayload(form);
      await apiClient.request('/cafeteria/products', { method: 'POST', body: JSON.stringify(payload) });
      setForm(EMPTY_FORM);
      setNotice(`Producto ${payload.name} creado en el catálogo.`);
      await loadProducts();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos crear el producto.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleAvailability(product: CafeteriaProduct) {
    setBusyId(product.id);
    setError(null);
    setNotice(null);
    try {
      const nextAvailable = !(product.isAvailable ?? true);
      await apiClient.request(`/cafeteria/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: nextAvailable }),
      });
      setNotice(`${product.name} quedó ${nextAvailable ? 'disponible' : 'pausado'}.`);
      await loadProducts();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos actualizar la disponibilidad.'));
    } finally {
      setBusyId(null);
    }
  }

  async function savePriceEdit(product: CafeteriaProduct) {
    const priceCop = Number(editPrice);
    const pickupDeadlineMinutes = Number(editDeadline);
    if (!Number.isFinite(priceCop) || priceCop <= 0) {
      setError('El precio debe ser un número positivo en COP.');
      return;
    }
    if (!Number.isInteger(pickupDeadlineMinutes) || pickupDeadlineMinutes < 1 || pickupDeadlineMinutes > 1440) {
      setError('El límite de retiro debe ser un entero entre 1 y 1440 minutos.');
      return;
    }
    setBusyId(product.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/cafeteria/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ priceCop, pickupDeadlineMinutes }),
      });
      setEditingId(null);
      setNotice(`Precio y retiro de ${product.name} actualizados.`);
      await loadProducts();
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos actualizar el producto.'));
    } finally {
      setBusyId(null);
    }
  }

  const availableCount = products.filter((item) => item.isAvailable !== false).length;

  return (
    <section className="panel management-panel" id="cafeteria-inventory" aria-labelledby="cafeteria-inventory-title">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Catálogo · {availableCount} disponibles de {products.length}</p>
          <h2 id="cafeteria-inventory-title">Inventario y disponibilidad</h2>
        </div>
        <button className="quiet-button" type="button" onClick={() => void loadProducts()} disabled={isLoading}>
          Actualizar <span aria-hidden="true">↻</span>
        </button>
      </header>

      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      <form className="management-form" onSubmit={(event) => void handleCreate(event)}>
        <h3>Nuevo producto</h3>
        <div className="management-form__grid">
          <label><span>SKU</span><input value={form.sku} onChange={(event) => setForm((c) => ({ ...c, sku: event.target.value }))} placeholder="CAF-01" required /></label>
          <label><span>Nombre</span><input value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} placeholder="Almuerzo ejecutivo" required /></label>
          <label><span>Categoría</span><input value={form.category} onChange={(event) => setForm((c) => ({ ...c, category: event.target.value }))} placeholder="Almuerzos" required /></label>
          <label><span>Precio (COP)</span><input type="number" min="1" step="100" value={form.priceCop} onChange={(event) => setForm((c) => ({ ...c, priceCop: event.target.value }))} required /></label>
          <label><span>Preparación (min)</span><input type="number" min="0" max="1440" value={form.prepMinutes} onChange={(event) => setForm((c) => ({ ...c, prepMinutes: event.target.value }))} placeholder="10" /></label>
          <label><span>Retiro máx. (min)</span><input type="number" min="1" max="1440" value={form.pickupDeadlineMinutes} onChange={(event) => setForm((c) => ({ ...c, pickupDeadlineMinutes: event.target.value }))} required /></label>
        </div>
        <button className="primary-button primary-button--compact" type="submit" disabled={isSaving}>
          {isSaving ? 'Guardando…' : 'Agregar producto'}
        </button>
      </form>

      {isLoading ? (
        <p className="empty-state">Cargando productos…</p>
      ) : products.length === 0 ? (
        <p className="empty-state">No hay productos registrados todavía.</p>
      ) : (
        <div className="management-table" role="table" aria-label="Productos de cafetería">
          <div className="management-table__head" role="row">
            <span role="columnheader">Producto</span>
            <span role="columnheader">Categoría</span>
            <span role="columnheader">Precio</span>
            <span role="columnheader">Retiro</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader">Acciones</span>
          </div>
          {products.map((product) => {
            const isEditing = editingId === product.id;
            const available = product.isAvailable !== false;
            return (
              <div className="management-table__row" role="row" key={product.id}>
                <span role="cell"><strong>{product.name}</strong> <small><code>{product.sku}</code></small></span>
                <span role="cell">{product.category}</span>
                <span role="cell">
                  {isEditing ? (
                    <input aria-label={`Precio de ${product.name}`} type="number" min="1" step="100" value={editPrice} onChange={(event) => setEditPrice(event.target.value)} />
                  ) : formatCafeteriaCop(product.priceCop)}
                </span>
                <span role="cell">
                  {isEditing ? (
                    <input aria-label={`Retiro de ${product.name}`} type="number" min="1" max="1440" value={editDeadline} onChange={(event) => setEditDeadline(event.target.value)} />
                  ) : `${product.pickupDeadlineMinutes ?? 30} min`}
                </span>
                <span role="cell"><span className={`status-pill${available ? '' : ' status-pill--quiet'}`}>{available ? 'Disponible' : 'Pausado'}</span></span>
                <span role="cell" className="management-table__actions">
                  {isEditing ? (
                    <>
                      <button className="primary-button primary-button--compact" type="button" onClick={() => void savePriceEdit(product)} disabled={busyId === product.id}>Guardar</button>
                      <button className="quiet-button" type="button" onClick={() => setEditingId(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button className="quiet-button" type="button" onClick={() => { setEditingId(product.id); setEditPrice(String(Number(product.priceCop))); setEditDeadline(String(product.pickupDeadlineMinutes ?? 30)); }}>Editar</button>
                      <button className="quiet-button" type="button" onClick={() => void toggleAvailability(product)} disabled={busyId === product.id}>
                        {available ? 'Pausar' : 'Activar'}
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
