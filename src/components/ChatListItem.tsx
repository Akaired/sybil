import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, MoreHorizontal, Pencil, Trash2, Share2 } from "lucide-react";
import { renameConversation, deleteConversation, type ConversationRow } from "../lib/sybil";
import Modal from "./Modal";
import ShareChatModal from "./ShareChatModal";

interface ChatListItemProps {
  conversation: ConversationRow;
  active: boolean;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}

export default function ChatListItem({ conversation, active, onRenamed, onDeleted }: ChatListItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleRenameSave() {
    const trimmed = titleDraft.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await renameConversation(conversation.id, trimmed);
      onRenamed(conversation.id, trimmed);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename the chat.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    setSaving(true);
    setError(null);
    try {
      await deleteConversation(conversation.id);
      onDeleted(conversation.id);
      setDeleting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the chat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative group">
      <Link
        to={`/dashboard?c=${conversation.id}`}
        title={conversation.title}
        className={`flex items-center gap-2.5 pl-3 pr-8 py-2 rounded-lg text-[13.5px] transition-colors duration-150 ${
          active
            ? "bg-sine-indigo/12 text-fg-primary"
            : "text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50"
        }`}
      >
        <MessageCircle
          size={15}
          strokeWidth={1.8}
          className={`shrink-0 ${active ? "text-sine-indigo" : "text-fg-subtle"}`}
        />
        <span className="truncate">{conversation.title}</span>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setMenuOpen((o) => !o);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-bg-surface opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 cursor-pointer"
        aria-label="Chat options"
      >
        <MoreHorizontal size={15} strokeWidth={1.8} />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-[calc(100%+2px)] w-40 bg-bg-elevated border border-fg-subtle/20 rounded-lg shadow-lg py-1 z-50"
        >
          <button
            onClick={() => {
              setMenuOpen(false);
              setTitleDraft(conversation.title);
              setError(null);
              setRenaming(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
          >
            <Pencil size={14} strokeWidth={1.8} />
            Rename
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              setShareModalOpen(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
          >
            <Share2 size={14} strokeWidth={1.8} />
            Share
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              setError(null);
              setDeleting(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-danger hover:bg-danger/10 transition-colors duration-150 cursor-pointer"
          >
            <Trash2 size={14} strokeWidth={1.8} />
            Delete
          </button>
        </div>
      )}

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename chat"
        footer={
          <>
            <button
              onClick={() => setRenaming(false)}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleRenameSave}
              disabled={saving || !titleDraft.trim()}
              className="px-3.5 py-2 rounded-md text-sm font-semibold bg-sine-indigo text-white hover:bg-sine-indigo/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSave();
          }}
          autoFocus
          maxLength={80}
          className="w-full px-3 py-2 rounded-md border border-fg-subtle/25 bg-bg-base text-fg-primary text-sm focus:outline-none focus:border-sine-indigo/60"
        />
        {error && <p className="text-xs text-danger mt-2.5">{error}</p>}
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete chat"
        footer={
          <>
            <button
              onClick={() => setDeleting(false)}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirm}
              disabled={saving}
              className="px-3.5 py-2 rounded-md text-sm font-semibold bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {saving ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Delete "<span className="text-fg-primary font-medium">{conversation.title}</span>"?
          This will permanently remove the chat and its messages.
        </p>
        {error && <p className="text-xs text-danger mt-2.5">{error}</p>}
      </Modal>

      <ShareChatModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        scope="single"
        initialChatId={conversation.id}
        initialChatTitle={conversation.title}
      />
    </div>
  );
}
