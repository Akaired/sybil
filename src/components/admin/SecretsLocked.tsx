import { Lock } from "lucide-react";

// Deliberately self-contained: no adminApi import, no network call, no props
// from a server. What's shown here is the entire truth of what this
// component can ever display — a staff-level caller must never be able to
// coax a real secret value out of this screen, even by reading the source.
const SERVICES = ["Bright Data", "Speechmatics", "AI/ML API", "OpenRouter"];
const FAKE_VALUE = "••••••••••••";

export default function SecretsLocked() {
  return (
    <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg p-6">
      <div className="flex items-center gap-2 text-fg-muted mb-1">
        <Lock size={15} strokeWidth={2} />
        <span className="text-sm font-semibold text-fg-primary">Secrets</span>
      </div>
      <p className="text-xs text-fg-subtle mb-5">Reserved for the platform owner.</p>

      <div className="divide-y divide-fg-subtle/10">
        {SERVICES.map((service) => (
          <div key={service} className="flex items-center justify-between py-3">
            <span className="text-[13.5px] text-fg-primary">{service}</span>
            <span className="font-mono text-sm text-fg-subtle tracking-wider">{FAKE_VALUE}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
