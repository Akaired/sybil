import { useState, type FormEvent, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { wave, copy } from "../../config/tokens";

export type AuthMode = "login" | "signup";

export interface AuthSubmitFields {
  email: string;
  password: string;
  name?: string;
  /** Only meaningful for mode="login" — see the "Remember me" checkbox below. */
  rememberMe?: boolean;
}

interface AuthCardProps {
  mode: AuthMode;
  /** Return an error message to display, or nothing on success. */
  onSubmit: (fields: AuthSubmitFields) => Promise<string | void>;
  /** Optional dismissible-free info banner shown above the form (e.g. "session expired"). */
  banner?: string | null;
}

// Auth screens use the "indigo" sine color as their accent (matches
// wave.indigo exactly), distinct from the app-wide fg-accent (signal red)
// used on Landing/marketing pages. Kept as designed — flagged to Davide.
const ACCENT = wave.indigo;
const BORDER_DEFAULT = "#262D35";

function isEmailValid(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isPasswordValid(v: string) {
  return v.length >= 8;
}
function isNameValid(v: string) {
  return v.trim().length >= 2;
}

export default function AuthCard({ mode, onSubmit, banner }: AuthCardProps) {
  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(true); // default: spuntata
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const emailError =
    touched.email && !isEmailValid(email) ? "Enter a valid email address." : null;
  const passwordError =
    touched.password && !isPasswordValid(password) ? "Use at least 8 characters." : null;
  const nameError = touched.name && !isNameValid(name) ? "Enter your name." : null;

  const setTouchedField = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const borderFor = (field: string, error: string | null) =>
    error || focused === field ? ACCENT : BORDER_DEFAULT;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const fields = isLogin ? ["email", "password"] : ["name", "email", "password"];
    setTouched((t) => ({ ...t, ...Object.fromEntries(fields.map((f) => [f, true])) }));

    const valid = isLogin
      ? isEmailValid(email) && isPasswordValid(password)
      : isNameValid(name) && isEmailValid(email) && isPasswordValid(password);

    if (!valid) return;

    setFormError("");
    setLoading(true);
    const err = await onSubmit({
      email,
      password,
      ...(isLogin ? { rememberMe } : { name }),
    });
    if (err) setFormError(err);
    setLoading(false);
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
          <span className="font-semibold text-[22px] tracking-[-0.4px] text-fg-primary">
            sybil
          </span>
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
              {isLogin ? copy.pages.login.title : copy.pages.register.title}
            </h1>
            <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
              {isLogin ? copy.pages.login.subtitle : copy.pages.register.subtitle}
            </p>
          </div>

          {banner && (
            <p className="m-0 mb-5 px-3.5 py-2.5 rounded-md text-[13px] text-danger bg-danger/10 border border-danger/30">
              {banner}
            </p>
          )}

          <button
            type="button"
            disabled
            className="w-full h-11 rounded-cap flex items-center justify-center gap-2.5 font-semibold text-sm cursor-not-allowed box-border"
            style={{ background: "#171C22", border: "1px solid #262D35", color: "#6B7280" }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.4673-.8055 5.9564-2.1805l-2.9087-2.2581c-.8055.5395-1.8368.8578-3.0477.8578-2.3436 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.9641 10.71c-.18-.5395-.2823-1.1155-.2823-1.71s.1023-1.1705.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z"
              />
              <path
                fill="#EA4335"
                d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5814-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-[#1E242B]" />
            <span className="text-xs text-[#565E68]">or</span>
            <div className="flex-1 h-px bg-[#1E242B]" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {!isLogin && (
              <div>
                <label className="block mb-1.5 font-medium text-[13px] text-[#B4BAC2]">
                  Full name
                </label>
                <input
                  type="text"
                  placeholder="Julius Caesar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setFocused("name")}
                  onBlur={() => {
                    setFocused(null);
                    setTouchedField("name");
                  }}
                  className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                  style={{ border: `1px solid ${borderFor("name", nameError)}` }}
                />
                {nameError && (
                  <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{nameError}</p>
                )}
              </div>
            )}

            <div>
              <label className="block mb-1.5 font-medium text-[13px] text-[#B4BAC2]">
                Email
              </label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused("email")}
                onBlur={() => {
                  setFocused(null);
                  setTouchedField("email");
                }}
                className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                style={{ border: `1px solid ${borderFor("email", emailError)}` }}
              />
              {emailError && (
                <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{emailError}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-medium text-[13px] text-[#B4BAC2]">Password</label>
                {isLogin && (
                  <Link
                    to="/forgot-password"
                    className="text-[12.5px] text-[#5B9CFF] no-underline font-medium"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => {
                  setFocused(null);
                  setTouchedField("password");
                }}
                className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                style={{ border: `1px solid ${borderFor("password", passwordError)}` }}
              />
              {passwordError && (
                <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{passwordError}</p>
              )}
            </div>

            {isLogin && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded cursor-pointer"
                  style={{ accentColor: ACCENT }}
                />
                <span className="text-[13px] text-[#B4BAC2]">Remember me on this device</span>
              </label>
            )}

            {/* Not part of the mockup (which never modeled a failed submit) —
                surfaces real Supabase auth errors using the app's semantic danger color. */}
            {formError && <p className="m-0 text-sm text-danger">{formError}</p>}

            <div className="flex items-center gap-2.5">
              <Link
                to="/"
                aria-label="Back to homepage"
                className="shrink-0 w-[46px] h-[46px] rounded-full flex items-center justify-center box-border no-underline"
                style={{ background: "#171C22", border: "1px solid #262D35" }}
              >
                <ArrowLeft size={18} color="#B4BAC2" />
              </Link>

              <button
                type="submit"
                disabled={loading}
                className="flex-1 h-[46px] rounded-cap border-none text-white font-semibold text-[15px] flex items-center justify-center box-border cursor-pointer disabled:cursor-default"
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
                ) : isLogin ? (
                  "Log in"
                ) : (
                  "Create account"
                )}
              </button>
            </div>
          </form>
        </div>

        <p className="m-0 text-sm text-[#8A94A0]">
          {isLogin ? (
            <span>
              Don't have an account?{" "}
              <Link to="/register" className="text-[#5B9CFF] no-underline font-medium">
                Sign up
              </Link>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <Link to="/login" className="text-[#5B9CFF] no-underline font-medium">
                Log in
              </Link>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
