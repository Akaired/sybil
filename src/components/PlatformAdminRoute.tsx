import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../contexts/AuthContext";
import SineWave from "./SineWave";

/**
 * Wraps every /admin/* route. Redirects to /dashboard once platformRole is
 * known and the user isn't a platform admin (staff or superadmin) — never
 * flashes the admin shell first.
 *
 * Gated on `platformRole`/`isPlatformAdmin`, deliberately never on
 * `activeWorkspaceId`, `workspace_members`, or team `role`/`isTeamAdmin` —
 * platform admin access and workspace/team membership are two separate
 * perimeters. The staff/superadmin split within these routes (e.g. Secrets
 * being superadmin-only) is enforced per-page, not here — staff still needs
 * to reach /admin/secrets to see the locked placeholder.
 */
export default function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, roleLoading } = useContext(AuthContext);

  if (roleLoading) {
    return (
      <div className="flex items-center gap-3 text-fg-muted p-6">
        <SineWave state="thinking" height={24} className="w-24" />
        <span className="text-sm animate-pulse">Checking permissions…</span>
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
