import { useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

/**
 * Generic reusable modal — overlay + centered panel on app design tokens.
 * Closes on Escape or backdrop click.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-md",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-xl p-6 max-h-[90vh] overflow-y-auto`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-base font-semibold text-fg-primary">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-fg-subtle hover:text-fg-primary cursor-pointer transition-colors duration-150"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div>{children}</div>

        {footer && (
          <div className="mt-6 flex items-center justify-end gap-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
