import { waveColors, waveGeometry, type SybilState } from "../config/tokens";

/**
 * SineWave — Sybil's signature capsule sine wave.
 *
 * 13 pill-shaped capsules positioned on the brand sine curve
 * y(x) = axis - amplitude · sin(2π·x / period)
 *
 * Each capsule: 12px wide, border-radius 999px (pill),
 * height derived from the |cos| (steepest = tallest).
 * Colors cycle through the 7-wave palette.
 *
 * Accepts a `state` prop that controls animation:
 *   idle | listening | thinking | speaking | alert | offline
 */
interface SineWaveProps {
  state?: SybilState;
  height?: number;
  className?: string;
}

/** Pre-compute capsule geometry for the 13 capsules */
function computeCapsules() {
  const { period, amplitude, step, axis, capWidth, capRadius, capCount, gridWidth, gridHeight, compression } =
    waveGeometry;

  const capsules: {
    cx: number;
    cy: number;
    h: number;
    colorIndex: number;
  }[] = [];

  // Start x so capsules are centered in the 240-wide grid
  const totalSpan = (capCount - 1) * step;
  const startX = (gridWidth - totalSpan) / 2;

  for (let i = 0; i < capCount; i++) {
    const x = startX + i * step;
    const phase = (2 * Math.PI * x) / period;
    const sinVal = Math.sin(phase);
    const y = axis - amplitude * sinVal;

    // Height proportional to |cos| (steepest part of wave = tallest capsule)
    const cosVal = Math.abs(Math.cos(phase));
    // Base height ranges from ~10 to ~34, compressed at 55%
    const rawHeight = 10 + cosVal * 24;
    const h = rawHeight * compression;

    capsules.push({
      cx: x,
      cy: y,
      h: Math.round(h * 10) / 10,
      colorIndex: i % waveColors.length,
    });
  }

  return { capsules, gridWidth, gridHeight, capWidth, capRadius };
}

// Pre-compute once — geometry is static per the brand manual
const { capsules, gridWidth, gridHeight, capWidth, capRadius } = computeCapsules();

export default function SineWave({ state = "idle", height = 48, className = "" }: SineWaveProps) {
  return (
    <svg
      viewBox={`0 0 ${gridWidth} ${gridHeight}`}
      width="100%"
      height={height}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      data-sybil-state={state}
      role="img"
      aria-label={`Sybil agent state: ${state}`}
      style={{ overflow: "visible" }}
    >
      {capsules.map((cap, i) => (
        <rect
          key={i}
          className="sybil-capsule"
          x={cap.cx - capWidth / 2}
          y={cap.cy - cap.h / 2}
          width={capWidth}
          height={cap.h}
          rx={capRadius}
          ry={capRadius}
          fill={waveColors[cap.colorIndex]}
          opacity={state === "offline" ? 0.4 : 0.75}
          style={{
            animationDelay: `${i * 80}ms`,
          }}
        />
      ))}
    </svg>
  );
}
