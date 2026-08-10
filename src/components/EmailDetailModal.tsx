import { useEffect, useState } from "react";
import { Trash2, X, Reply, ExternalLink } from "lucide-react";
import SineWave from "./SineWave";
import {
  bodyToDisplayText,
  deleteEmail,
  formatFullDate,
  formatSender,
  readEmail,
  type GmailMessageDetail,
} from "../lib/mail";

interface EmailDetailModalProps {
  /** The Gmail message id to load, or null to keep the modal closed. */
  messageId: string | null;
  onClose: () => void;
  /** Called after a successful delete (moves to Trash), with the deleted id. */
  onDeleted?: (messageId: string) => void;
  /** When provided, shows a Reply button that hands off the loaded detail. */
  onReply?: (detail: GmailMessageDetail) => void;
}

/**
 * Self-contained "read one email" modal — fetches its own detail via
 * gmail-actions given just a message id. Shared between the Mail page and
 * the chat's "quali sono le mie ultime mail" reply so both can open the
 * same rich preview instead of only linking out to Gmail.
 */
export default function EmailDetailModal({ messageId, onClose, onDeleted, onReply }: EmailDetailModalProps) {
  const [detail, setDetail] = useState<GmailMessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId) return;
    setDetail(null);
    setError(null);
    setConfirmingDelete(false);
    setDeleteError(null);
    setLoading(true);
    readEmail(messageId)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this email."))
      .finally(() => setLoading(false));
  }, [messageId]);

  useEffect(() => {
    if (!messageId) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [messageId, onClose]);

  async function confirmDelete() {
    if (!messageId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteEmail(messageId);
      onDeleted?.(messageId);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete this email.");
    } finally {
      setDeleting(false);
    }
  }

  if (!messageId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-xl p-6 max-h-[85vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="flex-1 text-base font-semibold text-fg-primary leading-snug">
            {detail?.headers.Subject || (loading ? "Loading…" : "(no subject)")}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-fg-subtle hover:text-fg-primary cursor-pointer transition-colors duration-150"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {detail && (
          <>
            <div className="text-[13px] text-fg-muted mb-1">
              From <span className="text-fg-primary font-medium">{formatSender(detail.headers.From)}</span>
            </div>
            <div className="text-[12px] text-fg-subtle mb-4">
              {formatFullDate(detail.headers.Date, detail.internal_date)}
            </div>
          </>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-3 text-fg-muted py-8 justify-center">
              <div data-sybil-state="thinking">
                <SineWave height={20} className="w-20" />
              </div>
              <span className="text-sm animate-pulse">Loading…</span>
            </div>
          )}
          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
              {error}
            </div>
          )}
          {detail && !loading && (
            <p className="text-[13.5px] text-fg-primary whitespace-pre-wrap leading-relaxed">
              {bodyToDisplayText(detail.body) || detail.snippet}
            </p>
          )}
        </div>

        {confirmingDelete ? (
          <div className="mt-5 pt-4 border-t border-fg-subtle/15">
            <p className="text-[13px] text-fg-muted mb-3">Move this email to Trash? You can still recover it from Gmail.</p>
            {deleteError && <p className="text-[13px] text-danger mb-3">{deleteError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm font-semibold bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-fg-subtle/15">
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={!detail}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-danger hover:text-danger/80 cursor-pointer transition-colors duration-150 disabled:opacity-50"
            >
              <Trash2 size={14} strokeWidth={2} />
              Delete
            </button>
            <div className="flex items-center gap-2">
              <a
                href={`https://mail.google.com/mail/u/0/#inbox/${messageId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted hover:text-fg-primary cursor-pointer transition-colors duration-150"
              >
                <ExternalLink size={13} strokeWidth={2} />
                Open in Gmail
              </a>
              {onReply && (
                <button
                  onClick={() => detail && onReply(detail)}
                  disabled={!detail}
                  className="flex items-center gap-1.5 text-[13px] font-semibold text-bg-base bg-warning rounded-lg px-3.5 py-2 cursor-pointer hover:bg-warning/90 transition-colors duration-150 disabled:opacity-50"
                >
                  <Reply size={14} strokeWidth={2} />
                  Reply
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
