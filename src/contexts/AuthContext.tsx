import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../config/supabase";
import { clearActivity, isIdleExpired, touchActivity, useIdleTimeout } from "../hooks/useIdleTimeout";
import type { MinimalProfile } from "../utils/displayName";
import { DEMO_ACCOUNT_EMAIL } from "../lib/demoLimit";

/** sybil_profiles row shape as read by AuthContext — superset of MinimalProfile. */
export interface SybilProfile extends MinimalProfile {
  avatar_url?: string | null;
  status?: "active" | "deactivated" | null;
  deactivated_at?: string | null;
  /** True once the user has finished (or skipped) the first-login product tour. */
  onboarding_completed?: boolean | null;
  /** Self-reported job category, used only to personalize the tour's example copy. Null if skipped before answering. */
  job_profile?: string | null;
}

// Role hierarchy: each role also has every permission of the roles below it
// (owner > admin > member > guest), so "owner" alone unlocks admin-gated UI.
const ROLE_RANK: Record<string, number> = {
  owner: 3,
  admin: 2,
  member: 1,
  guest: 0,
};
export type TeamRole = keyof typeof ROLE_RANK;

export interface WorkspaceMembership {
  workspaceId: string;
  workspaceName: string;
  role: string;
}

export type PlatformRole = "superadmin" | "staff" | null;

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** sybil_profiles row for the current user, or null if absent/not loaded/table not deployed yet — see getDisplayName(). */
  profile: SybilProfile | null;
  /** True while the profile is being (re)fetched for the current user. */
  profileLoading: boolean;
  /**
   * True ONLY when profile.status is exactly "deactivated" — absent profile,
   * null/undefined status, or a failed fetch all default to false (active).
   * A false positive here locks every user out of the app, so this must
   * never be inferred from anything but an explicit "deactivated" value.
   */
  isDeactivated: boolean;
  /**
   * True ONLY when profile.onboarding_completed is exactly `false` — absent
   * profile, null/undefined, or a failed fetch all default to false (don't
   * show the tour). Mirrors isDeactivated's fail-open reasoning: a read
   * failure must never force a user into onboarding, only ever skip it.
   */
  needsOnboarding: boolean;
  /** workspace_members.role for the current user in the active workspace, or null while unknown/unset. */
  role: string | null;
  /** True while role is being fetched (only meaningful once a user exists). */
  roleLoading: boolean;
  /** True when the current role's rank is >= the given role's rank. */
  hasRole: (minRole: TeamRole) => boolean;
  /**
   * Shorthand for hasRole("admin"). This is a WORKSPACE-management permission
   * (can invite/remove members, change roles) — it is NOT platform admin
   * access. Do not use this to gate the /admin panel or its nav link; use
   * isPlatformAdmin for that instead.
   */
  isTeamAdmin: boolean;
  /**
   * The caller's row in platform_admins, resolved server-side via the
   * get_platform_role() RPC — the table itself isn't readable by clients.
   * Global per-user, deliberately not tied to any single workspace
   * membership (a user can belong to several workspaces; platform admin
   * isn't a per-workspace thing). No self-service UI for it — only
   * grantable via direct DB write or another superadmin's admin_grant call.
   */
  platformRole: PlatformRole;
  /** Shorthand for `platformRole !== null` — grants access to the site-wide Admin panel. Kept as its own field so existing consumers don't need to know about platformRole. */
  isPlatformAdmin: boolean;
  /** The workspace the rest of the app should scope queries to. */
  activeWorkspaceId: string | null;
  /** Every workspace the current user belongs to (usually just one today). */
  workspaces: WorkspaceMembership[];
  /** Switches the active workspace among `workspaces` — no-op if not a member. */
  setActiveWorkspaceId: (id: string) => void;
  /** Re-fetches `workspaces` from the server — e.g. right after create/join. */
  refreshWorkspaces: () => Promise<void>;
  /** Re-fetches `profile` from sybil_profiles — e.g. right after Settings > Account saves a display name. */
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs out after account-manage's `delete` action succeeds — lands on the public home page (`/?accountDeleted=1`) instead of /login, since the account no longer exists to log back into. */
  signOutAfterDeletion: () => Promise<void>;
  /** Set once the shared demo account (demo@sybil.local) hits its server-side per-visitor usage quota — Layout renders a blocking, non-dismissable modal app-wide while this is true. */
  demoLimitReached: boolean;
  setDemoLimitReached: (v: boolean) => void;
}

const noopHasRole = () => false;

// OnboardingTour remembers "already dismissed this session" in sessionStorage
// (keyed by user id) so it survives remounting when Layout crosses in/out of
// /docs — see isTourDismissedThisSession. sessionStorage otherwise outlives
// sign-out (it's cleared only when the tab closes, not on navigation), so
// without this, signing back in as the demo account — whose needsOnboarding
// is permanently true — would silently skip the tour it's meant to always
// show. Clearing here, not in OnboardingTour, avoids a circular import.
function clearOnboardingDismissal(): void {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("sybil_onboarding_dismissed_")) sessionStorage.removeItem(key);
  }
}

