import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { User, LogOut, ChevronDown } from "lucide-react";
import { AuthContext } from "../contexts/AuthContext";
import { getDisplayName, initialsFromName } from "../utils/displayName";

/**
 * Top-right avatar + username with a dropdown (Account, Logout).
 */
export default function UserMenu() {
  const { session, user, profile, signOut } = useContext(AuthContext);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const displayName = getDisplayName(user, profile);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!session) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
      >
        <div className="w-[30px] h-[30px] shrink-0 rounded-full bg-sine-indigo/18 flex items-center justify-center text-xs font-semibold text-sine-indigo">
          {initialsFromName(displayName)}
        </div>
        <span className="text-[13px] font-medium text-fg-primary max-w-[90px] sm:max-w-[160px] truncate">
          {displayName}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`text-fg-subtle transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-48 bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-lg py-1.5 z-50">
          <Link
            to="/settings/account"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
          >
            <User size={16} strokeWidth={1.8} />
            Account
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-fg-muted hover:text-fg-primary hover:bg-bg-surface/50 transition-colors duration-150 cursor-pointer"
          >
            <LogOut size={16} strokeWidth={1.8} />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
