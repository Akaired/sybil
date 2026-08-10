import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { wave } from "../config/tokens";

const ACCENT = wave.indigo;

// Supabase's edge function gateway forces Content-Type: text/plain and a
// sandboxed CSP on any HTML an edge function tries to render directly to a
// browser — there's no way to override that from inside the function. So
// oauth-google-callback does a 302 redirect here instead of rendering its
// own page, and this (ordinary SPA) route shows the branded confirmation.
export default function OauthGoogleCallback() {
  const [params] = useSearchParams();
  const success = params.get("success") === "true";
  const email = params.get("email");
  const error = params.get("error");
  const redirectPath = params.get("redirect_path") || "/calendar";
  const isPopup = Boolean(window.opener);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isPopup) {
        window.close();
      } else {
        window.location.href = redirectPath;
      }
    }, success ? 1800 : 3500);
    return () => clearTimeout(timeout);
  }, [isPopup, success, redirectPath]);

  return (
    <div className="relative min-h-screen w-full bg-bg-base flex items-center justify-center overflow-hidden box-border px-5 py-12">
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
          {success ? (
            <>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Google Connected</h1>
              <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                {email ? (
                  <>
                    Your Google account (<strong className="text-[#B4BAC2]">{email}</strong>) is now
                    connected to Sybil.
                  </>
                ) : (
                  "Your Google account is now connected to Sybil."
                )}
              </p>
              <p className="m-0 mt-4 text-xs text-[#565E68]">
                {isPopup ? "This window will close automatically…" : "Taking you back…"}
              </p>
            </>
          ) : (
            <>
              <h1 className="m-0 mb-1.5 font-semibold text-2xl text-[#F3F5F7]">Connection failed</h1>
              <p className="m-0 text-sm leading-relaxed text-[#8A94A0]">
                {error || "Something went wrong while connecting your Google account."}
              </p>
              {!isPopup && (
                <Link
                  to={redirectPath}
                  className="inline-block mt-5 text-sm no-underline font-medium"
                  style={{ color: ACCENT }}
                >
                  Back to Sybil
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
