import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useContext, useEffect, useLayoutEffect, useState, useCallback } from "react";
import {
  Activity as ActivityIcon,
  MessageSquare,
  Users,
  Mail as MailIcon,
  SquareCheck,
  List,
  Calendar as CalendarIcon,
  SatelliteDish,
  BookOpen,
  Settings as SettingsIcon,
  Shield,
  SquarePen,
  LogOut,
  Menu,
  Share2,
  Gift,
} from "lucide-react";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import { useTeamRole } from "../hooks/useTeamRole";
import { listConversations, listSharedConversations, type ConversationRow, type SharedConversationRow } from "../lib/sybil";
import { listEmails } from "../lib/mail";
import { listCalendarEvents } from "../lib/calendar";
import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import MusicPlayer from "./MusicPlayer";
import ChatListItem from "./ChatListItem";
import SharedChatListItem from "./SharedChatListItem";
import ShareChatModal from "./ShareChatModal";
import OnboardingTour, { isTourDismissedThisSession } from "./onboarding/OnboardingTour";
import OnboardingSurvey, { hasGivenSurveyFeedback } from "./onboarding/OnboardingSurvey";
import DemoLimitModal from "./DemoLimitModal";
import { DEMO_ACCOUNT_EMAIL } from "../lib/demoLimit";

const ICON_SIZE = 18;
const ICON_STROKE = 1.8;

// Kept in sync by hand with the same constant in Sentinels.tsx / SettingsPlan.tsx
// (no shared plans module yet).
const SENTINEL_LIMIT = 3;
const PLAN_LABEL = "Free";
const SIDEBAR_CHAT_LIMIT = 3;

type AgentStatus = "active" | "degraded" | "inactive";

const AGENT_STATUS_META: Record<AgentStatus, { label: string; color: string; glow: string }> = {
  active: { label: "Active", color: "var(--color-sine-mint)", glow: "rgba(35,209,139,.18)" },
  degraded: { label: "Degraded", color: "var(--color-warning)", glow: "rgba(255,158,10,.18)" },
  inactive: { label: "Inactive", color: "var(--color-fg-subtle)", glow: "rgba(110,118,129,.18)" },
};

const NAV_ICONS: Record<string, React.ReactNode> = {
  pulse: <ActivityIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  chat: <MessageSquare size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  team: <Users size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  mail: <MailIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  tasks: <SquareCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  activity: <List size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  calendar: <CalendarIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  sentinels: <SatelliteDish size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  docs: <BookOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  settings: <SettingsIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
  admin: <Shield size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
};

/** Small colored count badge, shown inline (e.g. beside a sidebar label). Never rendered for a zero/unknown count. */
function NavCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-[18px] h-[18px] px-[5px] rounded-full bg-danger text-[11px] leading-[18px] font-bold text-white text-center pointer-events-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Same badge, pinned to the corner of an icon — for spots with no label to sit beside (e.g. the topbar gift icon). Kept close to the icon (not poking far above it) so it doesn't get clipped when the icon sits near the top of the viewport. */
function NavCountBadgeCorner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute top-0 right-0 min-w-[13px] h-[13px] px-[3px] rounded-full bg-danger text-[8px] leading-[13px] font-bold text-white text-center pointer-events-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const navLinks = [
  { to: "/pulse", label: "Pulse", icon: "pulse", tour: "nav-pulse" },
  { to: "/chats", label: "Chat", icon: "chat", tour: "nav-chat" },
  { to: "/team", label: "Team", icon: "team", tour: "nav-team" },
  { to: "/calendar", label: "Calendar", icon: "calendar", tour: "nav-calendar" },
  { to: "/mail", label: "Mail", icon: "mail", tour: "nav-mail" },
  { to: "/tasks", label: "Tasks", icon: "tasks", tour: "nav-tasks" },
  { to: "/activity", label: "Activity", icon: "activity", tour: "nav-activity" },
  { to: "/sentinels", label: "Sentinels", icon: "sentinels", tour: "nav-sentinels" },
  { to: "/docs", label: "Documentation", icon: "docs" },
  { to: "/settings", label: "Settings", icon: "settings", tour: "nav-settings" },
];

/**
 * App shell with sidebar navigation, per-user chat list, and a top bar
 * hosting the account menu (avatar + dropdown).
 */
