// ============================================================================
// SYBIL — Edge Function: ingest
// Riceve un messaggio (chat webapp, Telegram, voce, email) e crea un Signal
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEMO_ACCOUNT_EMAIL, getClientIp, tryConsumeDemoUsage } from "../_shared/demoLimits.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Auth: Bearer JWT (sessione utente Supabase Auth)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    // Verifica membership nel workspace
    const { data: membership, error: wsError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, email")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (wsError || !membership) {
      return json({ error: "User not in any workspace" }, 403);
    }
    const workspaceId = membership.workspace_id;

    // Parse body
    const body = await req.json();
    const {
      content,          // string (obbligatorio) — testo del messaggio
      origin = "chat",  // chat | telegram | voice | email | calendar | web
      metadata = {},    // object — extra: thread_id, headers, ecc.
      transcript,       // string | null — trascrizione se voice
      conversation_id,  // uuid | null — chat esistente; se assente ne creiamo una nuova
    } = body;

    if (!content || typeof content !== "string") {
      return json({ error: "content is required (string)" }, 400);
    }

    // Shared public demo account — cap usage per visitor IP so no single
    // visitor can spam/monopolize it. Call turns and dictated voice messages
    // both arrive with origin "voice"; the frontend tags call turns with
    // metadata.call_turn so they're counted against the (separate) call limit.
    if (user.email === DEMO_ACCOUNT_EMAIL) {
      const kind = metadata?.call_turn === true ? "call_turn" : origin === "voice" ? "transcription" : "chat";
      const ip = getClientIp(req);
      const allowed = await tryConsumeDemoUsage(supabase, ip, kind);
      if (!allowed) {
        return json({ error: "demo_limit_reached", limit_type: kind }, 429);
      }
    }

    // Risolvi (o crea) la conversazione, per messaggi da chat webapp (testo o voce)
    let resolvedConversationId: string | null = null;
    if (origin === "chat" || origin === "voice") {
      if (conversation_id) {
        const { data: existing } = await supabase
          .from("sybil_conversations")
          .select("id, author_id")
          .eq("id", conversation_id)
          .maybeSingle();

        if (existing?.author_id === user.id) {
          resolvedConversationId = existing.id;
        } else if (existing) {
          // Not the owner — allow writing only if the owner shared this
          // chat with write access. Signals keep the real sender's
          // author_id below; only the conversation itself is shared.
          const { data: share } = await supabase
            .from("chat_shares")
            .select("mode, chat_ids, access")
            .eq("owner_user_id", existing.author_id)
            .eq("shared_with_user_id", user.id)
            .maybeSingle();
          const hasWriteAccess =
            share?.access === "writer" &&
            (share.mode === "all" || (share.chat_ids ?? []).includes(conversation_id));
          if (hasWriteAccess) {
            resolvedConversationId = existing.id;
          }
        }
      }

      if (!resolvedConversationId) {
        const { data: conversation, error: convError } = await supabase
          .from("sybil_conversations")
          .insert({ author_id: user.id })
          .select()
          .single();

        if (convError) {
          return json({ error: "Failed to create conversation", detail: convError.message }, 500);
        }
        resolvedConversationId = conversation.id;
      }
    }

    // Crea il Signal
    const { data: signal, error: signalError } = await supabase
      .from("sybil_signals")
      .insert({
        workspace_id: workspaceId,
        author_id: user.id,
        origin,
        raw_content: content,
        transcript: transcript || null,
        metadata,
        conversation_id: resolvedConversationId,
        received_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (signalError) {
      return json({ error: "Failed to create signal", detail: signalError.message }, 500);
    }

    // Log activity
    await supabase.from("sybil_activity_logs").insert({
      workspace_id: workspaceId,
      entity_type: "signal",
      entity_id: signal.id,
      action: "created",
      actor: "user",
      actor_id: user.id,
      payload: { origin, content_preview: content.slice(0, 200) },
    });

    return json({
      signal_id: signal.id,
      conversation_id: resolvedConversationId,
      status: "ingested",
      next_step: `POST /interpret with { signal_id: "${signal.id}" }`,
    }, 200);

  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}