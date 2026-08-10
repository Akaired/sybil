// ============================================================================
// Shared demo-account rate limiting — demo@sybil.local is a single publicly
// reachable account (auto-login button on the landing page), so its usage is
// capped per visitor IP rather than per-account. Enforced server-side via the
// increment_demo_usage() Postgres function (atomic check-and-increment) so it
// can't be bypassed by clearing cookies or calling the edge functions directly.
// ============================================================================

export const DEMO_ACCOUNT_EMAIL = "demo@sybil.local";

export const DEMO_LIMITS = {
  chat: 3,
  transcription: 1,
  call_turn: 5,
} as const;

export type DemoUsageKind = keyof typeof DEMO_LIMITS;

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

/** Atomically checks-and-increments; returns true if this request is allowed. */
// deno-lint-ignore no-explicit-any
export async function tryConsumeDemoUsage(supabase: any, ip: string, kind: DemoUsageKind): Promise<boolean> {
  const { data, error } = await supabase.rpc("increment_demo_usage", {
    p_ip: ip,
    p_kind: kind,
    p_limit: DEMO_LIMITS[kind],
  });
  if (error) throw error;
  return data === true;
}

/** Read-only peek at current counts, for a pre-check before an expensive operation (e.g. minting a token). */
// deno-lint-ignore no-explicit-any
export async function peekDemoUsage(supabase: any, ip: string): Promise<{ chat_count: number; transcription_count: number; call_turn_count: number }> {
  const { data } = await supabase
    .from("demo_usage")
    .select("chat_count, transcription_count, call_turn_count")
    .eq("ip_address", ip)
    .maybeSingle();
  return {
    chat_count: data?.chat_count ?? 0,
    transcription_count: data?.transcription_count ?? 0,
    call_turn_count: data?.call_turn_count ?? 0,
  };
}
