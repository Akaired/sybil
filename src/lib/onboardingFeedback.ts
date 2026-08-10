import { supabase } from "../config/supabase";

export interface OnboardingFeedback {
  rating: number;
  willingnessToPay: number | null;
  comment: string | null;
  contactEmail: string | null;
}

/** One-time write at the end of the tour — see finish() in OnboardingTour. */
export async function saveOnboardingFeedback(userId: string, feedback: OnboardingFeedback): Promise<void> {
  const { error } = await supabase.from("sybil_onboarding_feedback").insert({
    user_id: userId,
    rating: feedback.rating,
    willingness_to_pay: feedback.willingnessToPay,
    comment: feedback.comment,
    contact_email: feedback.contactEmail,
  });
  if (error) {
    // Non-fatal: never block leaving onboarding on this write succeeding.
    console.error("Failed to save onboarding feedback:", error.message);
  }
}
