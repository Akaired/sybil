import { useEffect, useState } from "react";
import { Radio, Zap, Clock, Globe, ExternalLink } from "lucide-react";
import { supabase } from "../config/supabase";
import SineWave from "../components/SineWave";
import {
  type Resolution,
  originLabel,
  originIcon,
  actionLabel,
  actionIcon,
  outcomeIcon,
  resolutionSummary,
  Chip,
  formatDate,
} from "../lib/activity";

// ── Types ────────────────────────────────────────────────────

interface Signal {
  id: string;
  origin: string;
  raw_content: string;
  created_at: string;
}

interface WakeEvent {
  id: string;
  sentinel_id: string;
  diff_summary: string;
  evidence_url: string | null;
  evidence_snippet: string | null;
  created_at: string;
  condition_text?: string;
}

interface ActivityItem {
  kind: "signal" | "resolution" | "wake_event";
  timestamp: string;
  signal?: Signal;
  resolution?: Resolution;
  wakeEvent?: WakeEvent;
}

// ── Component ────────────────────────────────────────────────

export default function Activity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActivity();
  }, []);

  async function fetchActivity() {
    setLoading(true);
    setError(null);

    try {
      // Fetch signals
      const { data: signals, error: sigErr } = await supabase
        .from("sybil_signals")
        .select("id, origin, raw_content, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (sigErr) {
        setError(sigErr.message);
        return;
      }

      // Build a set of signal IDs
      const signalIds = (signals ?? []).map((s) => s.id);

      // Fetch resolutions for those signals
      const { data: resolutions, error: resErr } = await supabase
        .from("sybil_resolutions")
        .select("*")
        .in("signal_id", signalIds)
        .order("created_at", { ascending: false });

      if (resErr) {
        setError(resErr.message);
        return;
      }

      // Wake events are the proof a sentinel actually caught something —
      // rendered as their own hero item, not folded into the signal row.
      const { data: wakeEvents } = await supabase
        .from("sybil_wake_events")
        .select("id, sentinel_id, diff_summary, evidence_url, evidence_snippet, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      const sentinelIds = [...new Set((wakeEvents ?? []).map((w) => w.sentinel_id))];
      const { data: sentinels } = sentinelIds.length
        ? await supabase.from("sybil_sentinels").select("id, condition_text").in("id", sentinelIds)
        : { data: [] as { id: string; condition_text: string }[] };
      const conditionBySentinel = new Map((sentinels ?? []).map((s) => [s.id, s.condition_text]));

      // Merge into unified timeline
      const merged: ActivityItem[] = [
        ...(signals ?? []).map((s) => ({
          kind: "signal" as const,
          timestamp: s.created_at,
          signal: s,
        })),
        ...(resolutions ?? []).map((r) => ({
          kind: "resolution" as const,
          timestamp: r.created_at,
          resolution: r,
        })),
        ...(wakeEvents ?? []).map((w) => ({
          kind: "wake_event" as const,
          timestamp: w.created_at,
          wakeEvent: { ...w, condition_text: conditionBySentinel.get(w.sentinel_id) },
        })),
      ];

      merged.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      setItems(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected network error.");
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-fg-primary mb-2.5">Activity</h1>
      <p className="text-fg-muted text-sm mb-8">
        Chronological log of every signal received and every action Sybil has taken.
      </p>

      {/* Error */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-6 text-sm text-fg-primary">
          Failed to load: {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 text-fg-muted py-8">
          <div data-sybil-state="thinking">
            <SineWave height={24} className="w-24" />
          </div>
          <span className="text-sm animate-pulse">Loading activity…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && items.length === 0 && (
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-6 py-10 text-center">
          <div data-sybil-state="idle" className="mb-4 inline-block">
            <SineWave height={32} className="w-32" />
          </div>
          <p className="text-fg-muted text-sm">No activity recorded yet.</p>
          <p className="text-fg-subtle text-xs mt-1">
            Send a message from the Chat to get started.
          </p>
        </div>
      )}

      {/* Timeline */}
      {!loading && items.length > 0 && (
        <div className="relative">
          {/* Center divider — actions on the left, signals on the right */}
          <div className="absolute top-0 bottom-0 w-px bg-fg-subtle/20 left-3 -translate-x-1/2 sm:left-1/2" />

          {items.map((item) => {
            const isSignal = item.kind === "signal";

            if (item.kind === "wake_event" && item.wakeEvent) {
              const w = item.wakeEvent;
              return (
                <div
                  key={item.kind + w.id}
                  className="grid grid-cols-[24px_1fr] sm:grid-cols-[1fr_24px_1fr] items-center pb-5"
                >
                  {/* Left column — same slot as actions, hero styling to stand out */}
                  <div className="col-start-2 sm:col-start-1 sm:pr-5 sm:flex sm:flex-col sm:items-end">
                    <div className="w-full scroll-mt-6">
                      <span className="block text-xs text-fg-subtle font-mono mb-1">
                        {formatDate(item.timestamp)}
                      </span>
                      <div className="bg-gradient-to-b from-warning/10 to-bg-elevated border-2 border-warning/40 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                          <Chip
                            icon={<Globe size={11} strokeWidth={2} />}
                            label="Sentinel triggered"
                            className="bg-warning/15 border-warning/40 text-warning"
                          />
                        </div>

                        {w.condition_text && (
                          <p className="text-[13px] text-fg-subtle mb-1.5">
                            Watching: <span className="text-fg-muted">{w.condition_text}</span>
                          </p>
                        )}

                        <p className="text-sm font-semibold text-fg-primary mb-2">
                          {w.diff_summary}
                        </p>

                        {w.evidence_snippet && (
                          <blockquote className="border-l-2 border-warning/50 pl-3 py-0.5 mb-2.5 text-sm text-fg-muted italic">
                            "{w.evidence_snippet}"
                          </blockquote>
                        )}

                        {w.evidence_url && (
                          <a
                            href={w.evidence_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sine-cyan hover:underline"
                          >
                            View source
                            <ExternalLink size={12} strokeWidth={2} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Dot */}
                  <div className="col-start-1 sm:col-start-2 flex justify-center">
                    <span className="w-2.5 h-2.5 rounded-full border-2 border-bg-base bg-warning" />
                  </div>

                  {/* Right column intentionally empty — this item has no signal counterpart */}
                  <div className="col-start-2 sm:col-start-3 sm:pl-5" />
                </div>
              );
            }

            return (
              <div
                key={item.kind + item.timestamp}
                className="grid grid-cols-[24px_1fr] sm:grid-cols-[1fr_24px_1fr] items-center pb-5"
              >
                {/* Left column — actions */}
                <div className="col-start-2 sm:col-start-1 sm:pr-5 sm:flex sm:flex-col sm:items-end">
                  {!isSignal && item.resolution && (
                    <div
                      id={
                        (item.resolution.action === "create_task" ||
                          item.resolution.action === "update_task") &&
                        item.resolution.detail?.task_id
                          ? `task-${item.resolution.detail.task_id}`
                          : undefined
                      }
                      className="w-full scroll-mt-6"
                    >
                      <span className="block text-xs text-fg-subtle font-mono mb-1">
                        {formatDate(item.timestamp)}
                      </span>
                      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                          <Chip
                            icon={<Zap size={11} strokeWidth={2} />}
                            label="Action"
                            className="bg-sine-mint/10 border-sine-mint/25 text-sine-mint"
                          />
                          <Chip
                            icon={
                              actionIcon[item.resolution.action] ?? (
                                <Zap size={11} strokeWidth={2} />
                              )
                            }
                            label={actionLabel[item.resolution.action] ?? item.resolution.action}
                            className="bg-fg-subtle/10 border-fg-subtle/20 text-fg-muted"
                          />
                          <span
                            className="ml-auto shrink-0"
                            title={item.resolution.outcome}
                            aria-label={item.resolution.outcome}
                          >
                            {outcomeIcon[item.resolution.outcome] ?? (
                              <Clock size={14} strokeWidth={2} className="text-fg-subtle" />
                            )}
                          </span>
                        </div>
                        <p className="text-sm text-fg-primary line-clamp-2">
                          {resolutionSummary(item.resolution)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Dot */}
                <div className="col-start-1 sm:col-start-2 flex justify-center">
                  <span
                    className={`w-2.5 h-2.5 rounded-full border-2 border-bg-base ${
                      isSignal
                        ? "bg-sine-cyan"
                        : item.resolution?.outcome === "success"
                          ? "bg-success"
                          : item.resolution?.outcome === "error"
                            ? "bg-danger"
                            : "bg-warning"
                    }`}
                  />
                </div>

                {/* Right column — signals */}
                <div className="col-start-2 sm:col-start-3 sm:pl-5">
                  {isSignal && item.signal && (
                    <div>
                      <span className="block text-xs text-fg-subtle font-mono mb-1">
                        {formatDate(item.timestamp)}
                      </span>
                      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                          <Chip
                            icon={<Radio size={11} strokeWidth={2} />}
                            label="Signal"
                            className="bg-sine-cyan/10 border-sine-cyan/25 text-sine-cyan"
                          />
                          <Chip
                            icon={
                              originIcon[item.signal.origin] ?? (
                                <Radio size={11} strokeWidth={2} />
                              )
                            }
                            label={originLabel[item.signal.origin] ?? item.signal.origin}
                            className="bg-fg-subtle/10 border-fg-subtle/20 text-fg-muted"
                          />
                        </div>
                        <p className="text-sm text-fg-primary line-clamp-2">
                          {item.signal.raw_content}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
