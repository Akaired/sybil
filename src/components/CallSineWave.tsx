import type { SybilState } from "../config/tokens";

/**
 * CallSineWave — the hand-authored per-state capsule waveforms from
 * public/svg/sybil-state-*.svg, animated. Distinct from SineWave.tsx (one
 * generic procedural wave shape, opacity-pulse only): every state here has
 * its own actual waveform geometry, animated with real vertical undulation
 * via a dedicated `.call-capsule` / `[data-call-state]` CSS namespace in
 * index.css — kept separate from `.sybil-capsule` so it can't affect the
 * small SineWave badges used elsewhere in the app.
 */
interface Capsule {
  x: number;
  y: number;
  h: number;
  fill: string;
}

const CAPSULE_WIDTH = 13;
const CAPSULE_RADIUS = 6.5;
const VIEW_W = 152;
const VIEW_H = 96;

// Connecting (pre-listening "idle") uses the offline shape — flat, dim,
// signalling "not live yet" — separately from a genuine post-call idle.
const STATE_CAPSULES: Record<SybilState, Capsule[]> = {
  offline: [
    { x: 6, y: 44, h: 8, fill: "#3A4048" },
    { x: 27, y: 44, h: 8, fill: "#3A4048" },
    { x: 48, y: 44, h: 8, fill: "#3A4048" },
    { x: 69, y: 44, h: 8, fill: "#3A4048" },
    { x: 90, y: 44, h: 8, fill: "#3A4048" },
    { x: 111, y: 44, h: 8, fill: "#3A4048" },
    { x: 132, y: 44, h: 8, fill: "#3A4048" },
  ],
  idle: [
    { x: 6, y: 41, h: 10, fill: "#6E7681" },
    { x: 27, y: 38, h: 10, fill: "#6E7681" },
    { x: 48, y: 41, h: 10, fill: "#6E7681" },
    { x: 69, y: 46, h: 10, fill: "#6E7681" },
    { x: 90, y: 48, h: 10, fill: "#6E7681" },
    { x: 111, y: 45, h: 10, fill: "#6E7681" },
    { x: 132, y: 41, h: 10, fill: "#6E7681" },
  ],
  listening: [
    { x: 6, y: 37, h: 14, fill: "#6E7681" },
    { x: 27, y: 28, h: 20, fill: "#00C2D1" },
    { x: 48, y: 19, h: 26, fill: "#00C2D1" },
    { x: 69, y: 27, h: 22, fill: "#00C2D1" },
    { x: 90, y: 37, h: 18, fill: "#00C2D1" },
    { x: 111, y: 45, h: 14, fill: "#00C2D1" },
    { x: 132, y: 48, h: 12, fill: "#6E7681" },
  ],
  thinking: [
    { x: 6, y: 34, h: 16, fill: "#6E7681" },
    { x: 27, y: 25, h: 22, fill: "#C9E82B" },
    { x: 48, y: 18, h: 28, fill: "#23D18B" },
    { x: 69, y: 26, h: 24, fill: "#00C2D1" },
    { x: 90, y: 36, h: 20, fill: "#23D18B" },
    { x: 111, y: 44, h: 16, fill: "#C9E82B" },
    { x: 132, y: 43, h: 14, fill: "#6E7681" },
  ],
  speaking: [
    { x: 6, y: 48, h: 20, fill: "#FF3B1F" },
    { x: 27, y: 23, h: 34, fill: "#FF9E0A" },
    { x: 48, y: 7, h: 42, fill: "#C9E82B" },
    { x: 69, y: 27, h: 30, fill: "#23D18B" },
    { x: 90, y: 48, h: 24, fill: "#00C2D1" },
    { x: 111, y: 57, h: 18, fill: "#2C7DF7" },
    { x: 132, y: 49, h: 14, fill: "#6E7681" },
  ],
  alert: [
    { x: 6, y: 51, h: 26, fill: "#FF3B1F" },
    { x: 27, y: 9, h: 46, fill: "#FF3B1F" },
    { x: 48, y: 40, h: 44, fill: "#FF3B1F" },
    { x: 69, y: 6, h: 48, fill: "#FF3B1F" },
    { x: 90, y: 43, h: 42, fill: "#FF3B1F" },
    { x: 111, y: 14, h: 40, fill: "#FF3B1F" },
    { x: 132, y: 44, h: 28, fill: "#FF3B1F" },
  ],
};

interface CallSineWaveProps {
  state: SybilState;
  height?: number;
  className?: string;
}

export default function CallSineWave({ state, height = 96, className = "" }: CallSineWaveProps) {
  const capsules = STATE_CAPSULES[state];

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height={height}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      data-call-state={state}
      role="img"
      aria-label={`Sybil call state: ${state}`}
      style={{ overflow: "visible" }}
    >
      {capsules.map((cap, i) => (
        <rect
          key={i}
          className="call-capsule"
          x={cap.x}
          y={cap.y}
          width={CAPSULE_WIDTH}
          height={cap.h}
          rx={CAPSULE_RADIUS}
          ry={CAPSULE_RADIUS}
          fill={cap.fill}
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </svg>
  );
}