export const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  profile: null,
  profileLoading: true,
  isDeactivated: false,
  needsOnboarding: false,
  role: null,
  roleLoading: true,
  hasRole: noopHasRole,
  isTeamAdmin: false,
  platformRole: null,
  isPlatformAdmin: false,
  activeWorkspaceId: null,
  workspaces: [],
  setActiveWorkspaceId: () => {},
  refreshWorkspaces: async () => {},
  refreshProfile: async () => {},
  signOut: async () => {},
  signOutAfterDeletion: async () => {},
  demoLimitReached: false,
  setDemoLimitReached: () => {},
});

/**
 * Provides auth state to the entire app.
 * Listens for Supabase auth changes.
 *
 * The team role fetch lives here (not in a component-level hook) and is
 * wrapped in try/catch on purpose: a route-gating component (Layout,
 * PlatformAdminRoute) that fires its own unguarded async Supabase query at mount
 * can be evaluated by native.builder's build/preview pipeline outside a
 * real authenticated session — a rejected promise there previously got
 * "fixed" by native.builder silently deleting the role check entirely.
 * Centralizing + catching here keeps that fetch in one controlled place
 * and degrades to role=null instead of ever throwing.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SybilProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [platformRole, setPlatformRole] = useState<PlatformRole>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);
  const [demoLimitReached, setDemoLimitReached] = useState(false);

  // Shared by: the explicit user-facing signOut(), the on-load stale-session
  // check below, the idle-timeout callback, and post-account-deletion — all
  // need the exact same "clear everything, don't leave an ambiguous
  // half-logged-in state" behavior, differing only in where they land after.
  // "deleted" is distinct from the others: the account itself no longer
  // exists server-side, so it lands on the public home page instead of
  // /login (there's nothing to log back into).
  const forceSignOut = useCallback(async (reason?: "timeout" | "deleted") => {
    try {
      // scope: 'global' revokes the refresh token server-side (all devices),
      // not just this tab's local copy. For "deleted" the account (and thus
      // the token) is already gone server-side, so this is a best-effort
      // local cleanup call — errors here are expected and fine.
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // Network down, or the token was already expired/invalid server-side.
      // Either way the user must never be left looking logged-in — clear
      // local state and redirect regardless of whether the server call
      // actually succeeded.
    }
    clearActivity();
    clearOnboardingDismissal();
    setSession(null);
    setUser(null);
    setProfile(null);
    setWorkspaces([]);
    setActiveWorkspaceIdState(null);
    setPlatformRole(null);
    setDemoLimitReached(false);
    if (reason === "deleted") {
      window.location.href = "/?accountDeleted=1";
      return;
    }
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = reason ? `/login?reason=${reason}` : "/login";
    }
  }, []);

  /** Called after account-manage's `delete` action succeeds — see DeleteAccountDialog. */
  const signOutAfterDeletion = useCallback(() => forceSignOut("deleted"), [forceSignOut]);

  const handleIdleTimeout = useCallback(() => {
    forceSignOut("timeout");
  }, [forceSignOut]);

  // Convenience-only client-side idle timeout — see useIdleTimeout.ts for
  // why this isn't a real security boundary. Only tracks activity while a
  // user is actually signed in.
  useIdleTimeout(!!user, handleIdleTimeout);

  useEffect(() => {
    async function init() {
      // Catches "closed the laptop, reopened it the next day" — must run
      // BEFORE getSession() resolves and BEFORE anything renders as
      // authenticated, or the stale session flashes through first.
      if (isIdleExpired()) {
        await forceSignOut("timeout");
        setLoading(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (session) touchActivity();
    }
    init();

    // Listen for changes — this also covers cross-tab sync: supabase-js
    // mirrors localStorage-backed session changes across tabs (native
    // 'storage' event) and fires SIGNED_OUT here when that happens in
    // another tab, or when a silent token refresh fails irrecoverably.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === "SIGNED_OUT") {
        clearActivity();
        clearOnboardingDismissal();
        if (!window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [forceSignOut]);

  const loadProfile = useCallback(async (currentUser: User) => {
    try {
      const { data, error } = await supabase
        .from("sybil_profiles")
        .select("display_name, avatar_url, status, deactivated_at, onboarding_completed, job_profile")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      // A missing table (not deployed to this environment yet) or a missing
      // row both surface as a normal Postgrest response here, not a thrown
      // error — either way, falling back to null (→ active, see isDeactivated)
      // is correct, not a failure.
      if (error) {
        console.error("Failed to load sybil_profiles:", error.message);
        setProfile(null);
      } else {
        setProfile(data ?? null);
      }
    } catch (err) {
      // Network failure etc. — degrade to "no profile" (→ active), never to
      // "deactivated". A transient error here must not lock anyone out.
      console.error("Failed to load sybil_profiles:", err);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    // Wait for session resolution first — same reasoning as the workspaces
    // effect below: `user` being null here can mean "not logged in" or
    // "haven't checked yet", and we must not settle profileLoading=false on
    // the latter.
    if (loading) return;

    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);
    loadProfile(user).finally(() => {
      if (!cancelled) setProfileLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user, loading, loadProfile]);

  // Exposed so Settings > Account can pull a freshly-saved display_name
  // into context right after saving, without a full page reload.
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    await loadProfile(user);
  }, [user, loadProfile]);

  const loadWorkspaces = useCallback(async (currentUser: User) => {
    const [membershipsRes, adminRes] = await Promise.all([
      supabase
        .from("workspace_members")
        .select("workspace_id, role, joined_at, workspaces(name)")
        .eq("user_id", currentUser.id)
        .order("joined_at", { ascending: true }),
      supabase.rpc("get_platform_role"),
    ]);

    const rows = (membershipsRes.data ?? []) as unknown as Array<{
      workspace_id: string;
      role: string;
      workspaces: { name: string } | null;
    }>;
    const memberships: WorkspaceMembership[] = rows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceName: row.workspaces?.name ?? "Workspace",
      role: row.role,
    }));
    setWorkspaces(memberships);
    setActiveWorkspaceIdState((prev) =>
      prev && memberships.some((m) => m.workspaceId === prev) ? prev : (memberships[0]?.workspaceId ?? null),
    );
    const resolvedRole: PlatformRole =
      !adminRes.error && (adminRes.data === "superadmin" || adminRes.data === "staff")
        ? adminRes.data
        : null;
    setPlatformRole(resolvedRole);
  }, []);

  useEffect(() => {
    // Session resolution (the other effect, `getSession()`) is still in
    // flight — `user` being null right now doesn't mean "logged out", it
    // means "haven't checked yet". Concluding roleLoading=false/workspaces=[]
    // here would race a fresh page load: Layout's zero-workspace redirect
    // could fire on that transient false-empty state before the real user
    // (and their real workspaces) ever loads. Stay in the initial
    // roleLoading=true state until the session check itself is done.
    if (loading) return;

    if (!user) {
      setWorkspaces([]);
      setActiveWorkspaceIdState(null);
      setPlatformRole(null);
      setRoleLoading(false);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);

    loadWorkspaces(user)
      .catch(() => {
        if (!cancelled) {
          setWorkspaces([]);
          setActiveWorkspaceIdState(null);
          setPlatformRole(null);
        }
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, loading, loadWorkspaces]);

  // Exposed so a flow like /welcome (create/join a workspace) can pull the
  // freshly-created membership into context without a full page reload.
  const refreshWorkspaces = useCallback(async () => {
    if (!user) return;
    try {
      await loadWorkspaces(user);
    } catch {
      // Best-effort — the next natural refetch (e.g. next auth state change)
      // will catch up if this one fails.
    }
  }, [user, loadWorkspaces]);

  const role = workspaces.find((w) => w.workspaceId === activeWorkspaceId)?.role ?? null;

  const hasRole = (minRole: TeamRole) => {
    const rank = role ? (ROLE_RANK[role] ?? 0) : 0;
    return rank >= ROLE_RANK[minRole];
  };

  const setActiveWorkspaceId = (id: string) => {
    if (workspaces.some((w) => w.workspaceId === id)) setActiveWorkspaceIdState(id);
  };

  const signOut = useCallback(() => forceSignOut(), [forceSignOut]);

  // Strict equality on purpose — see isDeactivated's doc comment on
  // AuthState: anything other than the literal "deactivated" string means
  // active, including null/undefined/absent-profile.
  const isDeactivated = profile?.status === "deactivated";

  // Same strict-equality reasoning as isDeactivated, inverted: only an
  // explicit `false` shows the tour. Absent/null/error all resolve to
  // "don't show" so a profile read failure never traps a user in onboarding.
  // The shared demo account always gets the tour, regardless of what's
  // persisted — every visitor should see it, not just the first one.
  const needsOnboarding =
    profile?.onboarding_completed === false || user?.email === DEMO_ACCOUNT_EMAIL;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        profile,
        profileLoading,
        isDeactivated,
        needsOnboarding,
        role,
        roleLoading,
        hasRole,
        isTeamAdmin: hasRole("admin"),
        platformRole,
        isPlatformAdmin: platformRole !== null,
        activeWorkspaceId,
        workspaces,
        setActiveWorkspaceId,
        refreshWorkspaces,
        refreshProfile,
        signOut,
        signOutAfterDeletion,
        demoLimitReached,
        setDemoLimitReached,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
