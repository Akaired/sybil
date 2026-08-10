import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, MoreHorizontal } from "lucide-react";
import {
  Ban,
  Mail as MailIcon,
  Hash,
  Users2,
  FileText,
  MessageSquare,
  Workflow,
  KanbanSquare,
  Receipt,
} from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { supabase } from "../../config/supabase";
import { fetchOauthStatus, startGoogleOauth, type OauthStatusResponse } from "../../lib/calendar";
import { createTelegramLinkCode, fetchTelegramLinkStatus, unlinkTelegram, type TelegramLinkStatus } from "../../lib/telegramLink";
import SettingsSection from "../../components/settings/SettingsSection";
import ComingSoonBadge from "../../components/settings/ComingSoonBadge";
import Modal from "../../components/Modal";

const PROVIDER_ICON_BASE =
  "https://uhrqlwoejawnnhdeabob.supabase.co/storage/v1/object/public/brand-assets/providers";

const TELEGRAM_BOT_USERNAME =
  (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) || "sybil_agent_bot";

function mapError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = raw.toLowerCase();
  if (lower.includes("network")) return "Network error — check your connection and try again.";
  if (lower.includes("popup")) return "Couldn't open the Google sign-in window — check your popup blocker.";
  if (raw) return raw;
  return fallback;
}

// ── Toggle ───────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  saving,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  saving?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || saving}
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-150 ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-warning" : "bg-fg-subtle/20"} ${saving ? "opacity-60" : ""}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── Status badge (shared by the Available integrations cards) ──────────

type CardState = "loading" | "connected" | "pending" | "not_connected";

function StatusBadge({ state }: { state: CardState }) {
  if (state === "loading") {
    return (
      <span className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[11px] bg-fg-subtle/10 border border-fg-subtle/30 text-fg-subtle">
        …
      </span>
    );
  }
  if (state === "connected") {
    return (
      <span className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[11px] bg-success/10 border border-success/25 text-success">
        Connected
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[11px] bg-warning/10 border border-warning/30 text-warning">
        Pending
      </span>
    );
  }
  return (
    <span className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[11px] bg-fg-subtle/10 border border-fg-subtle/30 text-fg-subtle">
      Not connected
    </span>
  );
}

// ── Real brand logos (inline SVG — no storage round-trip needed) ───────

function GoogleLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
        c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
        c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039
        l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
        c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
        c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24
        C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}

function TelegramLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="120" cy="120" r="120" fill="#229ED9" />
      <path
        fill="#fff"
        d="M98.5 172c-3.7 0-3.1-1.4-4.4-4.9L83 130.4l90.4-53.7c4.2-2.5 8 .6 6.5 6.8l-15.4 76.3c-1 5.1-4 6.3-8.2 3.9l-22.7-16.8-11 10.6c-1.2 1.2-2.2 2.2-4.5 2.2z"
      />
    </svg>
  );
}

// ── Google account — hook + compact card + settings modal ──────────────

interface AgentPerms {
  calendar_enabled: boolean | null;
  gmail_enabled: boolean | null;
}

