import { useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Loader2, MoreHorizontal } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { copy } from "../config/tokens";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import { useTeamRole } from "../hooks/useTeamRole";
import SineWave from "../components/SineWave";
import Modal from "../components/Modal";

// ── Types ────────────────────────────────────────────────────

type Role = "owner" | "admin" | "member" | "guest";

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: Role;
  joinedAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

type Toast = { type: "success" | "error"; message: string };

// ── Helpers ──────────────────────────────────────────────────

const ROLE_META: Record<Role, { label: string; text: string; bg: string; border: string }> = {
  owner: { label: "Owner", text: "text-danger", bg: "bg-danger/14", border: "border-danger/32" },
  admin: { label: "Admin", text: "text-warning", bg: "bg-warning/14", border: "border-warning/32" },
  member: { label: "Member", text: "text-sine-cyan", bg: "bg-sine-cyan/14", border: "border-sine-cyan/32" },
  guest: { label: "Guest", text: "text-fg-subtle", bg: "bg-fg-subtle/14", border: "border-fg-subtle/32" },
};

const ASSIGNABLE_ROLES: Role[] = ["admin", "member", "guest"];

const AVATAR_PALETTE = [
  "bg-warning/22",
  "bg-sine-cyan/22",
  "bg-sine-indigo/22",
  "bg-success/22",
  "bg-fg-subtle/22",
  "bg-sine-acid/22",
];

// workspace_members has no display-name column — derive one from the email's
// local part (e.g. "marco.rossi@x.com" -> "Marco Rossi") instead of
// showing the raw address as the primary line.
function labelFromEmail(email: string): { name: string; initials: string } {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ") || email;
  const initials =
    parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : local.slice(0, 2).toUpperCase();
  return { name, initials };
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// The server is the actual authority on who may call team-manage (it
// re-checks the caller's role from their JWT on every request) — this only
// extracts a readable message out of a rejected call, it isn't the check.
async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // keep fallback
    }
  }
  return fallback;
}

