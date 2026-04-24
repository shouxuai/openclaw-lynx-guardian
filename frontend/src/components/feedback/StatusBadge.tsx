export interface StatusBadgeProps {
  label: string;
  tone?: "neutral" | "info" | "warning" | "danger" | "success";
}

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}
