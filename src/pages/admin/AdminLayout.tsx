import { useContext } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { LayoutGrid, BarChart3, HeartPulse, ScrollText, Cpu, KeyRound, Newspaper, BookOpen } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";

const TABS = [
  { to: "/admin/overview", label: "Overview", icon: LayoutGrid },
  { to: "/admin/usage", label: "Usage", icon: BarChart3 },
  { to: "/admin/health", label: "Health", icon: HeartPulse },
  { to: "/admin/audit", label: "Audit", icon: ScrollText },
  { to: "/admin/providers", label: "Providers", icon: Cpu },
  { to: "/admin/secrets", label: "Secrets", icon: KeyRound },
  { to: "/admin/blog", label: "Manage Blog", icon: Newspaper },
  { to: "/admin/docs", label: "Manage documentation", icon: BookOpen },
];

const ROLE_LABEL: Record<"staff" | "superadmin", string> = {
  staff: "Staff",
  superadmin: "Superadmin",
};

/**
 * Admin shell — internal tool, so deliberately dense and undecorated: no
 * page transitions, no card shadows beyond what the base tokens already use.
 * The banner exists specifically so this can never be mistaken for the
 * per-workspace Settings pages one level up in the sidebar.
 */
export default function AdminLayout() {
  const location = useLocation();
  const { platformRole } = useContext(AuthContext);

  return (
    <div className="w-full max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-2 bg-warning/10 border border-warning/25 rounded-md px-3 py-1.5 mb-5 text-xs font-semibold text-warning tracking-wide">
        Platform panel · {platformRole ? ROLE_LABEL[platformRole] : ""}
      </div>

      <h1 className="text-xl font-semibold text-fg-primary mb-2.5">Admin</h1>
      <p className="text-fg-muted text-sm mb-6">Platform-wide operations across every workspace.</p>

      <nav className="flex bg-bg-elevated border border-fg-subtle/20 rounded-lg p-[3px] mb-6 overflow-x-auto">
        {TABS.map((tab) => {
          const active = location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
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
