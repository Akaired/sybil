import { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import CallSineWave from "./CallSineWave";
import type { SybilState } from "../config/tokens";

interface CallOverlayProps {
  state: SybilState;
  liveTranscript: string;
  onEndTurn: () => void;
  onClose: () => void;
}

// The wave's "offline" shows during the pre-connect window — useVoiceCall's
// "idle" state means "not started yet" *or* a genuine post-connect idle
// moment, so the two are told apart below via everConnected.
const STATE_LABEL: Record<SybilState, string> = {
  offline: "Connecting…",
  idle: "Connected",
  listening: "Listening…",
  thinking: "Thinking…", // overridden by THINKING_MESSAGES while actually in this state
  speaking: "Speaking…",
  alert: "Something went wrong",
};

// A single request can take a while server-side (web search/research chains
// several page fetches before the answer comes back) — cycling this instead
// of a single static "Thinking…" reassures the user something is still
// happening rather than reading as a stall.
const THINKING_MESSAGES = ["Thinking…", "Searching the web…", "Reading sources…", "Still working on it…"];
const THINKING_MESSAGE_INTERVAL_MS = 4000;

/**
 * Full-screen live call overlay — opened by the handset button next to the
 * chat input. Mic capture, turn detection and TTS playback all live in
 * useVoiceCall; this component is purely presentational.
 */
export default function CallOverlay({ state, liveTranscript, onEndTurn, onClose }: CallOverlayProps) {
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (state !== "idle") setEverConnected(true);
  }, [state]);
  const waveState: SybilState = state === "idle" && !everConnected ? "offline" : state;

  const [thinkingMessageIndex, setThinkingMessageIndex] = useState(0);
  useEffect(() => {
    if (state !== "thinking") {
      setThinkingMessageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setThinkingMessageIndex((i) => Math.min(i + 1, THINKING_MESSAGES.length - 1));
    }, THINKING_MESSAGE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [state]);

  const stateLabel = state === "thinking" ? THINKING_MESSAGES[thinkingMessageIndex] : STATE_LABEL[waveState];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space") {
        e.preventDefault();
        onEndTurn();
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onEndTurn, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-bg-base/97 backdrop-blur-sm px-6">
      <CallSineWave state={waveState} height={90} className="w-[280px]" />

      <p className="text-sm font-medium text-fg-muted">{stateLabel}</p>

      <div className="max-w-[560px] min-h-[64px] text-center text-lg leading-relaxed text-fg-primary">
        {liveTranscript || (
          <span className="text-fg-subtle">{state === "listening" ? "Say something…" : ""}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onClose}
          title="End call"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-danger transition-opacity duration-150 hover:opacity-90 cursor-pointer"
        >
          <PhoneOff size={22} strokeWidth={2} className="text-white" />
        </button>
      </div>
    </div>
  );
}
