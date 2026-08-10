import { useEffect, useRef, useState } from "react";

/**
 * RoadmapSpine — vertical sine "spine" running alongside the roadmap
 * sections, from the Roadmap Claude Design mockup.
 *
 * Same y(x) = axis ± amplitude·sin(2π·x / period) formula as the
 * brand's horizontal SineWave (config/tokens.ts waveGeometry), rotated
 * 90°. Amplitude/period/spacing here match the mockup's fixed
 * 900px-tall reference curve (period 300, amplitude 35, capsules every
 * 75px) rather than tokens.waveGeometry, since that token set is
 * calibrated for the compact horizontal logo mark, not a page-length
 * vertical spine — flagged as intentional mockup-specific geometry.
 *
 * Capsules fade in as the page scrolls (own scroll listener drives
 * `revealedCount`), then breathe continuously via the shared
 * `.sybil-capsule` idle animation (index.css) once revealed —
 * satisfies "the sine must appear as you scroll and must be animated".
 */

const PERIOD = 300;
const AMPLITUDE = 35;
const CENTER_X = 60;
const CAP_SPACING = 75;
const CAP_WIDTH = 14;
const CAP_HEIGHT = 7;
const CAP_RADIUS = 3.5;

// Bespoke 13-stop fade from the mockup (red → orange → yellow → green →
// blue → back through amber/gray) — distinct from tokens.waveColors,
// same pattern as Landing.tsx's bespoke hero capsule gradient.
const CAPSULE_COLORS = [
  "#FF5A4E",
  "#FF8A3D",
  "#F5C542",
  "#4CAF6D",
  "#4A90D9",
  "#E8A33D",
  "#D98C2B",
  "#C9781E",
  "#BA6712",
  "#6B7280",
  "#5B6169",
  "#4B5058",
  "#3C4046",
];

function xAt(y: number) {
  return CENTER_X + AMPLITUDE * Math.sin((2 * Math.PI * y) / PERIOD);
}

function buildPath(height: number) {
  const steps = Math.max(Math.ceil(height / 15), 1);
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * height;
    const x = xAt(y);
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

function buildCapsules(height: number) {
  const caps: { x: number; y: number; color: string }[] = [];
  for (let y = 0, i = 0; y <= height; y += CAP_SPACING, i++) {
    caps.push({
      x: xAt(y),
      y,
      color: CAPSULE_COLORS[Math.min(i, CAPSULE_COLORS.length - 1)],
    });
  }
  return caps;
}

interface RoadmapSpineProps {
  height: number;
}

export default function RoadmapSpine({ height }: RoadmapSpineProps) {
  const safeHeight = Math.max(height, 1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [revealedCount, setRevealedCount] = useState(0);

  const path = buildPath(safeHeight);
  const capsules = buildCapsules(safeHeight);

  useEffect(() => {
    const REVEAL_LINE = 0.82; // fraction down the viewport that "reveals" the spine
    let frame = 0;

    const update = () => {
      frame = 0;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const revealY = window.innerHeight * REVEAL_LINE;
      const revealedPx = Math.min(Math.max(revealY - rect.top, 0), rect.height);
      const count = Math.ceil((revealedPx / safeHeight) * capsules.length);
      setRevealedCount((prev) => (prev === count ? prev : count));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [safeHeight, capsules.length]);

  return (
    <div ref={containerRef} style={{ height: safeHeight }}>
      <svg
        viewBox={`0 0 120 ${safeHeight}`}
        width="100%"
        height={safeHeight}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
        data-sybil-state="idle"
        role="presentation"
        aria-hidden="true"
      >
        <path d={path} fill="none" stroke="rgba(244,243,241,0.14)" strokeWidth={2} />
        {capsules.map((cap, i) => (
          <g
            key={i}
            className={`spine-capsule${i < revealedCount ? " is-revealed" : ""}`}
            style={{ transitionDelay: `${(i % 6) * 40}ms` }}
          >
            <rect
              className="sybil-capsule"
              x={cap.x - CAP_WIDTH / 2}
              y={cap.y - CAP_HEIGHT / 2}
              width={CAP_WIDTH}
              height={CAP_HEIGHT}
              rx={CAP_RADIUS}
              fill={cap.color}
              style={{ animationDelay: `${i * 90}ms` }}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
