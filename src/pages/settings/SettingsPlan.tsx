import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { supabase } from "../../config/supabase";
import ComingSoonBadge from "../../components/settings/ComingSoonBadge";

// Plan data, taglines and features copied verbatim from /pricing (Pricing.tsx)
// so the two stay visually and factually identical. Not shared as a module
// yet — sync by hand until that's worth doing.

type Billing = "monthly" | "annual";

interface Plan {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: string;
  priceAnnual: string;
  unitMonthly: string;
  unitAnnual: string;
  noteAnnual: string;
  features: string[];
  ctaLabel: string;
  highlighted?: boolean;
}

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try the agent on real work, no card required.",
    priceMonthly: "€0",
    priceAnnual: "€0",
    unitMonthly: "",
    unitAnnual: "",
    noteAnnual: "",
    features: [
      "1 user",
      "3 active sentinels",
      "Daily sentinel checks",
      "30 min voice / month",
      "In-app chat only",
      "3 projects",
      "1 custom skill",
      "30-day history",
    ],
    ctaLabel: "Start for free",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For one person running everything themselves.",
    priceMonthly: "€14",
    priceAnnual: "€134",
    unitMonthly: "/month",
    unitAnnual: "/year",
    noteAnnual: "billed annually",
    features: [
      "1 user",
      "25 active sentinels",
      "Checks every 6 hours",
      "5 hours voice / month",
      "All doors: chat, Telegram, voice, email, calendar, web",
      "Unlimited projects",
      "Unlimited custom skills",
      "Subagents",
      "1-year history",
    ],
    ctaLabel: "Get Pro",
  },
  {
    id: "team",
    name: "Team",
    tagline: "For agencies and small teams sharing one workspace.",
    priceMonthly: "€12",
    priceAnnual: "€115",
    unitMonthly: "/seat, min. 3",
    unitAnnual: "/seat/year",
    noteAnnual: "billed annually",
    features: [
      "3+ users",
      "25 sentinels × seats, shared",
      "Hourly sentinel checks",
      "10 hours voice / seat / month",
      "All doors",
      "Unlimited projects & skills",
      "Assign tasks to people",
      "2-year history",
    ],
    ctaLabel: "Get Team",
    highlighted: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: "For larger organizations with internal systems to watch.",
    priceMonthly: "From €39",
    priceAnnual: "From €39",
    unitMonthly: "/seat",
    unitAnnual: "/seat",
    noteAnnual: "",
    features: [
      "Unlimited users",
      "Unlimited sentinels",
      "Configurable check frequency",
      "Unlimited voice",
      "All doors + API access",
      "SSO",
      "Audit log",
      "Internal sentinels on private systems",
    ],
    ctaLabel: "Talk to us",
  },
];

const FREE_SENTINEL_LIMIT = 3;
const CURRENT_PLAN: Plan["id"] = "free";

/**
 * Plan tab — same visual language as /pricing (copied by hand, not shared),
 * plus the workspace-specific bits: real sentinel counter, active-plan
 * marking, and disabled upgrade buttons since billing isn't live.
 */
export default function SettingsPlan() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [sentinelCount, setSentinelCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("sybil_sentinels")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => {
        if (!cancelled) setSentinelCount(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-4 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-[13px] text-fg-subtle">Current plan</p>
          <p className="text-lg font-semibold text-fg-primary">Free</p>
        </div>
        <div className="px-3.5 py-2 rounded-lg bg-fg-subtle/10 text-sm font-medium text-fg-muted">
          Sentinels {sentinelCount === null ? "—" : `${Math.max(FREE_SENTINEL_LIMIT - sentinelCount, 0)}/${FREE_SENTINEL_LIMIT}`}
        </div>
      </div>

      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 bg-bg-elevated border border-fg-subtle/20 rounded-[10px] p-1">
          <button
            onClick={() => setBilling("monthly")}
            className={`font-semibold text-sm rounded-lg px-[18px] py-[9px] cursor-pointer transition-colors duration-150 ${
              billing === "monthly" ? "bg-fg-accent text-bg-base" : "bg-transparent text-fg-muted"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("annual")}
            className={`font-semibold text-sm rounded-lg px-[18px] py-[9px] cursor-pointer transition-colors duration-150 ${
              billing === "annual" ? "bg-fg-accent text-bg-base" : "bg-transparent text-fg-muted"
            }`}
          >
            Annual <span className="text-success font-bold">&minus;20%</span>
          </button>
        </div>
      </div>

      <div className="flex gap-5 items-stretch flex-wrap">
        {plans.map((plan) => {
          const isActive = plan.id === CURRENT_PLAN;
          return (
            <div
              key={plan.id}
              className={`relative w-full sm:flex-1 sm:min-w-[240px] sm:max-w-[300px] rounded-lg p-7 bg-bg-elevated border ${
                plan.highlighted
                  ? "border-fg-accent shadow-[0_0_0_1px_rgba(255,59,31,0.15)]"
                  : isActive
                    ? "border-sine-indigo/50"
                    : "border-fg-subtle/20"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-6 bg-fg-accent text-bg-base text-xs font-bold px-3 py-1 rounded-md tracking-[0.02em]">
                  Most popular
                </div>
              )}
              {!plan.highlighted && isActive && (
                <div className="absolute -top-3 left-6 bg-sine-indigo text-bg-base text-xs font-bold px-3 py-1 rounded-md tracking-[0.02em]">
                  Active
                </div>
              )}

              <div className="text-[15px] font-semibold text-fg-primary mb-2">{plan.name}</div>
              <div className="text-[13px] text-fg-subtle mb-6 min-h-[34px] leading-[1.4]">{plan.tagline}</div>

              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="font-semibold text-[34px] tracking-[-0.02em] text-fg-primary">
                  {billing === "annual" ? plan.priceAnnual : plan.priceMonthly}
                </span>
                <span className="text-sm text-fg-subtle">
                  {billing === "annual" ? plan.unitAnnual : plan.unitMonthly}
                </span>
              </div>
              <div className="text-[13px] text-fg-subtle mb-7 min-h-[18px]">
                {billing === "annual" ? plan.noteAnnual : ""}
              </div>

              {isActive ? (
                <div className="w-full text-center font-semibold text-sm rounded-lg py-[11px] border-[1.5px] border-sine-indigo/40 text-sine-indigo">
                  Your current plan
                </div>
              ) : (
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-lg py-[11px] border-[1.5px] border-fg-subtle/30 text-fg-subtle cursor-not-allowed"
                >
                  {plan.ctaLabel}
                  <ComingSoonBadge />
                </button>
              )}

              <div className="h-px bg-fg-subtle/20 my-7" />

              <div>
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2.5 mb-3.5">
                    <Check size={16} strokeWidth={1.8} className="shrink-0 mt-0.5 stroke-success" />
                    <span className="text-sm leading-[1.5] text-fg-muted">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
