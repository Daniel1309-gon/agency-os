import { useEffect, useState } from 'react';
import { cafeteriaProductSchema, type CafeteriaProduct } from '@agency-os/shared';
import { apiClient } from '../../services/api-client';
import { CafeteriaKds } from '../CafeteriaKds/CafeteriaKds';

export function CafeteriaOverview({ accessToken }: { accessToken: string | null }) {
  const [menu, setMenu] = useState<CafeteriaProduct[]>([]);
  const [menuError, setMenuError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void apiClient.request<unknown>('/cafeteria/menu')
      .then((raw) => setMenu(cafeteriaProductSchema.array().parse(raw)))
      .catch(() => setMenuError('No pudimos cargar el menú publicado.'));
  }, [accessToken]);

  return (
    <div className="cafeteria-layout">
      <div className="cafeteria-grid">
        <section className="panel menu-panel" id="section-01">
          <header className="panel-header">
            <div><p className="panel-kicker">Disponibilidad · hoy</p><h2>Menú de hoy</h2></div>
            <span className="count-panel__date">{menu.length} productos</span>
          </header>
          {menuError && <p className="form-notice form-notice--error" role="alert">{menuError}</p>}
          <div className="menu-list">
            {!menu.length && !menuError && <p className="panel-state">Cargando menú…</p>}
            {menu.map((item) => (
              <article className="menu-row" key={item.id}>
                <span className="menu-row__icon" aria-hidden="true">◌</span>
                <div><strong>{item.name}</strong><span>{item.category}</span></div>
                <span className="menu-row__price">${Number(item.priceCop).toLocaleString('es-CO')}</span>
                <span className="menu-row__sold">{item.prepMinutes ? `${item.prepMinutes} min` : 'Disponible'}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
      <CafeteriaKds accessToken={accessToken} />
    </div>
  );
}
