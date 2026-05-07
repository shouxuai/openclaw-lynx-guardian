import { useEffect, useId, type ReactNode } from "react";

export interface ModalDialogProps {
  children: ReactNode;
  closeOnBackdropClick?: boolean;
  closeLabel?: string;
  open: boolean;
  size?: "normal" | "wide";
  subtitle?: ReactNode;
  title: string;
  onClose: () => void;
}

export function ModalDialog({
  children,
  closeOnBackdropClick = false,
  closeLabel = "关闭",
  open,
  size = "normal",
  subtitle,
  title,
  onClose,
}: ModalDialogProps) {
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
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdropClick && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-dialog modal-dialog--${size}`}
        role="dialog"
      >
        <div className="modal-dialog__header">
          <div>
            <h2 className="modal-dialog__title" id={titleId}>{title}</h2>
            {subtitle ? <p className="modal-dialog__subtitle" id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button
            aria-label={closeLabel}
            className="modal-dialog__close"
            type="button"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="modal-dialog__body">{children}</div>
      </section>
    </div>
  );
}
