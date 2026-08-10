import { useCallback, useEffect, useState } from "react";
import { Globe, Mail, Target, Plus, RefreshCw, Settings, Search } from "lucide-react";
import { supabase } from "../config/supabase";
import SineWave from "../components/SineWave";
import NewSentinelModal from "../components/NewSentinelModal";
import EditSentinelModal from "../components/EditSentinelModal";

// ── Types ────────────────────────────────────────────────────

interface Sentinel {
  id: string;
  condition_text: string;
  type: "web" | "email" | "internal";
  status: "active" | "paused" | "triggered" | "error";
  frequency_min: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  config: { target?: string | null } | null;
  created_at: string;
  last_error: string | null;
  last_error_at: string | null;
}

interface WakeEvent {
  sentinel_id: string;
  diff_summary: string;
  evidence_url: string | null;
  created_at: string;
}

type SentinelCheckResult =
  | { kind: "no_change" }
  | { kind: "baseline" }
  | { kind: "triggered"; summary: string; evidence_url: string | null; evidence_snippet: string | null }
  | { kind: "changed_not_triggered"; detail: string }
  | { kind: "error"; detail: string };

// ── Helpers ──────────────────────────────────────────────────

const statusLabel: Record<Sentinel["status"], string> = {
  active: "Active",
  paused: "Paused",
  triggered: "Triggered",
  error: "Error",
};

const statusDot: Record<Sentinel["status"], string> = {
  active: "bg-success",
  paused: "bg-fg-subtle",
  triggered: "bg-warning",
  error: "bg-danger",
};

const typeLabel: Record<Sentinel["type"], string> = {
  web: "Web",
  email: "Email",
  internal: "Internal",
};

const typeAccent: Record<Sentinel["type"], string> = {
  web: "text-sine-cyan",
  email: "text-sine-indigo",
  internal: "text-sine-acid",
};

const typeIcon: Record<Sentinel["type"], React.ReactNode> = {
  web: <Globe size={17} strokeWidth={1.6} />,
  email: <Mail size={17} strokeWidth={1.6} />,
  internal: <Target size={17} strokeWidth={1.6} />,
};

function formatFrequency(min: number): string {
  if (min < 60) return `${min}m`;
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const past = diffMin < 0;
  const abs = Math.abs(diffMin);
  const label = abs < 60 ? `${abs}m` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return past ? `${label} ago` : `in ${label}`;
}

