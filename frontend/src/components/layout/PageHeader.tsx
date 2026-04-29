import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h1 className="sr-only">{title}</h1>
        {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
        <p className="page-header__description">{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
