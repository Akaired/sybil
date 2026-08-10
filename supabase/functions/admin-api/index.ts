// ============================================================================
// SYBIL — Edge Function: admin-api
// Platform admin panel backend. Level (staff/superadmin) is always resolved
// server-side from platform_admins — never trusted from the client. Every
// mutation, plus secrets_list despite being a read, writes to
// sybil_admin_audit. See project's migration 20260809_platform_admin_panel.sql
// for the schema this depends on.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Whitelist of secrets the panel is allowed to touch — nothing else, ever.
const MANAGED_SECRETS = [
  "BRIGHTDATA_API_KEY",
  "BRIGHTDATA_UNLOCKER_ZONE",
  "BRIGHTDATA_SERP_ZONE",
  "SPEECHMATICS_API_KEY",
  "LLM_AIML_API_KEY",
  "LLM_OPENROUTER_API_KEY",
];

// Keys that would let a client smuggle its own privilege level into the body.
const FORBIDDEN_BODY_KEYS = ["role", "platform_role", "level", "is_superadmin"];

const STAFF_ACTIONS = new Set([
  "overview",
  "usage",
  "health",
  "providers_list",
  "audit_list",
  "sentinel_check_now",
]);

const SUPERADMIN_ACTIONS = new Set([
  "providers_update",
  "secrets_list",
  "secret_set",
  "admin_list",
  "admin_grant",
  "admin_revoke",
  "workspace_suspend",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // --- a) resolve the caller from their JWT -----------------------------
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    // --- b) resolve the caller's platform role server-side ----------------
    const { data: adminRow } = await supabase
      .from("platform_admins")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    // --- c) no row -> 403, audited, no admin_role available ----------------
    if (!adminRow) {
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: null,
        action: "unknown",
        outcome: "denied",
        payload: { reason: "not a platform admin" },
      });
      return json({ error: "Forbidden" }, 403);
    }
    const callerRole = adminRow.role as "staff" | "superadmin";

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // Client-supplied privilege escalation attempt — always audited even
    // though it doesn't map to a known action.
    const smuggledKey = FORBIDDEN_BODY_KEYS.find((k) => k in (body || {}));
    if (smuggledKey) {
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: callerRole,
        action: action || "unknown",
        outcome: "denied",
        payload: body,
      });
      return json({ error: `Body must not contain '${smuggledKey}'` }, 400);
    }

    if (!action || (!STAFF_ACTIONS.has(action) && !SUPERADMIN_ACTIONS.has(action))) {
      return json({ error: "Unknown action" }, 400);
    }

    if (SUPERADMIN_ACTIONS.has(action) && callerRole !== "superadmin") {
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: callerRole,
        action,
        outcome: "denied",
        payload: redactedPayload(action, body),
      });
      return json({ error: "Forbidden — superadmin only" }, 403);
    }

    const ctx: ActionContext = { supabase, callerId: user.id, callerRole };

    switch (action) {
      case "overview":
        return json(await handleOverview(ctx));
      case "usage":
        return json(await handleUsage(ctx, body));
      case "health":
        return json(await handleHealth(ctx));
      case "providers_list":
        return json(await handleProvidersList(ctx));
      case "audit_list":
        return json(await handleAuditList(ctx, body));
      case "sentinel_check_now":
        return json(await handleSentinelCheckNow(ctx, body));
      case "providers_update":
        return json(await handleProvidersUpdate(ctx, body));
      case "secrets_list":
        return json(await handleSecretsList(ctx));
      case "secret_set":
        return json(await handleSecretSet(ctx, body));
      case "admin_list":
        return json(await handleAdminList(ctx));
      case "admin_grant":
        return json(await handleAdminGrant(ctx, body));
      case "admin_revoke":
        return json(await handleAdminRevoke(ctx, body));
      case "workspace_suspend":
        return json(await handleWorkspaceSuspend(ctx, body));
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("admin-api error:", err);
    return json({ error: "Internal error", detail: (err as Error).message }, 500);
  }
});

// ----------------------------------------------------------------------------
// Types + audit helper
// ----------------------------------------------------------------------------
interface ActionContext {
  supabase: ReturnType<typeof createClient>;
  callerId: string;
  callerRole: "staff" | "superadmin";
}

async function writeAudit(
  supabase: ReturnType<typeof createClient>,
  opts: {
    adminUserId: string;
    adminRole: "staff" | "superadmin" | null;
    action: string;
    targetType?: string;
    targetId?: string;
    payload?: Record<string, unknown>;
    outcome?: "ok" | "denied" | "error";
  },
) {
  try {
    await supabase.from("sybil_admin_audit").insert({
      admin_user_id: opts.adminUserId,
      admin_role: opts.adminRole,
      action: opts.action,
      target_type: opts.targetType ?? null,
      target_id: opts.targetId ?? null,
      payload: opts.payload ?? {},
      outcome: opts.outcome ?? "ok",
    });
  } catch (err) {
    // Audit failures must never break the actual action.
    console.error("audit insert failed:", err);
  }
}

