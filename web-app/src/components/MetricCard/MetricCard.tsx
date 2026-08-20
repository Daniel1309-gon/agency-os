interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  direction?: 'up' | 'steady' | 'down';
  accent?: 'blue' | 'navy' | 'orange';
}

export function MetricCard({ label, value, detail, direction = 'steady', accent = 'blue' }: MetricCardProps) {
  const directionMark = direction === 'up' ? '↗' : direction === 'down' ? '↘' : '→';

  return (
    <article className={`metric-card metric-card--${accent}`}>
      <div className="metric-card__topline">
        <span>{label}</span>
        <span className={`metric-card__direction metric-card__direction--${direction}`} aria-label={direction === 'up' ? 'En aumento' : direction === 'down' ? 'En descenso' : 'Estable'}>{directionMark}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
