import { BrandMark } from '../BrandMark/BrandMark';

export function BrandPanel() {
  return (
    <section className="brand-panel" aria-labelledby="brand-title">
      <div className="brand-panel__topline">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <p className="brand-name">Agency OS</p>
            <p className="brand-caption">Operations workspace</p>
          </div>
        </div>
        <span className="panel-code">AO / 01</span>
      </div>

      <div className="signal-map" aria-hidden="true">
        <span className="signal-orbit signal-orbit--outer" />
        <span className="signal-orbit signal-orbit--inner" />
        <span className="signal-line signal-line--one" />
        <span className="signal-line signal-line--two" />
        <span className="signal-node signal-node--one" />
        <span className="signal-node signal-node--two" />
        <span className="signal-node signal-node--three" />
        <span className="signal-label signal-label--one">LIVE / 06:05</span>
        <span className="signal-label signal-label--two">CONTROL LAYER</span>
      </div>

      <div className="brand-panel__message">
        <p className="eyebrow">La operación, en una sola vista</p>
        <h1 id="brand-title">Un acceso claro para cada turno.</h1>
        <p>
          Coordina perfiles, conversaciones y decisiones con el mismo pulso operativo de tu agencia.
        </p>
      </div>

      <div className="system-status" aria-label="Estado del sistema">
        <span className="status-dot" />
        <span>Sistema operativo</span>
        <span className="status-divider" />
        <span className="status-mono">BOG / UTC−05</span>
      </div>
    </section>
  );
}