// secret_set's payload must never carry the raw value — swap it for last4.
function redactedPayload(action: string, body: Record<string, unknown>) {
  if (action !== "secret_set") return body;
  const value = typeof body.value === "string" ? body.value : "";
  return { name: body.name, last4: value.slice(-4) };
}

// ----------------------------------------------------------------------------
// staff + superadmin: read actions
// ----------------------------------------------------------------------------
async function handleOverview(ctx: ActionContext) {
  const { supabase } = ctx;

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, plan, owner_id, created_at, suspended")
    .order("created_at", { ascending: true });

  const { data: members } = await supabase.from("workspace_members").select("workspace_id");
  const memberCounts = new Map<string, number>();
  for (const m of members ?? []) {
    memberCounts.set(m.workspace_id, (memberCounts.get(m.workspace_id) ?? 0) + 1);
  }

  const workspacesWithStats = await Promise.all(
    (workspaces ?? []).map(async (ws) => {
      const { data: lastActivity } = await supabase
        .from("sybil_activity_logs")
        .select("created_at")
        .eq("workspace_id", ws.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        ...ws,
        member_count: memberCounts.get(ws.id) ?? 0,
        last_activity_at: lastActivity?.created_at ?? null,
      };
    }),
  );

  const { count: llmCallTotal } = await supabase
    .from("sybil_llm_call_logs")
    .select("id", { count: "exact", head: true });
  const { count: webCallTotal } = await supabase
    .from("sybil_web_call_logs")
    .select("id", { count: "exact", head: true });

  return {
    workspaces: workspacesWithStats,
    totals: { llm_calls: llmCallTotal ?? 0, web_calls: webCallTotal ?? 0 },
  };
}

async function handleUsage(ctx: ActionContext, body: Record<string, unknown>) {
  const { supabase } = ctx;
  const from = typeof body.from === "string" ? body.from : new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = typeof body.to === "string" ? body.to : new Date().toISOString();

  const { data: llmRows } = await supabase
    .from("sybil_llm_call_logs")
    .select("workspace_id, function, provider_id, tokens_in, tokens_out, latency_ms, success")
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(10000);

  const { data: providers } = await supabase.from("sybil_llm_providers").select("id, name");
  const providerNameById = new Map((providers ?? []).map((p) => [p.id, p.name]));

  const byWorkspace = aggregateLlm(llmRows ?? [], (r) => r.workspace_id);
  const byFunction = aggregateLlm(llmRows ?? [], (r) => r.function);
  const byProvider = aggregateLlm(llmRows ?? [], (r) => providerNameById.get(r.provider_id) ?? r.provider_id ?? "unknown");

  const { data: webRows } = await supabase
    .from("sybil_web_call_logs")
    .select("workspace_id, action, latency_ms, bytes, status")
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(10000);

  const webByWorkspace = aggregateWeb(webRows ?? [], (r) => r.workspace_id);
  const webByAction = aggregateWeb(webRows ?? [], (r) => r.action);

  return {
    range: { from, to },
    llm: { by_workspace: byWorkspace, by_function: byFunction, by_provider: byProvider },
    web: { by_workspace: webByWorkspace, by_action: webByAction },
  };
}

function aggregateLlm(
  rows: { tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; success: boolean }[],
  keyFn: (r: any) => string,
) {
  const buckets = new Map<string, { calls: number; tokens: number; latency_sum: number; failures: number }>();
  for (const row of rows) {
    const key = keyFn(row) ?? "unknown";
    const b = buckets.get(key) ?? { calls: 0, tokens: 0, latency_sum: 0, failures: 0 };
    b.calls += 1;
    b.tokens += (row.tokens_in ?? 0) + (row.tokens_out ?? 0);
    b.latency_sum += row.latency_ms ?? 0;
    if (!row.success) b.failures += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries()).map(([key, b]) => ({
    key,
    calls: b.calls,
    tokens: b.tokens,
    avg_latency_ms: b.calls ? Math.round(b.latency_sum / b.calls) : 0,
    failures: b.failures,
  }));
}

