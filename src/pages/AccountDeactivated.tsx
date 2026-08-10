import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AuthContext } from "../contexts/AuthContext";
import { reactivateAccount, AccountManageError } from "../lib/account";

const PURGE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/**
 * Terminal screen for a deactivated account — no sidebar, no navigation.
 * Reached only through ProtectedRoute's gate (see AuthContext.isDeactivated),
 * which also bounces active users away from this route.
 */
export default function AccountDeactivated() {
  const { profile, signOut, refreshProfile } = useContext(AuthContext);
  const navigate = useNavigate();
  const [reactivating, setReactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deactivatedAt = profile?.deactivated_at ? new Date(profile.deactivated_at) : null;
  const purgeDate = deactivatedAt ? new Date(deactivatedAt.getTime() + PURGE_AFTER_DAYS * DAY_MS) : null;
  const daysRemaining = purgeDate
    ? Math.max(0, Math.ceil((purgeDate.getTime() - Date.now()) / DAY_MS))
    : null;

  async function handleReactivate() {
    setReactivating(true);
    setError(null);
    try {
      await reactivateAccount();
      // ProtectedRoute's gate reads profile.status from context — without
      // this it's still "deactivated" post-navigate and immediately bounces
      // back here.
      await refreshProfile();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message =
        err instanceof AccountManageError ? err.message : "Couldn't reactivate your account. Please try again.";
      setError(message);
      setReactivating(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-bg-base flex items-center justify-center overflow-hidden box-border px-5 py-12">
      <div className="relative z-10 w-full max-w-[440px] flex flex-col items-center gap-9">
        <div className="flex items-center gap-2.5">
          <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-[19px] w-[30px]" />
          <span className="font-semibold text-[22px] tracking-[-0.4px] text-fg-primary">sybil</span>
        </div>

        <div
          className="w-full rounded-xl box-border text-center"
          style={{
            background: "#12161B",
            border: "1px solid #1E242B",
            padding: "36px 28px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          }}
        >
          <img src="/svg/sybil-state-offline.svg" alt="" className="mx-auto mb-5 w-32 h-auto opacity-70" />

          <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Your account is deactivated</h1>

          {purgeDate && daysRemaining !== null ? (
            <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
              Your data will be permanently deleted on{" "}
              <strong className="text-[#B4BAC2]">{formatDate(purgeDate)}</strong>
              {" "}— {daysRemaining === 0 ? "less than a day" : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`} from
              now. Reactivate before then to keep your account.
            </p>
          ) : (
            <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
              Reactivate within 30 days to keep your account — after that it's permanently deleted.
            </p>
          )}

          {error && (
            <p className="mt-4 text-[13px] text-danger flex items-center justify-center gap-1.5">
              <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleReactivate}
            disabled={reactivating}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-warning text-bg-base text-[13.5px] font-semibold rounded-md px-4 py-2.5 hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {reactivating && <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />}
            Reactivate account
          </button>

          <button
            type="button"
            onClick={() => signOut()}
            className="mt-4 text-[13px] text-fg-subtle hover:text-fg-primary transition-colors duration-150 cursor-pointer"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
