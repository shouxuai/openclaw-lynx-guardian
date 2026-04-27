import { useEffect, useId, type ReactNode } from "react";

export interface ModalDialogProps {
  children: ReactNode;
  closeLabel?: string;
  open: boolean;
  subtitle?: ReactNode;
  title: string;
  onClose: () => void;
}

export function ModalDialog({
  children,
  closeLabel = "关闭",
  open,
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

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-dialog"
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
            关闭
          </button>
        </div>
        <div className="modal-dialog__body">{children}</div>
      </section>
    </div>
  );
}
