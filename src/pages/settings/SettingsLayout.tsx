import { Link, Outlet, useLocation } from "react-router-dom";
import { User, Plug, Scroll, CreditCard } from "lucide-react";
import { copy } from "../../config/tokens";

const TABS = [
  { to: "/settings/account", label: copy.pages.settings.tabs.account.label, icon: User },
  { to: "/settings/connections", label: copy.pages.settings.tabs.connections.label, icon: Plug },
  { to: "/settings/skills", label: copy.pages.settings.tabs.skills.label, icon: Scroll },
  { to: "/settings/plan", label: copy.pages.settings.tabs.plan.label, icon: CreditCard },
];

/**
 * Settings shell — five tabs as real routes under /settings/*, same
 * horizontal segmented-control style as the Mail Inbox/Sent toggle.
 */
export default function SettingsLayout() {
  const location = useLocation();

  return (
    <div className="w-full max-w-6xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-fg-primary mb-2.5">{copy.pages.settings.title}</h1>
      <p className="text-fg-muted text-sm mb-6">{copy.pages.settings.subtitle}</p>

      <nav className="flex bg-bg-elevated border border-fg-subtle/20 rounded-lg p-[3px] mb-6 overflow-x-auto">
        {TABS.map((tab) => {
          const active = location.pathname === tab.to;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex-1 flex items-center justify-center gap-1.5 font-semibold text-[13px] rounded-md px-1.5 sm:px-4 py-1.5 transition-colors duration-150 ${
                active ? "bg-warning text-bg-base" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              <Icon size={14} strokeWidth={1.8} className="shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}
