export interface DistributionItem {
  label: string;
  value: number;
}

export interface DistributionCardProps {
  title: string;
  subtitle: string;
  items: DistributionItem[];
}

export function DistributionCard({
  title,
  subtitle,
  items,
}: DistributionCardProps) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
          <p className="panel__subtitle">{subtitle}</p>
        </div>
      </div>
      <ul className="distribution-list">
        {items.map((item) => (
          <li key={item.label} className="distribution-list__item">
            <div className="distribution-list__meta">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
            <div className="distribution-list__track">
              <div
                className="distribution-list__fill"
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
