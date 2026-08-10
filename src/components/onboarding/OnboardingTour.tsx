import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Volume2, VolumeX, X } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { useMusicPlayer } from "../../contexts/MusicPlayerContext";
import { finishOnboarding, type JobProfile } from "../../lib/onboarding";
import { DEMO_ACCOUNT_EMAIL } from "../../lib/demoLimit";
import { JOB_OPTIONS, SENTINEL_EXAMPLES, DEFAULT_SENTINEL_EXAMPLE } from "../../config/onboardingContent";

const TOUR_VOLUME = 0.12;
const TOUR_TRACK = "Understanding the Clouds.mp3";

interface TourStep {
  selectors: string[];
  /** Only set for steps that spotlight something outside the sidebar chrome — navigated to on entry. */
  route?: string;
  title: string;
  body: (jobProfile: JobProfile | null) => string;
}

const TOUR_STEPS: TourStep[] = [
  {
    selectors: ['[data-tour="nav-chat"]'],
    title: "Chat with Sybil",
    body: () => "Ask questions, hand off tasks, or think out loud — Sybil replies right here, in plain language.",
  },
  {
    selectors: ['[data-tour="nav-team"]'],
    title: "Bring your team in",
    body: () => "Invite teammates into the same workspace and manage their roles.",
  },
  {
    selectors: ['[data-tour="nav-calendar"]'],
    title: "Calendar-aware",
    body: () => "Connect Google Calendar so Sybil knows your schedule and can reference it while you chat.",
  },
  {
    selectors: ['[data-tour="nav-mail"]'],
    title: "Your inbox, handled",
    body: () => "Sybil can read and act on your Gmail — right from here, no separate tab.",
  },
  {
    selectors: ['[data-tour="nav-tasks"]'],
    title: "A board that stays current",
    body: () => "A Kanban board for anything Sybil — or you — needs to track and move forward.",
  },
  {
    selectors: ['[data-tour="nav-activity"]'],
    title: "Nothing happens quietly",
    body: () => "A full log of everything Sybil has done — every action, every signal it picked up.",
  },
  {
    selectors: ['[data-tour="nav-sentinels"]'],
    title: "Sentinels keep watch for you",
    body: (jobProfile) =>
      `Set a condition once and Sybil checks it in the background, then flags you when it matters. For example: ${
        jobProfile ? SENTINEL_EXAMPLES[jobProfile] : DEFAULT_SENTINEL_EXAMPLE
      }`,
  },
  {
    selectors: ['[data-tour="nav-pulse"]'],
    title: "Pulse is your daily overview",
    body: () => "A single glance at what Sybil has been doing and what's coming up next.",
  },
  {
    selectors: ['[data-tour="nav-settings"]'],
    title: "Sybil also lives on Telegram",
    body: () => "Connect your account anytime from Settings to chat with Sybil and get sentinel alerts there too.",
  },
  {
    selectors: ['[data-tour="chat-call"]', '[data-tour="chat-transcribe"]'],
    route: "/dashboard",
    title: "Talk, don't just type",
    body: () => "Start a live voice call with the phone icon, or tap the mic to dictate your message instead of typing it.",
  },
];

type Stage = "welcome" | "role" | number | "closing";

function dismissedKey(userId: string): string {
  return `sybil_onboarding_dismissed_${userId}`;
}

// /docs is rendered by a separate top-level <Route> (see DocsShell) so it
// doesn't share a Layout instance with the rest of the protected app —
// crossing between them via a sidebar link unmounts/remounts Layout, which
// would otherwise reset this component's local `stage` back to "welcome"
// every time. Doubly important for the demo account, whose needsOnboarding
// is permanently true (see AuthContext) — without this it would restart the
// full tour on every /docs round-trip. sessionStorage (not localStorage) so
// a fresh visit/login still shows it again, matching "demo always sees the
// tour" intent.
export function isTourDismissedThisSession(userId: string): boolean {
  return sessionStorage.getItem(dismissedKey(userId)) === "1";
}

function useTargetRect(selectors: string[] | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selectors || selectors.length === 0) {
      setRect(null);
      return;
    }
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      const rects = selectors
        .map((sel) => document.querySelector(sel)?.getBoundingClientRect())
        .filter((r): r is DOMRect => !!r);
      if (rects.length > 0) {
        const top = Math.min(...rects.map((r) => r.top));
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const key = `${top}|${left}|${right}|${bottom}`;
        if (key !== lastKey) {
          lastKey = key;
          setRect(new DOMRect(left, top, right - left, bottom - top));
        }
      } else if (lastKey !== "") {
        lastKey = "";
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectors]);
  return rect;
}

const TOOLTIP_W = 320;
const GAP = 18;

