import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../config/tokens";
import RoadmapSpine from "../components/RoadmapSpine";
import { AuthContext } from "../contexts/AuthContext";
import PublicUserMenu from "../components/PublicUserMenu";
import PublicNavLinks from "../components/PublicNavLinks";
import PublicLegalLinks from "../components/PublicLegalLinks";
import { useIubendaScript } from "../hooks/useIubendaScript";

interface RoadmapGroup {
  id: string;
  badge: string;
  badgeColor: string;
  title: string;
  titleColor: string;
  items: string[];
  itemBorderColor: string;
  itemTextColor: string;
  muted?: boolean;
}

const groups: RoadmapGroup[] = [
  {
    id: "now",
    badge: "New",
    badgeColor: "#FF5A4E",
    title: "Now",
    titleColor: "#F4F3F1",
    items: [
      "Chat",
      "Telegram",
      "Voice",
      "Email",
      "Calendar",
      "Web sentinels",
      "Dormant tasks",
      "Pulse",
      "Team",
    ],
    itemBorderColor: "rgba(255,90,78,0.4)",
    itemTextColor: "#FDBFB8",
  },
  {
    id: "waiting",
    badge: "Waiting",
    badgeColor: "#8A8F98",
    title: "Hackathon results",
    titleColor: "#F4F3F1",
    items: [],
    itemBorderColor: "rgba(138,143,152,0.4)",
    itemTextColor: "#B7BAC0",
  },
  {
    id: "next",
    badge: "Coming soon",
    badgeColor: "#E8A33D",
    title: "Next",
    titleColor: "#F4F3F1",
    items: ["Skills", "MCP servers", "Notifications", "Subagents", "Slack", "Notion", "Payments"],
    itemBorderColor: "rgba(232,163,61,0.4)",
    itemTextColor: "#F3CE95",
  },
  {
    id: "registration",
    badge: "Registration",
    badgeColor: "#FF3B1F",
    title: "Launching on ProductHunt, incorporation",
    titleColor: "#F4F3F1",
    items: [],
    itemBorderColor: "rgba(255,59,31,0.4)",
    itemTextColor: "#FDBFB8",
  },
  {
    id: "later",
    badge: "Soon",
    badgeColor: "#8A8F98",
    title: "Later",
    titleColor: "#B7BAC0",
    items: [
      "LinkedIn",
      "Instagram",
      "X",
      "WhatsApp",
      "Jira",
      "Trello",
      "Outlook",
      "n8n",
      "IT e-invoicing",
      "...and much more!",
    ],
    itemBorderColor: "rgba(138,143,152,0.4)",
    itemTextColor: "#B7BAC0",
    muted: true,
  },
];

function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, revealed };
}

function RoadmapSection({ group }: { group: RoadmapGroup }) {
  const { ref, revealed } = useRevealOnScroll<HTMLElement>();

  return (
    <section
      ref={ref}
      className={`reveal-up${revealed ? " is-revealed" : ""}`}
      style={{ opacity: group.muted ? 0.6 : 1 }}
    >
      <div className="flex items-center gap-3.5 mb-[18px]">
        <span
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-[0.03em] border"
          style={{ borderColor: group.badgeColor, color: group.badgeColor }}
        >
          {group.badge}
        </span>
        <h2 className="text-[30px] font-semibold m-0" style={{ color: group.titleColor }}>
          {group.title}
        </h2>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {group.items.map((item, i) => (
          <span
            key={item}
            className={`reveal-up${revealed ? " is-revealed" : ""} px-4 py-[9px] rounded-full border text-[15px]`}
            style={{
              borderColor: group.itemBorderColor,
              color: group.itemTextColor,
              transitionDelay: revealed ? `${120 + i * 35}ms` : "0ms",
            }}
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

export default function Roadmap() {
  const { session, loading: authLoading } = useContext(AuthContext);
  useIubendaScript();
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [spineHeight, setSpineHeight] = useState(0);
  const { ref: ctaRef, revealed: ctaRevealed } = useRevealOnScroll<HTMLDivElement>();

  useLayoutEffect(() => {
    const el = sectionsRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setSpineHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full min-h-screen bg-bg-base">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-12 py-5 sm:py-7 max-w-[1440px] mx-auto">
        <div className="flex items-center gap-6 lg:gap-10 min-w-0">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
            <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 sm:h-7 w-auto shrink-0" />
            <span className="font-bold text-lg sm:text-xl tracking-[-0.01em] text-fg-primary truncate">
              {copy.appName}
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
      </header>

      <main className="max-w-[980px] mx-auto px-4 sm:px-6 md:px-12 pt-10 pb-[120px]">
        <h1 className="font-semibold text-[clamp(36px,8vw,56px)] leading-none mb-3 tracking-[-0.01em] text-fg-primary">
          {copy.pages.roadmap.title}
        </h1>
        <p className="text-[17px] leading-[1.6] text-fg-muted mb-[72px] max-w-[520px]">
          What Sybil listens to and watches today, and what&apos;s coming next.
        </p>

        <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[88px_1fr] gap-3 sm:gap-7">
          <RoadmapSpine height={spineHeight} />
          <div ref={sectionsRef} className="flex flex-col gap-[76px]">
            {groups.map((group) => (
              <RoadmapSection key={group.id} group={group} />
            ))}
          </div>
        </div>

        <div
          ref={ctaRef}
          className={`reveal-up${ctaRevealed ? " is-revealed" : ""} flex flex-col items-center gap-5 mt-24 pt-14 border-t border-fg-primary/10`}
        >
          <p className="text-lg text-fg-muted m-0">Have an idea?</p>
          <a
            href="mailto:maiordavid.dm@gmail.com"
            className="inline-flex items-center px-7 py-3 rounded-full border-[1.5px] border-fg-accent text-fg-accent font-semibold text-[15px] hover:bg-fg-accent/10 transition-colors duration-150"
          >
            Write to us
          </a>
        </div>
      </main>

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
    </div>
  );
}
