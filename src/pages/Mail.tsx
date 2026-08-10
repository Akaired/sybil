import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Pencil,
  Trash2,
  X,
  Reply,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import SineWave from "../components/SineWave";
import Modal from "../components/Modal";
import { copy } from "../config/tokens";
import {
  GmailActionsError,
  bodyToDisplayText,
  deleteEmail,
  fetchOauthStatus,
  formatSender,
  isGoogleConnected,
  isUnread,
  listEmails,
  listSybilSentMessageIds,
  readEmail,
  sendEmail,
  startGoogleOauth,
  type GmailMessageDetail,
  type GmailMessageSummary,
} from "../lib/mail";

// ── Helpers ──────────────────────────────────────────────────

function formatListDate(internalDate: string | undefined): string {
  const ms = Number(internalDate);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

function formatFullDate(headerDate: string | undefined, internalDate: string | undefined): string {
  const d = headerDate ? new Date(headerDate) : internalDate ? new Date(Number(internalDate)) : null;
  if (!d || Number.isNaN(d.getTime())) return headerDate || "";
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ComposeState {
  mode: "new" | "reply";
  to: string;
  cc: string;
  subject: string;
  body: string;
}

const EMPTY_COMPOSE: ComposeState = { mode: "new", to: "", cc: "", subject: "", body: "" };

// ── Component ────────────────────────────────────────────────

export default function Mail() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");
  const [sybilSentIds, setSybilSentIds] = useState<Set<string>>(new Set());

  const [selected, setSelected] = useState<GmailMessageSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<GmailMessageDetail | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(EMPTY_COMPOSE);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<GmailMessageSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Connection status ──────────────────────────────────────

  const checkConnection = useCallback(async () => {
    setConnectionError(null);
    try {
      const status = await fetchOauthStatus();
      if (isGoogleConnected(status)) setConnected(true);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : "Unexpected network error.");
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { authorization_url } = await startGoogleOauth("/mail");
      const popup = window.open(authorization_url, "sybil-google-oauth", "width=520,height=680");
      if (!popup) {
        window.location.href = authorization_url;
        return;
      }
      const poll = setInterval(() => {
        if (popup.closed) {
          clearInterval(poll);
          setConnecting(false);
          checkConnection();
          fetchMessages();
        }
      }, 500);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't start Google connection.");
      setConnecting(false);
    }
  }

  // ── Messages fetch ─────────────────────────────────────────

  const fetchMessages = useCallback(async (query: string = activeQuery) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const res = await listEmails({
        query: query || null,
        max_results: 25,
        label_ids: [folder === "inbox" ? "INBOX" : "SENT"],
      });
      setConnected(true);
      setMessages(res.messages);
      setNextPageToken(res.next_page_token);
    } catch (err) {
      if (err instanceof GmailActionsError && err.notConnected) {
        setConnected(false);
      } else {
        setMessagesError(err instanceof Error ? err.message : "Unexpected network error.");
      }
      setMessages([]);
      setNextPageToken(null);
    } finally {
      setMessagesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, folder]);

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, folder]);

  useEffect(() => {
    if (folder !== "sent") return;
    listSybilSentMessageIds().then(setSybilSentIds);
  }, [folder]);

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listEmails({
        query: activeQuery || null,
        max_results: 25,
        page_token: nextPageToken,
        label_ids: [folder === "inbox" ? "INBOX" : "SENT"],
      });
      setMessages((prev) => [...prev, ...res.messages]);
      setNextPageToken(res.next_page_token);
    } catch {
      // Silent — the existing list stays usable, user can retry via search/refresh.
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActiveQuery(searchInput.trim());
  }

  // ── Message detail ─────────────────────────────────────────

  async function openMessage(msg: GmailMessageSummary) {
    setSelected(msg);
    setSelectedDetail(null);
    setSelectedError(null);
    setSelectedLoading(true);
    // Optimistically drop UNREAD locally — Gmail marks it read server-side on `read`.
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, labelIds: (m.labelIds ?? []).filter((l) => l !== "UNREAD") } : m)),
    );
    try {
      const detail = await readEmail(msg.id);
      setSelectedDetail(detail);
    } catch (err) {
      setSelectedError(err instanceof Error ? err.message : "Couldn't load this email.");
    } finally {
      setSelectedLoading(false);
    }
  }

  function closeMessage() {
    setSelected(null);
    setSelectedDetail(null);
    setSelectedError(null);
  }

  useEffect(() => {
    if (!selected && !composeOpen && !deleteTarget) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (composeOpen) return; // Modal handles its own Escape via onClose
      if (deleteTarget) return;
      setSelected(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selected, composeOpen, deleteTarget]);

  // ── Compose / reply ────────────────────────────────────────

  function openCompose() {
    setCompose(EMPTY_COMPOSE);
    setSendError(null);
    setComposeOpen(true);
  }

  function openReply() {
    if (!selectedDetail) return;
    const fromAddr = selectedDetail.headers.From ?? "";
    const emailMatch = fromAddr.match(/<([^>]+)>/);
    const to = emailMatch ? emailMatch[1] : fromAddr;
    const subject = selectedDetail.headers.Subject ?? "";
    const quoted = bodyToDisplayText(selectedDetail.body)
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    setCompose({
      mode: "reply",
      to,
      cc: "",
      subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
      body: `\n\n${formatFullDate(selectedDetail.headers.Date, selectedDetail.internal_date)}, ${formatSender(fromAddr)} wrote:\n${quoted}`,
    });
    setSendError(null);
    setComposeOpen(true);
  }

  function closeCompose() {
    if (sending) return;
    setComposeOpen(false);
  }

  async function handleSend() {
    if (!compose.to.trim() || !compose.subject.trim() || !compose.body.trim()) {
      setSendError("Recipient, subject, and body are all required.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await sendEmail({
        to: compose.to.split(",").map((s) => s.trim()).filter(Boolean),
        cc: compose.cc.split(",").map((s) => s.trim()).filter(Boolean),
        subject: compose.subject,
        body: compose.body,
      });
      setComposeOpen(false);
      fetchMessages();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Couldn't send this email.");
    } finally {
      setSending(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────

  function requestDelete(msg: GmailMessageSummary) {
    setDeleteError(null);
    setDeleteTarget(msg);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteEmail(deleteTarget.id);
      setMessages((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      if (selected?.id === deleteTarget.id) closeMessage();
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete this email.");
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-semibold text-fg-primary mb-2.5">{copy.pages.mail.title}</h1>
        <p className="text-fg-muted text-sm mb-5">{copy.pages.mail.subtitle}</p>
      </div>

      {/* Toolbar */}
      <div className="px-4 sm:px-6 pb-5 flex items-center justify-between gap-4 flex-wrap border-b border-fg-subtle/15">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap flex-1 min-w-0">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <div className="relative flex-1">
              <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search mail…"
                className="w-full bg-bg-elevated border border-fg-subtle/20 rounded-lg pl-8 pr-3 py-2 text-[13px] text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:border-fg-subtle/40"
              />
            </div>
          </form>
          <button
            onClick={() => fetchMessages()}
            aria-label="Refresh"
            title="Refresh"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150"
          >
            <RefreshCw size={15} strokeWidth={2} className={messagesLoading ? "animate-spin" : ""} />
          </button>
          {connected && (
            <button
              onClick={openCompose}
              className="flex items-center gap-1.5 font-semibold text-[13px] text-bg-base bg-warning rounded-lg px-3.5 py-2 cursor-pointer hover:bg-warning/90 transition-colors duration-150"
            >
              <Pencil size={14} strokeWidth={2} />
              Compose
            </button>
          )}
        </div>

        {/* Connection badge */}
        {connected === null ? (
          <div className="flex items-center gap-2 text-fg-subtle text-xs shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle animate-pulse" />
            Checking Gmail…
          </div>
        ) : connected ? (
          <div className="flex items-center gap-2 bg-success/12 border border-success/35 rounded-full py-1.5 pl-2.5 pr-3.5 shrink-0">
            <span className="w-[7px] h-[7px] rounded-full bg-success" />
            <span className="text-xs font-semibold text-success">Gmail connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 bg-fg-subtle/10 border border-fg-subtle/30 rounded-full py-1.5 pl-2.5 pr-3.5">
              <span className="w-[7px] h-[7px] rounded-full bg-fg-subtle" />
              <span className="text-xs font-semibold text-fg-muted">Not connected</span>
            </div>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="text-xs font-semibold text-bg-base bg-warning rounded-lg px-3.5 py-2 cursor-pointer hover:bg-warning/90 transition-colors duration-150 disabled:opacity-50"
            >
              {connecting ? "Redirecting…" : "Connect Gmail"}
            </button>
          </div>
        )}
      </div>

      {connectionError && (
        <div className="mx-4 sm:mx-6 mt-4 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
          Couldn't check Gmail connection: {connectionError}
        </div>
      )}
      {connectError && (
        <div className="mx-4 sm:mx-6 mt-4 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
          {connectError}
        </div>
      )}

      {/* Main */}
      <div className="flex-1 px-4 sm:px-6 pb-6 pt-5 min-h-0 overflow-y-auto">
        {connected && (
          <div className="flex bg-bg-elevated border border-fg-subtle/20 rounded-lg p-[3px] mb-4">
            <button
              onClick={() => setFolder("inbox")}
              className={`flex-1 font-semibold text-[13px] rounded-md px-4 py-1.5 cursor-pointer transition-colors duration-150 ${
                folder === "inbox" ? "bg-warning text-bg-base" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Inbox
            </button>
            <button
              onClick={() => setFolder("sent")}
              className={`flex-1 font-semibold text-[13px] rounded-md px-4 py-1.5 cursor-pointer transition-colors duration-150 ${
                folder === "sent" ? "bg-warning text-bg-base" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Sent
            </button>
          </div>
        )}
        <div className="bg-bg-elevated border border-fg-subtle/15 rounded-xl overflow-hidden">
          {connected === null && (
            <div className="flex items-center justify-center gap-3 text-fg-muted py-16">
              <div data-sybil-state="thinking">
                <SineWave height={24} className="w-24" />
              </div>
              <span className="text-sm animate-pulse">Loading inbox…</span>
            </div>
          )}

          {connected === false && (
            <div className="flex flex-col items-center justify-center text-center px-6 py-16">
              <div data-sybil-state="idle" className="mb-4">
                <SineWave height={32} className="w-32" />
              </div>
              <p className="text-fg-primary text-sm font-medium">Gmail isn't connected yet</p>
              <p className="text-fg-subtle text-xs mt-1 max-w-xs">
                Connect your Google account to read, write, and manage your inbox here.
              </p>
            </div>
          )}

          {connected && messagesError && (
            <div className="m-4 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
              Failed to load messages: {messagesError}
            </div>
          )}

          {connected && messagesLoading && (
            <div className="flex items-center justify-center gap-3 text-fg-muted py-16">
              <div data-sybil-state="thinking">
                <SineWave height={24} className="w-24" />
              </div>
              <span className="text-sm animate-pulse">Loading inbox…</span>
            </div>
          )}

          {connected && !messagesLoading && !messagesError && messages.length === 0 && (
            <div className="text-center py-16">
              <p className="text-fg-muted text-sm">No messages found.</p>
              {activeQuery && <p className="text-fg-subtle text-xs mt-1">Try a different search.</p>}
            </div>
          )}

          {connected && !messagesLoading && !messagesError && messages.length > 0 && (
            <div className="divide-y divide-fg-subtle/10">
              {messages.map((msg) => {
                const unread = isUnread(msg);
                const sentBySybil = folder === "sent" && sybilSentIds.has(msg.id);
                return (
                  <div
                    key={msg.id}
                    onClick={() => openMessage(msg)}
                    className="group flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 cursor-pointer hover:bg-bg-surface transition-colors duration-150"
                  >
                    {folder === "sent" ? (
                      <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                        {sentBySybil && (
                          <img src="/svg/sybil-mark.svg" alt="" title="Sent by Sybil" className="w-3.5 h-3.5" />
                        )}
                      </span>
                    ) : (
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${unread ? "bg-sine-cyan" : "bg-transparent"}`}
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          className={`text-[13.5px] truncate ${unread ? "font-semibold text-fg-primary" : "font-medium text-fg-muted"}`}
                        >
                          {formatSender(msg.headers?.From)}
                        </span>
                        <span className="text-[11px] text-fg-subtle shrink-0">{formatListDate(msg.internalDate)}</span>
                      </div>
                      <div className={`text-[13px] truncate ${unread ? "text-fg-primary" : "text-fg-muted"}`}>
                        {msg.headers?.Subject || "(no subject)"}
                      </div>
                      <div className="text-[12px] text-fg-subtle truncate hidden sm:block">{msg.snippet}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(msg);
                      }}
                      aria-label="Delete email"
                      title="Delete"
                      className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition-all duration-150 cursor-pointer"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {connected && nextPageToken && !messagesLoading && (
            <div className="flex justify-center py-4 border-t border-fg-subtle/10">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-[13px] font-semibold text-fg-muted hover:text-fg-primary cursor-pointer disabled:opacity-50 transition-colors duration-150"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Message detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={closeMessage}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-xl p-6 max-h-[85vh] flex flex-col"
          >
            <div className="flex items-start justify-between gap-4 mb-1">
              <h2 className="flex-1 text-base font-semibold text-fg-primary leading-snug">
                {selected.headers?.Subject || "(no subject)"}
              </h2>
              <button
                onClick={closeMessage}
                aria-label="Close"
                className="shrink-0 text-fg-subtle hover:text-fg-primary cursor-pointer transition-colors duration-150"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="text-[13px] text-fg-muted mb-1">
              From <span className="text-fg-primary font-medium">{formatSender(selected.headers?.From)}</span>
            </div>
            <div className="text-[12px] text-fg-subtle mb-4">
              {formatFullDate(selectedDetail?.headers.Date ?? selected.headers?.Date, selected.internalDate)}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {selectedLoading && (
                <div className="flex items-center gap-3 text-fg-muted py-8 justify-center">
                  <div data-sybil-state="thinking">
                    <SineWave height={20} className="w-20" />
                  </div>
                  <span className="text-sm animate-pulse">Loading…</span>
                </div>
              )}
              {selectedError && (
                <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
                  {selectedError}
                </div>
              )}
              {selectedDetail && !selectedLoading && (
                <p className="text-[13.5px] text-fg-primary whitespace-pre-wrap leading-relaxed">
                  {bodyToDisplayText(selectedDetail.body) || selected.snippet}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-fg-subtle/15">
              <button
                onClick={() => {
                  requestDelete(selected);
                }}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-danger hover:text-danger/80 cursor-pointer transition-colors duration-150"
              >
                <Trash2 size={14} strokeWidth={2} />
                Delete
              </button>
              <div className="flex items-center gap-2">
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${selected.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted hover:text-fg-primary cursor-pointer transition-colors duration-150"
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  Open in Gmail
                </a>
                <button
                  onClick={openReply}
                  disabled={!selectedDetail}
                  className="flex items-center gap-1.5 text-[13px] font-semibold text-bg-base bg-warning rounded-lg px-3.5 py-2 cursor-pointer hover:bg-warning/90 transition-colors duration-150 disabled:opacity-50"
                >
                  <Reply size={14} strokeWidth={2} />
                  Reply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compose modal */}
      <Modal
        open={composeOpen}
        onClose={closeCompose}
        title={compose.mode === "reply" ? "Reply" : "Compose"}
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              onClick={closeCompose}
              disabled={sending}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="px-3.5 py-2 rounded-md text-sm font-semibold bg-warning text-bg-base hover:bg-warning/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">To</label>
            <input
              value={compose.to}
              onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))}
              placeholder="name@example.com"
              className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-[13.5px] text-fg-primary focus:outline-none focus:border-fg-subtle/50"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">Cc (optional)</label>
            <input
              value={compose.cc}
              onChange={(e) => setCompose((c) => ({ ...c, cc: e.target.value }))}
              placeholder="name@example.com"
              className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-[13.5px] text-fg-primary focus:outline-none focus:border-fg-subtle/50"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">Subject</label>
            <input
              value={compose.subject}
              onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))}
              className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-[13.5px] text-fg-primary focus:outline-none focus:border-fg-subtle/50"
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">Message</label>
            <textarea
              value={compose.body}
              onChange={(e) => setCompose((c) => ({ ...c, body: e.target.value }))}
              rows={8}
              className="w-full bg-bg-base border border-fg-subtle/25 rounded-md px-3 py-2 text-[13.5px] text-fg-primary focus:outline-none focus:border-fg-subtle/50 resize-y"
            />
          </div>
          {sendError && <p className="text-[13px] text-danger">{sendError}</p>}
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete email?"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setDeleteTarget(null)}
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
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Moves <span className="text-fg-primary font-medium">{deleteTarget?.headers?.Subject || "(no subject)"}</span> to
          Trash. You can still recover it from Gmail.
        </p>
        {deleteError && <p className="text-[13px] text-danger mt-3">{deleteError}</p>}
      </Modal>
    </div>
  );
}
