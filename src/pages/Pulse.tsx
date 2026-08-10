import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, List, SatelliteDish, SquareCheck } from "lucide-react";
import { copy } from "../config/tokens";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import SineWave from "../components/SineWave";
import { listCalendarEvents, CalendarActionsError } from "../lib/calendar";
import {
  type Resolution,
  actionIcon,
  outcomeIcon,
  resolutionSummary,
  formatDate,
} from "../lib/activity";

// ── Right rail: mini calendar + upcoming deadlines ──────────────

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

interface DeadlineEntry {
  id: string;
  label: string;
  date: Date;
  color: string;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatWhen(date: Date, today: Date): string {
  if (isSameDay(date, today)) return "Today";
  return date.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" }).replace(",", " ·");
}

interface MonthCell {
  day: number;
  inMonth: boolean;
  isToday: boolean;
  hasEvent: boolean;
}

function buildMonthCells(year: number, month: number, today: Date, eventDays: Set<string>): MonthCell[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = [];

  for (let i = 0; i < startOffset; i++) {
    const d = new Date(year, month, 1 - (startOffset - i));
    cells.push({ day: d.getDate(), inMonth: false, isToday: false, hasEvent: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({
      day,
      inMonth: true,
      isToday: isSameDay(d, today),
      hasEvent: eventDays.has(dateKey(d)),
    });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ day: nextDay++, inMonth: false, isToday: false, hasEvent: false });
  }
  return cells;
}

// Triggers the shared `.reveal-up` transition (see index.css, also used by
// Roadmap's scroll reveal) shortly after mount — Pulse's content is always
// above the fold, so a timeout stand-in for IntersectionObserver is enough.
function useRevealOnMount() {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 20);
    return () => clearTimeout(t);
  }, []);
  return revealed;
}

// Tweens a stat from 0 to its real value once it arrives from Supabase.
function AnimatedNumber({ value }: { value: number | null }) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    if (value === null) return;
    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    const duration = 1100;
    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        prevValue.current = to;
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  if (value === null) return <>—</>;
  return <>{display}</>;
}

// ── Types ────────────────────────────────────────────────────

interface PulseContent {
  summary: string;
  highlights: string[];
  stats: {
    new_signals: number;
    resolutions: number;
    wake_events: number;
    tasks_due: number;
  };
}

interface PulseRow {
  id: string;
  briefing_date: string;
  content: PulseContent;
  generated_at: string;
}

interface Stats {
  signalsToday: number | null;
  activeSentinels: number | null;
  openTasks: number | null;
}

/**
 * Pulse — real-time workspace overview.
 * Shows the agent's daily briefing, key metrics, and recent activity at a glance.
 */
