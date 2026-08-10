import { useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../config/supabase";
import { wave } from "../config/tokens";

const ACCENT = wave.indigo;
const BORDER_DEFAULT = "#262D35";

function isEmailValid(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);

  const emailError = touched && !isEmailValid(email) ? "Enter a valid email address." : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isEmailValid(email)) return;

    setFormError("");
    setLoading(true);
    // Supabase deliberately doesn't reveal whether the email is registered
    // (prevents account enumeration) — always show the same success state.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setSent(true);
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
          {sent ? (
            <div>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Check your email</h1>
              <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                If an account exists for <strong className="text-[#B4BAC2]">{email}</strong>, we've sent a
                link to reset your password. It expires shortly.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Reset your password</h1>
                <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                  Enter your email address and we'll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block mb-1.5 font-medium text-[13px] text-[#B4BAC2]">Email</label>
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                      setFocused(false);
                      setTouched(true);
                    }}
                    className="w-full h-11 rounded-md bg-[#171C22] text-[#F3F5F7] px-3.5 text-[15px] font-normal outline-none box-border"
                    style={{ border: `1px solid ${emailError || focused ? ACCENT : BORDER_DEFAULT}` }}
                  />
                  {emailError && <p className="mt-1.5 mb-0 text-[12.5px] text-[#7BAAFF]">{emailError}</p>}
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
                    "Send reset link"
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
