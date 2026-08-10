import { Fragment, useState, useRef, useEffect, useContext, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUp, Users, Copy, Check, Pencil, X, RefreshCw, ThumbsUp, ThumbsDown, Mic, Phone, Play, Square, Loader2, Plus, ScrollText, Upload } from "lucide-react";
import SineWave from "../components/SineWave";
import CallOverlay from "../components/CallOverlay";
import { AuthContext } from "../contexts/AuthContext";
import { supabase } from "../config/supabase";
import {
  processMessage,
  listSharedConversations,
  interpretSignal,
  resolveSignal,
  retryResolution,
  editSignal,
  setResolutionFeedback,
  fetchSpeechmaticsTTS,
  type ResolutionDetail,
  type SybilError,
  type SharedConversationRow,
} from "../lib/sybil";
import { useVoiceInput } from "../lib/speechmatics";
import { useVoiceCall } from "../lib/useVoiceCall";
import { useMusicPlayer } from "../contexts/MusicPlayerContext";
import { formatSender } from "../lib/mail";
import { isDemoLimitError } from "../lib/demoLimit";
import EmailDetailModal from "../components/EmailDetailModal";

// ── Types ────────────────────────────────────────────────────

interface SignalRow {
  id: string;
  origin: string;
  raw_content: string;
  created_at: string;
  llm_provider?: string | null;
}

interface ResolutionRow {
  id: string;
  signal_id: string;
  action: string;
  outcome: "success" | "partial" | "error" | "pending";
  detail: ResolutionDetail;
  created_at: string;
  feedback?: "up" | "down" | null;
}

interface ChatTurn {
  signal: SignalRow;
  resolution: ResolutionRow | null;
}

interface ActionCardSpec {
  colorVar: string;
  label: string;
  linkText: string;
  href: string;
}

const EXAMPLE_PROMPTS = [
  "Tell me what's on my calendar tomorrow",
  "Read my emails",
  "Search the web about Speechmatics and give me an explanation",
  "Search the web about Bright Data and summarize what it does",
];

interface MailMessageSummary {
  id: string;
  headers?: { Subject?: string; From?: string };
}

interface CalendarEventSummary {
  summary?: string;
  start?: { dateTime?: string; date?: string };
}

/** Short "day · time" label for a calendar event, used in chat reply text. */
function formatEventWhenShort(ev: CalendarEventSummary): string {
  const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : ev.start?.date ? new Date(ev.start.date) : null;
  if (!start) return "";
  const dateLabel = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (!ev.start?.dateTime) return `${dateLabel} · all day`;
  const timeLabel = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${dateLabel} · ${timeLabel}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "backlog": return "Backlog";
    case "todo": return "To Do";
    case "doing": return "Doing";
    case "done": return "Done";
    default: return status;
  }
}

function actionCardSpec(resolution: ResolutionRow): ActionCardSpec | null {
  const detail = resolution.detail ?? {};
  switch (resolution.action) {
    case "create_task":
      return {
        colorVar: "var(--color-sine-signal)",
        label: `Task created: ${detail.task_title ?? "untitled"}`,
        linkText: "Open board",
        href: "/tasks",
      };
    case "update_task": {
      const fields = (detail.updated_fields as string[] | undefined) ?? [];
      const isStatusMove = fields.length === 1 && fields[0] === "status" && detail.status;
      return {
        colorVar: "var(--color-sine-amber)",
        label: isStatusMove
          ? `Moved "${detail.task_title ?? "untitled"}" to ${statusLabel(detail.status as string)}`
          : `Task updated: ${detail.task_title ?? "untitled"}`,
        linkText: "View board",
        href: "/tasks",
      };
    }
    case "delete_task":
      return {
        colorVar: "var(--color-sine-signal)",
        label: detail.error && detail.error !== "Multiple matching tasks found"
          ? `Couldn't delete: ${detail.error}`
          : detail.error === "Multiple matching tasks found"
            ? "Multiple tasks matched — pick one"
            : detail.scope === "all"
              ? `Deleted ${detail.deleted_count ?? 0} task(s)`
              : `Task deleted: ${(detail.task_title as string) || ""}`,
        linkText: "View board",
        href: "/tasks",
      };
    case "create_sentinel":
      return {
        colorVar: "var(--color-sine-mint)",
        label: "Sentinel created: monitoring active",
        linkText: "View sentinel",
        href: detail.sentinel_id ? `/sentinels#sentinel-${detail.sentinel_id}` : "/sentinels",
      };
    case "send_email":
      return {
        colorVar: "var(--color-sine-cyan)",
        label: detail.error
          ? `Email not sent: ${detail.error}`
          : "Email sent",
        linkText: "Open Mail",
        href: "/mail",
      };
    case "create_calendar_event":
    case "calendar_event":
      return {
        colorVar: "var(--color-sine-indigo)",
        label: detail.error
          ? `Event not created: ${detail.error}`
          : "Calendar event created",
        linkText: "Open Calendar",
        href: "/calendar",
      };
    case "read_calendar":
      return {
        colorVar: "var(--color-sine-indigo)",
        label: detail.error
          ? `Couldn't read calendar: ${detail.error}`
          : `Read calendar: ${detail.count ?? 0} event(s)`,
        linkText: "Open Calendar",
        href: "/calendar",
      };
    case "read_emails":
      return {
        colorVar: "var(--color-sine-cyan)",
        label: detail.error
          ? `Couldn't read emails: ${detail.error}`
          : `Read inbox: ${detail.count ?? 0} message(s)`,
        linkText: "Open Mail",
        href: "/mail",
      };
    case "delete_email":
      return {
        colorVar: "var(--color-sine-cyan)",
        label: detail.error && detail.error !== "Multiple matching emails found"
          ? `Couldn't delete: ${detail.error}`
          : detail.error === "Multiple matching emails found"
            ? "Multiple emails matched — pick one"
            : detail.scope === "recent"
              ? `Deleted ${detail.deleted_count ?? 0} email(s)`
              : `Email deleted: ${(detail.subject as string) || ""}`,
        linkText: "Open Mail",
        href: "/mail",
      };
    case "delete_sentinel":
      return {
        colorVar: "var(--color-sine-signal)",
        label: detail.error
          ? `Couldn't delete: ${detail.error}`
          : detail.scope === "all"
            ? `Deleted ${detail.deleted_count ?? 0} sentinel(s)`
            : `Sentinel deleted: ${detail.condition ?? ""}`,
        linkText: "View sentinels",
        href: "/sentinels",
      };
    case "web_visit":
      return {
        colorVar: "var(--color-sine-cyan)",
        label: detail.error ? `Couldn't open page: ${detail.error}` : `Visited: ${domainOf((detail.url as string) || "")}`,
        linkText: "View activity",
        href: "/activity",
      };
    case "web_search":
      return {
        colorVar: "var(--color-sine-cyan)",
        label: detail.error
          ? `Couldn't search: ${detail.error}`
          : `Searched the web: ${((detail.results as unknown[] | undefined) ?? []).length} result(s)`,
        linkText: "View activity",
        href: "/activity",
      };
    case "web_research":
      return {
        colorVar: "var(--color-sine-cyan)",
        label: detail.error
          ? `Couldn't research: ${detail.error}`
          : `Researched: ${(detail.query as string) || ""}`,
        linkText: "View activity",
        href: "/activity",
      };
    default:
      return null;
  }
}

