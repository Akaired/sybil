// ============================================================
// Sybil Design Tokens — centralized source of truth
// From Manuale di Identità v1.0 · Agosto 2026
// ============================================================

// ── Wave colors (onda) ────────────────────────────────────────
// 7-color sine palette: dark bg (primary) & light bg variants
export const wave = {
  signal: "#FF3B1F",
  amber: "#FF9E0A",
  acid: "#C9E82B",
  mint: "#23D18B",
  cyan: "#00C2D1",
  indigo: "#2C7DF7",
  graphite: "#6E7681",
  graphiteOff: "#3A4048",
} as const;

export const waveOnLight = {
  signal: "#E22C10",
  amber: "#C97800",
  acid: "#7E9A00",
  mint: "#12A369",
  cyan: "#0093A0",
  indigo: "#1F63CF",
  graphite: "#5A626C",
} as const;

export const waveColors = [
  wave.signal,
  wave.amber,
  wave.acid,
  wave.mint,
  wave.cyan,
  wave.indigo,
  wave.graphite,
] as const;

// ── Surfaces & Text ───────────────────────────────────────────
export const palette = {
  bg: {
    base: "#0D1114",
    elevated: "#14181C",
    surface: "#1A1F24",
    overlay: "#1F252A",
  },
  fg: {
    primary: "#E9ECEE",
    muted: "#98A0A6",
    subtle: "#6E7681",
    accent: wave.signal,
    success: wave.mint,
    warning: wave.amber,
    danger: wave.signal,
  },
  sine: {
    a: wave.signal,
    b: wave.amber,
    c: wave.acid,
    d: wave.mint,
    e: wave.cyan,
    f: wave.indigo,
    g: wave.graphite,
  },
} as const;

// ── Typography ───────────────────────────────────────────────
export const typography = {
  font: {
    sans: "'Archivo', 'Helvetica Neue', Arial, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, 'Fira Code', monospace",
  },
  wordmark: {
    weight: "600",
    tracking: "0.07em",
    case: "lowercase",
  },
  size: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem",
  },
} as const;

// ── Wave Geometry ────────────────────────────────────────────
export const waveGeometry = {
  period: 126,
  amplitude: 26,
  step: 18,
  axis: 52,
  capWidth: 12,
  capRadius: 6,
  capCount: 13,
  gridWidth: 240,
  gridHeight: 96,
  compression: 0.55,
  /** y(x) = axis - amplitude * sin(2π·x / period) */
} as const;

// ── Spacing & Radii ──────────────────────────────────────────
export const shape = {
  radius: {
    cap: "999px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    icon: "21.875%",
    full: "9999px",
  },
  space: {
    x: "18px",
    "1": "6px",
    "2": "12px",
    "3": "18px",
    "4": "26px",
    "5": "40px",
  },
} as const;

// ── Motion ───────────────────────────────────────────────────
export const motion = {
  dur: {
    idle: "4s",
    listening: "1.2s",
    thinking: "2s",
    speaking: "0.8s",
    alertPulse: "0.3s",
    transition: "240ms",
    transitionFast: "160ms",
    transitionSlow: "400ms",
  },
  ease: {
    inOut: "cubic-bezier(.4,0,.2,1)",
    out: "cubic-bezier(0,0,.2,1)",
  },
} as const;

// ── Sybil states ─────────────────────────────────────────────
export type SybilState = "idle" | "listening" | "thinking" | "speaking" | "alert" | "offline";

// ── Copy (centralized strings) ───────────────────────────────
export const copy = {
  appName: "sybil",
  tagline: "Your AI-native work agent. Anticipate. Resolve. Accelerate.",
  pages: {
    landing: {
      cta: "Start for free",
      ctaSecondary: "Watch the demo",
      login: "Log in",
    },
    pricing: {
      title: "Pricing",
      subtitle: "Simple, transparent pricing for teams of every size.",
    },
    roadmap: {
      title: "Roadmap",
      subtitle: "What we're building and when to expect it.",
    },
    login: {
      title: "Log in",
      subtitle: "Welcome back to your agentic workspace.",
    },
    register: {
      title: "Create account",
      subtitle: "Start free with 3 sentinels. No card required.",
    },
    dashboard: {
      title: "Dashboard",
      welcomeMessage: "Good morning. Here's what you need to know.",
    },
    pulse: {
      title: "Pulse",
      subtitle: "Your workspace's pulse, at a glance.",
    },
    projects: {
      title: "Projects",
      subtitle: "Organize tasks and sentinels by client or initiative.",
    },
    mail: {
      title: "Mail",
      subtitle: "Your inbox, triaged and summarized by Sybil.",
    },
    tasks: {
      title: "Tasks",
      subtitle: "Drag, edit, or ask Sybil in chat — everything stays in sync.",
    },
    activity: {
      title: "Activity",
      subtitle: "Chronological log of every signal received and every action Sybil has taken.",
    },
    settings: {
      title: "Settings",
      subtitle: "Account and workspace preferences.",
      tabs: {
        account: { label: "Account", subtitle: "Your profile and session." },
        connections: { label: "Connectors", subtitle: "Integrations and connected accounts." },
        skills: { label: "Skills", subtitle: "Specialized reasoning modes Sybil can apply to your work." },
        plan: { label: "Plan", subtitle: "Your subscription and usage." },
      },
    },
    team: {
      title: "Team",
      subtitle: "Manage your team members and roles.",
    },
    docs: {
      title: "Documentation",
      subtitle: "Learn how to get the most out of Sybil.",
    },
  },
  roles: {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    guest: "Guest",
  },
} as const;
