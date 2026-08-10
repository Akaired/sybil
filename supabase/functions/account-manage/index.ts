// ============================================================================
// SYBIL — Edge Function: account-manage
// Actions: deactivate, reactivate, delete, pre_delete_check (user JWT auth,
// same pattern as speechmatics-token) — and purge_expired (service role key
// only, NOT the "no Authorization header = cron" pattern used elsewhere:
// this action permanently deletes accounts, so it must never be callable
// without proving possession of the real service role key).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PURGE_AFTER_DAYS = 30;
const DEMO_ACCOUNT_EMAIL = "demo@sybil.local";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ── purge_expired: service role key only, checked explicitly ────────
    if (action === "purge_expired") {
      const authHeader = req.headers.get("Authorization") || "";
      const providedKey = authHeader.replace("Bearer ", "");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey || providedKey !== serviceRoleKey) {
        return json({ error: "Forbidden" }, 403);
      }
      return await purgeExpiredAccounts(supabase);
    }

    // ── Everything else requires a real, authenticated user ─────────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    // Shared public demo account — deactivating/deleting it would break the
    // demo for every other visitor. Also enforced at the DB level (triggers
    // on auth.users/sybil_profiles) as defense in depth; this just returns a
    // clean error instead of a raw Postgres exception.
    if (user.email === DEMO_ACCOUNT_EMAIL && (action === "deactivate" || action === "delete")) {
      return json({ error: "This is the shared demo account and can't be deactivated or deleted." }, 403);
    }

    switch (action) {
      case "deactivate": {
        const { error } = await supabase
          .from("sybil_profiles")
          .update({ status: "deactivated", deactivated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        if (error) return json({ error: "Failed to deactivate account", detail: error.message }, 500);
        return json({ status: "deactivated" });
      }

      case "reactivate": {
        const { error } = await supabase
          .from("sybil_profiles")
          .update({ status: "active", deactivated_at: null })
          .eq("user_id", user.id);
        if (error) return json({ error: "Failed to reactivate account", detail: error.message }, 500);
        return json({ status: "active" });
      }

      case "pre_delete_check": {
        const requiresChoice = await getWorkspacesRequiringChoice(supabase, user.id);
        return json({ requires_choice: requiresChoice });
      }

      case "delete": {
        const choices: Array<{ workspace_id: string; mode: "transfer" | "delete"; new_owner_user_id?: string }> =
          Array.isArray(body.choices) ? body.choices : [];

        const requiresChoice = await getWorkspacesRequiringChoice(supabase, user.id);
        const missing = requiresChoice.filter(
          (w) => !choices.some((c) => c.workspace_id === w.workspace_id)
        );
        if (missing.length > 0) {
          return json({
            error: "A choice is required for every workspace you solely own.",
            missing_workspaces: missing,
          }, 400);
        }

        for (const w of requiresChoice) {
          const choice = choices.find((c) => c.workspace_id === w.workspace_id)!;
          if (choice.mode === "transfer") {
            if (!choice.new_owner_user_id || !w.members.some((m: any) => m.user_id === choice.new_owner_user_id)) {
              return json({
                error: `Invalid new_owner_user_id for workspace ${w.workspace_id} — must be an existing member.`,
              }, 400);
            }
            await transferWorkspaceOwnership(supabase, w.workspace_id, choice.new_owner_user_id);
          } else if (choice.mode === "delete") {
            await deleteWorkspaceCascade(supabase, w.workspace_id);
          } else {
            return json({ error: `Invalid mode "${choice.mode}" for workspace ${w.workspace_id}` }, 400);
          }
        }

        await cleanupUserFootprint(supabase, user.id);

        const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
        if (deleteUserError) {
          return json({ error: "Failed to delete account", detail: deleteUserError.message }, 500);
        }

        return json({ status: "deleted" });
      }

      default:
        return json(
          { error: `Unknown action: ${action}. Supported: deactivate, reactivate, delete, pre_delete_check` },
          400,
        );
    }
  } catch (err) {
    return json({ error: "Internal error", detail: (err as Error).message }, 500);
  }
});

// ============================================================================
// Ownership helpers
// ============================================================================

