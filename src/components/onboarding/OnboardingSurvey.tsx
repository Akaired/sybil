import { useContext, useState } from "react";
import { AuthContext } from "../../contexts/AuthContext";
import { saveOnboardingFeedback, type OnboardingFeedback } from "../../lib/onboardingFeedback";
import { DEMO_ACCOUNT_EMAIL } from "../../lib/demoLimit";

const COMMENT_MAX = 150;
const RATING_SCALE = Array.from({ length: 10 }, (_, i) => i + 1);

function givenKey(userId: string): string {
  return `sybil_survey_given_${userId}`;
}

/**
 * Whether this user already submitted a rating — used by Layout to hide the
 * topbar gift badge after the first real answer. Never true for the shared
 * demo account: every visitor there should see the prompt again, so it's
 * deliberately not persisted for that email.
 */
export function hasGivenSurveyFeedback(userId: string, email: string | null | undefined): boolean {
  if (email === DEMO_ACCOUNT_EMAIL) return false;
  return localStorage.getItem(givenKey(userId)) === "1";
}

type Stage = "rating" | "wtp" | "comment" | "email";

/**
 * Rating / willingness-to-pay / comment / contact-email survey — fully
 * controlled by the topbar gift icon (see Layout), the only way to open it.
 */
export default function OnboardingSurvey({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useContext(AuthContext);
  const [stage, setStage] = useState<Stage>("rating");
  const [rating, setRating] = useState<number | null>(null);
  const [wtp, setWtp] = useState("");
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");

  const dismiss = () => {
    setStage("rating");
    setRating(null);
    setWtp("");
    setComment("");
    setEmail("");
    onClose();
  };

  const buildFeedback = (): OnboardingFeedback | null => {
    if (rating === null) return null;
    const trimmedWtp = wtp.trim();
    const parsedWtp = trimmedWtp === "" ? null : Number(trimmedWtp.replace(",", "."));
    const trimmedComment = comment.trim().slice(0, COMMENT_MAX);
    const trimmedEmail = email.trim();
    return {
      rating,
      willingnessToPay: parsedWtp !== null && Number.isFinite(parsedWtp) ? parsedWtp : null,
      comment: trimmedComment === "" ? null : trimmedComment,
      contactEmail: trimmedEmail === "" ? null : trimmedEmail,
    };
  };

  const finish = async () => {
    const feedback = buildFeedback();
    if (user && feedback) {
      try {
        await saveOnboardingFeedback(user.id, feedback);
      } catch {
        // Best-effort — never block dismissing the card on this write.
      }
      if (user.email !== DEMO_ACCOUNT_EMAIL) localStorage.setItem(givenKey(user.id), "1");
    }
    dismiss();
  };

  const handleRating = (value: number) => {
    setRating(value);
    setStage(value >= 6 ? "wtp" : "comment");
  };

  if (!open) return null;

  return (
    <div
      className="fixed z-[90] bottom-6 right-6 w-[min(92vw,360px)] bg-bg-elevated border border-fg-subtle/20 rounded-2xl shadow-xl p-6"
      role="dialog"
      aria-label="Quick feedback"
    >
      <button
        type="button"
        onClick={finish}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-fg-subtle hover:text-fg-primary transition-colors duration-150 cursor-pointer text-xs font-medium"
      >
        Skip
      </button>

      {stage === "rating" && (
        <>
          <h2 className="text-sm font-semibold text-fg-primary mb-1.5 pr-10">How's Sybil treating you so far?</h2>
          <p className="text-xs text-fg-subtle mb-4">1 = not for me, 10 = love it</p>
          <div className="grid grid-cols-5 gap-1.5">
            {RATING_SCALE.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleRating(n)}
                className="py-2 rounded-lg border border-fg-subtle/20 text-sm font-semibold text-fg-primary hover:border-sine-indigo/60 hover:bg-sine-indigo/8 transition-colors duration-150 cursor-pointer"
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      {stage === "wtp" && (
        <>
          <h2 className="text-sm font-semibold text-fg-primary mb-1.5 pr-10">Glad to hear it!</h2>
          <p className="text-xs text-fg-subtle mb-4">What would you be willing to pay for Sybil, in the future?</p>
          <div className="flex items-center gap-2 mb-5">
            <span className="text-fg-subtle text-sm font-medium">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={wtp}
              onChange={(e) => setWtp(e.target.value)}
              placeholder="e.g. 15"
              className="flex-1 bg-bg-surface border border-fg-subtle/20 rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-subtle outline-none focus:border-sine-indigo/60"
            />
          </div>
          <button
            type="button"
            onClick={() => setStage("comment")}
            className="w-full py-2.5 rounded-lg bg-sine-indigo text-white text-sm font-semibold hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            Continue
          </button>
        </>
      )}

      {stage === "comment" && (
        <>
          <h2 className="text-sm font-semibold text-fg-primary mb-1.5 pr-10">Anything you'd suggest?</h2>
          <p className="text-xs text-fg-subtle mb-4">Optional — a sentence is plenty.</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
            maxLength={COMMENT_MAX}
            rows={3}
            placeholder="Suggestions or comments…"
            className="w-full resize-none bg-bg-surface border border-fg-subtle/20 rounded-lg px-3 py-2.5 text-sm text-fg-primary placeholder:text-fg-subtle outline-none focus:border-sine-indigo/60 mb-1.5"
          />
          <p className="text-[11px] text-fg-subtle text-right mb-4">
            {comment.length}/{COMMENT_MAX}
          </p>
          <button
            type="button"
            onClick={() => setStage("email")}
            className="w-full py-2.5 rounded-lg bg-sine-indigo text-white text-sm font-semibold hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            Continue
          </button>
        </>
      )}

      {stage === "email" && (
        <>
          <h2 className="text-sm font-semibold text-fg-primary mb-1.5 pr-10">Want to stay in the loop?</h2>
          <p className="text-xs text-fg-subtle mb-4">Optional — we'll only reach out about Sybil.</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-bg-surface border border-fg-subtle/20 rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-subtle outline-none focus:border-sine-indigo/60 mb-5"
          />
          <button
            type="button"
            onClick={finish}
            className="w-full py-2.5 rounded-lg bg-sine-indigo text-white text-sm font-semibold hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            Finish
          </button>
        </>
      )}
    </div>
  );
}