function useGoogleAccount() {
  const { user } = useContext(AuthContext);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<OauthStatusResponse | null>(null);
  const [perms, setPerms] = useState<AgentPerms>({ calendar_enabled: null, gmail_enabled: null });
  const [permsSupported, setPermsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [savingPerm, setSavingPerm] = useState<"calendar" | "gmail" | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const google = status?.connections?.google;
  const connected = Boolean(google?.connected && !google?.expired);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [oauthStatus, connRow] = await Promise.all([
        fetchOauthStatus(),
        supabase
          .from("sybil_oauth_connections")
          .select("calendar_enabled, gmail_enabled")
          .eq("user_id", user.id)
          .eq("provider", "google")
          .maybeSingle(),
      ]);
      setStatus(oauthStatus);
      if (connRow.error || !connRow.data || connRow.data.calendar_enabled === undefined) {
        setPermsSupported(!connRow.error);
        setPerms({ calendar_enabled: null, gmail_enabled: null });
      } else {
        setPermsSupported(true);
        setPerms({
          calendar_enabled: connRow.data.calendar_enabled ?? true,
          gmail_enabled: connRow.data.gmail_enabled ?? true,
        });
      }
    } catch (err) {
      setError(mapError(err, "Couldn't load your Google connection status."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { authorization_url } = await startGoogleOauth("/settings/connections");
      const popup = window.open(authorization_url, "sybil-google-oauth", "width=520,height=680");
      if (!popup) {
        window.location.href = authorization_url;
        return;
      }
      const poll = setInterval(() => {
        if (popup.closed) {
          clearInterval(poll);
          setConnecting(false);
          refresh();
        }
      }, 500);
    } catch (err) {
      setError(mapError(err, "Couldn't start the Google connection."));
      setConnecting(false);
    }
  }, [refresh]);

  const handleTogglePerm = useCallback(
    async (key: "calendar_enabled" | "gmail_enabled") => {
      if (!user || perms[key] === null) return;
      const prev = perms[key] as boolean;
      const permKind = key === "calendar_enabled" ? "calendar" : "gmail";
      setSavingPerm(permKind);
      setError(null);
      setPerms((p) => ({ ...p, [key]: !prev }));
      try {
        const { error: updateError } = await supabase
          .from("sybil_oauth_connections")
          .update({ [key]: !prev })
          .eq("user_id", user.id)
          .eq("provider", "google");
        if (updateError) throw updateError;
      } catch (err) {
        setPerms((p) => ({ ...p, [key]: prev }));
        setError(mapError(err, "Couldn't save that permission change."));
      } finally {
        setSavingPerm(null);
      }
    },
    [user, perms],
  );

  const handleDisconnect = useCallback(async () => {
    if (!user) return;
    setDisconnecting(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from("sybil_oauth_connections")
        .delete()
        .eq("user_id", user.id)
        .eq("provider", "google");
      if (deleteError) throw deleteError;
      await refresh();
      return true;
    } catch (err) {
      setError(mapError(err, "Couldn't disconnect your Google account."));
      return false;
    } finally {
      setDisconnecting(false);
    }
  }, [user, refresh]);

  return {
    loading,
    connected,
    google,
    perms,
    permsSupported,
    error,
    connecting,
    savingPerm,
    disconnecting,
    handleConnect,
    handleTogglePerm,
    handleDisconnect,
  };
}

type UseGoogleAccount = ReturnType<typeof useGoogleAccount>;

