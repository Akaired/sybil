import { useContext, useEffect, useMemo, useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import { shareChat, ChatShareError, type ConversationRow } from "../lib/sybil";
import Modal from "./Modal";

type Mode = "all" | "specific";
type AccessLevel = "reader" | "writer";
type TeamRole = "owner" | "admin" | "member" | "guest";

interface ShareableMember {
  id: string;
  userId: string;
  email: string;
  role: TeamRole;
}

interface ShareChatModalProps {
  open: boolean;
  onClose: () => void;
  /** "single": launched from one chat's own menu — mode=specific is fixed to that chat, no picker.
   *  "general": launched from a general view — mode=specific shows a multi-select picker. */
  scope: "single" | "general";
  /** Required when scope === "single". */
  initialChatId?: string;
  initialChatTitle?: string;
  /** Required when scope === "general" — the full list to pick from. */
  conversations?: ConversationRow[];
}

export default function ShareChatModal({
  open,
  onClose,
  scope,
  initialChatId,
  initialChatTitle,
  conversations = [],
}: ShareChatModalProps) {
  const { user, activeWorkspaceId } = useContext(AuthContext);

  const [mode, setMode] = useState<Mode>("specific");
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [access, setAccess] = useState<AccessLevel>("reader");

  const [members, setMembers] = useState<ShareableMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState<string>("");

  const [sharing, setSharing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("specific");
    setSelectedChatIds(scope === "single" && initialChatId ? new Set([initialChatId]) : new Set());
    setAccess("reader");
    setResult(null);

    if (members.length === 0 && !membersLoading && activeWorkspaceId) {
      setMembersLoading(true);
      setMembersError(null);
      supabase
        .from("workspace_members")
        .select("id, user_id, email, role")
        .eq("workspace_id", activeWorkspaceId)
        .order("email", { ascending: true })
        .then(({ data, error }) => {
          if (error) {
            setMembersError(error.message);
          } else {
            setMembers(
              (data ?? []).map((m) => ({ id: m.id, userId: m.user_id, email: m.email, role: m.role as TeamRole })),
            );
          }
          setMembersLoading(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shareableMembers = useMemo(() => members.filter((m) => m.userId !== user?.id), [members, user?.id]);
  const recipient = shareableMembers.find((m) => m.userId === recipientId) ?? null;
  const isGuestRecipient = recipient?.role === "guest";
  const effectiveAccess: AccessLevel = isGuestRecipient ? "reader" : access;

  function toggleChat(id: string) {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canConfirm =
    !sharing &&
    !!recipientId &&
    !!activeWorkspaceId &&
    (mode === "all" || selectedChatIds.size > 0);

  async function handleConfirm() {
    if (!activeWorkspaceId || !recipientId) return;
    setSharing(true);
    setResult(null);
    try {
      const res = await shareChat({
        workspace_id: activeWorkspaceId,
        shared_with_user_id: recipientId,
        mode,
        chat_ids: mode === "specific" ? Array.from(selectedChatIds) : undefined,
        access: effectiveAccess,
      });
      setResult({
        success: true,
        message: res.downgraded ? "Shared (view only — guest)" : "Shared successfully.",
      });
    } catch (err) {
      setResult({ success: false, message: err instanceof ChatShareError ? err.message : "Failed to share." });
    } finally {
      setSharing(false);
    }
  }

  function handleClose() {
    if (sharing) return;
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Share chat" maxWidth="max-w-lg"
      footer={
        <>
          <button
            onClick={handleClose}
            disabled={sharing}
            className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-3.5 py-2 rounded-md text-sm font-semibold bg-warning text-bg-base hover:bg-warning/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
          >
            {sharing ? "Sharing…" : "Share"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Mode selector */}
        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-lg border border-fg-subtle/15 px-3.5 py-2.5 cursor-pointer">
            <input
              type="radio"
              name="share-mode"
              className="mt-0.5 accent-warning cursor-pointer"
              checked={mode === "all"}
              onChange={() => setMode("all")}
            />
            <span>
              <span className="block text-[13.5px] font-medium text-fg-primary">Share all chats</span>
              <span className="block text-[12px] text-fg-subtle">Your entire chat history in this workspace.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-fg-subtle/15 px-3.5 py-2.5 cursor-pointer">
            <input
              type="radio"
              name="share-mode"
              className="mt-0.5 accent-warning cursor-pointer"
              checked={mode === "specific"}
              onChange={() => setMode("specific")}
            />
            <span>
              <span className="block text-[13.5px] font-medium text-fg-primary">
                {scope === "single" ? "Share only this chat" : "Share specific chats"}
              </span>
              <span className="block text-[12px] text-fg-subtle">
                {scope === "single" ? initialChatTitle : "Pick which chats to share below."}
              </span>
            </span>
          </label>
        </div>

        {/* Chat picker — only for general scope + specific mode */}
        {mode === "specific" && scope === "general" && (
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1 border border-fg-subtle/15 rounded-lg p-2">
            {conversations.length === 0 && (
              <p className="text-[13px] text-fg-subtle px-2 py-3">No chats yet.</p>
            )}
            {conversations.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-bg-surface/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="accent-warning cursor-pointer"
                  checked={selectedChatIds.has(c.id)}
                  onChange={() => toggleChat(c.id)}
                />
                <span className="text-[13px] text-fg-primary truncate">{c.title}</span>
              </label>
            ))}
          </div>
        )}

        {/* Recipient */}
        <div>
          <label className="block text-[12.5px] font-medium text-fg-muted mb-1.5">Recipient</label>
          {membersLoading && <p className="text-[13px] text-fg-subtle">Loading team members…</p>}
          {!membersLoading && membersError && (
            <p className="text-[13px] text-danger">Failed to load team members: {membersError}</p>
          )}
          {!membersLoading && !membersError && (
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-sm text-fg-primary cursor-pointer"
            >
              <option value="">Select a teammate…</option>
              {shareableMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.email} {m.role === "guest" ? "(guest)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Access level */}
        <div>
          <label className="block text-[12.5px] font-medium text-fg-muted mb-1.5">Access</label>
          <select
            value={effectiveAccess}
            disabled={isGuestRecipient}
            onChange={(e) => setAccess(e.target.value as AccessLevel)}
            title={isGuestRecipient ? "Guests can only view" : undefined}
            className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-sm text-fg-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <option value="reader">Can view</option>
            <option value="writer">Can edit</option>
          </select>
        </div>

        {result && (
          <div className={`flex items-center gap-2 text-[13px] ${result.success ? "text-success" : "text-danger"}`}>
            {result.success ? (
              <Check size={15} strokeWidth={2.5} className="shrink-0" />
            ) : (
              <AlertCircle size={15} strokeWidth={2} className="shrink-0" />
            )}
            {result.message}
          </div>
        )}
      </div>
    </Modal>
  );
}
