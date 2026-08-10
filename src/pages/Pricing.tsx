import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock } from "lucide-react";
import { copy } from "../config/tokens";
import { AuthContext } from "../contexts/AuthContext";
import PublicUserMenu from "../components/PublicUserMenu";
import PublicNavLinks from "../components/PublicNavLinks";
import PublicLegalLinks from "../components/PublicLegalLinks";
import { useIubendaScript } from "../hooks/useIubendaScript";

// ── Plan data ────────────────────────────────────────────────

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

const faqs = [
  {
    q: "What exactly is a sentinel?",
    a: 'A sentinel is a watcher you attach to a task instead of a due date — a wake-up condition written in plain language, like "tell me if this quote gets no reply in 5 days" or "tell me when this competitor changes their prices." It checks the web, an email thread or your workspace\'s own state, and only comes back to you when something real changes.',
  },
  {
    q: "Can I switch between monthly and annual billing?",
    a: "Yes. You can change your billing cycle at any time from your plan settings. Moving to annual applies the 20% discount immediately; moving back to monthly takes effect at the start of your next billing period.",
  },
  {
    q: "How does seat pricing work on Team and Business?",
    a: "Team starts at 3 seats minimum, each seat priced per person and sharing one pool of 25 sentinels per seat. Business is priced per seat as well, starting from €39, with everything — sentinels, voice, history — unlimited and configurable for the organization.",
  },
  {
    q: "What happens when I reach my sentinel limit?",
    a: "You'll be prompted to remove an existing sentinel or upgrade. The limit is on active sentinels, not on tasks or projects, so nothing else about your workspace is affected. Most people hit this exact moment right when they've understood what the product is for.",
  },
  {
    q: "Is my workspace isolated from other customers?",
    a: "Yes. Every workspace is isolated at the database level, not just in the interface — access is enforced by row-level security policies, so one workspace's data is never reachable from another, regardless of plan.",
  },
];

