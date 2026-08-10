import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, MapPin, User, Users, ExternalLink, Share2, Check, AlertCircle } from "lucide-react";
import SineWave from "../components/SineWave";
import Modal from "../components/Modal";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import {
  CalendarActionsError,
  CalendarShareError,
  fetchOauthStatus,
  isGoogleConnected,
  listCalendarEvents,
  listSharedCalendars,
  shareCalendar,
  startGoogleOauth,
  type GoogleCalendarEvent,
  type SharedCalendar,
} from "../lib/calendar";

// ── Share calendar types ────────────────────────────────────────

type TeamRole = "owner" | "admin" | "member" | "guest";
type AccessLevel = "reader" | "writer";

interface ShareTeamMember {
  id: string;
  userId: string;
  email: string;
  role: TeamRole;
}

interface ShareResult {
  success: boolean;
  message?: string;
}

// ── Constants ────────────────────────────────────────────────

const START_HOUR = 8;
const END_HOUR = 20;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GRID_HEIGHT_PX = 672; // 56px per hour row
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EVENT_COLOR_CLASSES = [
  { bg: "bg-sine-signal/15", border: "border-sine-signal", dot: "bg-sine-signal" },
  { bg: "bg-sine-amber/15", border: "border-sine-amber", dot: "bg-sine-amber" },
  { bg: "bg-sine-acid/15", border: "border-sine-acid", dot: "bg-sine-acid" },
  { bg: "bg-sine-mint/15", border: "border-sine-mint", dot: "bg-sine-mint" },
  { bg: "bg-sine-cyan/15", border: "border-sine-cyan", dot: "bg-sine-cyan" },
  { bg: "bg-sine-indigo/15", border: "border-sine-indigo", dot: "bg-sine-indigo" },
  { bg: "bg-sine-graphite/15", border: "border-sine-graphite", dot: "bg-sine-graphite" },
] as const;

// ── Helpers ──────────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DeadlineEntry {
  id: string;
  label: string;
  date: Date;
  color: string;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDeadlineWhen(date: Date, today: Date): string {
  if (isSameDay(date, today)) return "Today";
  return date.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" }).replace(",", " ·");
}

function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const period = hh >= 12 ? "pm" : "am";
  const h12 = ((hh + 11) % 12) + 1;
  return mm === 0 ? `${h12}${period}` : `${h12}:${String(mm).padStart(2, "0")}${period}`;
}

