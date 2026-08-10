import { useContext } from "react";
import { AuthContext } from "../contexts/AuthContext";

/**
 * Thin accessor over AuthContext's role state.
 * The actual fetch lives in AuthContext (see the comment there for why) —
 * this hook exists only so call sites don't need to know that.
 *
 * `isTeamAdmin` is a team-management permission (invite/remove members,
 * change roles) — it does NOT grant platform Admin panel access. Use
 * `isPlatformAdmin` for that (from AuthContext directly, or via this hook).
 */
export function useTeamRole() {
  const {
    role,
    isTeamAdmin,
    platformRole,
    isPlatformAdmin,
    roleLoading,
    hasRole,
    activeWorkspaceId,
    workspaces,
    setActiveWorkspaceId,
  } = useContext(AuthContext);
  return {
    role,
    isTeamAdmin,
    platformRole,
    isPlatformAdmin,
    loading: roleLoading,
    hasRole,
    workspaceId: activeWorkspaceId,
    workspaces,
    setActiveWorkspaceId,
  };
}
