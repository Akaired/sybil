import { useContext } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "../config/supabase";
import { setPersistEnabled } from "../lib/authStorage";
import { AuthContext } from "../contexts/AuthContext";
import AuthCard, { type AuthSubmitFields } from "../components/auth/AuthCard";

// Only allow same-origin relative paths (e.g. from /join/:code) — never
// follow a query-supplied absolute URL, to avoid an open-redirect footgun.
// Kept as the existing `?next=` param (already wired from JoinWorkspace's
// login/register links) rather than introducing a second `?redirect=` name.
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

export default function Login() {
  const { session, loading } = useContext(AuthContext);
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const timedOut = searchParams.get("reason") === "timeout";

  // Gate on `loading` too: session resolution isn't done yet on a fresh page
  // load, so redirecting purely on `session` (still null while resolving)
  // would render the login form for a frame before flashing away once the
  // real session shows up. Wait for the resolution to finish either way.
  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <p className="text-fg-muted text-sm animate-pulse">Loading…</p>
      </div>
    );
  }
  if (session) return <Navigate to={next} replace />;

  const handleSubmit = async ({ email, password, rememberMe }: AuthSubmitFields) => {
    // Must be written before signInWithPassword — the custom storage
    // adapter reads this flag to decide localStorage vs sessionStorage at
    // the moment the session gets persisted.
    setPersistEnabled(rememberMe ?? true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
  };

  return (
    <AuthCard mode="login" onSubmit={handleSubmit} banner={timedOut ? "Session expired due to inactivity." : null} />
  );
}
