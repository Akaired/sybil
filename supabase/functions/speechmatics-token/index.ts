// ============================================================================
// SYBIL — Edge Function: speechmatics-token
// Mints a short-lived Speechmatics JWT for real-time voice transcription.
// The long-lived SPEECHMATICS_API_KEY never reaches the browser.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/getSecret.ts";
import { DEMO_ACCOUNT_EMAIL, DEMO_LIMITS, getClientIp, peekDemoUsage } from "../_shared/demoLimits.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    // Verifica membership nel workspace, come ingest/interpret/resolve
    const { data: membership, error: wsError } = await supabase
      .from("workspace_members")
      .select("role, email")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (wsError || !membership) return json({ error: "User not in any workspace" }, 403);

    const apiKey = await getSecret("SPEECHMATICS_API_KEY");
    if (!apiKey) return json({ error: "Speechmatics not configured" }, 500);

    // Dictation tokens only need to outlive a single short recording; call
    // tokens must survive the whole conversation, so they get a longer TTL.
    const body = await req.json().catch(() => ({}));
    const isCallMode = body?.mode === "call";
    const ttl = isCallMode ? 600 : 60;

    // Shared public demo account — refuse to mint a new token once its
    // per-IP quota for this mode is already used up (actual counting/
    // enforcement happens per-turn in ingest; this is just an early UX
    // block so a demo visitor doesn't open a mic session for nothing).
    if (user.email === DEMO_ACCOUNT_EMAIL) {
      const ip = getClientIp(req);
      const usage = await peekDemoUsage(supabase, ip);
      const limitType = isCallMode ? "call" : "transcription";
      const atLimit = isCallMode
        ? usage.call_turn_count >= DEMO_LIMITS.call_turn
        : usage.transcription_count >= DEMO_LIMITS.transcription;
      if (atLimit) {
        return json({ error: "demo_limit_reached", limit_type: limitType }, 429);
      }
    }

    const smResponse = await fetch("https://mp.speechmatics.com/v1/api_keys?type=rt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(10000)
    });

    if (!smResponse.ok) {
      const detail = await smResponse.text();
      return json({ error: "Failed to mint Speechmatics token", detail }, 502);
    }

    const { key_value } = await smResponse.json();
    return json({ key_value }, 200);
  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