const PROVIDER_ICON_BASE =
  "https://uhrqlwoejawnnhdeabob.supabase.co/storage/v1/object/public/brand-assets/providers";

function llmProviderBadge(provider?: string | null): { src: string; title: string } | null {
  if (provider === "AI/ML API") {
    return { src: `${PROVIDER_ICON_BASE}/aiml.svg`, title: "This response was generated by AI/ML API" };
  }
  if (provider === "OpenRouter") {
    return { src: `${PROVIDER_ICON_BASE}/openrouter.svg`, title: "This response was generated by OpenRouter" };
  }
  return null;
}

/** URLs Bright Data actually opened for this resolution, one entry per source. */
function brightDataSources(resolution: ResolutionRow): { url: string; title?: string }[] {
  const detail = resolution.detail ?? {};
  switch (resolution.action) {
    case "web_visit":
      return detail.url ? [{ url: detail.url as string }] : [];
    case "web_search": {
      const results = (detail.results as { url?: string; title?: string }[] | undefined) ?? [];
      return results.filter((r) => r.url).map((r) => ({ url: r.url as string, title: r.title }));
    }
    case "web_research": {
      const sources = (detail.sources as { url?: string; title?: string }[] | undefined) ?? [];
      return sources.filter((s) => s.url).map((s) => ({ url: s.url as string, title: s.title }));
    }
    default:
      return [];
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconFor(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainOf(url))}&sz=32`;
}

function replyTextFor(resolution: ResolutionRow): string {
  const detail = resolution.detail ?? {};
  if (detail.reply_text) return detail.reply_text as string;
  switch (resolution.action) {
    case "create_task":
      return `Done. I created the task "${detail.task_title ?? ""}".`;
    case "update_task": {
      const fields = (detail.updated_fields as string[] | undefined) ?? [];
      if (fields.length === 1 && fields[0] === "status" && detail.status) {
        return `Done. Moved "${detail.task_title ?? ""}" to ${statusLabel(detail.status as string)}.`;
      }
      return `Done. I updated "${detail.task_title ?? ""}".`;
    }
    case "delete_task":
      if (detail.error === "Multiple matching tasks found") {
        const candidates = (detail.candidates as { title?: string }[] | undefined) ?? [];
        const lines = candidates.map((c) => `• ${c.title || "(untitled)"}`);
        return `Found more than one match — which one did you mean?\n${lines.join("\n")}`;
      }
      if (detail.error) return `Couldn't delete that task: ${detail.error}`;
      if (detail.scope === "all") return `Done. Deleted ${detail.deleted_count ?? 0} task(s).`;
      return `Done. Deleted "${detail.task_title || "that task"}".`;
    case "create_sentinel":
      return "Set. I'll let you know as soon as something happens.";
    case "send_email":
      if (detail.google_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't send that email: ${detail.error}`;
      return "Done. Email sent.";
    case "create_calendar_event":
    case "calendar_event":
      if (detail.calendar_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't create the event: ${detail.error}`;
      return "Done. Added it to your calendar.";
    case "read_calendar": {
      if (detail.calendar_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't read the calendar: ${detail.error}`;
      const events = (detail.events as CalendarEventSummary[] | undefined) ?? [];
      if (events.length === 0) return "No events found.";
      const lines = events.slice(0, 5).map((e) => `• ${e.summary || "(untitled)"} — ${formatEventWhenShort(e)}`);
      const more = events.length > 5 ? `\n…and ${events.length - 5} more.` : "";
      return `Found ${events.length} event(s):\n${lines.join("\n")}${more}`;
    }
    case "read_emails": {
      if (detail.google_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't read the inbox: ${detail.error}`;
      const messages = (detail.messages as MailMessageSummary[] | undefined) ?? [];
      if (messages.length === 0) return "No messages found.";
      // The individual emails render as clickable rows below this bubble (see EmailListPreview).
      return `Here are your last ${messages.length} email(s):`;
    }
    case "delete_email":
      if (detail.google_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error === "Multiple matching emails found") {
        const candidates = (detail.candidates as { subject?: string; from?: string }[] | undefined) ?? [];
        const lines = candidates.map((c) => `• ${c.subject || "(no subject)"} — ${formatSender(c.from)}`);
        return `Found more than one match — which one did you mean?\n${lines.join("\n")}`;
      }
      if (detail.error) return `Couldn't delete that email: ${detail.error}`;
      if (detail.scope === "recent") {
        const subjects = (detail.subjects as string[] | undefined) ?? [];
        const lines = subjects.map((s) => `• ${s || "(no subject)"}`);
        return `Done. Deleted ${detail.deleted_count ?? 0} email(s):\n${lines.join("\n")}`;
      }
      return `Done. Deleted "${detail.subject || "that email"}".`;
    case "delete_sentinel":
      if (detail.error) return `Couldn't delete that sentinel: ${detail.error}`;
      if (detail.scope === "all") return `Done. Deleted ${detail.deleted_count ?? 0} sentinel(s).`;
      return "Done. Sentinel deleted.";
    case "web_research": {
      if (detail.error) return `Couldn't research that: ${detail.error}`;
      if (detail.summary) return detail.summary as string;
      return "I looked into it, but couldn't put together a summary from what I found.";
    }
    case "web_search": {
      if (detail.error) return `Couldn't search for that: ${detail.error}`;
      const results = (detail.results as { title?: string; url?: string }[] | undefined) ?? [];
      if (results.length === 0) return "No results found.";
      const lines = results.slice(0, 5).map((r) => `• ${r.title || r.url}`);
      return `Found ${results.length} result(s):\n${lines.join("\n")}`;
    }
    case "web_visit": {
      if (detail.error) return `Couldn't open that page: ${detail.error}`;
      const markdown = (detail.markdown as string | undefined) ?? "";
      if (!markdown) return "I opened the page, but it had no readable content.";
      const excerpt = markdown.length > 600 ? `${markdown.slice(0, 600)}…` : markdown;
      return excerpt;
    }
    case "no_action":
      return (detail.reason as string) || "No action needed.";
    default:
      return "Done.";
  }
}

// ── Typing / thinking animations ────────────────────────────────

/** Reveals `text` progressively, like the agent typing it out. */
function TypingText({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? "" : text);

  useEffect(() => {
    if (!animate) {
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    const chunk = Math.max(1, Math.round(text.length / 120));
    const id = setInterval(() => {
      i += chunk;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 12);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return <>{shown}</>;
}

/** GPT-style animated thinking dots. */
function ThinkingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[6px] h-[6px] rounded-full bg-fg-subtle animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  );
}

/** Divider marking the start/end of a live voice call within the transcript. */
function CallDivider({ kind }: { kind: "start" | "end" }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-fg-subtle/20" />
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-subtle whitespace-nowrap">
        <Phone size={12} strokeWidth={2} />
        <span>{kind === "start" ? "Call started" : "Call ended"}</span>
        {kind === "end" && (
          <>
            <span className="text-fg-subtle/40">·</span>
            <span className="flex items-center gap-1">
              Powered by
              <img
                src={`${PROVIDER_ICON_BASE}/speechmatics.svg`}
                alt="Speechmatics"
                className="w-3 h-3 opacity-80"
              />
              Speechmatics
            </span>
          </>
        )}
      </div>
      <div className="flex-1 h-px bg-fg-subtle/20" />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export default function Dashboard() {
  const { user, setDemoLimitReached } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationId = searchParams.get("c");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [freshResolutionIds, setFreshResolutionIds] = useState<Set<string>>(new Set());
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const skipNextLoadRef = useRef<string | null>(null);
  const [sharedConversations, setSharedConversations] = useState<SharedConversationRow[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    listSharedConversations()
      .then(setSharedConversations)
      .catch(() => setSharedConversations([]));
  }, []);

  const activeShare = sharedConversations.find((c) => c.id === conversationId) ?? null;
  const readOnly = activeShare?.access === "reader";

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isVoiceInput, setIsVoiceInput] = useState(false);
  const { isRecording, start: startRecording, stop: stopRecording, voiceError } =
    useVoiceInput((text: string) => {
      setInput(text);
      setIsVoiceInput(true);
    });

  useEffect(() => {
    if (voiceError && isDemoLimitError(voiceError)) setDemoLimitReached(true);
  }, [voiceError, setDemoLimitReached]);

  // ── Live voice call ─────────────────────────────────────────
  const [callOpen, setCallOpen] = useState(false);
  // Turn-index range of each past call, so the transcript can show a
  // "Call started/ended" divider around it — not persisted, just a render
  // hint for the current session's turns array.
  const [callBoundaries, setCallBoundaries] = useState<{ start: number; end: number }[]>([]);
  const callBoundaryStartRef = useRef(0);
  // handleCallTurn needs voiceCall.speak/resumeListening, but voiceCall needs
  // handleCallTurn as its onTurn callback — break the cycle with a ref.
  const voiceCallRef = useRef<ReturnType<typeof useVoiceCall> | null>(null);

  const handleCallTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const optimisticId = `pending-${Date.now()}`;
      const optimisticSignal: SignalRow = {
        id: optimisticId,
        origin: "voice",
        raw_content: trimmed,
        created_at: new Date().toISOString(),
      };
      setTurns((prev) => [...prev, { signal: optimisticSignal, resolution: null }]);

      try {
        const result = await processMessage(trimmed, conversationId, "voice", trimmed, { call_turn: true });

        const finalSignal: SignalRow = {
          ...optimisticSignal,
          id: result.signal_id,
          llm_provider: result.llm_provider,
        };
        const resolution: ResolutionRow = {
          id: result.resolution_id,
          signal_id: result.signal_id,
          action: result.action,
          outcome: result.outcome,
          detail: result.detail,
          created_at: new Date().toISOString(),
        };

        setFreshResolutionIds((prev) => new Set(prev).add(resolution.id));
        setTurns((prev) =>
          prev.map((t) => (t.signal.id === optimisticId ? { signal: finalSignal, resolution } : t)),
        );

        if (!conversationId && result.conversation_id) {
          skipNextLoadRef.current = result.conversation_id;
          setSearchParams({ c: result.conversation_id });
        }
        window.dispatchEvent(new Event("sybil:conversations-changed"));

        await voiceCallRef.current?.speak(replyTextFor(resolution));
      } catch (err: unknown) {
        setTurns((prev) => prev.filter((t) => t.signal.id !== optimisticId));
        const sybilErr = err as SybilError;
        if (isDemoLimitError(sybilErr?.error)) {
          setDemoLimitReached(true);
          voiceCallRef.current?.stop();
          setCallOpen(false);
          return;
        }
        setErrorText(
          sybilErr?.error
            ? `Something went wrong: ${sybilErr.error}`
            : "Something went wrong. Please try again.",
        );
        voiceCallRef.current?.resumeListening();
      }
    },
    [conversationId, setSearchParams, setDemoLimitReached],
  );

  const voiceCall = useVoiceCall(handleCallTurn);
  voiceCallRef.current = voiceCall;

  const { duckTo } = useMusicPlayer();

  // Duck the ambient music into the background for the whole call, and
  // duck it a little less while Sybil is thinking so the pause doesn't
  // feel like dead air. Keyed off callOpen (not just voiceCall.state) so
  // the duck happens the instant the call UI opens, not only once
  // voiceCall.start() finishes connecting (mic permission + socket setup
  // can take a beat, during which state is still "idle").
  useEffect(() => {
    if (!callOpen) {
      duckTo(null);
    } else if (voiceCall.state === "thinking") {
      duckTo(0.12);
    } else {
      duckTo(0.04);
    }
  }, [callOpen, voiceCall.state, duckTo]);

  useEffect(() => {
    return () => duckTo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (voiceCall.callError) {
      if (isDemoLimitError(voiceCall.callError)) {
        setDemoLimitReached(true);
      } else {
        setErrorText(voiceCall.callError);
      }
      setCallOpen(false);
      setCallBoundaries((prev) => [...prev, { start: callBoundaryStartRef.current, end: turns.length - 1 }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceCall.callError]);

  async function openCall() {
    callBoundaryStartRef.current = turns.length;
    setCallOpen(true);
    await voiceCall.start();
  }

  function closeCall() {
    voiceCall.stop();
    setCallOpen(false);
    setCallBoundaries((prev) => [...prev, { start: callBoundaryStartRef.current, end: turns.length - 1 }]);
  }

  // Text-to-speech playback — one audio at a time across all messages.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTtsIdRef = useRef<string | null>(null);
  const [ttsId, setTtsId] = useState<string | null>(null);
  const [ttsStatus, setTtsStatus] = useState<"loading" | "playing" | null>(null);
  const [ttsPlayedIds, setTtsPlayedIds] = useState<Set<string>>(new Set());

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    activeTtsIdRef.current = null;
    setTtsId(null);
    setTtsStatus(null);
  }

  async function handlePlay(resolutionId: string, text: string) {
    if (activeTtsIdRef.current === resolutionId) {
      stopAudio();
      return;
    }
    stopAudio();
    activeTtsIdRef.current = resolutionId;
    setTtsId(resolutionId);
    setTtsStatus("loading");
    try {
      const blob = await fetchSpeechmaticsTTS(text);
      if (activeTtsIdRef.current !== resolutionId) return; // superseded while loading
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeTtsIdRef.current === resolutionId) stopAudio();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (activeTtsIdRef.current === resolutionId) stopAudio();
      };
      await audio.play();
      if (activeTtsIdRef.current === resolutionId) {
        setTtsStatus("playing");
        setTtsPlayedIds((prev) => new Set(prev).add(resolutionId));
      }
    } catch {
      if (activeTtsIdRef.current === resolutionId) stopAudio();
    }
  }

  // Stop any playing audio on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (conversationId && skipNextLoadRef.current === conversationId) {
      skipNextLoadRef.current = null;
      return;
    }
    if (!conversationId) {
      setTurns([]);
      setLoadingHistory(false);
      return;
    }
    loadHistory(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, processing, callBoundaries]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    function onNewChat() {
      setInput("");
      setTurns([]);
      setErrorText(null);
      setLoadingHistory(false);
    }
    window.addEventListener("sybil:new-chat", onNewChat);
    return () => window.removeEventListener("sybil:new-chat", onNewChat);
  }, []);

  async function loadHistory(convId: string) {
    setLoadingHistory(true);

    try {
      const { data: signals } = await supabase
        .from("sybil_signals")
        .select("id, origin, raw_content, created_at, llm_provider")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(200);

      const signalIds = (signals ?? []).map((s) => s.id);
      const { data: resolutions } = signalIds.length
        ? await supabase
            .from("sybil_resolutions")
            .select("id, signal_id, action, outcome, detail, created_at, feedback")
            .in("signal_id", signalIds)
        : { data: [] as ResolutionRow[] };

      const resolutionBySignal = new Map<string, ResolutionRow>();
      (resolutions ?? []).forEach((r) => resolutionBySignal.set(r.signal_id, r));

      const merged: ChatTurn[] = (signals ?? []).map((s) => ({
        signal: s,
        resolution: resolutionBySignal.get(s.id) ?? null,
      }));

      setTurns(merged);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? `Couldn't load history: ${err.message}`
          : "Couldn't load the conversation history.",
      );
    } finally {
      setLoadingHistory(false);
    }
  }

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || processing) return;

    const fromVoice = isVoiceInput;
    setInput("");
    setIsVoiceInput(false);
    setProcessing(true);
    setErrorText(null);

    // Show the user's message immediately — don't wait for the round trip.
    const optimisticId = `pending-${Date.now()}`;
    const optimisticSignal: SignalRow = {
      id: optimisticId,
      origin: fromVoice ? "voice" : "chat",
      raw_content: trimmed,
      created_at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, { signal: optimisticSignal, resolution: null }]);

    try {
      const result = fromVoice
        ? await processMessage(trimmed, conversationId, "voice", trimmed)
        : await processMessage(trimmed, conversationId);

      const finalSignal: SignalRow = {
        ...optimisticSignal,
        id: result.signal_id,
        llm_provider: result.llm_provider,
      };
      const resolution: ResolutionRow = {
        id: result.resolution_id,
        signal_id: result.signal_id,
        action: result.action,
        outcome: result.outcome,
        detail: result.detail,
        created_at: new Date().toISOString(),
      };

      setFreshResolutionIds((prev) => new Set(prev).add(resolution.id));
      setTurns((prev) =>
        prev.map((t) =>
          t.signal.id === optimisticId ? { signal: finalSignal, resolution } : t,
        ),
      );

      if (!conversationId && result.conversation_id) {
        skipNextLoadRef.current = result.conversation_id;
        setSearchParams({ c: result.conversation_id });
      }
      window.dispatchEvent(new Event("sybil:conversations-changed"));
    } catch (err: unknown) {
      setTurns((prev) => prev.filter((t) => t.signal.id !== optimisticId));
      const sybilErr = err as SybilError;
      if (isDemoLimitError(sybilErr?.error)) {
        setDemoLimitReached(true);
      } else if (sybilErr?.status === 403 && sybilErr?.error?.includes("team")) {
        setErrorText("You're not part of a team yet. Ask an admin to invite you.");
      } else if (sybilErr?.error) {
        setErrorText(`Something went wrong: ${sybilErr.error}`);
      } else {
        setErrorText("Something went wrong. Please try again.");
      }
    } finally {
      setProcessing(false);
    }
  }, [input, processing, conversationId, setSearchParams, isVoiceInput, setDemoLimitReached]);

  async function handleCopy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      // Clipboard access denied/unsupported — non-critical, ignore.
    }
  }

  /** Re-runs interpret+resolve against an already-ingested signal (no new ingest). */
  async function regenerateReply(signalId: string): Promise<ResolutionRow> {
    const { interpretation } = await interpretSignal(signalId);
    const result = await resolveSignal(signalId, interpretation);
    return {
      id: result.resolution_id,
      signal_id: result.signal_id,
      action: result.action,
      outcome: result.outcome,
      detail: result.detail,
      created_at: new Date().toISOString(),
      feedback: null,
    };
  }

  async function handleRetry(signalId: string) {
    if (regeneratingId || processing) return;
    setRegeneratingId(signalId);
    setErrorText(null);
    setTurns((prev) => prev.map((t) => (t.signal.id === signalId ? { ...t, resolution: null } : t)));
    try {
      await retryResolution(signalId);
      const resolution = await regenerateReply(signalId);
      setFreshResolutionIds((prev) => new Set(prev).add(resolution.id));
      setTurns((prev) => prev.map((t) => (t.signal.id === signalId ? { ...t, resolution } : t)));
    } catch {
      setErrorText("Couldn't regenerate that reply. Please try again.");
    } finally {
      setRegeneratingId(null);
    }
  }

  function startEdit(signalId: string, currentText: string) {
    setEditingId(signalId);
    setEditDraft(currentText);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit(signalId: string) {
    const trimmed = editDraft.trim();
    if (!trimmed || regeneratingId || processing) return;
    setEditingId(null);
    setRegeneratingId(signalId);
    setErrorText(null);
    setTurns((prev) =>
      prev.map((t) =>
        t.signal.id === signalId
          ? { signal: { ...t.signal, raw_content: trimmed }, resolution: null }
          : t,
      ),
    );
    try {
      await editSignal(signalId, trimmed);
      const resolution = await regenerateReply(signalId);
      setFreshResolutionIds((prev) => new Set(prev).add(resolution.id));
      setTurns((prev) => prev.map((t) => (t.signal.id === signalId ? { ...t, resolution } : t)));
    } catch {
      setErrorText("Couldn't resend that message. Please try again.");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function handleFeedback(resolution: ResolutionRow, value: "up" | "down") {
    const next = resolution.feedback === value ? null : value;
    setTurns((prev) =>
      prev.map((t) =>
        t.resolution?.id === resolution.id ? { ...t, resolution: { ...t.resolution, feedback: next } } : t,
      ),
    );
    try {
      await setResolutionFeedback(resolution.id, next);
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t.resolution?.id === resolution.id
            ? { ...t, resolution: { ...t.resolution, feedback: resolution.feedback ?? null } }
            : t,
        ),
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function useExample(text: string) {
    setInput(text);
  }

  const isEmpty = !loadingHistory && turns.length === 0;

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {activeShare && (
        <div className="mx-4 sm:mx-8 mt-4 flex items-center gap-2 bg-sine-indigo/10 border border-sine-indigo/25 rounded-lg px-4 py-2.5 text-[13px] text-fg-muted shrink-0">
          <Users size={14} strokeWidth={2} className="text-sine-indigo shrink-0" />
          Viewing <span className="text-fg-primary font-medium">{activeShare.ownerEmail}</span>'s chat
          {readOnly ? " (view only)" : " (can edit)"}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-7 flex flex-col gap-[18px]">
        {loadingHistory && (
          <div className="flex items-center gap-3 text-fg-muted py-8">
            <SineWave state="thinking" height={24} className="w-24" />
            <span className="text-sm animate-pulse">Loading conversation…</span>
          </div>
        )}

        {isEmpty && (
          <div className="flex-1 flex flex-col items-center justify-center gap-[22px] text-center">
            <SineWave state="idle" height={42} className="w-[66px]" />
            <div>
              <p className="text-xl font-semibold text-fg-primary mb-1.5">Type or talk</p>
              <p className="text-sm text-fg-subtle max-w-[380px]">
                Sybil reads your calendar and mail, and watches the web for
                whatever you ask it to keep an eye on.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 justify-center max-w-[520px]">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  onClick={() => useExample(ex)}
                  className="border border-fg-subtle rounded-full px-4 py-2.5 text-[13.5px] font-medium text-fg-muted hover:text-fg-primary hover:border-fg-muted transition-colors duration-150 cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loadingHistory &&
          turns.map((turn, idx) => {
            const isLast = turn.signal.id === turns[turns.length - 1]?.signal.id;
            const callStartsHere = callBoundaries.some((b) => b.start === idx);
            const callEndsHere = callBoundaries.some((b) => b.end === idx);
            const isEditing = editingId === turn.signal.id;
            const isRegenerating = regeneratingId === turn.signal.id;
            const canAct = !processing && !regeneratingId && !readOnly;
            const llmBadge = llmProviderBadge(turn.signal.llm_provider);
            const dictatedTitle = turn.signal.origin === "voice"
              ? "This message was dictated using Speechmatics"
              : null;
            const ttsPlayed = !!turn.resolution && ttsPlayedIds.has(turn.resolution.id);
            const playedTitle = ttsPlayed ? "Read aloud with Speechmatics text-to-speech" : null;
            const brightDataUsed = turn.resolution?.detail?.used_brightdata === true;
            const brightDataSourceUrls = turn.resolution ? brightDataSources(turn.resolution) : [];

            return (
            <Fragment key={turn.signal.id}>
              {callStartsHere && <CallDivider kind="start" />}
              <div className="flex flex-col gap-2">
              {turn.signal.origin !== "sentinel" && (
                <div className="flex flex-col items-end gap-1 group/user">
                  {isEditing ? (
                    <div className="flex flex-col gap-2 w-full sm:max-w-[560px]">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full resize-none bg-bg-elevated border border-sine-indigo/40 rounded-[14px] px-[18px] py-[13px] text-[15px] leading-normal text-fg-primary outline-none focus:border-sine-indigo/60"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={cancelEdit}
                          title="Cancel"
                          className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                        >
                          <X size={14} strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => saveEdit(turn.signal.id)}
                          title="Save and resend"
                          disabled={!editDraft.trim()}
                          className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Check size={14} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="bg-sine-indigo/15 rounded-[18px] px-[18px] py-[13px] text-[15px] leading-normal text-fg-primary max-w-[85%] sm:max-w-[560px]">
                        {turn.signal.raw_content}
                      </div>
                      <div
                        className={`flex items-center gap-1 transition-opacity duration-150 pr-1 ${
                          isLast
                            ? "opacity-100"
                            : "opacity-0 group-hover/user:opacity-100 focus-within:opacity-100"
                        }`}
                      >
                        <button
                          onClick={() => handleCopy(`u-${turn.signal.id}`, turn.signal.raw_content)}
                          title="Copy"
                          className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                        >
                          {copiedKey === `u-${turn.signal.id}` ? (
                            <Check size={14} strokeWidth={2} />
                          ) : (
                            <Copy size={14} strokeWidth={1.8} />
                          )}
                        </button>
                        {isLast && canAct && (
                          <button
                            onClick={() => startEdit(turn.signal.id, turn.signal.raw_content)}
                            title="Edit"
                            className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                          >
                            <Pencil size={14} strokeWidth={1.8} />
                          </button>
                        )}
                        {dictatedTitle && (
                          <>
                            <span className="w-px h-4 bg-fg-subtle/20 mx-1" />
                            <img
                              src={`${PROVIDER_ICON_BASE}/speechmatics.svg`}
                              title={dictatedTitle}
                              alt={dictatedTitle}
                              className="w-3.5 h-3.5 opacity-80"
                            />
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {isRegenerating && !turn.resolution && (
                <div className="flex gap-3">
                  <div className="w-[30px] h-[30px] min-w-[30px] rounded-full bg-fg-subtle/15 flex items-center justify-center">
                    <SineWave state="idle" height={11} className="w-[17px]" />
                  </div>
                  <div className="bg-fg-subtle/10 rounded-[18px] px-5 py-[13px] flex items-center">
                    <ThinkingDots />
                  </div>
                </div>
              )}

              {turn.resolution && (
                <div className="flex gap-3 max-w-full sm:max-w-[640px] group/agent">
                  <div className="w-[30px] h-[30px] min-w-[30px] rounded-full bg-fg-subtle/15 flex items-center justify-center">
                    <SineWave state="idle" height={11} className="w-[17px]" />
                  </div>
                  <div className="flex flex-col gap-2 min-w-0 max-w-[85%] sm:max-w-[560px]">
                    <div className="bg-fg-subtle/10 rounded-[18px] px-[18px] py-[13px] text-[15px] leading-normal text-fg-primary whitespace-pre-wrap">
                      <TypingText
                        text={replyTextFor(turn.resolution)}
                        animate={freshResolutionIds.has(turn.resolution.id)}
                      />
                    </div>

                    <div
                      className={`flex items-center gap-1 transition-opacity duration-150 ${
                        isLast
                          ? "opacity-100"
                          : "opacity-0 group-hover/agent:opacity-100 focus-within:opacity-100"
                      }`}
                    >
                      <button
                        onClick={() => handleCopy(`a-${turn.resolution!.id}`, replyTextFor(turn.resolution!))}
                        title="Copy"
                        className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                      >
                        {copiedKey === `a-${turn.resolution.id}` ? (
                          <Check size={14} strokeWidth={2} />
                        ) : (
                          <Copy size={14} strokeWidth={1.8} />
                        )}
                      </button>
                      <button
                        onClick={() => handlePlay(turn.resolution!.id, replyTextFor(turn.resolution!))}
                        title={ttsId === turn.resolution.id && ttsStatus === "playing" ? "Stop" : "Play"}
                        className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                      >
                        {ttsId === turn.resolution.id && ttsStatus === "loading" ? (
                          <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />
                        ) : ttsId === turn.resolution.id && ttsStatus === "playing" ? (
                          <Square size={14} strokeWidth={1.8} fill="currentColor" />
                        ) : (
                          <Play size={14} strokeWidth={1.8} />
                        )}
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            onClick={() => handleFeedback(turn.resolution!, "up")}
                            title="Good reply"
                            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 cursor-pointer ${
                              turn.resolution.feedback === "up"
                                ? "text-success bg-success/10"
                                : "text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10"
                            }`}
                          >
                            <ThumbsUp size={14} strokeWidth={1.8} />
                          </button>
                          <button
                            onClick={() => handleFeedback(turn.resolution!, "down")}
                            title="Bad reply"
                            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 cursor-pointer ${
                              turn.resolution.feedback === "down"
                                ? "text-danger bg-danger/10"
                                : "text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10"
                            }`}
                          >
                            <ThumbsDown size={14} strokeWidth={1.8} />
                          </button>
                          {isLast && canAct && (
                            <button
                              onClick={() => handleRetry(turn.signal.id)}
                              title="Retry"
                              className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-fg-subtle/10 transition-colors duration-150 cursor-pointer"
                            >
                              <RefreshCw size={14} strokeWidth={1.8} />
                            </button>
                          )}
                        </>
                      )}
                      {(llmBadge || playedTitle || brightDataUsed) && (
                        <span className="w-px h-4 bg-fg-subtle/20 mx-1" />
                      )}
                      {llmBadge && (
                        <img
                          src={llmBadge.src}
                          title={llmBadge.title}
                          alt={llmBadge.title}
                          className="w-3.5 h-3.5 opacity-80"
                        />
                      )}
                      {playedTitle && (
                        <img
                          src={`${PROVIDER_ICON_BASE}/speechmatics.svg`}
                          title={playedTitle}
                          alt={playedTitle}
                          className="w-3.5 h-3.5 opacity-80"
                        />
                      )}
                      {brightDataUsed && (
                        <img
                          src={`${PROVIDER_ICON_BASE}/brightdata.svg?v=2`}
                          title="This response used the Bright Data API"
                          alt="This response used the Bright Data API"
                          className="w-3.5 h-3.5 rounded-[3px] opacity-90"
                        />
                      )}
                    </div>

                    {brightDataUsed && brightDataSourceUrls.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {brightDataSourceUrls.map((s) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={s.title || s.url}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-fg-subtle/20 text-[11.5px] text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150"
                          >
                            <img src={faviconFor(s.url)} alt="" className="w-3 h-3 rounded-sm" />
                            {domainOf(s.url)}
                          </a>
                        ))}
                      </div>
                    )}

                    {turn.resolution.action === "read_emails" &&
                      !turn.resolution.detail?.error &&
                      ((turn.resolution.detail?.messages as MailMessageSummary[] | undefined) ?? []).length > 0 && (
                        <div className="flex flex-col gap-1 rounded-[14px] border border-fg-subtle/20 px-2 py-1.5">
                          {((turn.resolution.detail?.messages as MailMessageSummary[]).slice(0, 5)).map((m) => (
                            <button
                              key={m.id}
                              onClick={() => setOpenMessageId(m.id)}
                              className="flex items-baseline gap-2 min-w-0 text-left px-2.5 py-1.5 rounded-md hover:bg-fg-subtle/10 cursor-pointer transition-colors duration-150"
                            >
                              <span className="text-[13.5px] text-fg-primary font-medium truncate">
                                {m.headers?.Subject || "(no subject)"}
                              </span>
                              <span className="text-[12px] text-fg-subtle truncate shrink-0">
                                {formatSender(m.headers?.From)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                    {actionCardSpec(turn.resolution) && (
                      <div className="border border-fg-subtle/20 rounded-[14px] px-4 py-3 flex flex-col gap-2">
                        <span className="text-[11.5px] font-semibold tracking-wide uppercase text-fg-subtle">
                          What I did
                        </span>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="w-[7px] h-[7px] rounded-full shrink-0"
                              style={{ background: actionCardSpec(turn.resolution)!.colorVar }}
                            />
                            <span className="text-[13.5px] text-fg-muted truncate">
                              {actionCardSpec(turn.resolution)!.label}
                            </span>
                          </div>
                          <Link
                            to={actionCardSpec(turn.resolution)!.href}
                            className="text-xs font-semibold text-fg-muted hover:text-fg-primary shrink-0"
                          >
                            {actionCardSpec(turn.resolution)!.linkText} →
                          </Link>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              )}
              </div>
              {callEndsHere && <CallDivider kind="end" />}
            </Fragment>
            );
          })}

        {processing && (
          <div className="flex gap-3">
            <div className="w-[30px] h-[30px] min-w-[30px] rounded-full bg-fg-subtle/15 flex items-center justify-center">
              <SineWave state="idle" height={11} className="w-[17px]" />
            </div>
            <div className="bg-fg-subtle/10 rounded-[18px] px-5 py-[13px] flex items-center">
              <ThinkingDots />
            </div>
          </div>
        )}

        {errorText && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
            {errorText}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 sm:px-8 pt-[18px] pb-6">
        <div className="flex items-end gap-2.5 bg-bg-elevated border border-fg-subtle/20 rounded-[18px] pl-2.5 pr-2.5 py-2.5">
          <div ref={attachMenuRef} className="relative shrink-0">
            <button
              onClick={() => setAttachMenuOpen((o) => !o)}
              title="Add"
              disabled={!user || readOnly}
              className={`w-[38px] h-[38px] min-w-[38px] rounded-full border flex items-center justify-center cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                attachMenuOpen
                  ? "border-fg-subtle/40 bg-bg-surface/50 text-fg-primary"
                  : "border-fg-subtle/20 hover:border-fg-subtle/40 text-fg-subtle"
              }`}
            >
              <Plus size={16} strokeWidth={2} />
            </button>

            {attachMenuOpen && (
              <div className="absolute left-0 bottom-[calc(100%+8px)] w-52 bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-lg py-1.5 z-50">
                <div className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-fg-subtle cursor-not-allowed">
                  <ScrollText size={16} strokeWidth={1.8} />
                  <span className="flex-1">Skills</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle/70">Soon</span>
                </div>
                <div className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-fg-subtle cursor-not-allowed">
                  <Users size={16} strokeWidth={1.8} />
                  <span className="flex-1">Subagents</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle/70">Soon</span>
                </div>
                <div className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-fg-subtle cursor-not-allowed">
                  <Upload size={16} strokeWidth={1.8} />
                  <span className="flex-1">Upload</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle/70">Soon</span>
                </div>
              </div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setIsVoiceInput(false);
            }}
            onKeyDown={handleKeyDown}
            disabled={processing || readOnly}
            placeholder={readOnly ? "View only — you can't reply in a shared chat." : "Message Sybil…"}
            rows={1}
            className="flex-1 resize-none bg-transparent border-none outline-none text-fg-primary text-[15px] leading-normal py-2 max-h-40 overflow-y-auto placeholder:text-fg-subtle disabled:opacity-50"
          />
          <button
            onClick={openCall}
            title="Start a live voice call"
            disabled={!user || readOnly}
            data-tour="chat-call"
            className="w-[38px] h-[38px] min-w-[38px] rounded-full border border-fg-subtle/20 hover:border-fg-subtle/40 text-fg-subtle flex items-center justify-center cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Phone size={16} strokeWidth={2} />
          </button>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            title="Voice input"
            disabled={!user || readOnly}
            data-tour="chat-transcribe"
            className={`w-[38px] h-[38px] min-w-[38px] rounded-full border flex items-center justify-center cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              isRecording
                ? "border-sine-cyan bg-sine-cyan/12 text-sine-cyan"
                : "border-fg-subtle/20 hover:border-fg-subtle/40 text-fg-subtle"
            }`}
          >
            <Mic size={16} strokeWidth={2} />
          </button>
          <button
            onClick={handleSend}
            disabled={processing || !input.trim() || readOnly}
            title="Send"
            className="w-[38px] h-[38px] min-w-[38px] rounded-full border-none bg-fg-accent flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUp size={16} strokeWidth={2} stroke="#0D1114" />
          </button>
        </div>
        <p className="text-[11.5px] text-fg-subtle mt-2 pl-1">
          {voiceError ??
            "Sybil can read your mail and calendar, and act on the sentinels you set. Verify before it matters."}
        </p>
      </div>

      <EmailDetailModal messageId={openMessageId} onClose={() => setOpenMessageId(null)} />

      {callOpen && (
        <CallOverlay
          state={voiceCall.state}
          liveTranscript={voiceCall.liveTranscript}
          onEndTurn={voiceCall.endTurnNow}
          onClose={closeCall}
        />
      )}
    </div>
  );
}