export default function Layout({ children }: { children?: React.ReactNode } = {}) {
  const { session, signOut, needsOnboarding, demoLimitReached } = useContext(AuthContext);
  const { isPlatformAdmin, workspaces, setActiveWorkspaceId, workspaceId, loading: roleLoading } = useTeamRole();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveyGiven, setSurveyGiven] = useState(false);

  const refreshSurveyGiven = useCallback(() => {
    if (session?.user) setSurveyGiven(hasGivenSurveyFeedback(session.user.id, session.user.email));
  }, [session]);

  useEffect(() => {
    refreshSurveyGiven();
  }, [refreshSurveyGiven]);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeConversationId = searchParams.get("c");

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, activeConversationId]);

  // Hides the iubenda floating preferences button (kept on public pages)
  // only while a backoffice route is mounted. Runs pre-paint (useLayoutEffect)
  // and resets scroll so a sub-pixel body scroll picked up before the class
  // lands can't stay "frozen" once overflow becomes hidden, shifting the
  // whole app up under the browser chrome.
  useLayoutEffect(() => {
    document.body.classList.add("sybil-backoffice");
    window.scrollTo(0, 0);
    return () => document.body.classList.remove("sybil-backoffice");
  }, []);

  const handleNewChat = useCallback(() => {
    navigate("/dashboard");
    window.dispatchEvent(new Event("sybil:new-chat"));
  }, [navigate]);

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [sharedConversations, setSharedConversations] = useState<SharedConversationRow[]>([]);

  const [sentinelSummary, setSentinelSummary] = useState({ total: 0, activeCount: 0, hasActive: false, hasError: false });

  const refreshSentinelSummary = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("sybil_sentinels")
      .select("status")
      .eq("workspace_id", workspaceId);
    const rows = data ?? [];
    setSentinelSummary({
      total: rows.length,
      activeCount: rows.filter((r) => r.status === "active").length,
      hasActive: rows.some((r) => r.status === "active"),
      hasError: rows.some((r) => r.status === "error"),
    });
  }, [workspaceId]);

  useEffect(() => {
    refreshSentinelSummary();
  }, [refreshSentinelSummary, location.pathname]);

  // Nav badge counts — Mail (unread) and Calendar (today's events). Both
  // fail silently (Google not connected, or gmail/calendar disabled in
  // Settings) since these are just topbar hints, never a blocking fetch.
  const [unreadMailCount, setUnreadMailCount] = useState(0);
  const [todayEventCount, setTodayEventCount] = useState(0);

  const refreshUnreadMailCount = useCallback(async () => {
    try {
      const res = await listEmails({ query: "is:unread", max_results: 1 });
      setUnreadMailCount(res.result_size_estimate ?? 0);
    } catch {
      setUnreadMailCount(0);
    }
  }, []);

  const refreshTodayEventCount = useCallback(async () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    try {
      const res = await listCalendarEvents({
        time_min: startOfToday.toISOString(),
        time_max: endOfToday.toISOString(),
        max_results: 50,
      });
      setTodayEventCount(res.events.filter((e) => e.status !== "cancelled").length);
    } catch {
      setTodayEventCount(0);
    }
  }, []);

  useEffect(() => {
    refreshUnreadMailCount();
    refreshTodayEventCount();
  }, [refreshUnreadMailCount, refreshTodayEventCount, location.pathname]);

  const navBadgeCount = useCallback(
    (icon: string): number => {
      if (icon === "mail") return unreadMailCount;
      if (icon === "calendar") return todayEventCount;
      if (icon === "sentinels") return sentinelSummary.activeCount;
      return 0;
    },
    [unreadMailCount, todayEventCount, sentinelSummary.activeCount],
  );

  const agentStatus: AgentStatus = sentinelSummary.hasError
    ? "degraded"
    : sentinelSummary.hasActive
      ? "active"
      : "inactive";

  const refreshConversations = useCallback(async () => {
    if (!session) return;
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
  }, [session]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations, location.pathname]);

  useEffect(() => {
    window.addEventListener("sybil:conversations-changed", refreshConversations);
    return () => window.removeEventListener("sybil:conversations-changed", refreshConversations);
  }, [refreshConversations]);

  // Every workspace-scoped page in this layout assumes at least one
  // workspace — a user who hasn't created or joined one yet gets sent to
  // onboarding instead of silently rendering empty/broken pages everywhere.
  // The shared demo account always has exactly one pre-provisioned workspace
  // and is DB-blocked from creating/joining another (see
  // guard_demo_no_extra_workspace/_membership) — never route it to /welcome,
  // even on a transient empty-workspaces read, since Create/Join would just
  // dead-end there.
  if (!roleLoading && workspaces.length === 0 && session?.user?.email !== DEMO_ACCOUNT_EMAIL) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base overflow-hidden">
      <DemoLimitModal open={demoLimitReached} />
      {/* Top bar — full width, sits above both the sidebar and main content */}
      <div
        className={`shrink-0 h-[58px] border-b border-fg-subtle/15 flex items-center gap-3 ${
          location.pathname === "/dashboard" ? "items-end pb-2" : ""
        }`}
      >
        {/* Brand zone — matches the sidebar's width from md: up, so it sits directly above it */}
        <div className="flex items-center gap-2 px-3 sm:px-5 md:w-64 md:shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="md:hidden shrink-0 -ml-1 p-1.5 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
          >
            <Menu size={20} strokeWidth={1.8} />
          </button>
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <img src="/svg/sybil-mark.svg" alt="" className="h-[18px] w-auto" />
            <span className="font-bold text-[15px] tracking-tight text-fg-primary">sybil</span>
          </Link>
        </div>

        {/* Status chips — aligned with the main content column, same spot they occupied before */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0 sm:hidden"
            style={{
              background: AGENT_STATUS_META[agentStatus].color,
              boxShadow: `0 0 0 3px ${AGENT_STATUS_META[agentStatus].glow}`,
            }}
          />
          <div className="hidden sm:flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-fg-subtle/20 pl-2 pr-2.5 py-1 text-xs font-semibold text-fg-primary whitespace-nowrap">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: AGENT_STATUS_META[agentStatus].color,
                  boxShadow: `0 0 0 3px ${AGENT_STATUS_META[agentStatus].glow}`,
                }}
              />
              {AGENT_STATUS_META[agentStatus].label}
            </span>
            <span className="rounded-full border border-fg-subtle/20 px-2.5 py-1 text-xs font-medium text-fg-muted whitespace-nowrap">
              {PLAN_LABEL} plan
            </span>
            <span className="rounded-full border border-fg-subtle/20 px-2.5 py-1 text-xs font-medium text-fg-muted whitespace-nowrap">
              {Math.max(SENTINEL_LIMIT - sentinelSummary.total, 0)}/{SENTINEL_LIMIT} sentinels
            </span>
            <button
              type="button"
              onClick={() => setSurveyOpen(true)}
              aria-label="Quick feedback"
              title="Quick feedback"
              className="relative p-1.5 rounded-full text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
            >
              <Gift size={16} strokeWidth={1.8} />
              <NavCountBadgeCorner count={surveyGiven ? 0 : 1} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 px-3 sm:px-5">
          <MusicPlayer />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Mobile backdrop */}
        {mobileNavOpen && (
          <div
            className="fixed top-[58px] inset-x-0 bottom-0 z-30 bg-black/50 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed top-[58px] bottom-0 left-0 z-40 w-64 bg-bg-base border-r border-fg-subtle/15 flex flex-col shrink-0 transform transition-transform duration-200 ease-out md:static md:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {workspaces.length > 1 && (
            <div className="px-6 pt-5 mb-3">
              <select
                value={workspaceId ?? ""}
                onChange={(e) => setActiveWorkspaceId(e.target.value)}
                aria-label="Active workspace"
                className="w-full bg-bg-elevated border border-fg-subtle/20 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-fg-primary cursor-pointer"
              >
                {workspaces.map((w) => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.workspaceName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {workspaces.length > 1 && <div className="h-px bg-fg-subtle/15 mx-6 mb-[14px]" />}

          {/* Nav */}
          <nav className={`flex flex-col gap-px px-3.5 shrink-0 ${workspaces.length > 1 ? "" : "pt-5"}`}>
            {navLinks.slice(0, 1).map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  data-tour={link.tour}
                  className={`flex items-center gap-3 px-3 py-[7px] rounded-lg text-sm font-medium transition-colors duration-150 ${
                    active
                      ? "bg-sine-indigo/12 text-fg-primary"
                      : "text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50"
                  }`}
                >
                  <span className={active ? "text-sine-indigo" : "text-fg-subtle"}>
                    {NAV_ICONS[link.icon]}
                  </span>
                  {link.label}
                </Link>
              );
            })}

            {/* New chat */}
            <button
              type="button"
              onClick={handleNewChat}
              className="flex items-center gap-3 px-3 py-[7px] rounded-lg text-sm font-medium text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
            >
              <SquarePen size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-fg-subtle" />
              New chat
            </button>

            {navLinks.slice(1).map((link) => {
              const active =
                !activeConversationId &&
                (link.to === "/settings" || link.to === "/docs"
                  ? location.pathname.startsWith(link.to)
                  : location.pathname === link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  data-tour={link.tour}
                  className={`flex items-center gap-3 px-3 py-[7px] rounded-lg text-sm font-medium transition-colors duration-150 ${
                    active
                      ? "bg-sine-indigo/12 text-fg-primary"
                      : "text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50"
                  }`}
                >
                  <span className={active ? "text-sine-indigo" : "text-fg-subtle"}>
                    {NAV_ICONS[link.icon]}
                  </span>
                  <span className="flex-1">{link.label}</span>
                  <NavCountBadge count={navBadgeCount(link.icon)} />
                </Link>
              );
            })}

          </nav>

          {/* Chat list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3.5 mt-4 flex flex-col gap-0.5">
            {conversations.length > 0 && (
              <div className="flex items-center justify-between pb-1.5 pl-3 pr-1">
                <span className="text-[11px] font-semibold tracking-wide uppercase text-fg-subtle">
                  Chats
                </span>
                <button
                  type="button"
                  onClick={() => setShareModalOpen(true)}
                  aria-label="Share chats"
                  title="Share chats"
                  className="p-1 rounded-md text-fg-subtle hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
                >
                  <Share2 size={13} strokeWidth={1.8} />
                </button>
              </div>
            )}
            {conversations.slice(0, SIDEBAR_CHAT_LIMIT).map((c) => (
              <ChatListItem
                key={c.id}
                conversation={c}
                active={location.pathname === "/dashboard" && activeConversationId === c.id}
                onRenamed={(id, title) =>
                  setConversations((prev) => prev.map((row) => (row.id === id ? { ...row, title } : row)))
                }
                onDeleted={(id) => {
                  setConversations((prev) => prev.filter((row) => row.id !== id));
                  if (activeConversationId === id) handleNewChat();
                }}
              />
            ))}

            {sharedConversations.length > 0 && (
              <div className="flex items-center pb-1.5 pl-3 pr-1 mt-4">
                <span className="text-[11px] font-semibold tracking-wide uppercase text-fg-subtle">
                  Shared with you
                </span>
              </div>
            )}
            {sharedConversations.slice(0, SIDEBAR_CHAT_LIMIT).map((c) => (
              <SharedChatListItem
                key={c.id}
                conversation={c}
                active={location.pathname === "/dashboard" && activeConversationId === c.id}
              />
            ))}

            {(conversations.length > SIDEBAR_CHAT_LIMIT || sharedConversations.length > SIDEBAR_CHAT_LIMIT) && (
              <Link
                to="/chats"
                className="text-[12.5px] font-medium text-fg-subtle hover:text-fg-primary transition-colors duration-150 pl-3 pr-1 py-1.5 mt-1"
              >
                View all chats →
              </Link>
            )}
          </div>

          {/* Admin — pinned below the (scrollable) chat list, always visible */}
          {isPlatformAdmin && (
            <div className="px-3.5 pt-3 shrink-0 border-t border-fg-subtle/15">
              <Link
                to="/admin"
                className={`flex items-center gap-3 px-3 py-[7px] rounded-lg text-sm font-medium transition-colors duration-150 ${
                  location.pathname.startsWith("/admin")
                    ? "bg-sine-indigo/12 text-fg-primary"
                    : "text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50"
                }`}
              >
                <span
                  className={
                    location.pathname.startsWith("/admin") ? "text-sine-indigo" : "text-fg-subtle"
                  }
                >
                  {NAV_ICONS.admin}
                </span>
                Admin
              </Link>
            </div>
          )}

          {/* Logout */}
          {session && (
            <div
              className={`px-3.5 py-4 shrink-0 ${isPlatformAdmin ? "" : "border-t border-fg-subtle/15"}`}
            >
              <button
                onClick={() => signOut()}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
              >
                <LogOut size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-fg-subtle" />
                Logout
              </button>
            </div>
          )}
        </aside>

        {/* Main area */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children ?? <Outlet />}
        </main>
      </div>

      <ShareChatModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        scope="general"
        conversations={conversations}
      />

      {needsOnboarding &&
        !location.pathname.startsWith("/docs") &&
        !(session?.user && isTourDismissedThisSession(session.user.id)) && (
          <OnboardingTour setMobileNavOpen={setMobileNavOpen} />
        )}
      <OnboardingSurvey
        open={surveyOpen}
        onClose={() => {
          setSurveyOpen(false);
          refreshSurveyGiven();
        }}
      />
    </div>
  );
}
