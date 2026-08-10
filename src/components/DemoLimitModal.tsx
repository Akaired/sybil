import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { AuthContext } from "../contexts/AuthContext";

/**
 * Not a generic Modal — deliberately has no close button, no Escape/backdrop
 * dismissal, and unmounts the rest of the app underneath it (see how it's
 * rendered in Dashboard). Reaching this means the shared demo account's
 * per-visitor quota is spent; the only ways out are logout or registering.
 */
export default function DemoLimitModal({ open }: { open: boolean }) {
  const { signOut } = useContext(AuthContext);
  const navigate = useNavigate();

  if (!open) return null;

  async function handleLogout() {
    await signOut();
  }

  function handleRegister() {
    signOut().finally(() => navigate("/register"));
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Demo limit reached"
        className="w-full max-w-sm bg-bg-elevated border border-fg-subtle/20 rounded-xl shadow-xl p-7 text-center"
      >
        <div className="w-11 h-11 mx-auto rounded-full bg-fg-accent/12 flex items-center justify-center text-fg-accent mb-4">
          <Sparkles size={20} strokeWidth={1.8} />
        </div>
        <p className="text-[15px] text-fg-primary font-medium leading-snug">
          Thank you for trying out the platform, register with a real account to explore more!
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleRegister}
            className="w-full bg-fg-accent text-bg-base font-semibold text-sm rounded-md px-4 py-2.5 hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            Create a free account
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-fg-muted hover:text-fg-primary text-sm font-medium py-2 transition-colors duration-150 cursor-pointer"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