/** Monday-based start of the week containing `d`. */
function weekStartOf(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Simple stable hash of an event id into one of the 7 sine palette colors. */
function colorForEvent(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return EVENT_COLOR_CLASSES[sum % EVENT_COLOR_CLASSES.length];
}

function eventHour(dt: { dateTime?: string; date?: string }): number | null {
  if (!dt.dateTime) return null; // all-day event
  const d = new Date(dt.dateTime);
  return d.getHours() + d.getMinutes() / 60;
}

function formatEventWhen(ev: GoogleCalendarEvent): string {
  if (ev.start.date) {
    // All-day event
    const start = new Date(ev.start.date);
    const end = ev.end.date ? new Date(ev.end.date) : null;
    const startLabel = start.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    if (!end || end.getTime() - start.getTime() <= 86400000) {
      return `${startLabel} · All day`;
    }
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    return `${startLabel} – ${lastDay.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })} · All day`;
  }
  if (!ev.start.dateTime) return "";
  const start = new Date(ev.start.dateTime);
  const end = ev.end.dateTime ? new Date(ev.end.dateTime) : null;
  const dateLabel = start.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const endTime = end?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return endTime ? `${dateLabel} · ${startTime} – ${endTime}` : `${dateLabel} · ${startTime}`;
}

// ── Component ────────────────────────────────────────────────

export default function CalendarPage() {
  const { user, activeWorkspaceId } = useContext(AuthContext);

  const [view, setView] = useState<"week" | "month">("month");
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<GoogleCalendarEvent | null>(null);

  const [deadlines, setDeadlines] = useState<DeadlineEntry[]>([]);

  // ── Shared calendars (viewing) ──────────────────────────────

  const [sharedCalendars, setSharedCalendars] = useState<SharedCalendar[]>([]);
  const [activeCalendarId, setActiveCalendarId] = useState<string>("primary");

  useEffect(() => {
    listSharedCalendars()
      .then(setSharedCalendars)
      .catch(() => setSharedCalendars([]));
  }, []);

  const activeCalendar = useMemo(
    () => sharedCalendars.find((c) => c.ownerCalendarId === activeCalendarId) ?? null,
    [sharedCalendars, activeCalendarId],
  );

  function handleCalendarChange(calendarId: string) {
    setActiveCalendarId(calendarId);
    setSelectedEvent(null);
  }

  // ── Share calendar ─────────────────────────────────────────

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareMembers, setShareMembers] = useState<ShareTeamMember[]>([]);
  const [shareMembersLoading, setShareMembersLoading] = useState(false);
  const [shareMembersError, setShareMembersError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [accessLevels, setAccessLevels] = useState<Record<string, AccessLevel>>({});
  const [sharing, setSharing] = useState(false);
  const [shareResults, setShareResults] = useState<Record<string, ShareResult> | null>(null);

  const shareableMembers = useMemo(
    () => shareMembers.filter((m) => m.userId !== user?.id),
    [shareMembers, user?.id],
  );

  function openShareModal() {
    setShareModalOpen(true);
    setShareResults(null);
    if (shareMembers.length === 0 && !shareMembersLoading && activeWorkspaceId) {
      setShareMembersLoading(true);
      setShareMembersError(null);
      supabase
        .from("workspace_members")
        .select("id, user_id, email, role")
        .eq("workspace_id", activeWorkspaceId)
        .order("email", { ascending: true })
        .then(({ data, error }) => {
          if (error) {
            setShareMembersError(error.message);
          } else {
            setShareMembers(
              (data ?? []).map((m) => ({ id: m.id, userId: m.user_id, email: m.email, role: m.role as TeamRole })),
            );
          }
          setShareMembersLoading(false);
        });
    }
  }

  function closeShareModal() {
    if (sharing) return;
    setShareModalOpen(false);
    setSelectedMemberIds(new Set());
    setShareResults(null);
  }

  function toggleMemberSelected(member: ShareTeamMember) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(member.id)) {
        next.delete(member.id);
      } else {
        next.add(member.id);
      }
      return next;
    });
  }

  function accessLevelFor(member: ShareTeamMember): AccessLevel {
    if (member.role === "guest") return "reader";
    return accessLevels[member.id] ?? "reader";
  }

  function setAccessLevelFor(memberId: string, level: AccessLevel) {
    setAccessLevels((prev) => ({ ...prev, [memberId]: level }));
  }

  async function confirmShare() {
    const targets = shareableMembers.filter((m) => selectedMemberIds.has(m.id));
    if (targets.length === 0) return;

    setSharing(true);
    setShareResults(null);

    const entries = await Promise.all(
      targets.map(async (m) => {
        try {
          const res = await shareCalendar({ email: m.email, role: accessLevelFor(m) });
          return [m.id, { success: true, message: res.downgraded ? "Shared (view only — guest)" : "Shared" }] as const;
        } catch (err) {
          const message = err instanceof CalendarShareError ? err.message : "Failed to share.";
          return [m.id, { success: false, message }] as const;
        }
      }),
    );

    setShareResults(Object.fromEntries(entries));
    setSharing(false);
  }

  useEffect(() => {
    if (!selectedEvent) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedEvent(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedEvent]);

  // ── Connection status ──────────────────────────────────────

  // Optimistic hint only — calendar-actions (see fetchEvents below) is the
  // real source of truth for whether Google is connected, since its
  // response shape is fully known while oauth-status's isn't.
  const checkConnection = useCallback(async () => {
    setConnectionError(null);
    try {
      const status = await fetchOauthStatus();
      if (isGoogleConnected(status)) setConnected(true);
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Unexpected network error.",
      );
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { authorization_url } = await startGoogleOauth("/calendar");
      const popup = window.open(
        authorization_url,
        "sybil-google-oauth",
        "width=520,height=680",
      );
      if (!popup) {
        // Popup blocked — fall back to a full-page redirect rather than
        // stranding the user with a "Redirecting…" button that never finishes.
        window.location.href = authorization_url;
        return;
      }
      const poll = setInterval(() => {
        if (popup.closed) {
          clearInterval(poll);
          setConnecting(false);
          // fetchEvents (not just checkConnection) is what actually loads the
          // newly-connected calendar's events — calendar-actions' own
          // connected:false/success response is the real source of truth.
          checkConnection();
          fetchEvents();
        }
      }, 500);
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : "Couldn't start Google connection.",
      );
      setConnecting(false);
    }
  }

  // ── Visible date range ─────────────────────────────────────

  const weekDates = useMemo(() => {
    const start = weekStartOf(anchorDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [anchorDate]);

  const monthCells = useMemo(() => {
    const y = anchorDate.getFullYear();
    const m = anchorDate.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const firstDow = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = addDays(firstOfMonth, -firstDow);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [anchorDate]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === "week") {
      return { rangeStart: weekDates[0], rangeEnd: addDays(weekDates[6], 1) };
    }
    return {
      rangeStart: monthCells[0],
      rangeEnd: addDays(monthCells[41], 1),
    };
  }, [view, weekDates, monthCells]);

  // ── Events fetch ───────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await listCalendarEvents({
        time_min: rangeStart.toISOString(),
        time_max: rangeEnd.toISOString(),
        max_results: 100,
        calendar_id: activeCalendarId,
      });
      // calendar-actions succeeded, so the account is definitely connected —
      // this is the ground truth, and overrides an oauth-status mismatch.
      setConnected(true);
      setEvents(res.events.filter((e) => e.status !== "cancelled"));
    } catch (err) {
      if (err instanceof CalendarActionsError && err.notConnected) {
        setConnected(false);
      } else {
        setEventsError(err instanceof Error ? err.message : "Unexpected network error.");
      }
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [rangeStart, rangeEnd, activeCalendarId]);

  // Always attempt to load events, regardless of what oauth-status reported —
  // calendar-actions' own connected:false / success response is the source
  // of truth for whether Google is actually connected.
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ── Upcoming deadlines (sidebar) ────────────────────────────
  // Same task-due-dates + Google Calendar merge as Pulse's right rail,
  // scoped to the next 7 days rather than the full month.

  const fetchDeadlines = useCallback(async () => {
    if (!activeWorkspaceId) return;

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekEnd = addDays(startOfToday, 7);

    const entries: DeadlineEntry[] = [];

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
      if (due >= startOfToday && due < weekEnd) {
        entries.push({ id: `task-${t.id}`, label: t.title as string, date: due, color: "bg-sine-amber" });
      }
    }

    try {
      const res = await listCalendarEvents({
        time_min: startOfToday.toISOString(),
        time_max: weekEnd.toISOString(),
        max_results: 100,
      });
      for (const ev of res.events) {
        if (ev.status === "cancelled") continue;
        const startIso = ev.start.dateTime ?? ev.start.date;
        if (!startIso) continue;
        const start = new Date(startIso);
        if (start >= startOfToday && start < weekEnd) {
          entries.push({ id: `event-${ev.id}`, label: ev.summary, date: start, color: "bg-sine-indigo" });
        }
      }
    } catch (err) {
      // Google Calendar may not be connected — the deadlines panel still
      // works from task due dates alone.
      if (!(err instanceof CalendarActionsError)) {
        console.error("Failed to load calendar events for deadlines panel", err);
      }
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    setDeadlines(entries.slice(0, 5));
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchDeadlines();
  }, [fetchDeadlines]);

  // ── Derived view data ──────────────────────────────────────

  const eventsByDay = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent[]>();
    for (const ev of events) {
      const key = ev.start.dateTime ? dateKey(new Date(ev.start.dateTime)) : ev.start.date;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  const hourMarks = useMemo(
    () =>
      Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
        const h = START_HOUR + i;
        return { label: fmtHour(h), top: ((h - START_HOUR) / TOTAL_HOURS) * 100 };
      }),
    [],
  );

  const today = dateKey(new Date());

  const rangeLabel =
    view === "week"
      ? `${weekDates[0].toLocaleDateString("en-GB", { month: "short", day: "numeric" })} – ${weekDates[6].toLocaleDateString(
          "en-GB",
          { month: "short", day: "numeric", year: "numeric" },
        )}`
      : anchorDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  function goToday() {
    setAnchorDate(new Date());
  }

  function goPrev() {
    setAnchorDate((d) =>
      view === "week"
        ? addDays(d, -7)
        : new Date(d.getFullYear(), d.getMonth() - 1, 1),
    );
  }

  function goNext() {
    setAnchorDate((d) =>
      view === "week"
        ? addDays(d, 7)
        : new Date(d.getFullYear(), d.getMonth() + 1, 1),
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap border-b border-fg-subtle/15">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="flex bg-bg-elevated border border-fg-subtle/20 rounded-lg p-[3px]">
            <button
              onClick={() => setView("month")}
              className={`font-semibold text-[13px] rounded-md px-4 py-1.5 cursor-pointer transition-colors duration-150 ${
                view === "month" ? "bg-warning text-bg-base" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView("week")}
              className={`font-semibold text-[13px] rounded-md px-4 py-1.5 cursor-pointer transition-colors duration-150 ${
                view === "week" ? "bg-warning text-bg-base" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Week
            </button>
          </div>
          <button
            onClick={goToday}
            className="font-semibold text-[13px] text-fg-primary bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-2 cursor-pointer hover:border-fg-subtle/40 transition-colors duration-150"
          >
            Today
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              aria-label="Previous"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150"
            >
              <ChevronLeft size={16} strokeWidth={2} />
            </button>
            <button
              onClick={goNext}
              aria-label="Next"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150"
            >
              <ChevronRight size={16} strokeWidth={2} />
            </button>
          </div>
          <div className="font-semibold text-[15px] text-fg-primary">{rangeLabel}</div>

          {sharedCalendars.length > 0 && connected && (
            <select
              value={activeCalendarId}
              onChange={(e) => handleCalendarChange(e.target.value)}
              className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-3 py-2 text-[13px] font-semibold text-fg-primary cursor-pointer"
            >
              <option value="primary">My calendar</option>
              {sharedCalendars.map((c) => (
                <option key={c.id} value={c.ownerCalendarId}>
                  {c.ownerTeamEmail} ({c.role === "writer" ? "can edit" : "can view"})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Connection badge */}
        {connected === null ? (
          <div className="flex items-center gap-2 text-fg-subtle text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle animate-pulse" />
            Checking Google Calendar…
          </div>
        ) : connected ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-success/12 border border-success/35 rounded-full py-1.5 pl-2.5 pr-3.5">
              <span className="w-[7px] h-[7px] rounded-full bg-success" />
              <span className="text-xs font-semibold text-success">Google Calendar connected</span>
            </div>
            {activeCalendarId === "primary" && (
              <button
                onClick={openShareModal}
                className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary bg-bg-elevated border border-fg-subtle/20 rounded-lg px-3.5 py-2 cursor-pointer hover:border-fg-subtle/40 transition-colors duration-150"
              >
                <Share2 size={14} strokeWidth={2} />
                Share calendar
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-fg-subtle/10 border border-fg-subtle/30 rounded-full py-1.5 pl-2.5 pr-3.5">
              <span className="w-[7px] h-[7px] rounded-full bg-fg-subtle" />
              <span className="text-xs font-semibold text-fg-muted">Not connected</span>
            </div>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="text-xs font-semibold text-bg-base bg-warning rounded-lg px-3.5 py-2 cursor-pointer hover:bg-warning/90 transition-colors duration-150 disabled:opacity-50"
            >
              {connecting ? "Redirecting…" : "Connect Google Calendar"}
            </button>
          </div>
        )}
      </div>

      {connectionError && (
        <div className="mx-4 sm:mx-6 mt-4 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
          Couldn't check Google Calendar connection: {connectionError}
        </div>
      )}
      {connectError && (
        <div className="mx-4 sm:mx-6 mt-4 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
          {connectError}
        </div>
      )}
      {activeCalendar && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-center gap-2 bg-sine-indigo/10 border border-sine-indigo/25 rounded-lg px-4 py-2.5 text-[13px] text-fg-muted">
          <Users size={14} strokeWidth={2} className="text-sine-indigo shrink-0" />
          Viewing <span className="text-fg-primary font-medium">{activeCalendar.ownerTeamEmail}</span>'s calendar
          {activeCalendar.role === "reader" ? " (view only)" : " (can edit)"}
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 px-4 sm:px-6 pb-6 pt-5 min-h-0 overflow-y-auto lg:overflow-visible">
        {/* Calendar area */}
        <div className="flex-1 min-w-0 bg-bg-elevated border border-fg-subtle/15 rounded-xl overflow-hidden flex flex-col">
          {connected === null && (
            <div className="flex-1 flex items-center justify-center gap-3 text-fg-muted py-12">
              <div data-sybil-state="thinking">
                <SineWave height={24} className="w-24" />
              </div>
              <span className="text-sm animate-pulse">Loading events…</span>
            </div>
          )}

          {connected === false && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
              <div data-sybil-state="idle" className="mb-4">
                <SineWave height={32} className="w-32" />
              </div>
              <p className="text-fg-primary text-sm font-medium">Google Calendar isn't connected yet</p>
              <p className="text-fg-subtle text-xs mt-1 max-w-xs">
                Connect your Google account to see your real events here.
              </p>
            </div>
          )}

          {connected && eventsError && (
            <div className="m-4 bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
              Failed to load events: {eventsError}
            </div>
          )}

          {connected && eventsLoading && (
            <div className="flex-1 flex items-center justify-center gap-3 text-fg-muted py-12">
              <div data-sybil-state="thinking">
                <SineWave height={24} className="w-24" />
              </div>
              <span className="text-sm animate-pulse">Loading events…</span>
            </div>
          )}

          {connected && !eventsLoading && !eventsError && view === "week" && (
            <div className="overflow-x-auto">
              <div className="min-w-[840px]">
                {/* Day headers */}
                <div className="flex border-b border-fg-subtle/15">
                  <div className="w-14 shrink-0" />
                  {weekDates.map((d) => {
                    const isToday = dateKey(d) === today;
                    return (
                      <div
                        key={dateKey(d)}
                        className="flex-1 text-center py-3.5 px-1 border-l border-fg-subtle/15"
                      >
                        <div className="text-[11px] tracking-wide uppercase text-fg-subtle font-semibold">
                          {DAY_LABELS[(d.getDay() + 6) % 7]}
                        </div>
                        <div
                          className={
                            isToday
                              ? "inline-flex items-center justify-center w-[26px] h-[26px] mt-1 rounded-full bg-warning text-bg-base font-bold text-sm"
                              : "text-sm font-semibold mt-1 text-fg-primary/90"
                          }
                        >
                          {d.getDate()}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Grid */}
                <div className="flex relative overflow-y-auto" style={{ maxHeight: GRID_HEIGHT_PX }}>
                  {/* Hour marks */}
                  <div className="w-14 shrink-0 relative" style={{ height: GRID_HEIGHT_PX }}>
                    {hourMarks.map((hm, i) => (
                      <div
                        key={hm.label}
                        className="absolute left-0 right-2 text-[11px] text-fg-subtle text-right"
                        style={{
                          top: `${hm.top}%`,
                          transform:
                            i === 0
                              ? "translateY(0)"
                              : i === hourMarks.length - 1
                                ? "translateY(-100%)"
                                : "translateY(-50%)",
                        }}
                      >
                        {hm.label}
                      </div>
                    ))}
                  </div>

                  {weekDates.map((d) => {
                    const key = dateKey(d);
                    const dayEvents = (eventsByDay.get(key) ?? []).filter(
                      (ev) => eventHour(ev.start) !== null,
                    );
                    return (
                      <div
                        key={key}
                        className="flex-1 relative border-l border-fg-subtle/15"
                        style={{ height: GRID_HEIGHT_PX }}
                      >
                        {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
                          <div key={i} className="h-14 border-b border-fg-subtle/10" />
                        ))}
                        {dayEvents.map((ev) => {
                          const startH = Math.max(eventHour(ev.start) ?? START_HOUR, START_HOUR);
                          const endH = Math.min(eventHour(ev.end) ?? END_HOUR, END_HOUR);
                          const top = ((startH - START_HOUR) / TOTAL_HOURS) * 100;
                          const height = Math.max(
                            ((endH - startH) / TOTAL_HOURS) * 100,
                            0.5,
                          );
                          const durationPx = (height / 100) * GRID_HEIGHT_PX;
                          const showTime = durationPx >= 40;
                          const color = colorForEvent(ev.id);
                          return (
                            <div
                              key={ev.id}
                              onClick={() => setSelectedEvent(ev)}
                              className={`absolute left-1 right-1 rounded-md px-2 py-1.5 border-l-[3px] overflow-hidden box-border cursor-pointer hover:brightness-125 transition-[filter] duration-150 ${color.bg} ${color.border}`}
                              style={{ top: `${top}%`, height: `${height}%` }}
                              title={ev.summary}
                            >
                              <div
                                className="text-[12px] font-semibold leading-tight text-fg-primary overflow-hidden"
                                style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: durationPx < 30 ? 1 : durationPx < 56 ? 2 : 3,
                                }}
                              >
                                {ev.summary || "(No title)"}
                              </div>
                              {showTime && (
                                <div className="text-[10.5px] text-fg-primary/75 mt-0.5">
                                  {fmtHour(startH)} – {fmtHour(endH)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {connected && !eventsLoading && !eventsError && view === "month" && (
            <div className="p-4">
              <div className="grid grid-cols-7">
                {DAY_LABELS.map((lbl) => (
                  <div
                    key={lbl}
                    className="text-center text-[11px] tracking-wide uppercase text-fg-subtle font-semibold py-2 px-1"
                  >
                    {lbl}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5 mt-1" style={{ gridAutoRows: "104px" }}>
                {monthCells.map((d) => {
                  const key = dateKey(d);
                  const isToday = key === today;
                  const inMonth = d.getMonth() === anchorDate.getMonth();
                  const dayEvents = eventsByDay.get(key) ?? [];
                  return (
                    <div
                      key={key}
                      className={`rounded-lg p-2 border ${
                        isToday ? "bg-warning/10 border-warning" : "bg-bg-surface border-fg-subtle/15"
                      } ${inMonth ? "" : "opacity-35"}`}
                    >
                      <div
                        className={`text-[12.5px] ${
                          isToday ? "font-bold text-warning" : "font-semibold text-fg-primary/90"
                        }`}
                      >
                        {d.getDate()}
                      </div>
                      <div className="flex flex-col gap-0.5 mt-1 overflow-hidden">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <div
                            key={ev.id}
                            onClick={() => setSelectedEvent(ev)}
                            className="flex items-center gap-1 min-w-0 cursor-pointer hover:opacity-80"
                            title={ev.summary}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorForEvent(ev.id).dot}`}
                            />
                            <span className="text-[10.5px] leading-tight text-fg-muted truncate">
                              {ev.summary || "(No title)"}
                            </span>
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[10px] text-fg-subtle pl-2.5">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-80 lg:shrink-0 bg-bg-elevated border border-fg-subtle/15 rounded-xl p-5 h-fit">
          <div className="font-bold text-[15px] text-fg-primary mb-1">Upcoming deadlines</div>
          <div className="text-xs text-fg-subtle mb-4">Next 7 days</div>
          {deadlines.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-fg-muted text-sm">Nothing due</p>
              <p className="text-fg-subtle text-xs mt-1">You're all caught up for the next 7 days.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {deadlines.map((d) => (
                <div key={d.id} className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${d.color}`} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-fg-primary truncate">{d.label}</div>
                    <div className="text-xs text-fg-subtle">{formatDeadlineWhen(d.date, new Date())}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-xl p-6"
          >
            <div className="flex items-start justify-between gap-4 mb-1">
              <div
                className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${colorForEvent(selectedEvent.id).dot}`}
              />
              <h2 className="flex-1 text-base font-semibold text-fg-primary leading-snug">
                {selectedEvent.summary || "(No title)"}
              </h2>
              <button
                onClick={() => setSelectedEvent(null)}
                aria-label="Close"
                className="shrink-0 text-fg-subtle hover:text-fg-primary cursor-pointer transition-colors duration-150"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <p className="text-[13px] text-fg-muted pl-[22px] mb-4">
              {formatEventWhen(selectedEvent)}
            </p>

            <div className="space-y-3 pl-[22px]">
              {selectedEvent.location && (
                <div className="flex items-start gap-2 text-[13px] text-fg-muted">
                  <MapPin size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-fg-subtle" />
                  <span>{selectedEvent.location}</span>
                </div>
              )}

              {selectedEvent.organizer?.email && (
                <div className="flex items-start gap-2 text-[13px] text-fg-muted">
                  <User size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-fg-subtle" />
                  <span>
                    Organized by{" "}
                    {selectedEvent.organizer.self ? "you" : selectedEvent.organizer.email}
                  </span>
                </div>
              )}

              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div className="flex items-start gap-2 text-[13px] text-fg-muted">
                  <Users size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-fg-subtle" />
                  <div className="flex flex-col gap-0.5">
                    {selectedEvent.attendees.map((a) => (
                      <span key={a.email}>
                        {a.email}
                        {a.responseStatus && (
                          <span className="text-fg-subtle"> · {a.responseStatus}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedEvent.status && selectedEvent.status !== "confirmed" && (
                <div className="text-[13px] text-warning capitalize">
                  {selectedEvent.status}
                </div>
              )}
            </div>

            {selectedEvent.htmlLink && (
              <a
                href={selectedEvent.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-sine-indigo hover:text-sine-indigo/80 transition-colors duration-150"
              >
                Open in Google Calendar
                <ExternalLink size={13} strokeWidth={2} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Share calendar modal */}
      <Modal
        open={shareModalOpen}
        onClose={closeShareModal}
        title="Share calendar"
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              onClick={closeShareModal}
              disabled={sharing}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={confirmShare}
              disabled={sharing || selectedMemberIds.size === 0}
              className="px-3.5 py-2 rounded-md text-sm font-semibold bg-warning text-bg-base hover:bg-warning/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {sharing ? "Sharing…" : selectedMemberIds.size > 0 ? `Share (${selectedMemberIds.size})` : "Share"}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-muted mb-4">
          Choose who gets access to your Google Calendar, and how much.
        </p>

        {shareMembersLoading && (
          <div className="flex items-center gap-3 text-fg-muted py-6">
            <div data-sybil-state="thinking">
              <SineWave height={20} className="w-20" />
            </div>
            <span className="text-sm animate-pulse">Loading team members…</span>
          </div>
        )}

        {!shareMembersLoading && shareMembersError && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-fg-primary">
            Failed to load team members: {shareMembersError}
          </div>
        )}

        {!shareMembersLoading && !shareMembersError && shareableMembers.length === 0 && (
          <div className="border border-dashed border-fg-subtle/25 rounded-lg px-5 py-6 text-center text-sm text-fg-subtle">
            No other team members to share with yet.
          </div>
        )}

        {!shareMembersLoading && !shareMembersError && shareableMembers.length > 0 && (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto -mx-1 px-1">
            {shareableMembers.map((m) => {
              const selected = selectedMemberIds.has(m.id);
              const level = accessLevelFor(m);
              const result = shareResults?.[m.id];
              const isGuest = m.role === "guest";
              return (
                <div
                  key={m.id}
                  className={`flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 rounded-lg border px-3.5 py-2.5 transition-colors duration-150 ${
                    selected ? "border-warning/40 bg-warning/5" : "border-fg-subtle/15"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleMemberSelected(m)}
                      className="w-4 h-4 shrink-0 accent-warning cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-medium text-fg-primary truncate">{m.email}</p>
                      <p className="text-[11.5px] text-fg-subtle capitalize">{m.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 pl-7 sm:pl-0">
                    <select
                      value={level}
                      disabled={isGuest}
                      onChange={(e) => setAccessLevelFor(m.id, e.target.value as AccessLevel)}
                      title={isGuest ? "Guests can only view" : undefined}
                      className="shrink-0 bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-xs text-fg-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <option value="reader">Can view</option>
                      <option value="writer">Can edit</option>
                    </select>
                    {result &&
                      (result.success ? (
                        <Check size={15} strokeWidth={2.5} className="text-success shrink-0" />
                      ) : (
                        <span title={result.message}>
                          <AlertCircle size={15} strokeWidth={2} className="text-danger shrink-0" />
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {shareResults && (
          <div className="mt-4 text-[13px]">
            {Object.values(shareResults).every((r) => r.success) ? (
              <p className="text-success">Calendar shared successfully.</p>
            ) : (
              <p className="text-danger">Some shares failed — check the icons above.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
