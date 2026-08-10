import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../config/supabase";
import { wave } from "../config/tokens";

const ACCENT = wave.indigo;
const BORDER_DEFAULT = "#262D35";

function isPasswordValid(v: string) {
  return v.length >= 8;
}

type LinkStatus = "checking" | "ready" | "invalid";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The recovery link uses the implicit flow: Supabase parses the token
    // from the URL fragment on load and either has a session already, or
    // fires a PASSWORD_RECOVERY event shortly after.
    let settled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !settled) {
        settled = true;
        setLinkStatus("ready");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || session) && !settled) {
        settled = true;
        setLinkStatus("ready");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) setLinkStatus("invalid");
    }, 2500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const passwordError =
    touched.password && !isPasswordValid(password) ? "Use at least 8 characters." : null;
  const confirmError =
    touched.confirm && confirm !== password ? "Passwords don't match." : null;

  const borderFor = (field: string, error: string | null) =>
    error || focused === field ? ACCENT : BORDER_DEFAULT;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirm: true });
    if (!isPasswordValid(password) || confirm !== password) return;

    setFormError("");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => navigate("/dashboard", { replace: true }), 1800);
  };

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
          {linkStatus === "checking" && (
            <p className="m-0 text-sm text-[#8A94A0]">Checking your reset link…</p>
          )}

          {linkStatus === "invalid" && (
            <div>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Link expired</h1>
              <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                This password reset link is invalid or has expired. Request a new one to continue.
              </p>
              <Link
                to="/forgot-password"
                className="inline-block mt-5 text-sm text-[#5B9CFF] no-underline font-medium"
              >
                Request a new link
              </Link>
            </div>
          )}

          {linkStatus === "ready" && done && (
            <div>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Password updated</h1>
              <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                Taking you to your dashboard…
              </p>
            </div>
          )}

          {linkStatus === "ready" && !done && (
            <>
              <div className="mb-6">
                <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Choose a new password</h1>
                <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                  Enter a new password for your account.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block mb-1.5 font-medium text-[13px] text-[#B4BAC2]">
                    New password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocused("password")}
                    onBlur={() => {
                      setFocused(null);
                      setTouched((t) => ({ ...t, password: true }));
                    }}
                    className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                    style={{ border: `1px solid ${borderFor("password", passwordError)}` }}
                  />
                  {passwordError && (
                    <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{passwordError}</p>
                  )}
                </div>

                <div>
                  <label className="block mb-1.5 font-medium text-[13px] text-[#B4BAC2]">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onFocus={() => setFocused("confirm")}
                    onBlur={() => {
                      setFocused(null);
                      setTouched((t) => ({ ...t, confirm: true }));
                    }}
                    className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                    style={{ border: `1px solid ${borderFor("confirm", confirmError)}` }}
                  />
                  {confirmError && (
                    <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{confirmError}</p>
                  )}
                </div>

                {formError && <p className="m-0 text-sm text-danger">{formError}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[46px] rounded-cap border-none text-white font-semibold text-[15px] flex items-center justify-center box-border cursor-pointer disabled:cursor-default"
                  style={{ background: ACCENT }}
                >
                  {loading ? (
                    <div className="flex items-center gap-[3px] h-4">
                      {[0, 0.12, 0.24, 0.36, 0.48].map((delay) => (
                        <div
                          key={delay}
                          className="landing-capsule w-[3px] h-4 rounded-[2px]"
                          style={
                            {
                              background: "#0D1114",
                              "--cap-base": 0.35,
                              "--cap-duration": "1s",
                              "--cap-delay": `${delay}s`,
                            } as CSSProperties
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    "Update password"
                  )}
                </button>
              </form>
            </>
          )}
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
