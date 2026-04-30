import { useEffect, useId, type ReactNode } from "react";

export interface SideDrawerProps {
  children: ReactNode;
  closeOnBackdropClick?: boolean;
  closeLabel?: string;
  open: boolean;
  subtitle?: ReactNode;
  title: string;
  onClose: () => void;
}

export function SideDrawer({
  children,
  closeOnBackdropClick = false,
  closeLabel = "关闭",
  open,
  subtitle,
  title,
  onClose,
}: SideDrawerProps) {
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="side-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdropClick && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="side-drawer"
        role="dialog"
      >
        <div className="side-drawer__header">
          <div className="side-drawer__heading">
            <h2 className="side-drawer__title" id={titleId}>{title}</h2>
            {subtitle ? <p className="side-drawer__subtitle" id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button
            aria-label={closeLabel}
            className="side-drawer__close"
            type="button"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="side-drawer__body">{children}</div>
      </aside>
    </div>
  );
}