function tooltipStyle(rect: DOMRect | null): React.CSSProperties {
  if (typeof window === "undefined") return {};
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  let left = rect.right + GAP;
  let top = rect.top + rect.height / 2;
  let translateY = "-50%";
  if (left + TOOLTIP_W > vw - 12) {
    left = Math.min(Math.max(rect.left, 12), Math.max(vw - TOOLTIP_W - 12, 12));
    top = rect.bottom + GAP;
    translateY = "0";
    if (top + 220 > vh - 12) {
      top = Math.max(rect.top - GAP, 232);
      translateY = "-100%";
    }
  }
  return { top, left, transform: `translateY(${translateY})` };
}

/**
 * First-login product tour: a one-click job question, then a spotlight
 * walkthrough of the sidebar (plus the chat composer's call/dictate
 * buttons). The rating/feedback survey no longer lives here — it's the
 * topbar gift icon's OnboardingSurvey modal (see Layout). Purely additive
 * UI — never touches ingest/interpret/resolve, never creates real
 * sentinels, and the job answer only ever selects which example string is
 * shown here.
 */
export default function OnboardingTour({
  setMobileNavOpen,
}: {
  setMobileNavOpen: (open: boolean) => void;
}) {
  const { user, refreshProfile } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const music = useMusicPlayer();

  const [stage, setStage] = useState<Stage>("welcome");
  const [jobProfile, setJobProfile] = useState<JobProfile | null>(null);

  const startedMusicRef = useRef(false);
  const musicStartAttemptedRef = useRef(false);
  // Some browsers (confirmed: autoplay silently fails right after the demo
  // account's login-button click) don't treat that earlier gesture as still
  // "fresh" once we're several async ticks and a client-side navigation
  // later — but any click made directly inside the tour reliably works. So
  // we no longer fire startMusic() the instant the tour mounts; we wait for
  // the user's own "Start tour" click, which is both a real gesture and
  // synchronous with playback starting.
  const wantsMusicRef = useRef(false);

  const stepIndex = typeof stage === "number" ? stage : null;
  const step = stepIndex !== null ? TOUR_STEPS[stepIndex] : null;
  const rect = useTargetRect(step?.selectors ?? null);

  // Sidebar nav lives in a mobile drawer below md: — keep it open only for
  // steps that spotlight something in it, so it doesn't cover the chat
  // composer during the call/dictate step (or the centered survey cards).
  useEffect(() => {
    setMobileNavOpen(!!step && !step.route);
    return () => setMobileNavOpen(false);
  }, [step, setMobileNavOpen]);

  // Steps that spotlight page content outside the sidebar need that page
  // actually mounted — navigate there on entry if we're not already on it.
  useEffect(() => {
    if (step?.route && location.pathname !== step.route) {
      navigate(step.route, { replace: true });
    }
  }, [step, location.pathname, navigate]);

  const startMusic = useCallback(() => {
    // Always this specific track for onboarding, not whatever the shuffle
    // queue would have played next — jump to it even if something (e.g. a
    // stale "resume playback" auto-start racing ahead of this effect) is
    // already audible, since the tour has one deterministic track.
    music.playTrack(TOUR_TRACK);
    startedMusicRef.current = true;
    // Fade in from silence up to a low, background-only level.
    music.duckTo(TOUR_VOLUME);
  }, [music]);

  // Fires once the track list is ready (async fetch from storage), but only
  // after "Start tour" has actually been clicked — see wantsMusicRef above.
  useEffect(() => {
    if (musicStartAttemptedRef.current) return;
    if (!wantsMusicRef.current) return;
    if (!music.ready || !music.hasTracks) return;
    musicStartAttemptedRef.current = true;
    startMusic();
  }, [music.ready, music.hasTracks, startMusic]);

  // Tour music is meant to carry on into the app once onboarding is done,
  // not stop — just hand the volume back from the tour's low level to the
  // user's normal one. A no-op if the tour never started it (e.g. the
  // topbar player was already going, so it was left alone the whole time).
  const releaseMusicDuck = useCallback(() => {
    if (!startedMusicRef.current) return;
    music.duckTo(null);
    startedMusicRef.current = false;
  }, [music]);

  const toggleMute = useCallback(() => {
    music.toggle();
  }, [music]);

  const finish = useCallback(
    async (finalJobProfile: JobProfile | null) => {
      setStage("closing");
      releaseMusicDuck();
      if (user) {
        sessionStorage.setItem(dismissedKey(user.id), "1");
        try {
          // The shared demo account is DB-guarded against ever persisting
          // onboarding_completed=true (every visitor should see the tour),
          // so skip the write entirely rather than let it fail server-side.
          const isDemo = user.email === DEMO_ACCOUNT_EMAIL;
          if (!isDemo) await finishOnboarding(user.id, finalJobProfile);
          // Pull the fresh onboarding_completed=true into AuthContext so
          // needsOnboarding flips immediately — otherwise it stays stale
          // until the next natural profile refetch (same class of bug as
          // the deactivate/reactivate race: see project memory).
          if (!isDemo) await refreshProfile();
        } catch {
          // Write already logs its own errors — worst case the tour
          // reappears next login, which is safe, never blocking.
        }
      }
      navigate("/pulse", { replace: true });
    },
    [user, navigate, releaseMusicDuck, refreshProfile],
  );

  const handleStartTour = () => {
    setStage("role");
    wantsMusicRef.current = true;
    if (!musicStartAttemptedRef.current && music.ready && music.hasTracks) {
      musicStartAttemptedRef.current = true;
      startMusic();
    }
  };

  const handlePickJob = (value: JobProfile) => {
    setJobProfile(value);
    setStage(0);
  };

  const handleNext = () => {
    if (stepIndex === null) return;
    if (stepIndex + 1 < TOUR_STEPS.length) {
      setStage(stepIndex + 1);
    } else {
      finish(jobProfile);
    }
  };

  // Skip always ends onboarding immediately, from any stage.
  const handleSkip = () => finish(jobProfile);

  if (stage === "closing") return null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Backdrop with an optional cutout around the spotlighted element */}
      {rect ? (
        <div
          className="fixed z-[100] rounded-xl transition-[top,left,width,height] duration-300 ease-out pointer-events-none"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            boxShadow: "0 0 0 9999px rgba(6,9,11,0.8)",
            outline: "2px solid var(--color-sine-indigo)",
            outlineOffset: 3,
          }}
        />
      ) : (
        <div className="fixed inset-0 z-[100] bg-[rgba(6,9,11,0.82)]" />
      )}

      {/* Click-catcher: blocks interaction with the app underneath */}
      <div className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()} />

      {/* Always-visible controls */}
      <div className="fixed top-4 right-4 z-[102] flex items-center gap-2">
        {startedMusicRef.current || music.isPlaying ? (
          <button
            type="button"
            onClick={toggleMute}
            aria-label={music.isPlaying ? "Mute music" : "Unmute music"}
            title={music.isPlaying ? "Mute music" : "Unmute music"}
            className="p-2 rounded-full bg-bg-elevated/90 border border-fg-subtle/25 text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer"
          >
            {music.isPlaying ? <Volume2 size={16} strokeWidth={1.8} /> : <VolumeX size={16} strokeWidth={1.8} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleSkip}
          className="px-3 py-2 rounded-full bg-bg-elevated/90 border border-fg-subtle/25 text-xs font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 cursor-pointer"
        >
          Skip
        </button>
      </div>

      {/* Welcome */}
      {stage === "welcome" && (
        <div
          className="fixed z-[102] w-[min(92vw,420px)] bg-bg-elevated border border-fg-subtle/20 rounded-2xl shadow-xl p-7 text-center"
          style={tooltipStyle(null)}
        >
          <div className="flex justify-center mb-4">
            <img src="/svg/sybil-mark.svg" alt="" aria-hidden="true" className="h-10 w-auto" />
          </div>
          <h2 className="text-lg font-semibold text-fg-primary mb-2">Welcome to Sybil</h2>
          <p className="text-sm text-fg-muted mb-6">
            One quick question, then a short look around — so you know exactly what Sybil can do for you.
          </p>
          <button
            type="button"
            onClick={handleStartTour}
            className="w-full py-2.5 rounded-lg bg-sine-indigo text-white text-sm font-semibold hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            Start tour
          </button>
        </div>
      )}

      {/* Role question */}
      {stage === "role" && (
        <div
          className="fixed z-[102] w-[min(92vw,440px)] bg-bg-elevated border border-fg-subtle/20 rounded-2xl shadow-xl p-7"
          style={tooltipStyle(null)}
        >
          <h2 className="text-lg font-semibold text-fg-primary mb-1.5 text-center">What best describes your work?</h2>
          <p className="text-xs text-fg-subtle mb-5 text-center">This just personalizes the example on the next screen.</p>
          <div className="grid grid-cols-1 gap-2">
            {JOB_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePickJob(opt.value)}
                className="w-full text-left px-4 py-2.5 rounded-lg border border-fg-subtle/20 text-sm font-medium text-fg-primary hover:border-sine-indigo/60 hover:bg-sine-indigo/8 transition-colors duration-150 cursor-pointer"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tour step */}
      {step && (
        <div
          className="fixed z-[102] w-[min(92vw,320px)] bg-bg-elevated border border-fg-subtle/20 rounded-2xl shadow-xl p-5 transition-[top,left] duration-300 ease-out"
          style={tooltipStyle(rect)}
        >
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-1 flex-wrap max-w-[220px]">
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                    i === stepIndex ? "bg-sine-indigo" : "bg-fg-subtle/30"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleSkip}
              aria-label="Close tour"
              className="text-fg-subtle hover:text-fg-primary transition-colors duration-150 cursor-pointer shrink-0"
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>
          <h3 className="text-sm font-semibold text-fg-primary mb-1.5">{step.title}</h3>
          <p className="text-[13px] leading-relaxed text-fg-muted mb-4">{step.body(jobProfile)}</p>
          <button
            type="button"
            onClick={handleNext}
            className="w-full py-2 rounded-lg bg-sine-indigo text-white text-sm font-semibold hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            {stepIndex !== null && stepIndex + 1 < TOUR_STEPS.length ? "Next" : "Continue"}
          </button>
        </div>
      )}

    </div>
  );
}
