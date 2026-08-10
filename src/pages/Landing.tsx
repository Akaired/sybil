import { useContext, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileText,
  Globe,
  Loader2,
  Phone,
  Play,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { copy } from "../config/tokens";
import { AuthContext } from "../contexts/AuthContext";
import { supabase } from "../config/supabase";
import { setPersistEnabled } from "../lib/authStorage";
import SineWave from "../components/SineWave";
import CallSineWave from "../components/CallSineWave";
import PublicUserMenu from "../components/PublicUserMenu";
import PublicNavLinks from "../components/PublicNavLinks";
import PublicLegalLinks from "../components/PublicLegalLinks";
import { useIubendaScript } from "../hooks/useIubendaScript";

const DEMO_ACCOUNT_EMAIL = "demo@sybil.local";
const DEMO_ACCOUNT_PASSWORD = "demouser";

const PROVIDER_ICON_BASE =
  "https://uhrqlwoejawnnhdeabob.supabase.co/storage/v1/object/public/brand-assets/providers";

// ── Hero equalizer capsules ─────────────────────────────────
// Bespoke 13-color gradient from the marketing mockup — distinct
// from the app's 7-color sine palette (config/tokens.ts).

const capsuleColors = [
  "#FF3B1F",
  "#FF6A3D",
  "#FFA24B",
  "#F2C14E",
  "#8FBF8F",
  "#5FA8D3",
  "#4C7BC0",
  "#6D5AC4",
  "#9257C9",
  "#C24BA0",
  "#E0446F",
  "#FF5C40",
  "#FF8A50",
];

const capsuleBases = [0.4, 0.55, 0.7, 0.85, 1, 0.9, 1, 0.9, 1, 0.85, 0.7, 0.55, 0.4];

const heroCapsules = capsuleColors.map((color, i) => ({
  color,
  base: capsuleBases[i],
  duration: (1.4 + (i % 3) * 0.2).toFixed(2),
  delay: (i * 0.08).toFixed(2),
}));

// ── Content ──────────────────────────────────────────────────

const features = [
  {
    title: "More doors in",
    body: "Chat, Telegram, voice, email, calendar, web. You don't open the app to update it: you talk to it, message it from your phone, forward it an email, or do nothing at all and it updates itself.",
  },
  {
    title: "Dormant tasks",
    body: "A task doesn't need a deadline. It can have a condition written in plain language, and come back to the top when the world changes.",
  },
];

const pulseEvents = [
  { text: "Quote for Novak — no reply in 4 days. Moved back to the top.", proof: "Proof attached — thread went unanswered" },
  { text: "Client Bergman wrote at 11pm. Draft reply ready.", proof: "Proof attached — message + draft" },
  { text: "Supplier's price page changed overnight. Flagged for renegotiation.", proof: "Proof attached — page snapshot" },
  { text: "Invoice #204 is 6 days overdue. Reminder sent.", proof: "Proof attached — payment status" },
  { text: "A competitor dropped prices 12%. Worth a look.", proof: "Proof attached — pricing page diff" },
  { text: "Silence from Takahashi since Monday. Following up.", proof: "Proof attached — thread history" },
  { text: "Call with Dubois transcribed. 3 action items extracted.", proof: "Proof attached — call transcript" },
  { text: "Domain renewal due in 3 days. Added to today.", proof: "Proof attached — registrar notice" },
  { text: "New lead replied after 48 hours of silence. Follow-up queued.", proof: "Proof attached — reply thread" },
];

const pulseCardCapsules = heroCapsules.slice(0, 7);

// ── "How it works" animated chat ────────────────────────────
type ChatScene =
  | { kind: "chat"; user: string; assistant: string; wake: string }
  | {
      kind: "websearch";
      user: string;
      assistant: string;
      steps: string[];
      sources: { domain: string }[];
    }
  | { kind: "call"; summary: string };

const chatScenes: ChatScene[] = [
  {
    kind: "chat",
    user: "Quote for Novak by Friday, Sam calls the supplier by Wednesday.",
    assistant: "Got it — 2 tasks created, both dormant until their condition triggers.",
    wake: "Novak quote resurfaced — 4 days, no reply.",
  },
  {
    kind: "websearch",
    user: "Check what people are saying about the competitor's new pricing.",
    assistant: "Searched the web — sentiment's mixed, mostly complaints about the new tier.",
    steps: ["Searched the web via Bright Data", "Read 3 pricing discussion threads", "Summarized the sentiment"],
    sources: [{ domain: "reddit.com" }, { domain: "techcrunch.com" }, { domain: "producthunt.com" }],
  },
  {
    kind: "chat",
    user: "Remind me to renew the domain, and watch the competitor's pricing page.",
    assistant: "Done — reminder set, and I'm now watching that page for changes.",
    wake: "Competitor's price page changed overnight. Flagged for renegotiation.",
  },
  {
    kind: "call",
    summary: "Call transcribed — 2 action items captured.",
  },
  {
    kind: "chat",
    user: "Call me if Takahashi doesn't reply by Monday.",
    assistant: "Noted — I'll surface it the moment the deadline passes with no reply.",
    wake: "Silence from Takahashi since Monday. Following up.",
  },
];

type CallPhase = "idle" | "ringing" | "listening" | "thinking" | "speaking" | "summary";

const CALL_PHASE_LABEL: Record<CallPhase, string> = {
  idle: "Tap to start a call",
  ringing: "Calling…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  summary: "Call ended",
};

function HowItWorksChat() {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [typing, setTyping] = useState<"user" | "assistant" | null>(null);
  const [showWake, setShowWake] = useState(false);
  const [stepsShown, setStepsShown] = useState(0);
  const [sourcesShown, setSourcesShown] = useState(false);
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const [callPressed, setCallPressed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function typeText(setter: (s: string) => void, full: string, speed: number) {
      for (let i = 0; i <= full.length; i++) {
        if (cancelled) return;
        setter(full.slice(0, i));
        await sleep(speed);
      }
    }

    async function runChat(scene: Extract<ChatScene, { kind: "chat" }>) {
      await sleep(500);
      if (cancelled) return;
      setTyping("user");
      await typeText(setUserText, `"${scene.user}"`, 28);
      if (cancelled) return;
      setTyping(null);

      await sleep(750);
      if (cancelled) return;
      setTyping("assistant");
      await typeText(setAssistantText, scene.assistant, 24);
      if (cancelled) return;
      setTyping(null);

      await sleep(900);
      if (cancelled) return;
      setShowWake(true);

      await sleep(4200);
    }

    async function runWebsearch(scene: Extract<ChatScene, { kind: "websearch" }>) {
      await sleep(500);
      if (cancelled) return;
      setTyping("user");
      await typeText(setUserText, `"${scene.user}"`, 28);
      if (cancelled) return;
      setTyping(null);

      await sleep(650);
      if (cancelled) return;
      setTyping("assistant");
      await typeText(setAssistantText, scene.assistant, 24);
      if (cancelled) return;
      setTyping(null);

      for (let i = 0; i < scene.steps.length; i++) {
        await sleep(450);
        if (cancelled) return;
        setStepsShown(i + 1);
      }

      await sleep(500);
      if (cancelled) return;
      setSourcesShown(true);

      await sleep(4200);
    }

    async function runCall() {
      setCallPhase("idle");
      await sleep(900);
      if (cancelled) return;
      setCallPressed(true);
      await sleep(350);
      if (cancelled) return;
      setCallPhase("ringing");

      await sleep(1000);
      if (cancelled) return;
      setCallPhase("listening");

      await sleep(1600);
      if (cancelled) return;
      setCallPhase("thinking");

      await sleep(1300);
      if (cancelled) return;
      setCallPhase("speaking");

      await sleep(1600);
      if (cancelled) return;
      setCallPhase("summary");

      await sleep(3600);
    }

    async function run() {
      setUserText("");
      setAssistantText("");
      setShowWake(false);
      setTyping(null);
      setStepsShown(0);
      setSourcesShown(false);
      setCallPhase("idle");
      setCallPressed(false);

      const scene = chatScenes[sceneIdx];
      if (scene.kind === "chat") await runChat(scene);
      else if (scene.kind === "websearch") await runWebsearch(scene);
      else await runCall();

      if (cancelled) return;
      setSceneIdx((i) => (i + 1) % chatScenes.length);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [sceneIdx]);

  const scene = chatScenes[sceneIdx];

  return (
    <div className="border border-fg-subtle/20 rounded-lg bg-bg-elevated p-6 flex flex-col gap-4 h-[340px] overflow-hidden">
      {scene.kind === "call" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5">
          {callPhase === "idle" || callPhase === "ringing" ? (
            <>
              <div className="relative flex items-center justify-center">
                {callPhase === "ringing" && (
                  <span className="absolute w-16 h-16 rounded-full bg-fg-accent/25 animate-ping" />
                )}
                <div
                  className={`relative flex items-center justify-center w-14 h-14 rounded-full bg-fg-accent transition-transform duration-150 ${
                    callPressed ? "scale-90" : "scale-100"
                  }`}
                >
                  <Phone size={22} strokeWidth={2} className="text-bg-base" />
                </div>
              </div>
              <p className="text-sm font-medium text-fg-muted">{CALL_PHASE_LABEL[callPhase]}</p>
            </>
          ) : (
            <>
              <CallSineWave
                state={callPhase === "summary" ? "idle" : callPhase}
                height={64}
                className="w-[200px]"
              />
              <p className="text-sm font-medium text-fg-muted">{CALL_PHASE_LABEL[callPhase]}</p>
            </>
          )}

          {callPhase === "summary" && (
            <div className="flex gap-3 w-full max-w-[380px] animate-[slidein_0.4s_ease-out]">
              <div className="w-[30px] h-[30px] min-w-[30px] rounded-full bg-fg-subtle/15 flex items-center justify-center">
                <SineWave state="idle" height={11} className="w-[17px]" />
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <div className="bg-fg-subtle/10 rounded-[18px] px-[18px] py-[13px] text-[15px] leading-normal text-fg-primary">
                  {scene.summary}
                </div>
                <div className="flex items-center gap-1 px-1">
                  <img
                    src={`${PROVIDER_ICON_BASE}/speechmatics.svg`}
                    alt=""
                    className="w-3.5 h-3.5 opacity-80"
                  />
                  <span className="text-[12px] text-fg-subtle">Transcribed with Speechmatics</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* User message */}
          {userText && (
            <div className="flex flex-col items-end gap-1">
              <div className="bg-sine-indigo/15 rounded-[18px] px-[18px] py-[13px] text-[15px] leading-normal text-fg-primary max-w-[85%]">
                {userText}
                {typing === "user" && (
                  <span className="inline-block w-[2px] h-[15px] ml-0.5 -mb-[2px] bg-fg-primary animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* Sybil reply */}
          {assistantText && (
            <div className="flex gap-3 max-w-[90%]">
              <div className="w-[30px] h-[30px] min-w-[30px] rounded-full bg-fg-subtle/15 flex items-center justify-center">
                <SineWave state={typing === "assistant" ? "thinking" : "idle"} height={11} className="w-[17px]" />
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <div className="bg-fg-subtle/10 rounded-[18px] px-[18px] py-[13px] text-[15px] leading-normal text-fg-primary">
                  {assistantText}
                  {typing === "assistant" && (
                    <span className="inline-block w-[2px] h-[15px] ml-0.5 -mb-[2px] bg-fg-primary animate-pulse" />
                  )}
                </div>
                {!typing && (
                  <div className="flex items-center gap-1 animate-[fadein_0.4s_ease-out]">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle">
                      <Copy size={14} strokeWidth={1.8} />
                    </span>
                    <span className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle">
                      <Play size={14} strokeWidth={1.8} />
                    </span>
                    <span className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle">
                      <ThumbsUp size={14} strokeWidth={1.8} />
                    </span>
                    <span className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle">
                      <ThumbsDown size={14} strokeWidth={1.8} />
                    </span>
                    <span className="w-px h-4 bg-fg-subtle/20 mx-1" />
                    <img
                      src={`${PROVIDER_ICON_BASE}/${scene.kind === "websearch" ? "brightdata.svg?v=2" : "aiml.svg"}`}
                      alt=""
                      className={`w-3.5 h-3.5 opacity-80 ${scene.kind === "websearch" ? "rounded-[3px]" : ""}`}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Wake Event proof */}
          {scene.kind === "chat" && showWake && (
            <div className="flex gap-3 max-w-[90%] animate-[slidein_0.4s_ease-out]">
              <div className="w-[30px] h-[30px] min-w-[30px] rounded-full bg-fg-subtle/15 flex items-center justify-center">
                <SineWave state="idle" height={11} className="w-[17px]" />
              </div>
              <div className="flex flex-col gap-2 min-w-0 border border-fg-accent/40 rounded-[18px] px-[18px] py-[13px] bg-bg-base">
                <span className="inline-flex items-center self-start px-2.5 py-1 rounded-full bg-fg-accent/10 text-fg-accent font-bold text-[11px] tracking-[0.04em] uppercase animate-pulse">
                  Wake Event
                </span>
                <p className="text-[14px] leading-[1.5] text-fg-primary">{scene.wake}</p>
              </div>
            </div>
          )}

          {/* "What I did" panel */}
          {scene.kind === "websearch" && stepsShown > 0 && (
            <div className="flex flex-col gap-2 min-w-0 max-w-[90%] ml-[42px] border border-fg-subtle/20 rounded-[14px] px-[16px] py-[12px] bg-bg-base animate-[slidein_0.4s_ease-out]">
              <div className="flex items-center gap-1.5 text-fg-subtle">
                <Globe size={13} strokeWidth={1.8} />
                <span className="text-[11px] font-bold uppercase tracking-[0.04em]">What I did</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {scene.steps.slice(0, stepsShown).map((step) => (
                  <div key={step} className="flex items-center gap-2 animate-[fadein_0.35s_ease-out]">
                    <CheckCircle2 size={13} strokeWidth={1.8} className="text-success shrink-0" />
                    <span className="text-[13px] text-fg-muted">{step}</span>
                  </div>
                ))}
              </div>
              {sourcesShown && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1 animate-[fadein_0.4s_ease-out]">
                  {scene.sources.map((s) => (
                    <span
                      key={s.domain}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-fg-subtle/20 text-[11.5px] text-fg-muted"
                    >
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.domain)}&sz=32`}
                        alt=""
                        className="w-3 h-3 rounded-sm"
                      />
                      {s.domain}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const integrations = [
  { name: "LabLab.ai", url: "https://lablab.ai", logo: "/logos/lablab.png" },
  { name: "native.builder", url: "https://nativelyai.com/builder", logo: "/logos/native-builder.svg" },
  { name: "Speechmatics", url: "https://www.speechmatics.com", logo: "/logos/speechmatics.svg" },
  { name: "Bright Data", url: "https://brightdata.com", logo: "/logos/brightdata.svg" },
  { name: "AI/ML API", url: "https://aimlapi.com", logo: "/logos/aimlapi-icon.png", withLabel: true },
  { name: "OpenRouter", url: "https://openrouter.ai", logo: "/logos/openrouter.svg" },
];

export default function Landing() {
  const [searchParams] = useSearchParams();
  const accountDeleted = searchParams.get("accountDeleted") === "1";
  const { session, loading: authLoading } = useContext(AuthContext);
  const navigate = useNavigate();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  useIubendaScript();

  async function handleDemoLogin() {
    setDemoError(null);
    setDemoLoading(true);
    // Demo sessions are single-tab, throwaway browsing — never persist to
    // localStorage, so closing the tab doesn't leave a live shared session.
    setPersistEnabled(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: DEMO_ACCOUNT_EMAIL,
      password: DEMO_ACCOUNT_PASSWORD,
    });
    if (error) {
      setDemoError("Couldn't start the demo right now. Please try again.");
      setDemoLoading(false);
      return;
    }
    navigate("/dashboard");
  }

  return (
    <div className="w-full min-h-screen bg-bg-base overflow-hidden">
      {accountDeleted && (
        <div className="w-full bg-success/15 border-b border-success/30 px-4 py-2.5 flex items-center justify-center gap-2 text-center">
          <Check size={15} strokeWidth={2} className="text-success shrink-0" />
          <span className="text-[13px] font-medium text-success">
            Your account has been permanently deleted.
          </span>
        </div>
      )}

      {/* Work-in-progress banner */}
      <div className="w-full bg-warning/15 border-b border-warning/30 px-4 py-2.5 flex items-center justify-center gap-2 text-center">
        <TriangleAlert size={15} strokeWidth={2} className="text-warning shrink-0" />
        <span className="text-[13px] font-medium text-warning">
          Work in progress, this does not reflect the final product!
        </span>
      </div>

      {/* Nav */}
      <nav className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-16 py-5 sm:py-7 max-w-[1440px] mx-auto">
        <div className="flex items-center gap-6 lg:gap-10 min-w-0">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
            <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 sm:h-7 w-auto shrink-0" />
            <span className="font-bold text-lg sm:text-xl tracking-[-0.01em] text-fg-primary truncate">
              sybil
            </span>
          </Link>
          <PublicNavLinks />
        </div>
        <div className="flex items-center gap-3 sm:gap-5 md:gap-8 shrink-0">
          {authLoading ? null : session ? (
            <PublicUserMenu />
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm sm:text-[15px] font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 whitespace-nowrap"
              >
                {copy.pages.landing.login}
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center px-3.5 py-2 sm:px-5 sm:py-2.5 border border-fg-accent rounded-lg text-fg-accent font-semibold text-xs sm:text-sm whitespace-nowrap hover:bg-fg-accent/10 transition-colors duration-150"
              >
                {copy.pages.landing.cta}
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-[1440px] mx-auto px-6 md:px-16 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-16 items-center">
        <div>
          <h1 className="font-semibold text-[clamp(40px,5.2vw,68px)] leading-[1.08] tracking-[-0.015em] mb-8 text-[#F5F3EF]">
            Every management tool lives on{" "}
            <span className="text-fg-muted">Chronos</span>. Sybil is the
            first workspace that knows when the moment is right, because it
            listens to you and watches the world.
          </h1>
          <div className="flex gap-4 items-center flex-wrap">
            <Link
              to="/register"
              className="inline-flex items-center px-8 py-4 bg-fg-accent rounded-lg text-bg-base font-bold text-base hover:bg-[#ff5c40] transition-colors duration-150"
            >
              {copy.pages.landing.cta}
            </Link>
            <a
              href="#"
              className="inline-flex items-center px-8 py-4 border border-fg-subtle/20 rounded-lg text-fg-primary font-semibold text-base hover:border-fg-primary transition-colors duration-150"
            >
              {copy.pages.landing.ctaSecondary}
            </a>
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={demoLoading}
              className="inline-flex items-center gap-2 px-8 py-4 border border-fg-subtle/20 rounded-lg text-fg-primary font-semibold text-base hover:border-fg-primary transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {demoLoading && <Loader2 size={16} strokeWidth={2.2} className="animate-spin" />}
              Demo platform
            </button>
          </div>
          {demoError && <p className="text-[13px] text-danger mt-3">{demoError}</p>}
        </div>

        {/* Equalizer capsules */}
        <div className="flex items-center justify-center h-40 lg:h-[220px] gap-1.5">
          {heroCapsules.map((cap, i) => (
            <div
              key={i}
              className="landing-capsule w-3.5 h-40 rounded-[7px] shrink-0"
              style={
                {
                  backgroundColor: cap.color,
                  "--cap-base": cap.base,
                  "--cap-duration": `${cap.duration}s`,
                  "--cap-delay": `${cap.delay}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </header>

      {/* How it works */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 pt-8 pb-28 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          <span className="text-[13px] font-bold text-fg-accent tracking-[0.04em] uppercase">
            How it works
          </span>
          <p className="text-[22px] leading-[1.55] text-[#F5F3EF] mt-5 mb-5 font-normal">
            Elena holds a button and says: quote for Novak by Friday, Sam
            calls the supplier by Wednesday. Three tasks, two people, zero
            typing.
          </p>
          <p className="text-[22px] leading-[1.55] text-fg-muted mb-7 font-normal">
            She sends the quote. Nothing happens for five days. Sybil brings
            it back to the top — with proof it went unanswered.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 font-semibold text-[15px] text-fg-accent hover:text-[#ff5c40] transition-colors duration-150"
          >
            Get started today →
          </Link>
        </div>

        <HowItWorksChat />
      </section>

      {/* Feature cards */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 pt-8 pb-28">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-fg-subtle/20 rounded-lg p-8 bg-bg-elevated">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#FF3B1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-5">
              <path d="M6 16h14M14 10l6 6-6 6" />
              <rect x="22" y="6" width="4" height="20" rx="1" />
            </svg>
            <h3 className="font-semibold text-[22px] mb-4 text-[#F5F3EF]">
              {features[0].title}
            </h3>
            <p className="text-[15px] leading-[1.6] text-fg-muted">
              {features[0].body}
            </p>
          </div>

          <div className="border border-fg-subtle/20 rounded-lg p-8 bg-bg-elevated">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#FF3B1F" strokeWidth="2" strokeLinecap="round" className="mb-5">
              <circle cx="11" cy="16" r="5" />
              <circle cx="11" cy="16" r="1.2" fill="#FF3B1F" />
              <path d="M20 10v12M23 12v8M26 14v4" />
            </svg>
            <h3 className="font-semibold text-[22px] mb-4 text-[#F5F3EF]">
              Two senses
            </h3>
            <p className="text-[15px] leading-[1.6] text-fg-muted">
              Hears —{" "}
              <a
                href="https://www.speechmatics.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg-accent hover:text-[#ff5c40] transition-colors duration-150"
              >
                Speechmatics
              </a>
              : dictation and call recordings.
              <br />
              Sees —{" "}
              <a
                href="https://brightdata.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-fg-accent hover:text-[#ff5c40] transition-colors duration-150"
              >
                Bright Data
              </a>
              : live web surveillance.
            </p>
          </div>

          <div className="border border-fg-subtle/20 rounded-lg p-8 bg-bg-elevated">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#FF3B1F" strokeWidth="2" strokeLinejoin="round" className="mb-5">
              <path d="M20 8a10 10 0 100 16 8 8 0 010-16z" />
              <circle cx="24" cy="10" r="1.2" fill="#FF3B1F" />
            </svg>
            <h3 className="font-semibold text-[22px] mb-4 text-[#F5F3EF]">
              {features[1].title}
            </h3>
            <p className="text-[15px] leading-[1.6] text-fg-muted">
              {features[1].body}
            </p>
          </div>
        </div>
      </section>

      {/* Pulse events */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 pt-8 pb-28">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pulseEvents.map((event) => (
            <div
              key={event.text}
              className="border border-fg-subtle/20 rounded-lg p-6 bg-bg-elevated flex flex-col gap-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-fg-muted">Pulse</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5FA8D3]" />
                  Listening
                </span>
              </div>

              <div className="flex items-end gap-1 h-6">
                {pulseCardCapsules.map((cap, i) => (
                  <div
                    key={i}
                    className="landing-capsule w-1 h-6 rounded-[2px] shrink-0"
                    style={
                      {
                        backgroundColor: cap.color,
                        "--cap-base": cap.base,
                        "--cap-duration": `${cap.duration}s`,
                        "--cap-delay": `${cap.delay}s`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>

              <span className="inline-flex items-center self-start px-3.5 py-1.5 rounded-full bg-fg-accent/15 text-fg-accent font-bold text-[12px] tracking-[0.04em] uppercase">
                Wake Event
              </span>

              <p className="text-[16px] leading-[1.5] text-fg-primary">
                {event.text}
              </p>

              <div className="flex items-center gap-2 px-4 py-3 border border-fg-subtle/20 rounded-lg mt-auto">
                <FileText size={14} strokeWidth={1.8} className="text-fg-subtle shrink-0" />
                <span className="text-[13px] text-fg-muted">{event.proof}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Hackathon badge */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 pt-8 pb-8 text-center">
        <span className="inline-flex items-center px-4 py-1.5 rounded-full border border-fg-subtle/20 bg-bg-elevated text-fg-muted text-xs font-semibold tracking-[0.02em]">
          Built for AI Factory / native.builder Hackathon — August 2026
        </span>
      </section>

      {/* Integrations */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 pt-8 pb-28">
        <div className="flex justify-center items-center gap-6 flex-wrap">
          {integrations.map((item) => (
            <a
              key={item.name}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={item.name}
              className="flex items-center gap-3 h-16 px-6 bg-[#F5F3EF] rounded-2xl border border-transparent hover:border-fg-accent hover:-translate-y-0.5 hover:shadow-lg transition-all duration-150"
            >
              <img src={item.logo} alt={item.name} className="h-7 w-auto object-contain" />
              {item.withLabel && (
                <span className="font-bold text-lg tracking-[-0.01em] text-[#0D1114]">
                  AI/ML API
                </span>
              )}
            </a>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 py-24 text-center border-t border-fg-subtle/20">
        <h2 className="font-semibold text-[clamp(28px,3.4vw,40px)] mb-6 text-[#F5F3EF]">
          Stop checking. Start knowing.
        </h2>
        <div className="flex justify-center mb-6">
          <Link
            to="/register"
            className="inline-flex items-center px-8 py-4 bg-fg-accent rounded-lg text-bg-base font-bold text-base hover:bg-[#ff5c40] transition-colors duration-150"
          >
            {copy.pages.landing.cta}
          </Link>
        </div>
        <span className="inline-flex items-center px-5 py-2.5 rounded-full border border-fg-subtle/20 bg-bg-elevated text-fg-primary font-semibold text-[15px]">
          No credit card required. 3 free sentinels.
        </span>
      </section>

      {/* Footer */}
      <footer className="max-w-[1440px] mx-auto px-6 md:px-16 pt-12 pb-16 border-t border-fg-subtle/20 flex flex-col gap-8">
        <div className="flex gap-10 flex-wrap justify-center">
          <a
            href="https://sybilagent.statuspage.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
          >
            Status
          </a>
          <Link
            to="/pricing"
            className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
          >
            Pricing
          </Link>
          <Link
            to="/roadmap"
            className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
          >
            Roadmap
          </Link>
          <Link
            to="/blog"
            className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
          >
            Blog
          </Link>
          <PublicLegalLinks />
        </div>
        <div className="flex items-center justify-center gap-2">
          <img
            src="/svg/sybil-mark.svg"
            alt="Sybil"
            className="h-6 w-auto opacity-60"
          />
          <span className="font-bold text-[15px] tracking-[0.02em] text-[#5A6167]">
            sybil
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-xs text-fg-subtle">
            © 2026 Sybil Team - all rights reserved, made in Italy for the AI Factory / native.builder Hackathon.
          </p>
          <a
            href="https://davidemaiorana.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-6 px-2.5 bg-[#F5F3EF] rounded-full hover:-translate-y-0.5 hover:shadow-lg transition-all duration-150"
          >
            <Code2 size={12} strokeWidth={2.5} className="text-[#0E9F63]" />
            <span className="font-bold text-sm tracking-[0.02em] text-[#5A6167]">
              davidemaiorana.dev
            </span>
          </a>
        </div>
      </footer>
    </div>
  );
}