function RoleBadge({ role }: { role: Role }) {
  const rm = ROLE_META[role];
  return (
    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border ${rm.bg} ${rm.text} ${rm.border}`}>
      {rm.label}
    </span>
  );
}

// ── Member row ───────────────────────────────────────────────

interface MemberRowProps {
  member: TeamMember;
  index: number;
  isYou: boolean;
  canManageTeam: boolean;
  onSetRole: (member: TeamMember, role: Role) => Promise<void>;
  onRequestRemove: (member: TeamMember) => void;
}

function MemberRow({ member, index, isYou, canManageTeam, onSetRole, onRequestRemove }: MemberRowProps) {
  const { name, initials } = labelFromEmail(member.email);
  const avatarBg = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
  const canManage = canManageTeam && member.role !== "owner" && !isYou;

  const [menuOpen, setMenuOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleSetRole(role: Role) {
    setMenuOpen(false);
    setUpdating(true);
    await onSetRole(member, role);
    setUpdating(false);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-5 py-4 border-b border-fg-subtle/10 last:border-b-0">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className={`w-10 h-10 rounded-full ${avatarBg} flex items-center justify-center text-sm font-semibold text-fg-primary shrink-0`}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-fg-primary truncate">
            {name}
            {isYou && <span className="text-fg-subtle font-normal"> · You</span>}
          </p>
          <p className="text-[13px] text-fg-muted mt-0.5 truncate">{member.email}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 pl-14 sm:pl-0">
        <RoleBadge role={member.role} />
        <span className="w-[130px] text-left sm:text-right text-[13px] text-fg-subtle">
          {formatJoined(member.joinedAt)}
        </span>
        <div className="relative w-9 h-9 shrink-0">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                disabled={updating}
                className="w-9 h-9 rounded-lg border border-fg-subtle/20 text-fg-muted hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={`Manage ${member.email}`}
              >
                {updating ? (
                  <Loader2 size={16} strokeWidth={1.8} className="animate-spin" />
                ) : (
                  <MoreHorizontal size={16} strokeWidth={1.8} />
                )}
              </button>
              {menuOpen && (
                <div
                  ref={menuRef}
                  className="absolute right-0 top-[calc(100%+6px)] w-44 bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-lg py-1.5 z-10"
                >
                  <div className="px-3.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                    Change role
                  </div>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => handleSetRole(r)}
                      disabled={r === member.role}
                      className="w-full text-left px-3.5 py-2 text-[13px] text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      {ROLE_META[r].label}
                    </button>
                  ))}
                  <div className="h-px bg-fg-subtle/15 my-1.5 mx-2" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onRequestRemove(member);
                    }}
                    className="w-full text-left px-3.5 py-2 text-[13px] text-danger hover:bg-danger/10 transition-colors duration-150 cursor-pointer"
                  >
                    Remove from team
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function Team() {
  const { user } = useContext(AuthContext);
  const { isTeamAdmin: canManageTeam, workspaceId } = useTeamRole();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invite | null>(null);
  const [cancelingInvite, setCancelingInvite] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [joinLink, setJoinLink] = useState<{ code: string; useCount: number } | null>(null);
  const [joinLinkLoading, setJoinLinkLoading] = useState(true);
  const [joinLinkBusy, setJoinLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    // Layout redirects to /welcome before this page can render without a
    // workspace, but guard anyway rather than spinning forever if reached.
    if (!workspaceId) {
      setMembersLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setMembersLoading(true);
      setMembersError(null);
      try {
        const { data, error } = await supabase
          .from("workspace_members")
          .select("id, user_id, email, role, joined_at")
          .eq("workspace_id", workspaceId)
          .order("joined_at", { ascending: true });

        if (cancelled) return;

        if (error) {
          setMembersError(error.message);
        } else {
          setMembers(
            (data ?? []).map((m) => ({
              id: m.id,
              userId: m.user_id,
              email: m.email,
              role: m.role as Role,
              joinedAt: m.joined_at,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setMembersError(err instanceof Error ? err.message : "Unexpected network error.");
        }
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setInvitesLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setInvitesLoading(true);
      setInvitesError(null);
      try {
        const { data, error } = await supabase
          .from("invites")
          .select("id, email, role, expires_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        if (error) {
          setInvitesError(error.message);
        } else {
          setInvites(
            (data ?? []).map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role as Role,
              expiresAt: i.expires_at,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setInvitesError(err instanceof Error ? err.message : "Unexpected network error.");
        }
      } finally {
        if (!cancelled) setInvitesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !canManageTeam) {
      setJoinLinkLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setJoinLinkLoading(true);
      const { data } = await supabase.functions.invoke("team-manage", {
        body: { action: "get_join_link", workspace_id: workspaceId },
      });
      if (cancelled) return;
      const link = data?.link as { code: string; use_count: number } | null | undefined;
      setJoinLink(link ? { code: link.code, useCount: link.use_count } : null);
      setJoinLinkLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, canManageTeam]);

  async function handleCreateJoinLink() {
    setJoinLinkBusy(true);
    const { data, error } = await supabase.functions.invoke("team-manage", {
      body: { action: "create_join_link", workspace_id: workspaceId, role: "member" },
    });
    setJoinLinkBusy(false);
    if (error) {
      showToast(await functionErrorMessage(error, "Failed to create invite link."), "error");
      return;
    }
    const link = data?.link as { code: string; use_count: number } | undefined;
    if (link) setJoinLink({ code: link.code, useCount: link.use_count });
  }

  async function handleRevokeJoinLink() {
    setJoinLinkBusy(true);
    const { error } = await supabase.functions.invoke("team-manage", {
      body: { action: "revoke_join_link", workspace_id: workspaceId },
    });
    setJoinLinkBusy(false);
    if (error) {
      showToast(await functionErrorMessage(error, "Failed to revoke invite link."), "error");
      return;
    }
    setJoinLink(null);
    showToast("Invite link revoked.");
  }

  function copyJoinLink() {
    if (!joinLink) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${joinLink.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function showToast(message: string, type: Toast["type"] = "success") {
    setToast({ type, message });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  async function handleSetRole(member: TeamMember, role: Role) {
    const { data, error } = await supabase.functions.invoke("team-manage", {
      body: { action: "set_role", member_id: member.id, role, workspace_id: workspaceId },
    });

    if (error) {
      showToast(await functionErrorMessage(error, "Failed to update role."), "error");
      return;
    }

    const updated = data?.member as
      | { id: string; user_id: string; email: string; role: Role; joined_at: string }
      | undefined;
    if (updated) {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === updated.id
            ? { id: updated.id, userId: updated.user_id, email: updated.email, role: updated.role, joinedAt: updated.joined_at }
            : m,
        ),
      );
    }
    showToast(`${member.email}'s role is now ${ROLE_META[role].label}.`);
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);

    const { error } = await supabase.functions.invoke("team-manage", {
      body: { action: "remove_member", member_id: removeTarget.id, workspace_id: workspaceId },
    });

    if (error) {
      showToast(await functionErrorMessage(error, "Failed to remove member."), "error");
    } else {
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
      showToast(`${removeTarget.email} was removed from the team.`);
    }
    setRemoving(false);
    setRemoveTarget(null);
  }

  async function confirmCancelInvite() {
    if (!cancelTarget) return;
    setCancelingInvite(true);

    const { error } = await supabase.functions.invoke("team-manage", {
      body: { action: "cancel_invite", invite_id: cancelTarget.id, workspace_id: workspaceId },
    });

    if (error) {
      showToast(await functionErrorMessage(error, "Failed to cancel invite."), "error");
    } else {
      setInvites((prev) => prev.filter((i) => i.id !== cancelTarget.id));
      showToast(`Invite to ${cancelTarget.email} cancelled.`);
    }
    setCancelingInvite(false);
    setCancelTarget(null);
  }

  async function sendInvite() {
    const email = newEmail.trim();
    if (!isValidEmail(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }

    setSending(true);
    setInviteError(null);

    const { data, error } = await supabase.functions.invoke("team-invite", {
      body: { email, role: newRole, workspace_id: workspaceId },
    });

    if (error) {
      setInviteError(await functionErrorMessage(error, "Failed to send invite. Try again."));
      setSending(false);
      return;
    }

    const invite = data?.invite as { id: string; email: string; role: Role; expires_at: string } | undefined;
    if (invite) {
      setInvites((prev) => [
        ...prev,
        { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expires_at },
      ]);
    }
    setNewEmail("");
    setSending(false);
    showToast(`Invite sent to ${email}.`);
  }

  const removeLabel = removeTarget ? labelFromEmail(removeTarget.email).name : "";

  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-fg-primary mb-2.5">
        {copy.pages.team.title}
      </h1>
      <p className="text-fg-muted text-sm mb-8">{copy.pages.team.subtitle}</p>

      {toast && (
        <div
          className={`flex items-center gap-2.5 rounded-lg px-4 py-3 mb-6 border ${
            toast.type === "success" ? "bg-success/12 border-success/35" : "bg-danger/10 border-danger/30"
          }`}
        >
          {toast.type === "success" ? (
            <Check size={16} strokeWidth={2.5} className="text-success shrink-0" />
          ) : (
            <AlertCircle size={16} strokeWidth={2} className="text-danger shrink-0" />
          )}
          <span className={`text-sm font-medium ${toast.type === "success" ? "text-success" : "text-danger"}`}>
            {toast.message}
          </span>
        </div>
      )}

      {/* Members */}
      <h2 className="text-sm font-medium text-fg-primary mb-3">
        Members {!membersLoading && !membersError && `(${members.length})`}
      </h2>

      {membersLoading && (
        <div className="flex items-center gap-3 text-fg-muted py-8 mb-8">
          <div data-sybil-state="thinking">
            <SineWave height={24} className="w-24" />
          </div>
          <span className="text-sm animate-pulse">Loading members…</span>
        </div>
      )}

      {!membersLoading && membersError && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-8 text-sm text-fg-primary">
          Failed to load members: {membersError}
        </div>
      )}

      {!membersLoading && !membersError && (
        <div className="mb-8">
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg">
            {members.map((m, i) => (
              <MemberRow
                key={m.id}
                member={m}
                index={i}
                isYou={m.userId === user?.id}
                canManageTeam={canManageTeam}
                onSetRole={handleSetRole}
                onRequestRemove={setRemoveTarget}
              />
            ))}
          </div>
          {members.length <= 1 && (
            <p className="text-[13px] text-fg-subtle mt-3">
              You're the only member of this workspace so far — invite teammates below.
            </p>
          )}
        </div>
      )}

      {/* Pending invites */}
      <h2 className="text-sm font-medium text-fg-primary mb-3">
        Pending invites {!invitesLoading && !invitesError && `(${invites.length})`}
      </h2>

      {invitesLoading && (
        <div className="flex items-center gap-3 text-fg-muted py-6 mb-8">
          <div data-sybil-state="thinking">
            <SineWave height={20} className="w-20" />
          </div>
          <span className="text-sm animate-pulse">Loading invites…</span>
        </div>
      )}

      {!invitesLoading && invitesError && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-8 text-sm text-fg-primary">
          Failed to load invites: {invitesError}
        </div>
      )}

      {!invitesLoading && !invitesError && (
        invites.length > 0 ? (
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden mb-8">
            {invites.map((inv) => {
              const days = daysUntil(inv.expiresAt);
              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-5 py-4 border-b border-fg-subtle/10 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-fg-primary truncate">{inv.email}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 flex-wrap">
                    <RoleBadge role={inv.role} />
                    <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold bg-warning/14 text-warning border border-warning/32">
                      Pending
                    </span>
                    <span className="w-[90px] text-right text-[13px] text-fg-subtle">
                      in {days} day{days === 1 ? "" : "s"}
                    </span>
                    {canManageTeam && (
                      <button
                        onClick={() => setCancelTarget(inv)}
                        className="px-3.5 py-1.5 rounded-md border border-fg-subtle/20 text-fg-muted text-xs font-semibold hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border border-dashed border-fg-subtle/25 rounded-lg px-5 py-6 text-center text-sm text-fg-subtle mb-8">
            No pending invites.
          </div>
        )
      )}

      {/* Invite form */}
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-5 sm:px-6 sm:py-6">
        <h2 className="text-[15px] font-semibold text-fg-primary mb-4">Invite a teammate</h2>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
          <input
            type="email"
            placeholder="name@company.com"
            value={newEmail}
            disabled={sending}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setInviteError(null);
            }}
            className="flex-1 bg-bg-base border border-fg-subtle/25 rounded-lg px-3.5 py-2.5 text-sm text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:border-fg-accent/50 transition-colors duration-150 disabled:opacity-50"
          />
          <select
            value={newRole}
            disabled={sending}
            onChange={(e) => setNewRole(e.target.value as Role)}
            className="sm:w-[150px] bg-bg-base border border-fg-subtle/25 rounded-lg px-3.5 py-2.5 text-sm text-fg-primary focus:outline-none focus:border-fg-accent/50 transition-colors duration-150 cursor-pointer disabled:opacity-50"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
          <button
            onClick={sendInvite}
            disabled={sending}
            className="shrink-0 bg-fg-accent text-bg-base text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#ff5c40] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Sending…" : "Invite"}
          </button>
        </div>
        {inviteError && (
          <p className="text-xs text-danger mt-2.5">{inviteError}</p>
        )}
      </div>

      {/* Invite link */}
      {canManageTeam && (
        <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-5 sm:px-6 sm:py-6 mt-6">
          <h2 className="text-[15px] font-semibold text-fg-primary mb-1">Invite link</h2>
          <p className="text-[13px] text-fg-muted mb-4">
            Planned feature, will be implemented soon.
          </p>

          {joinLinkLoading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : joinLink ? (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="flex-1 min-w-0 bg-bg-base border border-fg-subtle/25 rounded-lg px-3.5 py-2.5 text-sm text-fg-muted truncate">
                {window.location.origin}/join/{joinLink.code}
              </div>
              <button
                onClick={copyJoinLink}
                className="shrink-0 flex items-center gap-1.5 border border-fg-subtle/20 text-fg-muted text-sm font-semibold px-4 py-2.5 rounded-lg hover:text-fg-primary hover:border-fg-subtle/40 transition-colors duration-150 cursor-pointer"
              >
                {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={1.8} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleRevokeJoinLink}
                disabled={joinLinkBusy}
                className="shrink-0 text-danger text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-danger/10 transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {joinLinkBusy ? "Revoking…" : "Revoke"}
              </button>
            </div>
          ) : (
            <button
              onClick={handleCreateJoinLink}
              disabled={true}
              title="Coming soon"
              className="bg-fg-accent text-bg-base text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#ff5c40] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joinLinkBusy ? "Generating…" : "Generate invite link"}
            </button>
          )}
        </div>
      )}

      {/* Remove member confirmation */}
      <Modal
        open={!!removeTarget}
        onClose={() => !removing && setRemoveTarget(null)}
        title="Remove teammate"
        footer={
          <>
            <button
              onClick={() => setRemoveTarget(null)}
              disabled={removing}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmRemove}
              disabled={removing}
              className="px-3.5 py-2 rounded-md text-sm font-semibold bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Remove "<span className="text-fg-primary font-medium">{removeLabel}</span>" ({removeTarget?.email}) from
          the team? They'll lose access immediately.
        </p>
      </Modal>

      {/* Cancel invite confirmation */}
      <Modal
        open={!!cancelTarget}
        onClose={() => !cancelingInvite && setCancelTarget(null)}
        title="Cancel invite"
        footer={
          <>
            <button
              onClick={() => setCancelTarget(null)}
              disabled={cancelingInvite}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              Keep invite
            </button>
            <button
              onClick={confirmCancelInvite}
              disabled={cancelingInvite}
              className="px-3.5 py-2 rounded-md text-sm font-semibold bg-danger text-bg-base hover:bg-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {cancelingInvite ? "Cancelling…" : "Cancel invite"}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Cancel the invite to "<span className="text-fg-primary font-medium">{cancelTarget?.email}</span>"? They
          won't be able to join with this invite anymore.
        </p>
      </Modal>
    </div>
  );
}