function formatCountdown(iso: string | null, now: number): string {
  if (!iso) return "—";
  const diffMs = new Date(iso).getTime() - now;
  if (diffMs <= 0) return "due now";
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Component ────────────────────────────────────────────────

export default function Sentinels() {
  const [sentinels, setSentinels] = useState<Sentinel[]>([]);
  const [latestEvents, setLatestEvents] = useState<Record<string, WakeEvent>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Sentinel | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [checkingSentinel, setCheckingSentinel] = useState<Record<string, boolean>>({});
  const [sentinelCheckResults, setSentinelCheckResults] = useState<Record<string, SentinelCheckResult>>({});

  useEffect(() => {
    const hasActive = sentinels.some((s) => s.status === "active");
    if (!hasActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sentinels]);

  const fetchSentinels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: err } = await supabase
        .from("sybil_sentinels")
        .select("*")
        .order("created_at", { ascending: false });

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const list = data ?? [];
      setSentinels(list);

      const ids = list.map((s) => s.id);
      if (ids.length > 0) {
        const { data: events } = await supabase
          .from("sybil_wake_events")
          .select("sentinel_id, diff_summary, evidence_url, created_at")
          .in("sentinel_id", ids)
          .order("created_at", { ascending: false });

        const latest: Record<string, WakeEvent> = {};
        for (const ev of events ?? []) {
          if (!latest[ev.sentinel_id]) latest[ev.sentinel_id] = ev;
        }
        setLatestEvents(latest);
      } else {
        setLatestEvents({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSentinels();
  }, [fetchSentinels]);

  async function toggleStatus(sentinel: Sentinel) {
    const newStatus: Sentinel["status"] =
      sentinel.status === "active" ? "paused" : "active";

    setToggling((prev) => ({ ...prev, [sentinel.id]: true }));
    setToggleErrors((prev) => {
      const next = { ...prev };
      delete next[sentinel.id];
      return next;
    });

    const { error: err } = await supabase
      .from("sybil_sentinels")
      .update({ status: newStatus })
      .eq("id", sentinel.id);

    if (err) {
      setToggleErrors((prev) => ({
        ...prev,
        [sentinel.id]: `Permission denied: you can't modify this sentinel.`,
      }));
    } else {
      setSentinels((prev) =>
        prev.map((s) =>
          s.id === sentinel.id ? { ...s, status: newStatus } : s,
        ),
      );
    }
    setToggling((prev) => ({ ...prev, [sentinel.id]: false }));
  }

  // Runs the real sentinel-check edge function — it scans every active
  // sentinel whose next_check_at is due (there's no scheduler wired up yet,
  // so this is currently the only way any sentinel actually gets checked).
  async function runChecksNow() {
    setRunningChecks(true);
    setCheckResult(null);

    const { data, error: err } = await supabase.functions.invoke("sentinel-check");

    if (err) {
      setCheckResult(`Check failed: ${err.message}`);
    } else if (data?.message === "No sentinels due") {
      setCheckResult("No sentinels were due for a check.");
    } else {
      setCheckResult(
        `Checked ${data?.checked ?? 0} sentinel(s), ${data?.triggered ?? 0} triggered.`,
      );
      await fetchSentinels();
    }
    setRunningChecks(false);
  }

  // Checks a single sentinel immediately, bypassing the due-schedule filter —
  // the { sentinel_id } path on sentinel-check.
  async function checkSentinelNow(sentinel: Sentinel) {
    setCheckingSentinel((prev) => ({ ...prev, [sentinel.id]: true }));
    setSentinelCheckResults((prev) => {
      const next = { ...prev };
      delete next[sentinel.id];
      return next;
    });

    const { data, error: err } = await supabase.functions.invoke("sentinel-check", {
      body: { sentinel_id: sentinel.id },
    });

    if (err) {
      setSentinelCheckResults((prev) => ({
        ...prev,
        [sentinel.id]: { kind: "error", detail: err.message },
      }));
    } else {
      const result = data?.results?.[0];
      let mapped: SentinelCheckResult;
      switch (result?.status) {
        case "unchanged":
          mapped = { kind: "no_change" };
          break;
        case "baseline_stored":
          mapped = { kind: "baseline" };
          break;
        case "triggered":
          mapped = {
            kind: "triggered",
            summary: result.detail?.summary ?? "Condition matched.",
            evidence_url: result.detail?.evidence_url ?? null,
            evidence_snippet: result.detail?.evidence_snippet ?? null,
          };
          break;
        case "changed_not_triggered":
          mapped = { kind: "changed_not_triggered", detail: result.detail ?? "Content changed, but the condition wasn't met." };
          break;
        default:
          mapped = { kind: "error", detail: typeof result?.detail === "string" ? result.detail : "Check failed." };
      }
      setSentinelCheckResults((prev) => ({ ...prev, [sentinel.id]: mapped }));
      await fetchSentinels();
    }
    setCheckingSentinel((prev) => ({ ...prev, [sentinel.id]: false }));
  }

  const activeCount = sentinels.filter((s) => s.status === "active").length;
  const SENTINEL_LIMIT = 3;
  const atLimit = sentinels.length >= SENTINEL_LIMIT;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-fg-primary">Sentinels</h1>
          {!loading && sentinels.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/12 border border-success/35 font-mono text-xs text-success">
              {activeCount} active
            </span>
          )}
          {!loading && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-fg-subtle/10 border border-fg-subtle/25 font-mono text-xs text-fg-muted">
              {Math.max(SENTINEL_LIMIT - sentinels.length, 0)} / {SENTINEL_LIMIT}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={runChecksNow}
            disabled={runningChecks}
            title="No scheduler is wired up yet — this is the only way sentinels get checked today."
            aria-label="Check now"
            className="flex items-center justify-center w-9 h-9 rounded-full border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={15} strokeWidth={2} className={runningChecks ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setModalOpen(true)}
            disabled={atLimit}
            title={atLimit ? `You've reached the limit of ${SENTINEL_LIMIT} sentinels. Delete one to create a new one.` : undefined}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-success text-bg-base text-sm font-semibold hover:bg-success/90 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-success"
          >
            <Plus size={14} strokeWidth={2.5} />
            New sentinel
          </button>
        </div>
      </div>
      <p className="text-fg-muted text-sm mb-3">
        Sentinels monitor conditions and alert you when something happens.
        Create one by asking in chat, or from the button above. You can have up to{" "}
        {SENTINEL_LIMIT} sentinels at a time.
      </p>

      {atLimit && !loading && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-2.5 mb-5 text-sm text-fg-primary">
          You've reached the limit of {SENTINEL_LIMIT} sentinels. Delete one to create a new one.
        </div>
      )}

      {checkResult && (
        <div className="bg-fg-subtle/10 border border-fg-subtle/25 rounded-lg px-4 py-2.5 mb-5 text-sm text-fg-muted">
          {checkResult}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-6 text-sm text-fg-primary">
          Failed to load: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-3 text-fg-muted py-8">
          <div data-sybil-state="thinking">
            <SineWave height={24} className="w-24" />
          </div>
          <span className="text-sm animate-pulse">Loading sentinels…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && sentinels.length === 0 && (
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-6 py-10 text-center">
          <div data-sybil-state="idle" className="mb-4 inline-block">
            <SineWave height={32} className="w-32" />
          </div>
          <p className="text-fg-muted text-sm">No active sentinels yet.</p>
          <p className="text-fg-subtle text-xs mt-1">
            Go to Chat and ask Sybil to monitor something, or create one above.
          </p>
        </div>
      )}

      {/* Sentinel cards */}
      {!loading && sentinels.length > 0 && (
        <div className="flex flex-col gap-3.5 mb-10">
          {sentinels.map((s) => {
            const event = latestEvents[s.id];
            return (
              <div
                key={s.id}
                id={`sentinel-${s.id}`}
                className="bg-bg-elevated border border-fg-subtle/15 rounded-xl px-5 py-[18px] flex flex-col sm:flex-row gap-4 sm:items-start transition-colors duration-150 hover:border-fg-subtle/25 scroll-mt-6"
              >
                <div className="flex gap-4 flex-1 min-w-0">
                  {/* Type icon badge — discreet, low-saturation background */}
                  <div
                    className={`w-9 h-9 rounded-lg bg-fg-subtle/10 flex items-center justify-center shrink-0 ${typeAccent[s.type]}`}
                  >
                    {typeIcon[s.type]}
                  </div>

                  <div className="flex-1 min-w-0">
                  {/* Name + status */}
                  <div className="flex items-center gap-2.5 flex-wrap mb-0.5">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${statusDot[s.status]} ${s.status === "active" ? "animate-pulse" : ""}`}
                    />
                    <span className="text-[15px] font-semibold text-fg-primary">
                      {s.condition_text}
                    </span>
                    <span className="text-fg-subtle/40">·</span>
                    <span className="text-xs text-fg-subtle">{statusLabel[s.status]}</span>
                  </div>

                  {/* Type · target */}
                  <div className="text-[13px] text-fg-muted mb-2.5">
                    {typeLabel[s.type]}
                    {s.config?.target ? ` · ${s.config.target}` : ""}
                  </div>

                  {/* Meta row */}
                  <div className="flex gap-4 flex-wrap font-mono text-xs text-fg-subtle mb-2.5">
                    <span>
                      check every <strong className="text-fg-muted font-medium">{formatFrequency(s.frequency_min)}</strong>
                    </span>
                    <span>
                      last check <strong className="text-fg-muted font-medium">{formatRelative(s.last_checked_at)}</strong>
                    </span>
                    {s.status === "active" && (
                      <span>
                        next check <strong className="text-fg-muted font-medium">{formatCountdown(s.next_check_at, now)}</strong>
                      </span>
                    )}
                  </div>

                  {/* Latest diff */}
                  {event && (
                    <div className="text-[13px] text-fg-primary">
                      <span className="text-fg-subtle">Latest diff:</span> {event.diff_summary}
                    </div>
                  )}

                  {/* Unreadable-page error (e.g. JS-rendered page Bright Data couldn't capture) */}
                  {s.status === "error" && s.last_error && (
                    <p className="text-[13px] text-danger mt-1">
                      {s.last_error}
                      {s.last_error_at ? ` (${formatRelative(s.last_error_at)})` : ""}
                    </p>
                  )}

                  {/* Result of a manual "Check now" on this sentinel */}
                  {sentinelCheckResults[s.id] && (
                    <div className="text-[13px] mt-2 px-3 py-2 rounded-md bg-fg-subtle/8 border border-fg-subtle/15">
                      {sentinelCheckResults[s.id].kind === "no_change" && (
                        <span className="text-fg-muted">No change detected.</span>
                      )}
                      {sentinelCheckResults[s.id].kind === "baseline" && (
                        <span className="text-fg-muted">Baseline stored — nothing to compare yet.</span>
                      )}
                      {sentinelCheckResults[s.id].kind === "changed_not_triggered" && (
                        <span className="text-fg-muted">
                          Content changed, but the condition wasn't met: {(sentinelCheckResults[s.id] as { detail: string }).detail}
                        </span>
                      )}
                      {sentinelCheckResults[s.id].kind === "error" && (
                        <span className="text-danger">{(sentinelCheckResults[s.id] as { detail: string }).detail}</span>
                      )}
                      {sentinelCheckResults[s.id].kind === "triggered" && (() => {
                        const r = sentinelCheckResults[s.id] as Extract<SentinelCheckResult, { kind: "triggered" }>;
                        return (
                          <div className="text-fg-primary">
                            <span className="text-warning font-medium">Triggered:</span> {r.summary}
                            {r.evidence_snippet && (
                              <p className="text-fg-muted text-xs mt-1">"{r.evidence_snippet}"</p>
                            )}
                            {r.evidence_url && (
                              <a
                                href={r.evidence_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sine-cyan text-xs mt-1 inline-block hover:underline"
                              >
                                View source
                              </a>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {toggleErrors[s.id] && (
                    <p className="text-xs text-danger mt-2">{toggleErrors[s.id]}</p>
                  )}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-row items-center justify-end gap-2.5 shrink-0 w-full sm:w-auto pl-[52px] sm:pl-0">
                  <button
                    onClick={() => checkSentinelNow(s)}
                    disabled={checkingSentinel[s.id]}
                    aria-label="Check now"
                    title="Check now"
                    className="flex items-center justify-center w-7 h-7 rounded-md border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer disabled:opacity-50"
                  >
                    <Search size={14} strokeWidth={1.8} className={checkingSentinel[s.id] ? "animate-pulse" : ""} />
                  </button>
                  <button
                    onClick={() => setEditing(s)}
                    aria-label="Configure sentinel"
                    title="Configure"
                    className="flex items-center justify-center w-7 h-7 rounded-md border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
                  >
                    <Settings size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={() => toggleStatus(s)}
                    disabled={toggling[s.id]}
                    role="switch"
                    aria-checked={s.status === "active"}
                    aria-label={s.status === "active" ? "Pause sentinel" : "Activate sentinel"}
                    className={`relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer disabled:opacity-50 ${
                      s.status === "active" ? "bg-success" : "bg-fg-subtle/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg-base transition-all duration-150 ${
                        s.status === "active" ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewSentinelModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={fetchSentinels}
      />

      <EditSentinelModal
        sentinel={editing}
        onClose={() => setEditing(null)}
        onSaved={fetchSentinels}
        onDeleted={fetchSentinels}
      />
    </div>
  );
}