function aggregateWeb(
  rows: { latency_ms: number | null; bytes: number | null; status: string | null }[],
  keyFn: (r: any) => string,
) {
  const buckets = new Map<string, { calls: number; bytes: number; latency_sum: number; failures: number }>();
  for (const row of rows) {
    const key = keyFn(row) ?? "unknown";
    const b = buckets.get(key) ?? { calls: 0, bytes: 0, latency_sum: 0, failures: 0 };
    b.calls += 1;
    b.bytes += row.bytes ?? 0;
    b.latency_sum += row.latency_ms ?? 0;
    if (row.status && row.status !== "ok" && row.status !== "success") b.failures += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries()).map(([key, b]) => ({
    key,
    calls: b.calls,
    bytes: b.bytes,
    avg_latency_ms: b.calls ? Math.round(b.latency_sum / b.calls) : 0,
    failures: b.failures,
  }));
}

async function handleHealth(ctx: ActionContext) {
  const { supabase } = ctx;

  const { data: erroredSentinels } = await supabase
    .from("sybil_sentinels")
    .select("id, workspace_id, condition_text, last_error, last_error_at")
    .eq("status", "error")
    .order("last_error_at", { ascending: false });

  const { count: activeCount } = await supabase
    .from("sybil_sentinels")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  const { data: oldestDue } = await supabase
    .from("sybil_sentinels")
    .select("next_check_at")
    .eq("status", "active")
    .order("next_check_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: lastRun } = await supabase
    .from("sybil_sentinels")
    .select("last_checked_at")
    .order("last_checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    last_run_at: lastRun?.last_checked_at ?? null,
    errored_sentinels: erroredSentinels ?? [],
    active_sentinel_count: activeCount ?? 0,
    oldest_next_check_at: oldestDue?.next_check_at ?? null,
  };
}

async function handleProvidersList(ctx: ActionContext) {
  const { data } = await ctx.supabase
    .from("sybil_llm_providers")
    .select("id, name, base_url, model, priority, is_active, max_tokens, note, created_at, updated_at")
    .order("priority", { ascending: true });
  return { providers: data ?? [] };
}

async function handleAuditList(ctx: ActionContext, body: Record<string, unknown>) {
  const page = typeof body.page === "number" && body.page > 0 ? body.page : 1;
  const pageSize = typeof body.page_size === "number" && body.page_size > 0 && body.page_size <= 200
    ? body.page_size
    : 50;
  const { data, count } = await ctx.supabase
    .from("sybil_admin_audit")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const rows = data ?? [];
  const uniqueIds = Array.from(new Set(rows.map((r) => r.admin_user_id)));
  const nameById = new Map<string, string>();
  if (uniqueIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from("sybil_profiles")
      .select("user_id, display_name")
      .in("user_id", uniqueIds);
    const displayNameById = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));

    await Promise.all(
      uniqueIds.map(async (id) => {
        const fromProfile = displayNameById.get(id)?.trim();
        if (fromProfile) {
          nameById.set(id, fromProfile);
          return;
        }
        const { data } = await ctx.supabase.auth.admin.getUserById(id);
        nameById.set(id, data?.user?.email?.split("@")[0] ?? id);
      }),
    );
  }

  const entries = rows.map((r) => ({ ...r, admin_display_name: nameById.get(r.admin_user_id) ?? r.admin_user_id }));
  return { entries, page, page_size: pageSize, total: count ?? 0 };
}

async function handleSentinelCheckNow(ctx: ActionContext, body: Record<string, unknown>) {
  const sentinelId = body.sentinel_id;
  if (!sentinelId || typeof sentinelId !== "string") {
    return { ok: false, error: "Missing sentinel_id" };
  }

  // Called the same way the production VPS cron calls it — no Authorization
  // header, which sentinel-check treats as an internal/system call and lets
  // through unauthenticated (see sentinel-check/index.ts's isCronCall).
  const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sentinel-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentinel_id: sentinelId }),
  });
  const result = await resp.json().catch(() => ({ error: "Invalid response from sentinel-check" }));

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "sentinel_check_now",
    targetType: "sentinel",
    targetId: sentinelId,
    payload: { result },
  });

  return result;
}

// ----------------------------------------------------------------------------
// superadmin only
// ----------------------------------------------------------------------------
async function handleProvidersUpdate(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id;
  if (!id || typeof id !== "string") return { ok: false, error: "Missing id" };

  const patch: Record<string, unknown> = {};
  if (typeof body.active === "boolean") patch.is_active = body.active;
  if (typeof body.priority === "number") patch.priority = body.priority;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };

  const { error } = await ctx.supabase.from("sybil_llm_providers").update(patch).eq("id", id);

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "providers_update",
    targetType: "llm_provider",
    targetId: id,
    payload: patch,
    outcome: error ? "error" : "ok",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function handleSecretsList(ctx: ActionContext) {
  const { data, error } = await ctx.supabase.rpc("list_managed_secrets", { names: MANAGED_SECRETS });

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "secrets_list",
    outcome: error ? "error" : "ok",
  });

  if (error) return { ok: false, error: error.message };
  return { secrets: data ?? [] };
}

