import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

/**
 * Top bar notification bell with a dropdown. Placeholder — no real
 * notifications are wired up yet.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        title="Notifications"
        className="p-1.5 rounded-lg text-fg-subtle hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
      >
        <Bell size={18} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-72 bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-lg py-1.5 z-50">
          <div className="px-3.5 py-2 text-xs font-semibold text-fg-subtle uppercase tracking-wide">
            Notifications
          </div>
          <div className="px-3.5 py-6 text-sm text-fg-muted text-center">
            No notifications yet
          </div>
        </div>
      )}
    </div>
  );
}
