import { useContext, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthContext } from "../contexts/AuthContext";
import { wave } from "../config/tokens";
import { joinByCode, previewJoinLink, WorkspaceOnboardingError } from "../lib/workspace";

const ACCENT = wave.indigo;

type State = "loading" | "ready" | "invalid" | "joining" | "error";

export default function JoinWorkspace() {
  const { code = "" } = useParams();
  const { session, loading: authLoading, refreshWorkspaces, setActiveWorkspaceId } = useContext(AuthContext);
  const navigate = useNavigate();

  const [state, setState] = useState<State>("loading");
  const [workspaceName, setWorkspaceName] = useState("");
  const [memberCount, setMemberCount] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    previewJoinLink(code)
      .then((res) => {
        setWorkspaceName(res.workspace_name);
        setMemberCount(res.member_count);
        setState("ready");
      })
      .catch((err) => {
        setError(err instanceof WorkspaceOnboardingError ? err.message : "This invite link is invalid.");
        setState("invalid");
      });
  }, [code]);

  async function handleJoin() {
    setState("joining");
    try {
      const { workspace_id } = await joinByCode(code);
      await refreshWorkspaces();
      setActiveWorkspaceId(workspace_id);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof WorkspaceOnboardingError ? err.message : "Couldn't join this workspace.");
      setState("error");
    }
  }

  const nextParam = encodeURIComponent(`/join/${code}`);

  return (
    <div className="relative min-h-screen w-full bg-bg-base flex items-center justify-center overflow-hidden box-border px-5 py-12">
      <img
        src="/svg/sybil-mark.svg"
        alt=""
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[214px] opacity-5 pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-[420px] flex flex-col items-center gap-9">
        <div className="flex items-center gap-2.5">
          <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-[19px] w-[30px]" />
          <span className="font-semibold text-[22px] tracking-[-0.4px] text-fg-primary">sybil</span>
        </div>

        <div
          className="w-full rounded-xl box-border text-center"
          style={{
            background: "#12161B",
            border: "1px solid #1E242B",
            padding: "32px 28px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          }}
        >
          {state === "loading" && <p className="m-0 text-sm text-[#8A94A0]">Checking invite link…</p>}

          {(state === "invalid" || state === "error") && (
            <>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">
                {state === "invalid" ? "Invite link expired" : "Couldn't join"}
              </h1>
              <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">{error}</p>
            </>
          )}

          {(state === "ready" || state === "joining") && (
            <>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Join {workspaceName}</h1>
              <p className="m-0 mb-6 text-sm leading-relaxed text-[#8A94A0]">
                {memberCount} member{memberCount === 1 ? "" : "s"} already here.
              </p>

              {authLoading ? (
                <p className="m-0 text-sm text-[#8A94A0]">Loading…</p>
              ) : session ? (
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={state === "joining"}
                  className="w-full h-[46px] rounded-cap border-none text-white font-semibold text-[15px] cursor-pointer disabled:cursor-default disabled:opacity-70"
                  style={{ background: ACCENT }}
                >
                  {state === "joining" ? "Joining…" : `Join ${workspaceName}`}
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link
                    to={`/login?next=${nextParam}`}
                    className="w-full h-[46px] rounded-cap text-white font-semibold text-[15px] flex items-center justify-center no-underline box-border"
                    style={{ background: ACCENT }}
                  >
                    Log in to join
                  </Link>
                  <Link
                    to={`/register?next=${nextParam}`}
                    className="w-full h-[46px] rounded-cap font-semibold text-[15px] flex items-center justify-center no-underline box-border border"
                    style={{ borderColor: ACCENT, color: ACCENT }}
                  >
                    Create an account
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
