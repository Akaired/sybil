import type { JobProfile } from "../lib/onboarding";

export interface JobOption {
  value: JobProfile;
  label: string;
}

export const JOB_OPTIONS: JobOption[] = [
  { value: "agency_owner", label: "Agency owner" },
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "marketer", label: "Marketer" },
  { value: "other", label: "Something else" },
];

/**
 * Illustrative sentinel-example strings shown inside the tour only — never
 * created as real sentinels, never implies the agent behaves differently
 * per job type.
 */
export const SENTINEL_EXAMPLES: Record<JobProfile, string> = {
  agency_owner: "“Client sign-off is late — the Acme Co. brand deck hasn't been approved in 3 days.”",
  developer: "“Review is stalled — pull request #482 has been open for 2 days with no comment.”",
  designer: "“File wasn't approved — the homepage mockup was delivered but never marked reviewed.”",
  marketer: "“Report went unread — last week's campaign performance email hasn't been opened.”",
  other: "“Something's been sitting too long — a client email has gone unanswered for 2 days.”",
};

export const DEFAULT_SENTINEL_EXAMPLE = SENTINEL_EXAMPLES.other;