export default function Pricing() {
  const { session, loading: authLoading } = useContext(AuthContext);
  useIubendaScript();
  const [billing, setBilling] = useState<Billing>("monthly");
  const [modalOpen, setModalOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});

  const toggleFaq = (i: number) =>
    setFaqOpen((s) => ({ ...s, [i]: !s[i] }));

  return (
    <div className="w-full min-h-screen bg-bg-base overflow-hidden">
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
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center px-3.5 py-2 sm:px-5 sm:py-2.5 border border-fg-accent rounded-lg text-fg-accent font-semibold text-xs sm:text-sm whitespace-nowrap hover:bg-fg-accent/10 transition-colors duration-150 cursor-pointer"
              >
                {copy.pages.landing.cta}
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-[1440px] mx-auto px-6 md:px-16 pt-16 pb-6 text-center">
        <div className="inline-block text-[13px] font-semibold tracking-[0.06em] uppercase text-fg-accent mb-4">
          Pricing
        </div>
        <h1 className="font-semibold text-[clamp(32px,4.4vw,48px)] leading-[1.1] tracking-[-0.02em] mb-4 text-fg-primary">
          Simple pricing, built around sentinels
        </h1>
        <p className="text-[17px] leading-[1.6] text-fg-muted max-w-[560px] mx-auto mb-10">
          Every plan gets the full agent. What scales is how many things it
          watches for you, and how often.
        </p>

        <div className="inline-flex items-center gap-1 bg-bg-elevated border border-fg-subtle/20 rounded-[10px] p-1">
          <button
            onClick={() => setBilling("monthly")}
            className={`font-semibold text-sm rounded-lg px-[18px] py-[9px] cursor-pointer transition-colors duration-150 ${
              billing === "monthly"
                ? "bg-fg-accent text-bg-base"
                : "bg-transparent text-fg-muted"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("annual")}
            className={`font-semibold text-sm rounded-lg px-[18px] py-[9px] cursor-pointer transition-colors duration-150 ${
              billing === "annual"
                ? "bg-fg-accent text-bg-base"
                : "bg-transparent text-fg-muted"
            }`}
          >
            Annual <span className="text-success font-bold">&minus;20%</span>
          </button>
        </div>
      </header>

      {/* Plans */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-16 pt-10 pb-24">
        <div className="flex gap-5 items-stretch flex-wrap justify-center">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex-1 min-w-[260px] max-w-[300px] rounded-lg p-8 bg-bg-elevated border ${
                plan.highlighted
                  ? "border-fg-accent shadow-[0_0_0_1px_rgba(255,59,31,0.15)]"
                  : "border-fg-subtle/20"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-6 bg-fg-accent text-bg-base text-xs font-bold px-3 py-1 rounded-md tracking-[0.02em]">
                  Most popular
                </div>
              )}
              <div className="text-[15px] font-semibold text-fg-primary mb-2">
                {plan.name}
              </div>
              <div className="text-[13px] text-fg-subtle mb-6 min-h-[34px] leading-[1.4]">
                {plan.tagline}
              </div>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="font-semibold text-[38px] tracking-[-0.02em] text-fg-primary">
                  {billing === "annual" ? plan.priceAnnual : plan.priceMonthly}
                </span>
                <span className="text-sm text-fg-subtle">
                  {billing === "annual" ? plan.unitAnnual : plan.unitMonthly}
                </span>
              </div>
              <div className="text-[13px] text-fg-subtle mb-7 min-h-[18px]">
                {billing === "annual" ? plan.noteAnnual : ""}
              </div>
              <button
                onClick={() => setModalOpen(true)}
                className={`w-full font-semibold text-sm rounded-lg py-[11px] cursor-pointer border-[1.5px] transition-colors duration-150 ${
                  plan.highlighted
                    ? "border-fg-accent text-fg-accent hover:bg-fg-accent/10"
                    : "border-fg-subtle/40 text-fg-primary hover:border-fg-muted"
                }`}
              >
                {plan.ctaLabel}
              </button>
              <div className="h-px bg-fg-subtle/20 my-7" />
              <div>
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2.5 mb-3.5">
                    <Check
                      size={16}
                      strokeWidth={1.8}
                      className="shrink-0 mt-0.5 stroke-success"
                    />
                    <span className="text-sm leading-[1.5] text-fg-muted">
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-[760px] mx-auto px-6 md:px-16 pb-28">
        <h2 className="font-semibold text-[30px] tracking-[-0.02em] text-fg-primary text-center mb-11">
          Frequently asked questions
        </h2>
        {faqs.map((faq, i) => (
          <div key={faq.q} className="border-b border-fg-subtle/20 py-[22px]">
            <button
              onClick={() => toggleFaq(i)}
              className="flex items-center justify-between gap-4 w-full text-left cursor-pointer"
            >
              <span className="text-base font-semibold text-fg-primary">
                {faq.q}
              </span>
              <span
                className={`text-xl font-normal leading-none transition-transform duration-150 ${
                  faqOpen[i] ? "text-fg-accent rotate-45" : "text-fg-subtle"
                }`}
              >
                +
              </span>
            </button>
            {faqOpen[i] && (
              <p className="text-[15px] leading-[1.65] text-fg-muted mt-3.5 max-w-[640px]">
                {faq.a}
              </p>
            )}
          </div>
        ))}
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
        <div className="flex items-center justify-center gap-3">
          <img
            src="/svg/sybil-mark.svg"
            alt="Sybil"
            className="h-6 w-auto opacity-60"
          />
          <span className="font-bold text-[15px] tracking-[0.02em] text-[#5A6167]">
            sybil
          </span>
        </div>
      </footer>

      {/* "Not live yet" modal */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          className="fixed inset-0 bg-[rgba(4,6,7,0.72)] flex items-center justify-center z-50 p-5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-bg-elevated border border-fg-subtle/20 rounded-lg p-10 max-w-[400px] text-center relative"
          >
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 bg-transparent border-none text-fg-subtle text-xl leading-none cursor-pointer"
            >
              ×
            </button>
            <div className="w-11 h-11 rounded-[10px] bg-fg-accent/10 flex items-center justify-center mx-auto mb-5">
              <Clock size={20} strokeWidth={2} className="text-fg-accent" />
            </div>
            <h3 className="font-semibold text-xl text-fg-primary mb-2.5">
              Available from September
            </h3>
            <p className="text-sm leading-[1.6] text-fg-muted mb-6">
              Sign-ups and billing aren't live yet. Leave your email and
              we'll let you know the moment plans open up.
            </p>
            <button
              onClick={() => setModalOpen(false)}
              className="w-full font-semibold text-[15px] text-bg-base bg-fg-accent border-none rounded-lg py-3 cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
