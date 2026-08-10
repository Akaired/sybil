import { useContext, useState } from "react";
import { Navigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import AuthCard, { type AuthSubmitFields } from "../components/auth/AuthCard";

// Only allow same-origin relative paths (e.g. from /join/:code) — never
// follow a query-supplied absolute URL, to avoid an open-redirect footgun.
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

export default function Register() {
  const { session, loading } = useContext(AuthContext);
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  // See Login.tsx for why this waits on `loading` instead of redirecting
  // purely on `session` — avoids a one-frame flash of the signup form.
  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <p className="text-fg-muted text-sm animate-pulse">Loading…</p>
      </div>
    );
  }
  if (session) return <Navigate to={next} replace />;

  const handleSubmit = async ({ email, password, name }: AuthSubmitFields) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });
    if (error) return error.message;

    // Supabase returns success with an empty identities[] (no error) when
    // the email is already registered, to avoid leaking which emails exist
    // to an unauthenticated caller — this is the documented way to detect it.
    if (data.user && data.user.identities?.length === 0) {
      return "This email is already registered. Try logging in, or reset your password if you forgot it.";
    }

    setSubmittedEmail(email);
  };

  if (submittedEmail) {
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
            className="w-full rounded-xl box-border"
            style={{
              background: "#12161B",
              border: "1px solid #1E242B",
              padding: "32px 28px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Check your email</h1>
            <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
              We've sent a confirmation link to{" "}
              <strong className="text-[#B4BAC2]">{submittedEmail}</strong>. Click it to activate your
              account and get started.
            </p>
          </div>
          <p className="m-0 text-sm text-[#8A94A0]">
            <Link to="/login" className="text-[#5B9CFF] no-underline font-medium">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return <AuthCard mode="signup" onSubmit={handleSubmit} />;
}
