export interface TrendPoint {
  label: string;
  value: number;
}

export interface TrendCardProps {
  title: string;
  subtitle: string;
  points: TrendPoint[];
}

export function TrendCard({ title, subtitle, points }: TrendCardProps) {
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
          <p className="panel__subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="trend-card">
        {points.map((point) => (
          <div key={point.label} className="trend-card__point">
            <div
              className="trend-card__bar"
              style={{ height: `${Math.max((point.value / maxValue) * 100, 8)}%` }}
              title={`${point.label}: ${point.value}`}
            />
            <span className="trend-card__label">{point.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