// "Owner" = workspace_members.role = 'owner' (the field team-manage actually
// protects), not the legacy workspaces.owner_id pointer — confirmed with
// Davide 2026-08-08. A workspace "requires a choice" only when this user is
// the workspace's ONLY owner-role member.
async function getWorkspacesRequiringChoice(supabase: any, userId: string) {
  const { data: ownedRows } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("role", "owner");

  if (!ownedRows || ownedRows.length === 0) return [];

  const result = [];
  for (const row of ownedRows) {
    const { data: owners } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", row.workspace_id)
      .eq("role", "owner");

    if (owners && owners.length > 1) continue; // other owners exist — no choice needed

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("name")
      .eq("id", row.workspace_id)
      .single();

    const { data: otherMembers } = await supabase
      .from("workspace_members")
      .select("user_id, email, role, joined_at")
      .eq("workspace_id", row.workspace_id)
      .neq("user_id", userId)
      .order("joined_at", { ascending: true });

    const memberIds = (otherMembers ?? []).map((m: any) => m.user_id);
    const { data: profiles } = memberIds.length
      ? await supabase.from("sybil_profiles").select("user_id, display_name").in("user_id", memberIds)
      : { data: [] };
    const nameByUserId = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));

    result.push({
      workspace_id: row.workspace_id,
      workspace_name: workspace?.name || "Workspace",
      members: (otherMembers ?? []).map((m: any) => ({
        user_id: m.user_id,
        display_name: nameByUserId.get(m.user_id) || m.email,
        email: m.email,
        role: m.role,
      })),
    });
  }
  return result;
}

async function transferWorkspaceOwnership(supabase: any, workspaceId: string, newOwnerUserId: string) {
  await supabase
    .from("workspace_members")
    .update({ role: "owner" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", newOwnerUserId);
  await supabase
    .from("workspaces")
    .update({ owner_id: newOwnerUserId })
    .eq("id", workspaceId);
}

// Deletes a workspace and everything scoped to it. workspace_members,
// workspace_join_links and sybil_pulses cascade automatically via FK — every
// other workspace-scoped table has ON DELETE NO ACTION and must be cleared
// explicitly first, or the final `workspaces` delete fails on the FK.
async function deleteWorkspaceCascade(supabase: any, workspaceId: string) {
  const byWorkspace = (table: string) => supabase.from(table).delete().eq("workspace_id", workspaceId);

  // sybil_resolutions cascades from sybil_signals; sybil_wake_events/
  // sybil_sentinels cascade from sybil_tasks — deleted explicitly anyway so
  // the order here doesn't depend on those cascades firing correctly.
  await byWorkspace("sybil_wake_events");
  await byWorkspace("sybil_signals");
  await byWorkspace("sybil_sentinels");
  await byWorkspace("sybil_tasks");
  await byWorkspace("sybil_projects");
  await byWorkspace("sybil_activity_logs");
  await byWorkspace("sybil_llm_call_logs");
  await byWorkspace("sybil_web_call_logs");
  await byWorkspace("sybil_oauth_connections");
  await byWorkspace("invites");
  await byWorkspace("calendar_shares");
  await byWorkspace("chat_shares");

  await supabase.from("workspaces").delete().eq("id", workspaceId);
}

// Removes what's left of the user's own footprint once any solely-owned
// workspaces have already been transferred or deleted above: their
// membership in workspaces they don't own, and their personal chats.
// sybil_profiles itself is left alone — it cascades from auth.users via its
// own FK when auth.admin.deleteUser runs next.
async function cleanupUserFootprint(supabase: any, userId: string) {
  await supabase.from("workspace_members").delete().eq("user_id", userId);
  await supabase.from("sybil_oauth_connections").delete().eq("user_id", userId);
  await supabase.from("sybil_conversations").delete().eq("author_id", userId); // cascades to sybil_signals → sybil_resolutions
  await supabase.from("chat_shares").delete().eq("shared_with_user_id", userId);
}

// ============================================================================
// purge_expired — automated daily cleanup, service-role-key auth only
// ============================================================================
async function purgeExpiredAccounts(supabase: any) {
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired, error } = await supabase
    .from("sybil_profiles")
    .select("user_id")
    .eq("status", "deactivated")
    .lt("deactivated_at", cutoff);

  if (error) return json({ error: "Failed to query expired accounts", detail: error.message }, 500);
  if (!expired || expired.length === 0) return json({ purged: [], errors: [] });

  const purged: string[] = [];
  const errors: Array<{ user_id: string; error: string }> = [];

  for (const row of expired) {
    try {
      // No human is present to choose transfer-vs-delete for solely-owned
      // workspaces here, so purge picks a default: hand ownership to the
      // longest-tenured other member if one exists, otherwise delete the
      // workspace outright. Documented default, confirmed acceptable given
      // this only runs 30+ days after deactivation and doesn't fire before
      // 2026-09-08 — see conversation with Davide 2026-08-08.
      const requiresChoice = await getWorkspacesRequiringChoice(supabase, row.user_id);
      for (const w of requiresChoice) {
        if (w.members.length > 0) {
          await transferWorkspaceOwnership(supabase, w.workspace_id, w.members[0].user_id);
        } else {
          await deleteWorkspaceCascade(supabase, w.workspace_id);
        }
      }

      await cleanupUserFootprint(supabase, row.user_id);

      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(row.user_id);
      if (deleteUserError) throw new Error(deleteUserError.message);

      purged.push(row.user_id);
    } catch (err) {
      errors.push({ user_id: row.user_id, error: (err as Error).message });
    }
  }

  return json({ purged, errors });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
