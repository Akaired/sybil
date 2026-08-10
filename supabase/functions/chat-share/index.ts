// ============================================================================
// SYBIL — Edge Function: chat-share
// Shares the caller's own chat history (all of it, or a specific set of
// conversations) with a workspace teammate. Purely a Sybil-internal record
// (chat_shares) — no external API involved, unlike calendar/gmail sharing.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODES = new Set(["all", "specific"]);
const ACCESS_LEVELS = new Set(["reader", "writer"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    const body = await req.json().catch(() => ({}));
    const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
    const sharedWithUserId = typeof body.shared_with_user_id === "string" ? body.shared_with_user_id : "";
    const mode = body.mode;
    const chatIds = Array.isArray(body.chat_ids) ? body.chat_ids.filter((id: unknown) => typeof id === "string") : [];
    const requestedAccess = body.access;

    if (!workspaceId) return json({ error: "workspace_id is required" }, 400);
    if (!sharedWithUserId) return json({ error: "shared_with_user_id is required" }, 400);
    if (!MODES.has(mode)) return json({ error: "mode must be one of: all, specific" }, 400);
    if (!ACCESS_LEVELS.has(requestedAccess)) return json({ error: "access must be one of: reader, writer" }, 400);
    if (mode === "specific" && chatIds.length === 0) {
      return json({ error: "chat_ids is required and must be non-empty when mode is specific" }, 400);
    }
    if (sharedWithUserId === user.id) {
      return json({ error: "You can't share chats with yourself" }, 400);
    }

    // Caller must actually belong to the workspace they're sharing under.
    const { data: callerMembership, error: callerError } = await supabase
      .from("workspace_members")
      .select("email")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();
    if (callerError || !callerMembership) {
      return json({ error: "You're not a member of that workspace" }, 403);
    }

    // Recipient must be in the same workspace — chat-share only ever crosses
    // teammates, not arbitrary users. Guests are forced to reader, same rule
    // as calendar-share, enforced here (not just in the UI).
    const { data: targetMember, error: targetError } = await supabase
      .from("workspace_members")
      .select("email, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", sharedWithUserId)
      .single();
    if (targetError || !targetMember) {
      return json({ error: "That user isn't a member of your workspace" }, 404);
    }
    const access = targetMember.role === "guest" ? "reader" : requestedAccess;

    // For mode=specific, verify every chat_id actually belongs to the caller —
    // you can only share your own conversations, never someone else's.
    if (mode === "specific") {
      const { data: owned, error: ownedError } = await supabase
        .from("sybil_conversations")
        .select("id")
        .eq("author_id", user.id)
        .in("id", chatIds);
      if (ownedError) {
        return json({ error: "Failed to verify chat ownership", detail: ownedError.message }, 500);
      }
      const ownedIds = new Set((owned ?? []).map((c: { id: string }) => c.id));
      const missing = chatIds.filter((id: string) => !ownedIds.has(id));
      if (missing.length > 0) {
        return json({ error: "Some chats don't exist or aren't yours", detail: { missing } }, 400);
      }
    }

    // A share row is keyed on (owner, recipient) — merge with whatever's
    // already there instead of clobbering it, so sharing chat B after
    // already having shared chat A doesn't drop A.
    const { data: existingShare, error: existingError } = await supabase
      .from("chat_shares")
      .select("mode, chat_ids")
      .eq("owner_user_id", user.id)
      .eq("shared_with_user_id", sharedWithUserId)
      .maybeSingle();
    if (existingError) {
      return json({ error: "Failed to check existing share", detail: existingError.message }, 500);
    }

    let finalMode: "all" | "specific" = mode;
    let finalChatIds: string[] | null = mode === "specific" ? [...new Set(chatIds)] : null;
    if (existingShare && mode === "specific") {
      if (existingShare.mode === "all") {
        // Already sharing everything — that supersedes this narrower request.
        finalMode = "all";
        finalChatIds = null;
      } else {
        finalChatIds = Array.from(new Set([...(existingShare.chat_ids ?? []), ...chatIds]));
      }
    }

    const { data: share, error: shareError } = await supabase
      .from("chat_shares")
      .upsert(
        {
          workspace_id: workspaceId,
          owner_user_id: user.id,
          owner_team_email: callerMembership.email,
          shared_with_user_id: sharedWithUserId,
          shared_with_email: targetMember.email,
          mode: finalMode,
          chat_ids: finalChatIds,
          access,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_user_id,shared_with_user_id" },
      )
      .select()
      .single();

    if (shareError) {
      return json({ error: "Failed to create share", detail: shareError.message }, 500);
    }

    await supabase.from("sybil_activity_logs").insert({
      workspace_id: workspaceId,
      entity_type: "chat_share",
      entity_id: share.id,
      action: "shared",
      actor: "user",
      actor_id: user.id,
      payload: { shared_with_user_id: sharedWithUserId, mode: finalMode, access, chat_count: finalChatIds?.length ?? null },
    });

    return json({
      success: true,
      share_id: share.id,
      shared_with_user_id: sharedWithUserId,
      mode: finalMode,
      chat_ids: finalChatIds,
      access,
      downgraded: access !== requestedAccess,
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
