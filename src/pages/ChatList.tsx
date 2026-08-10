import { useCallback, useContext, useEffect, useState } from "react";
import { MessageSquare, SquarePen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../contexts/AuthContext";
import { listConversations, listSharedConversations, type ConversationRow, type SharedConversationRow } from "../lib/sybil";
import ChatListItem from "../components/ChatListItem";
import SharedChatListItem from "../components/SharedChatListItem";

/**
 * Full chat list — everything the sidebar's "Chats" section trims to the
 * 3 most recent. Own conversations on top, chats shared with you below.
 */
export default function ChatList() {
  const { session } = useContext(AuthContext);
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [sharedConversations, setSharedConversations] = useState<SharedConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const rows = await listConversations();
      setConversations(rows);
    } catch {
      // Chat list is non-critical UI; fail silently.
    }
    try {
      const sharedRows = await listSharedConversations();
      setSharedConversations(sharedRows);
    } catch {
      // Shared chat list is non-critical UI; fail silently.
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener("sybil:conversations-changed", refresh);
    return () => window.removeEventListener("sybil:conversations-changed", refresh);
  }, [refresh]);

  function handleNewChat() {
    navigate("/dashboard");
    window.dispatchEvent(new Event("sybil:new-chat"));
  }

  const empty = !loading && conversations.length === 0 && sharedConversations.length === 0;

  return (
    <div className="w-full max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <h1 className="text-xl font-semibold text-fg-primary">Chats</h1>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-fg-accent text-bg-base text-sm font-semibold hover:bg-[#ff5c40] transition-colors duration-150 cursor-pointer"
        >
          <SquarePen size={15} strokeWidth={2} />
          New chat
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : empty ? (
        <div className="text-center py-16 border border-dashed border-fg-subtle/25 rounded-xl">
          <MessageSquare size={28} strokeWidth={1.5} className="mx-auto mb-3 text-fg-subtle" />
          <p className="text-sm text-fg-muted">No chats yet.</p>
          <p className="text-xs text-fg-subtle mt-1">Click "New chat" to start one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {conversations.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold tracking-wide uppercase text-fg-subtle mb-1.5 pl-1">
                Your chats
              </div>
              <div className="flex flex-col gap-0.5">
                {conversations.map((c) => (
                  <ChatListItem
                    key={c.id}
                    conversation={c}
                    active={false}
                    onRenamed={(id, title) =>
                      setConversations((prev) => prev.map((row) => (row.id === id ? { ...row, title } : row)))
                    }
                    onDeleted={(id) => setConversations((prev) => prev.filter((row) => row.id !== id))}
                  />
                ))}
              </div>
            </div>
          )}

          {sharedConversations.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold tracking-wide uppercase text-fg-subtle mb-1.5 pl-1">
                Shared with you
              </div>
              <div className="flex flex-col gap-0.5">
                {sharedConversations.map((c) => (
                  <SharedChatListItem key={c.id} conversation={c} active={false} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
