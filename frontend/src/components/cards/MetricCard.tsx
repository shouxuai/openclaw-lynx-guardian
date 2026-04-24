export interface MetricCardProps {
  label: string;
  value: string;
  note?: string;
  accent?: string;
}

export function MetricCard({ label, value, note, accent }: MetricCardProps) {
  return (
    <article className="metric-card">
      <p className="metric-card__label">{label}</p>
      <strong className="metric-card__value">{value}</strong>
      <p className="metric-card__note">{note ?? accent ?? "\u00a0"}</p>
    </article>
  );
}