export default function Pulse() {
  const { activeWorkspaceId } = useContext(AuthContext);
  const revealed = useRevealOnMount();

  const [stats, setStats] = useState<Stats>({ signalsToday: null, activeSentinels: null, openTasks: null });
  const [statsLoading, setStatsLoading] = useState(true);

  const [pulse, setPulse] = useState<PulseRow | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [pulseError, setPulseError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [monthEventDays, setMonthEventDays] = useState<Set<string>>(new Set());
  const [deadlines, setDeadlines] = useState<DeadlineEntry[]>([]);

  const fetchStats = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setStatsLoading(true);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [signalsRes, sentinelsRes, tasksRes] = await Promise.all([
      supabase
        .from("sybil_signals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", activeWorkspaceId)
        .gte("received_at", startOfDay.toISOString()),
      supabase
        .from("sybil_sentinels")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", activeWorkspaceId)
        .eq("status", "active"),
      supabase
        .from("sybil_tasks")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", activeWorkspaceId)
        .neq("status", "done"),
    ]);

    setStats({
      signalsToday: signalsRes.count ?? 0,
      activeSentinels: sentinelsRes.count ?? 0,
      openTasks: tasksRes.count ?? 0,
    });
    setStatsLoading(false);
  }, [activeWorkspaceId]);

  const fetchPulse = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setPulseLoading(true);
    setPulseError(null);

    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("sybil_pulses")
      .select("id, briefing_date, content, generated_at")
      .eq("workspace_id", activeWorkspaceId)
      .eq("briefing_date", today)
      .maybeSingle();

    if (error) {
      setPulseError(error.message);
    } else {
      setPulse(data);
    }
    setPulseLoading(false);
  }, [activeWorkspaceId]);

  const fetchActivity = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setActivityLoading(true);
    setActivityError(null);

    const { data, error } = await supabase
      .from("sybil_resolutions")
      .select("*")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      setActivityError(error.message);
    } else {
      setResolutions(data ?? []);
    }
    setActivityLoading(false);
  }, [activeWorkspaceId]);

  // Combines open task due dates with Google Calendar events (when connected)
  // into one "days with something happening" set for the mini calendar, and
  // one chronological upcoming list for the deadlines panel.
  const fetchCalendarRail = useCallback(async () => {
    if (!activeWorkspaceId) return;

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const entries: DeadlineEntry[] = [];
    const eventDays = new Set<string>();

    const { data: tasks } = await supabase
      .from("sybil_tasks")
      .select("id, title, due_date")
      .eq("workspace_id", activeWorkspaceId)
      .neq("status", "done")
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(30);

    for (const t of tasks ?? []) {
      const due = new Date(t.due_date as string);
      if (due >= monthStart && due < monthEnd) eventDays.add(dateKey(due));
      if (due >= startOfToday) {
        entries.push({ id: `task-${t.id}`, label: t.title as string, date: due, color: "bg-sine-amber" });
      }
    }

    try {
      const res = await listCalendarEvents({
        time_min: monthStart.toISOString(),
        time_max: monthEnd.toISOString(),
        max_results: 100,
      });
      for (const ev of res.events) {
        if (ev.status === "cancelled") continue;
        const startIso = ev.start.dateTime ?? ev.start.date;
        if (!startIso) continue;
        const start = new Date(startIso);
        eventDays.add(dateKey(start));
        if (start >= startOfToday) {
          entries.push({ id: `event-${ev.id}`, label: ev.summary, date: start, color: "bg-sine-indigo" });
        }
      }
    } catch (err) {
      // Google Calendar may not be connected — the deadlines panel still
      // works from task due dates alone.
      if (!(err instanceof CalendarActionsError)) {
        console.error("Failed to load calendar events for Pulse rail", err);
      }
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    setDeadlines(entries.slice(0, 5));
    setMonthEventDays(eventDays);
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchStats();
    fetchPulse();
    fetchActivity();
    fetchCalendarRail();
  }, [fetchStats, fetchPulse, fetchActivity, fetchCalendarRail]);

  const today = useMemo(() => new Date(), []);
  const monthCells = useMemo(
    () => buildMonthCells(today.getFullYear(), today.getMonth(), today, monthEventDays),
    [today, monthEventDays],
  );
  const monthLabel = useMemo(
    () => today.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    [today],
  );

  async function generateBriefing() {
    if (!activeWorkspaceId) return;
    setGenerating(true);
    setPulseError(null);

    const { data, error } = await supabase.functions.invoke("generate-pulse", {
      body: { workspace_id: activeWorkspaceId },
    });

    if (error) {
      setPulseError(error.message);
    } else if (data?.pulse) {
      setPulse(data.pulse);
    }
    setGenerating(false);
  }

  const statCards: {
    label: string;
    value: number | null;
    to: string;
    accent: string;
    icon: ReactNode;
  }[] = [
    { label: "Signals today", value: stats.signalsToday, to: "/activity", accent: "text-sine-cyan", icon: <List size={34} strokeWidth={1.6} /> },
    { label: "Active sentinels", value: stats.activeSentinels, to: "/sentinels", accent: "text-success", icon: <SatelliteDish size={34} strokeWidth={1.6} /> },
    { label: "Open tasks", value: stats.openTasks, to: "/tasks", accent: "text-sine-amber", icon: <SquareCheck size={34} strokeWidth={1.6} /> },
  ];

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="w-full p-6 xl:pr-10 flex flex-col xl:flex-row xl:items-start gap-8">
    <div className="w-full max-w-5xl min-w-0 flex-1 xl:mx-auto">
      <h1 className="text-xl font-semibold text-fg-primary mb-2.5">
        {copy.pages.pulse.title}
      </h1>
      <p className="text-fg-muted text-sm mb-8">{copy.pages.pulse.subtitle}</p>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {statCards.map((stat, i) => (
          <div
            key={stat.label}
            className={`reveal-up${revealed ? " is-revealed" : ""}`}
            style={{ transitionDelay: `${i * 90}ms`, transitionDuration: "900ms" }}
          >
            <Link
              to={stat.to}
              className="group relative flex flex-col items-center text-center gap-1.5 bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-5 hover:border-fg-subtle/40 hover:bg-bg-surface transition-colors duration-150"
            >
              <div
                className={`absolute left-5 top-1/2 -translate-y-1/2 ${stat.accent} opacity-70 group-hover:opacity-100 transition-opacity duration-150`}
              >
                {stat.icon}
              </div>
              <p className={`text-5xl font-bold tabular-nums tracking-tight ${stat.accent}`}>
                {statsLoading ? "—" : <AnimatedNumber value={stat.value} />}
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle group-hover:text-fg-muted transition-colors duration-150">
                {stat.label}
              </p>
            </Link>
          </div>
        ))}
      </div>

      {/* Daily briefing */}
      <div
        className={`reveal-up${revealed ? " is-revealed" : ""} flex items-center justify-between gap-4 mb-3`}
        style={{ transitionDelay: "270ms", transitionDuration: "900ms" }}
      >
        <h2 className="text-sm font-medium text-fg-primary">Daily briefing</h2>
        {pulse && (
          <button
            onClick={generateBriefing}
            disabled={generating}
            title="Regenerate today's briefing"
            aria-label="Regenerate briefing"
            className="flex items-center justify-center w-7 h-7 rounded-full border border-fg-subtle/25 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={2} className={generating ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      <div
        className={`reveal-up${revealed ? " is-revealed" : ""}`}
        style={{ transitionDelay: "270ms", transitionDuration: "900ms" }}
      >
        {pulseError && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-8 text-sm text-fg-primary">
            Failed to load briefing: {pulseError}
          </div>
        )}

        {!pulseError && pulseLoading && (
          <div className="flex items-center gap-3 text-fg-muted py-6 mb-8">
            <div data-sybil-state="thinking">
              <SineWave height={22} className="w-20" />
            </div>
            <span className="text-sm animate-pulse">Loading briefing…</span>
          </div>
        )}

        {!pulseError && !pulseLoading && !pulse && (
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-6 py-8 text-center mb-8">
            <div data-sybil-state="idle" className="mb-3 inline-block">
              <SineWave height={28} className="w-28" />
            </div>
            <p className="text-fg-muted text-sm">No briefing yet for today.</p>
            <p className="text-fg-subtle text-xs mt-1 mb-4">
              Sybil compiles it every morning — or generate it now.
            </p>
            <button
              onClick={generateBriefing}
              disabled={generating}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-success text-bg-base text-sm font-semibold hover:bg-success/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} strokeWidth={2} className={generating ? "animate-spin" : ""} />
              Generate now
            </button>
          </div>
        )}

        {!pulseError && !pulseLoading && pulse && (
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-4 mb-8">
            <p className="text-sm text-fg-primary mb-3">{pulse.content.summary}</p>

            {pulse.content.highlights.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {pulse.content.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-fg-muted">
                    <span className="mt-[7px] w-1 h-1 rounded-full bg-sine-indigo shrink-0" />
                    {h}
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[11px] text-fg-subtle font-mono">
              Generated {formatDate(pulse.generated_at)}
            </p>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div
        className={`reveal-up${revealed ? " is-revealed" : ""}`}
        style={{ transitionDelay: "360ms", transitionDuration: "900ms" }}
      >
        <h2 className="text-sm font-medium text-fg-primary mb-3">Recent activity</h2>

        {activityError && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
            Failed to load: {activityError}
          </div>
        )}

        {!activityError && activityLoading && (
          <div className="flex items-center gap-3 text-fg-muted py-6">
            <div data-sybil-state="thinking">
              <SineWave height={22} className="w-20" />
            </div>
            <span className="text-sm animate-pulse">Loading activity…</span>
          </div>
        )}

        {!activityError && !activityLoading && resolutions.length === 0 && (
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-6 text-center">
            <p className="text-fg-muted text-sm">
              The live feed will show up here after your first interactions with Sybil.
            </p>
            <p className="text-fg-subtle text-xs mt-1">Try sending a message from Chat.</p>
          </div>
        )}

        {!activityError && !activityLoading && resolutions.length > 0 && (
          <div className="space-y-2">
            {resolutions.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-3"
              >
                <span className="shrink-0" title={r.outcome} aria-label={r.outcome}>
                  {outcomeIcon[r.outcome] ?? outcomeIcon.pending}
                </span>
                <span className="shrink-0 text-fg-subtle">
                  {actionIcon[r.action] ?? null}
                </span>
                <p className="text-sm text-fg-primary flex-1 line-clamp-1">
                  {resolutionSummary(r)}
                </p>
                <span className="text-xs text-fg-subtle font-mono shrink-0">
                  {formatDate(r.created_at)}
                </span>
              </div>
            ))}
            <Link
              to="/activity"
              className="block text-center text-sm text-sine-indigo hover:underline pt-1"
            >
              View all →
            </Link>
          </div>
        )}
      </div>
    </div>

    {/* Right rail — mini calendar + upcoming deadlines */}
    <aside className="hidden xl:flex w-[280px] shrink-0 flex-col gap-7 border-l border-fg-subtle/15 pl-8 xl:sticky xl:top-6">
      <div>
        <div className="text-sm font-semibold text-fg-primary mb-3.5">{monthLabel}</div>
        <div className="grid grid-cols-7 gap-1 text-[11px] text-fg-subtle mb-1.5 text-center">
          {WEEKDAY_LETTERS.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {monthCells.map((cell, i) => (
            <div
              key={i}
              className={`aspect-square flex items-center justify-center rounded-md text-xs ${
                cell.isToday
                  ? "bg-warning text-bg-base font-bold"
                  : cell.hasEvent
                    ? "bg-sine-indigo/12 text-sine-indigo font-semibold"
                    : cell.inMonth
                      ? "text-fg-primary font-medium"
                      : "text-fg-subtle/40"
              }`}
            >
              {cell.day}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-fg-primary mb-3.5">Upcoming deadlines</div>
        {deadlines.length === 0 ? (
          <p className="text-xs text-fg-subtle">Nothing due — you're all caught up.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {deadlines.map((d) => (
              <div key={d.id} className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${d.color}`} />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg-primary truncate">{d.label}</div>
                  <div className="text-xs text-fg-subtle">{formatWhen(d.date, today)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
    </div>
  );
}
