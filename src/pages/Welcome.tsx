import { useContext, useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AuthContext } from "../contexts/AuthContext";
import { wave } from "../config/tokens";
import {
  createWorkspace,
  joinByCode,
  joinByInvite,
  listMyInvites,
  WorkspaceOnboardingError,
  type PendingInvite,
} from "../lib/workspace";
import { DEMO_ACCOUNT_EMAIL } from "../lib/demoLimit";

const ACCENT = wave.indigo;
const BORDER_DEFAULT = "#262D35";

type Mode = "create" | "join";

// A pasted join link (https://sybil-agent.com/join/wsl_xxx) or a bare code
// (wsl_xxx) both work — only the trailing path segment matters.
function extractCode(input: string): string {
  const trimmed = input.trim();
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

export default function Welcome() {
  const { session, loading, workspaces, refreshWorkspaces, setActiveWorkspaceId } = useContext(AuthContext);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("create");

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [joiningCode, setJoiningCode] = useState(false);
  const [codeError, setCodeError] = useState("");

  useEffect(() => {
    if (!session) return;
    listMyInvites()
      .then((res) => setInvites(res.invites))
      .catch(() => setInvites([]))
      .finally(() => setInvitesLoading(false));
  }, [session]);

  if (!loading && !session) return <Navigate to="/login" replace />;
  // The shared demo account is DB-guarded against ever creating or joining a
  // workspace (see guard_demo_no_extra_workspace/_membership) and always has
  // its one pre-provisioned workspace — this route isn't nested under Layout
  // so that guard's redirect-away-from-/welcome doesn't cover it; bounce here
  // too so direct/bookmarked navigation can't reach a form that only fails
  // server-side.
  if (!loading && session?.user?.email === DEMO_ACCOUNT_EMAIL) return <Navigate to="/dashboard" replace />;
  // Already has a workspace (e.g. came here voluntarily to add another) and
  // hasn't done anything yet — fine to stay, but nothing forces it.

  async function finishInto(workspaceId: string) {
    await refreshWorkspaces();
    setActiveWorkspaceId(workspaceId);
    navigate("/dashboard", { replace: true });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError("Enter a workspace name.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const { workspace } = await createWorkspace(trimmed);
      await finishInto(workspace.id);
    } catch (err) {
      setCreateError(err instanceof WorkspaceOnboardingError ? err.message : "Couldn't create workspace.");
      setCreating(false);
    }
  }

  async function handleAcceptInvite(invite: PendingInvite) {
    setJoiningId(invite.id);
    try {
      const { workspace_id } = await joinByInvite(invite.id);
      await finishInto(workspace_id);
    } catch {
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      setJoiningId(null);
    }
  }

  async function handleJoinByCode(e: FormEvent) {
    e.preventDefault();
    const extracted = extractCode(code);
    if (!extracted) {
      setCodeError("Enter an invite code or link.");
      return;
    }
    setJoiningCode(true);
    setCodeError("");
    try {
      const { workspace_id } = await joinByCode(extracted);
      await finishInto(workspace_id);
    } catch (err) {
      setCodeError(err instanceof WorkspaceOnboardingError ? err.message : "Couldn't join with that code.");
      setJoiningCode(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-bg-base flex items-center justify-center overflow-hidden box-border px-5 py-12">
      <img
        src="/svg/sybil-mark.svg"
        alt=""
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[214px] opacity-5 pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-[480px] flex flex-col items-center gap-9">
        <div className="flex items-center gap-2.5">
          <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-[19px] w-[30px]" />
          <span className="font-semibold text-[22px] tracking-[-0.4px] text-fg-primary">sybil</span>
        </div>

        <div
          className="w-full rounded-xl box-border"
          style={{
            background: "#12161B",
            border: "1px solid #1E242B",
            padding: "32px 28px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          }}
        >
          <div className="mb-6">
            <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">
              {workspaces.length > 0 ? "Add another workspace" : "Welcome to Sybil"}
            </h1>
            <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
              Create a new workspace, or join one you've been invited to.
            </p>
          </div>

          <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ background: "#171C22" }}>
            {(["create", "join"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="flex-1 h-9 rounded-md text-sm font-semibold cursor-pointer border-none transition-colors duration-150"
                style={
                  mode === m
                    ? { background: ACCENT, color: "#fff" }
                    : { background: "transparent", color: "#8A94A0" }
                }
              >
                {m === "create" ? "Create" : "Join"}
              </button>
            ))}
          </div>

          {mode === "create" ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-[13px] text-[#B4BAC2]">
                  Workspace name
                </label>
                <input
                  type="text"
                  placeholder="Acme Inc"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setCreateError("");
                  }}
                  className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                  style={{ border: `1px solid ${createError ? ACCENT : BORDER_DEFAULT}` }}
                />
                {createError && <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{createError}</p>}
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full h-[46px] rounded-cap border-none text-white font-semibold text-[15px] flex items-center justify-center box-border cursor-pointer disabled:cursor-default disabled:opacity-70"
                style={{ background: ACCENT }}
              >
                {creating ? "Creating…" : "Create workspace"}
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                {invitesLoading ? (
                  <p className="m-0 text-sm text-[#8A94A0]">Checking for pending invites…</p>
                ) : invites.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {invites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-3"
                        style={{ background: "#171C22", border: `1px solid ${BORDER_DEFAULT}` }}
                      >
                        <div className="min-w-0">
                          <p className="m-0 text-sm font-semibold text-[#F3F5F7] truncate">
                            {invite.workspace_name}
                          </p>
                          <p className="m-0 mt-0.5 text-[12.5px] text-[#8A94A0]">as {invite.role}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAcceptInvite(invite)}
                          disabled={joiningId === invite.id}
                          className="shrink-0 h-9 px-4 rounded-cap border-none text-white text-sm font-semibold cursor-pointer disabled:cursor-default disabled:opacity-70"
                          style={{ background: ACCENT }}
                        >
                          {joiningId === invite.id ? "Joining…" : "Join"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-[#8A94A0]">No pending invites for your email.</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: "#1E242B" }} />
                <span className="text-xs text-[#565E68]">or use a code</span>
                <div className="flex-1 h-px" style={{ background: "#1E242B" }} />
              </div>

              <form onSubmit={handleJoinByCode} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Invite code or link"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError("");
                  }}
                  className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                  style={{ border: `1px solid ${codeError ? ACCENT : BORDER_DEFAULT}` }}
                />
                {codeError && <p className="m-0 text-[12.5px] text-[#7BAAFF]">{codeError}</p>}
                <button
                  type="submit"
                  disabled={joiningCode}
                  className="w-full h-11 rounded-cap border text-sm font-semibold cursor-pointer disabled:cursor-default disabled:opacity-70"
                  style={{ background: "transparent", borderColor: ACCENT, color: ACCENT }}
                >
                  {joiningCode ? "Joining…" : "Join with code"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
