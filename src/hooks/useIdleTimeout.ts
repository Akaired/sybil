import { useEffect } from "react";

// This is a CLIENT-SIDE CONVENIENCE TIMEOUT, not a security boundary.
// Supabase's native inactivity-timeout / time-boxed-session features are
// paid-plan-only and unavailable to us, so this only ends the *browser tab's*
// idea of the session after inactivity — it does not, by itself, revoke
// anything server-side. A leaked/stolen refresh token remains valid on
// Supabase's end regardless of this timer; real revocation happens via
// signOut({ scope: "global" }) in AuthContext, separately.
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000; // don't hit localStorage on every keystroke
const CHECK_INTERVAL_MS = 60 * 1000;
const LAST_ACTIVITY_KEY = "sybil.lastActivity";

export function touchActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function getLastActivity(): number | null {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  return raw ? Number(raw) : null;
}

export function clearActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

// No recorded activity (e.g. this is a brand new login) means "not stale" —
// only an actual elapsed gap counts.
export function isIdleExpired(): boolean {
  const last = getLastActivity();
  if (last === null) return false;
  return Date.now() - last > IDLE_TIMEOUT_MS;
}

/**
 * Tracks user activity while `enabled` and calls `onTimeout` once
 * IDLE_TIMEOUT_MS has passed without any. This hook only observes activity
 * going forward from mount — it does NOT cover "the tab/browser was closed
 * and reopened after the window elapsed". That path is handled separately,
 * synchronously, before the app renders (see AuthContext's init effect,
 * which calls isIdleExpired() itself on load).
 */
export function useIdleTimeout(enabled: boolean, onTimeout: () => void) {
  useEffect(() => {
    if (!enabled) return;

    touchActivity(); // mark "active" the moment tracking starts (fresh login / app load)

    let lastWrite = Date.now();
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      touchActivity();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab is itself a form of activity, but also the
      // moment we most need to catch a gap that happened while it was
      // hidden/backgrounded (timers can be throttled in background tabs).
      if (isIdleExpired()) {
        onTimeout();
        return;
      }
      recordActivity();
    };

    window.addEventListener("mousedown", recordActivity);
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const interval = setInterval(() => {
      if (isIdleExpired()) onTimeout();
    }, CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener("mousedown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
    };
  }, [enabled, onTimeout]);
}
