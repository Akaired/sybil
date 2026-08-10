// ============================================================================
// SYBIL — Edge Function: speechmatics-tts
// Text-to-speech via Speechmatics (preview API). Streams WAV audio to the
// client without buffering the whole file in memory.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/getSecret.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const ALLOWED_VOICES = ["sarah", "theo", "megan", "jack"];
const MAX_TEXT_LENGTH = 2000;

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

    // Verifica membership nel workspace, come speechmatics-token/ingest/interpret/resolve
    const { data: membership, error: wsError } = await supabase
      .from("workspace_members")
      .select("role, email")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (wsError || !membership) return json({ error: "User not in any workspace" }, 403);

    const body = await req.json();
    const { text, voice = "sarah" } = body;

    if (!text || typeof text !== "string") {
      return json({ error: "text is required (string)" }, 400);
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: `text exceeds max length of ${MAX_TEXT_LENGTH} characters` }, 400);
    }
    if (!ALLOWED_VOICES.includes(voice)) {
      return json({ error: `voice must be one of: ${ALLOWED_VOICES.join(", ")}` }, 400);
    }

    const apiKey = await getSecret("SPEECHMATICS_API_KEY");
    if (!apiKey) return json({ error: "Speechmatics not configured" }, 500);

    const ttsResponse = await fetch(`https://preview.tts.speechmatics.com/generate/${voice}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000)
    });

    if (!ttsResponse.ok || !ttsResponse.body) {
      const detail = await ttsResponse.text().catch(() => "");
      return json({ error: "Failed to generate speech", detail }, 502);
    }

    // Pipe the upstream stream straight through — no buffering.
    return new Response(ttsResponse.body, {
      status: 200,
      headers: { ...CORS, "Content-Type": "audio/wav" }
    });
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
