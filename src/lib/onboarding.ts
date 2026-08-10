import { supabase } from "../config/supabase";

export type JobProfile = "agency_owner" | "developer" | "designer" | "marketer" | "other";

/**
 * Marks the tour as done (whether finished or skipped) and, if the user
 * answered the one-click job question, saves it. Called at most once per
 * user — a skip and a completed tour both land here, just with a different
 * `jobProfile`.
 */
export async function finishOnboarding(userId: string, jobProfile: JobProfile | null): Promise<void> {
  const { error } = await supabase
    .from("sybil_profiles")
    .update({ onboarding_completed: true, job_profile: jobProfile })
    .eq("user_id", userId);
  if (error) {
    // Non-fatal: worst case the tour reappears next login. Never block the
    // user's exit from onboarding on this write succeeding.
    console.error("Failed to save onboarding completion:", error.message);
  }
}