function GoogleSettingsModalContent({ g }: { g: UseGoogleAccount }) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  if (g.loading) {
    return (
      <div className="flex items-center gap-2.5 text-fg-subtle text-[13.5px]">
        <Loader2 size={15} strokeWidth={2.2} className="animate-spin" />
        Checking connection…
      </div>
    );
  }

  if (!g.connected) {
    return (
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-fg-primary font-medium">Not connected</p>
            <p className="text-[13px] text-fg-subtle mt-0.5">
              Connect Google to let Sybil read your calendar and email.
            </p>
          </div>
          <button
            type="button"
            onClick={g.handleConnect}
            disabled={g.connecting}
            className="shrink-0 inline-flex items-center gap-2 bg-warning text-bg-base text-[13px] font-semibold rounded-md px-4 py-2 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {g.connecting && <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />}
            Connect Google
          </button>
        </div>
        {g.error && (
          <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
            <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
            {g.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-fg-primary font-medium">{g.google?.email || "Connected"}</p>
          <p className="text-[13px] text-success mt-0.5">Connected</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-fg-subtle/10">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mb-3">Agent permissions</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13.5px] text-fg-primary">Google Calendar</p>
              <p className="text-[12.5px] text-fg-subtle mt-0.5">Sybil can read your schedule and create events.</p>
            </div>
            {g.permsSupported ? (
              <Toggle
                checked={g.perms.calendar_enabled ?? false}
                onChange={() => g.handleTogglePerm("calendar_enabled")}
                saving={g.savingPerm === "calendar"}
                label="Google Calendar agent permission"
              />
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <ComingSoonBadge />
                <Toggle checked={false} onChange={() => {}} disabled label="Google Calendar agent permission" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13.5px] text-fg-primary">Gmail</p>
              <p className="text-[12.5px] text-fg-subtle mt-0.5">Sybil can read and send email on your behalf.</p>
            </div>
            {g.permsSupported ? (
              <Toggle
                checked={g.perms.gmail_enabled ?? false}
                onChange={() => g.handleTogglePerm("gmail_enabled")}
                saving={g.savingPerm === "gmail"}
                label="Gmail agent permission"
              />
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <ComingSoonBadge />
                <Toggle checked={false} onChange={() => {}} disabled label="Gmail agent permission" />
              </div>
            )}
          </div>
        </div>
        <p className="text-[12px] text-fg-subtle mt-3">
          These only control what the agent is allowed to use — turning them off doesn't disconnect your Google
          account.
        </p>
      </div>

      <div className="mt-4 pt-4 border-t border-fg-subtle/10">
        {!confirmDisconnect ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="bg-danger text-white text-[12.5px] font-medium rounded-md px-3.5 py-2 hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            Disconnect Google account
          </button>
        ) : (
          <div className="bg-danger/[0.06] border border-danger/25 rounded-md px-3.5 py-3">
            <p className="text-[12.5px] text-fg-primary flex items-start gap-1.5">
              <AlertTriangle size={13} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
              This revokes Google access entirely — Calendar and Gmail will both stop working until you reconnect.
              Are you sure?
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              <button
                type="button"
                onClick={async () => {
                  const ok = await g.handleDisconnect();
                  if (ok) setConfirmDisconnect(false);
                }}
                disabled={g.disconnecting}
                className="inline-flex items-center gap-1.5 bg-danger text-white text-[12.5px] font-medium rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 cursor-pointer"
              >
                {g.disconnecting && <Loader2 size={12} strokeWidth={2.2} className="animate-spin" />}
                Yes, disconnect
              </button>
              <button
                type="button"
                onClick={() => setConfirmDisconnect(false)}
                disabled={g.disconnecting}
                className="text-[12.5px] text-fg-subtle hover:text-fg-primary transition-colors duration-150 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {g.error && (
        <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
          <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
          {g.error}
        </p>
      )}
    </div>
  );
}

function GoogleIntegrationCard() {
  const g = useGoogleAccount();
  const [modalOpen, setModalOpen] = useState(false);

  const state: CardState = g.loading ? "loading" : g.connected ? "connected" : "not_connected";

  return (
    <>
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="w-10 h-10 rounded-lg bg-white/95 flex items-center justify-center p-2 shrink-0">
            <GoogleLogo className="w-full h-full" />
          </div>
          <StatusBadge state={state} />
        </div>
        <div>
          <p className="text-sm text-fg-primary font-medium">Google</p>
          <p className="text-[12.5px] text-fg-subtle mt-0.5 truncate">
            {g.connected ? g.google?.email || "Connected" : "Let Sybil read your calendar and email."}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2">
          {g.connected ? (
            <button
              type="button"
              disabled
              className="flex-1 border border-success/25 bg-success/10 text-success rounded-md px-3 py-1.5 text-[12.5px] font-medium text-center cursor-default"
            >
              Connected
            </button>
          ) : (
            <button
              type="button"
              onClick={g.handleConnect}
              disabled={g.connecting || g.loading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-warning text-bg-base text-[12.5px] font-semibold rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {g.connecting && <Loader2 size={13} strokeWidth={2.2} className="animate-spin" />}
              Connect Google
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="Google settings"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-fg-subtle/25 text-fg-subtle hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Google account">
        <GoogleSettingsModalContent g={g} />
      </Modal>
    </>
  );
}

// ── Telegram link — hook + compact card + settings modal ───────────────

type TgState = "loading" | "not_connected" | "creating" | "pending" | "connected" | "timeout";

const POLL_INTERVAL_MS = 3000;
// Matches the code's real server-side TTL (10 min, see telegram-link's
// CODE_TTL_MS) — stopping the poll earlier than the code actually expires
// would show a misleading "Try again" while /start <code> would still work.
const POLL_MAX_ATTEMPTS = 200; // 200 * 3s = 600s = 10 min

function useTelegramLink() {
  const [state, setState] = useState<TgState>("loading");
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [linkedAt, setLinkedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyStatus = useCallback((s: TelegramLinkStatus) => {
    if (s.state === "connected") {
      setState("connected");
      setUsername(s.telegram_username);
      setLinkedAt(s.linked_at);
      return;
    }
    if (s.state === "pending") {
      setCode(s.code);
      setExpiresAt(s.expires_at);
      setState((prev) => (prev === "timeout" ? "timeout" : "pending"));
      return;
    }
    setState("not_connected");
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    attemptsRef.current = 0;
    pollRef.current = window.setInterval(async () => {
      attemptsRef.current += 1;
      const s = await fetchTelegramLinkStatus().catch(() => null);
      if (s?.state === "connected") {
        setState("connected");
        setUsername(s.telegram_username);
        setLinkedAt(s.linked_at);
        stopPolling();
        return;
      }
      if (attemptsRef.current >= POLL_MAX_ATTEMPTS) {
        stopPolling();
        setState("timeout"); // stop pinging the server forever — no infinite polling left hanging
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchTelegramLinkStatus();
      applyStatus(s);
      if (s.state === "pending" && pollRef.current === null) startPolling();
      setError(null);
    } catch (err) {
      setError(mapError(err, "Couldn't load your Telegram connection status."));
      setState("not_connected");
    }
  }, [applyStatus, startPolling]);

  useEffect(() => {
    refresh();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    setState("creating");
    setError(null);
    try {
      const { code: newCode, expires_at } = await createTelegramLinkCode();
      setCode(newCode);
      setExpiresAt(expires_at);
      window.open(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${newCode}`, "_blank", "noopener,noreferrer");
      setState("pending");
      startPolling();
    } catch (err) {
      setError(mapError(err, "Couldn't generate a Telegram link code."));
      setState("not_connected");
    }
  }, [startPolling]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await unlinkTelegram();
      stopPolling();
      setState("not_connected");
      setCode(null);
      setUsername(null);
      setLinkedAt(null);
      return true;
    } catch (err) {
      setError(mapError(err, "Couldn't disconnect Telegram."));
      return false;
    } finally {
      setDisconnecting(false);
    }
  }, [stopPolling]);

  return { state, code, expiresAt, username, linkedAt, error, disconnecting, connect, disconnect };
}

type UseTelegramLink = ReturnType<typeof useTelegramLink>;

function useCountdown(expiresAt: string | null, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  const remainingSec = expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");
  return { mm, ss, remainingSec };
}

function CopyCodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="w-full flex items-center justify-between gap-2 bg-bg-base border border-fg-subtle/20 rounded-md px-3 py-2 hover:border-fg-subtle/35 transition-colors duration-150 cursor-pointer"
    >
      <span className="font-mono text-sm tracking-widest text-fg-primary">{code}</span>
      {copied ? (
        <Check size={14} strokeWidth={2.2} className="text-success shrink-0" />
      ) : (
        <Copy size={14} strokeWidth={2} className="text-fg-subtle shrink-0" />
      )}
    </button>
  );
}

function TelegramSettingsModalContent({ t }: { t: UseTelegramLink }) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { mm, ss, remainingSec } = useCountdown(t.expiresAt, t.state === "pending");

  if (t.state === "loading") {
    return (
      <div className="flex items-center gap-2.5 text-fg-subtle text-[13.5px]">
        <Loader2 size={15} strokeWidth={2.2} className="animate-spin" />
        Checking connection…
      </div>
    );
  }

  if (t.state === "connected") {
    return (
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-fg-primary font-medium">{t.username ? `@${t.username}` : "Connected"}</p>
            <p className="text-[13px] text-success mt-0.5">
              Connected{t.linkedAt ? ` · ${new Date(t.linkedAt).toLocaleDateString()}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-fg-subtle/10">
          {!confirmDisconnect ? (
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              className="bg-danger text-white text-[12.5px] font-medium rounded-md px-3.5 py-2 hover:opacity-90 transition-opacity duration-150 cursor-pointer"
            >
              Disconnect Telegram
            </button>
          ) : (
            <div className="bg-danger/[0.06] border border-danger/25 rounded-md px-3.5 py-3">
              <p className="text-[12.5px] text-fg-primary flex items-start gap-1.5">
                <AlertTriangle size={13} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
                Sybil will stop responding to messages from this Telegram chat. Are you sure?
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await t.disconnect();
                    if (ok) setConfirmDisconnect(false);
                  }}
                  disabled={t.disconnecting}
                  className="inline-flex items-center gap-1.5 bg-danger text-white text-[12.5px] font-medium rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 cursor-pointer"
                >
                  {t.disconnecting && <Loader2 size={12} strokeWidth={2.2} className="animate-spin" />}
                  Yes, disconnect
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  disabled={t.disconnecting}
                  className="text-[12.5px] text-fg-subtle hover:text-fg-primary transition-colors duration-150 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {t.error && (
          <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
            <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
            {t.error}
          </p>
        )}
      </div>
    );
  }

  if (t.state === "pending" && t.code) {
    return (
      <div>
        <p className="text-sm text-fg-primary font-medium">Waiting for confirmation…</p>
        <p className="text-[13px] text-fg-subtle mt-0.5">
          A Telegram tab should have opened. If it didn't, send this code to{" "}
          <span className="font-medium text-fg-primary">@{TELEGRAM_BOT_USERNAME}</span> yourself as{" "}
          <span className="font-mono">/start {t.code}</span>.
        </p>
        <div className="mt-3">
          <CopyCodeBox code={t.code} />
        </div>
        <p className="text-[12px] text-fg-subtle mt-2">
          Code expires in {mm}:{ss}
          {remainingSec === 0 ? " — expired, generate a new one." : "."}
        </p>
        {t.error && (
          <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
            <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
            {t.error}
          </p>
        )}
      </div>
    );
  }

  // not_connected or timeout
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-fg-primary font-medium">
            {t.state === "timeout" ? "Still not confirmed" : "Not connected"}
          </p>
          <p className="text-[13px] text-fg-subtle mt-0.5">
            {t.state === "timeout"
              ? "The link wasn't confirmed in time. Generate a new code and try again."
              : `Chat with Sybil and get sentinel alerts from @${TELEGRAM_BOT_USERNAME} on Telegram.`}
          </p>
        </div>
        <button
          type="button"
          onClick={t.connect}
          disabled={t.state === "creating"}
          className="shrink-0 inline-flex items-center gap-2 bg-warning text-bg-base text-[13px] font-semibold rounded-md px-4 py-2 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {t.state === "creating" && <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />}
          {t.state === "timeout" ? "Try again" : "Connect Telegram"}
        </button>
      </div>
      {t.error && (
        <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
          <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
          {t.error}
        </p>
      )}
    </div>
  );
}

function TelegramIntegrationCard() {
  const t = useTelegramLink();
  const [modalOpen, setModalOpen] = useState(false);
  const { mm, ss } = useCountdown(t.expiresAt, t.state === "pending");

  const badgeState: CardState =
    t.state === "loading"
      ? "loading"
      : t.state === "connected"
        ? "connected"
        : t.state === "pending"
          ? "pending"
          : "not_connected";

  return (
    <>
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="w-10 h-10 rounded-lg bg-white/95 flex items-center justify-center p-2 shrink-0">
            <TelegramLogo className="w-full h-full" />
          </div>
          <StatusBadge state={badgeState} />
        </div>
        <div>
          <p className="text-sm text-fg-primary font-medium">Telegram</p>
          <p className="text-[12.5px] text-fg-subtle mt-0.5 truncate">
            {t.state === "connected"
              ? t.username
                ? `@${t.username}`
                : "Connected"
              : t.state === "pending"
                ? `Waiting… ${mm}:${ss} left`
                : "Chat with Sybil and get alerts from a Telegram bot."}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2">
          {t.state === "connected" ? (
            <button
              type="button"
              disabled
              className="flex-1 border border-success/25 bg-success/10 text-success rounded-md px-3 py-1.5 text-[12.5px] font-medium text-center cursor-default"
            >
              Connected
            </button>
          ) : t.state === "pending" ? (
            <button
              type="button"
              disabled
              className="flex-1 inline-flex items-center justify-center gap-1.5 border border-warning/30 bg-warning/10 text-warning rounded-md px-3 py-1.5 text-[12.5px] font-medium cursor-default"
            >
              <Loader2 size={13} strokeWidth={2.2} className="animate-spin" />
              Waiting…
            </button>
          ) : (
            <button
              type="button"
              onClick={t.connect}
              disabled={t.state === "creating" || t.state === "loading"}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-warning text-bg-base text-[12.5px] font-semibold rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {t.state === "creating" && <Loader2 size={13} strokeWidth={2.2} className="animate-spin" />}
              {t.state === "timeout" ? "Try again" : "Connect Telegram"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="Telegram settings"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-fg-subtle/25 text-fg-subtle hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Telegram">
        <TelegramSettingsModalContent t={t} />
      </Modal>
    </>
  );
}

// ── Available integrations (Google + Telegram — the real ones) ─────────

function AvailableIntegrationsSection() {
  return (
    <SettingsSection title="Available integrations" description="Connect Sybil to the tools you already use.">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <GoogleIntegrationCard />
        <TelegramIntegrationCard />
      </div>
    </SettingsSection>
  );
}

// ── Infrastructure ────────────────────────────────────────────────────

interface InfraProviderDef {
  name: string;
  logo: string;
  role: string;
  description: string;
  /** Speechmatics' SVG is filled pure white — invert so it reads on the white logo chip. */
  invert?: boolean;
  /** OpenRouter's mark is lime-on-transparent, designed for a dark backdrop — a white chip washes it out. */
  darkChip?: boolean;
}

const INFRA_PROVIDERS: InfraProviderDef[] = [
  {
    name: "Bright Data",
    logo: `${PROVIDER_ICON_BASE}/brightdata.svg`,
    role: "Web observation",
    description: "Runs Sybil's web search, page visits, and deeper research queries.",
  },
  {
    name: "Speechmatics",
    logo: `${PROVIDER_ICON_BASE}/speechmatics.svg`,
    role: "Voice",
    description: "Real-time speech transcription and text-to-speech for voice input.",
    invert: true,
  },
  {
    name: "AI/ML API",
    logo: `${PROVIDER_ICON_BASE}/aiml.svg`,
    role: "Language model",
    description: "Hosts the primary model Sybil uses to reason about your work.",
  },
  {
    name: "OpenRouter",
    logo: `${PROVIDER_ICON_BASE}/openrouter.svg`,
    role: "Model routing",
    description: "Fallback and specialized routing across additional models.",
    darkChip: true,
  },
];

function InfrastructureSection() {
  return (
    <SettingsSection
      title="Infrastructure"
      description="Third-party services Sybil runs on under the hood — informational only, nothing to configure here."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {INFRA_PROVIDERS.map((provider) => (
          <div
            key={provider.name}
            className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center p-2 shrink-0 ${
                  provider.darkChip ? "bg-bg-base" : "bg-white/95"
                }`}
              >
                <img
                  src={provider.logo}
                  alt={provider.name}
                  className={`w-full h-full object-contain ${provider.invert ? "invert" : ""}`}
                />
              </div>
              <span className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[11px] bg-success/10 border border-success/25 text-success">
                Active
              </span>
            </div>
            <div>
              <p className="text-sm text-fg-primary font-medium">{provider.name}</p>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle mt-1">
                {provider.role}
              </p>
              <p className="text-[12.5px] text-fg-subtle mt-1.5">{provider.description}</p>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

// ── Future integrations grid ──────────────────────────────────────────

interface IntegrationDef {
  name: string;
  description: string;
  icon: React.ReactNode;
}

const INTEGRATIONS: IntegrationDef[] = [
  { name: "Inbound email", description: "Forward an inbox to Sybil and it turns messages into signals.", icon: <MailIcon size={18} strokeWidth={1.6} /> },
  { name: "Slack", description: "Bring Sybil into your team's Slack workspace.", icon: <Hash size={18} strokeWidth={1.6} /> },
  { name: "LinkedIn", description: "Track mentions and messages from your LinkedIn presence.", icon: <Users2 size={18} strokeWidth={1.6} /> },
  { name: "Notion", description: "Sync tasks and notes with your Notion workspace.", icon: <FileText size={18} strokeWidth={1.6} /> },
  { name: "WhatsApp", description: "Chat with Sybil over WhatsApp Business.", icon: <MessageSquare size={18} strokeWidth={1.6} /> },
  { name: "n8n", description: "Trigger and be triggered by your n8n automations.", icon: <Workflow size={18} strokeWidth={1.6} /> },
  { name: "Jira", description: "Turn signals into Jira issues and track their status.", icon: <KanbanSquare size={18} strokeWidth={1.6} /> },
  { name: "Trello", description: "Keep a Trello board in sync with Sybil's task list.", icon: <KanbanSquare size={18} strokeWidth={1.6} /> },
  { name: "Outlook", description: "Connect Outlook mail and calendar as an alternative to Google.", icon: <MailIcon size={18} strokeWidth={1.6} /> },
  { name: "Italian e-invoicing", description: "Send and track fatture elettroniche via SDI.", icon: <Receipt size={18} strokeWidth={1.6} /> },
];

function IntegrationsGrid() {
  return (
    <SettingsSection title="More integrations" description="Coming to Sybil soon.">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {INTEGRATIONS.map((integration) => (
          <div
            key={integration.name}
            className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="w-9 h-9 rounded-lg bg-fg-subtle/10 flex items-center justify-center text-fg-muted shrink-0">
                {integration.icon}
              </div>
              <ComingSoonBadge />
            </div>
            <div>
              <p className="text-sm text-fg-primary font-medium">{integration.name}</p>
              <p className="text-[12.5px] text-fg-subtle mt-0.5">{integration.description}</p>
            </div>
            <button
              type="button"
              disabled
              className="mt-auto w-full border border-fg-subtle/25 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-fg-subtle cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Ban size={12} strokeWidth={2} />
              Not available yet
            </button>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

export default function SettingsConnections() {
  return (
    <div>
      <AvailableIntegrationsSection />
      <InfrastructureSection />
      <IntegrationsGrid />
    </div>
  );
}
