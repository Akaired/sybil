export const DEMO_ACCOUNT_EMAIL = "demo@sybil.local";
const DEMO_LIMIT_ERROR = "demo_limit_reached";

/** True when a caught error/message is the server-side demo-quota rejection. */
export function isDemoLimitError(message?: string | null): boolean {
  return message === DEMO_LIMIT_ERROR;
}