async function handleSecretSet(ctx: ActionContext, body: Record<string, unknown>) {
  const name = body.name;
  const value = body.value;
  if (typeof name !== "string" || !MANAGED_SECRETS.includes(name)) {
    await writeAudit(ctx.supabase, {
      adminUserId: ctx.callerId,
      adminRole: ctx.callerRole,
      action: "secret_set",
      outcome: "denied",
      payload: { name },
    });
    return { ok: false, error: "Secret name not in the managed whitelist" };
  }
  if (typeof value !== "string" || !value) {
    return { ok: false, error: "Missing value" };
  }

  const { error } = await ctx.supabase.rpc("set_vault_secret", { secret_name: name, secret_value: value });

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "secret_set",
    targetType: "secret",
    targetId: name,
    payload: { name, last4: value.slice(-4) },
    outcome: error ? "error" : "ok",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function handleAdminList(ctx: ActionContext) {
  const { data: admins } = await ctx.supabase
    .from("platform_admins")
    .select("user_id, role, note, created_by, granted_at")
    .order("granted_at", { ascending: true });

  const withEmail = await Promise.all(
    (admins ?? []).map(async (a) => {
      const { data } = await ctx.supabase.auth.admin.getUserById(a.user_id);
      return { ...a, email: data?.user?.email ?? null };
    }),
  );

  return { admins: withEmail };
}

async function handleAdminGrant(ctx: ActionContext, body: Record<string, unknown>) {
  const targetUserId = body.user_id;
  const role = body.role;
  if (typeof targetUserId !== "string" || (role !== "superadmin" && role !== "staff")) {
    return { ok: false, error: "Missing/invalid user_id or role" };
  }

  if (role === "superadmin" && body.confirm_superadmin !== true) {
    await writeAudit(ctx.supabase, {
      adminUserId: ctx.callerId,
      adminRole: ctx.callerRole,
      action: "admin_grant",
      targetType: "platform_admin",
      targetId: targetUserId,
      payload: { role },
      outcome: "denied",
    });
    return { ok: false, error: "Granting superadmin requires confirm_superadmin: true" };
  }

  const { error } = await ctx.supabase
    .from("platform_admins")
    .upsert({ user_id: targetUserId, role, created_by: ctx.callerId }, { onConflict: "user_id" });

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "admin_grant",
    targetType: "platform_admin",
    targetId: targetUserId,
    payload: { role },
    outcome: error ? "error" : "ok",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function handleAdminRevoke(ctx: ActionContext, body: Record<string, unknown>) {
  const targetUserId = body.user_id;
  if (typeof targetUserId !== "string") return { ok: false, error: "Missing user_id" };

  const { data: target } = await ctx.supabase
    .from("platform_admins")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!target) return { ok: false, error: "Not an admin" };

  if (target.role === "superadmin") {
    const { count } = await ctx.supabase
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "superadmin");
    if ((count ?? 0) <= 1) {
      await writeAudit(ctx.supabase, {
        adminUserId: ctx.callerId,
        adminRole: ctx.callerRole,
        action: "admin_revoke",
        targetType: "platform_admin",
        targetId: targetUserId,
        outcome: "denied",
        payload: { reason: "cannot remove last superadmin" },
      });
      return { ok: false, error: "Cannot remove the last superadmin" };
    }
  }

  const { error } = await ctx.supabase.from("platform_admins").delete().eq("user_id", targetUserId);

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "admin_revoke",
    targetType: "platform_admin",
    targetId: targetUserId,
    outcome: error ? "error" : "ok",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function handleWorkspaceSuspend(ctx: ActionContext, body: Record<string, unknown>) {
  const workspaceId = body.workspace_id;
  const suspended = body.suspended;
  if (typeof workspaceId !== "string" || typeof suspended !== "boolean") {
    return { ok: false, error: "Missing workspace_id or suspended (boolean)" };
  }

  const { error } = await ctx.supabase
    .from("workspaces")
    .update({ suspended, suspended_at: suspended ? new Date().toISOString() : null })
    .eq("id", workspaceId);

  await writeAudit(ctx.supabase, {
    adminUserId: ctx.callerId,
    adminRole: ctx.callerRole,
    action: "workspace_suspend",
    targetType: "workspace",
    targetId: workspaceId,
    payload: { suspended },
    outcome: error ? "error" : "ok",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ----------------------------------------------------------------------------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
