import { useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthContext } from "../contexts/AuthContext";

const ACCOUNT_DEACTIVATED_PATH = "/account-deactivated";

/**
 * Wraps routes that require authentication.
 * Redirects to /login if no session exists.
 *
 * Also the single choke point for the account-deactivation gate: every
 * authenticated route (including /account-deactivated itself) mounts
 * through this component, so the redirect logic only needs to live here
 * rather than in every page. See AuthContext.isDeactivated for the
 * fail-safe-to-active reasoning this depends on.
 */
export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, loading, profileLoading, isDeactivated } = useContext(AuthContext);
  const location = useLocation();

  // Block on BOTH session and profile resolution — rendering children (or
  // even deciding whether to redirect) before the profile has loaded would
  // either flash the dashboard for a deactivated user or bounce an active
  // user off /account-deactivated before we actually know their status.
  if (loading || (session && profileLoading)) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <p className="text-fg-muted text-sm animate-pulse">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const onDeactivatedScreen = location.pathname === ACCOUNT_DEACTIVATED_PATH;

  if (isDeactivated && !onDeactivatedScreen) {
    return <Navigate to={ACCOUNT_DEACTIVATED_PATH} replace />;
  }

  if (!isDeactivated && onDeactivatedScreen) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
