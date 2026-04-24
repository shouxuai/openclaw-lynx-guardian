import type { ReactNode } from "react";

export interface DetailField {
  label: string;
  value: ReactNode;
}

export interface DetailPanelProps {
  title: string;
  subtitle: string;
  fields: DetailField[];
}

export function DetailPanel({ title, subtitle, fields }: DetailPanelProps) {
  return (
    <aside className="panel detail-panel">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
          <p className="panel__subtitle">{subtitle}</p>
        </div>
      </div>
      <dl className="detail-panel__grid">
        {fields.map((field) => (
          <div key={field.label} className="detail-panel__field">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
