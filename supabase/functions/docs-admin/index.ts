// ============================================================================
// SYBIL — Edge Function: docs-admin
// Docs are platform content, not workspace content — same shape as blog-admin.
// Level (staff/superadmin) is always resolved server-side from platform_admins,
// never trusted from the client. Public read of published pages bypasses this
// function entirely (docs-public + RLS on sybil_docs_pages handle that).
// Mutations write to sybil_admin_audit with a docs_ prefix; pure reads
// (list/get/slug_check) do not — auditing reads floods the audit screen in
// dev under React StrictMode (see admin-api/blog-admin precedent).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FORBIDDEN_BODY_KEYS = ["role", "platform_role", "level", "is_superadmin", "status", "published_at", "author_user_id"];

const STAFF_ACTIONS = new Set([
  "list",
  "get",
  "slug_check",
  "category_list",
]);

const SUPERADMIN_ACTIONS = new Set([
  "create",
  "update",
  "publish",
  "unpublish",
  "reorder",
  "category_create",
  "category_update",
  "category_reorder",
  "delete",
  "category_delete",
]);

const READ_ONLY_ACTIONS = new Set(["list", "get", "slug_check", "category_list"]);

const UPDATABLE_FIELDS = [
  "title",
  "summary",
  "content_md",
  "category",
  "order_index",
  "seo_title",
  "seo_description",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    const { data: adminRow } = await supabase
      .from("platform_admins")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminRow) {
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: null,
        action: "docs_unknown",
        outcome: "denied",
        payload: { reason: "not a platform admin" },
      });
      return json({ error: "Forbidden" }, 403);
    }
    const callerRole = adminRow.role as "staff" | "superadmin";

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // update/create carry a legitimate body — status/published_at/author_user_id
    // must never be settable from the client though, on any action.
    const smuggledKey = FORBIDDEN_BODY_KEYS.find((k) => k in (body || {}));
    if (smuggledKey) {
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: callerRole,
        action: `docs_${action || "unknown"}`,
        outcome: "denied",
        payload: redactedPayload(body),
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
        action: `docs_${action}`,
        outcome: "denied",
        payload: redactedPayload(body),
      });
      return json({ error: "Forbidden — superadmin only" }, 403);
    }

    const ctx: ActionContext = { supabase, callerId: user.id, callerRole };

    let result: unknown;
    switch (action) {
      case "list":
        result = await handleList(ctx, body);
        break;
      case "get":
        result = await handleGet(ctx, body);
        break;
      case "slug_check":
        result = await handleSlugCheck(ctx, body);
        break;
      case "create":
        result = await handleCreate(ctx, body);
        break;
      case "update":
        result = await handleUpdate(ctx, body);
        break;
      case "publish":
        result = await handlePublish(ctx, body);
        break;
      case "unpublish":
        result = await handleUnpublish(ctx, body);
        break;
      case "reorder":
        result = await handleReorder(ctx, body);
        break;
      case "delete":
        result = await handleDelete(ctx, body);
        break;
      case "category_list":
        result = await handleCategoryList(ctx);
        break;
      case "category_create":
        result = await handleCategoryCreate(ctx, body);
        break;
      case "category_update":
        result = await handleCategoryUpdate(ctx, body);
        break;
      case "category_reorder":
        result = await handleCategoryReorder(ctx, body);
        break;
      case "category_delete":
        result = await handleCategoryDelete(ctx, body);
        break;
      default:
        return json({ error: "Unknown action" }, 400);
    }

    if (!READ_ONLY_ACTIONS.has(action)) {
      const r = result as {
        ok?: boolean;
        error?: string;
        page?: { id?: string; slug?: string; title?: string };
        category?: { id?: string; slug?: string; label?: string };
      };
      const isCategoryAction = action.startsWith("category_");
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: callerRole,
        action: `docs_${action}`,
        targetType: isCategoryAction ? "docs_category" : "docs_page",
        targetId: (body.id as string) ?? r?.page?.id ?? r?.category?.id,
        payload: isCategoryAction
          ? { slug: (body.slug as string) ?? r?.category?.slug, label: r?.category?.label }
          : { slug: (body.slug as string) ?? r?.page?.slug, title: r?.page?.title },
        outcome: r?.error ? "error" : "ok",
      });
    }

    return json(result);
  } catch (err) {
    console.error("docs-admin error:", err);
    return json({ error: "Internal error", detail: (err as Error).message }, 500);
  }
});

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
    console.error("audit insert failed:", err);
  }
}

function redactedPayload(body: Record<string, unknown>) {
  return { id: body.id, slug: body.slug };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
}

async function uniqueSlug(supabase: ReturnType<typeof createClient>, base: string, excludeId?: string) {
  let candidate = base;
  let n = 2;
  for (;;) {
    let query = supabase.from("sybil_docs_pages").select("id").eq("slug", candidate).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query;
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

async function uniqueCategorySlug(supabase: ReturnType<typeof createClient>, base: string, excludeId?: string) {
  let candidate = base;
  let n = 2;
  for (;;) {
    let query = supabase.from("sybil_docs_categories").select("id").eq("slug", candidate).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query;
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

async function categoryExists(supabase: ReturnType<typeof createClient>, slug: string) {
  const { data } = await supabase.from("sybil_docs_categories").select("slug").eq("slug", slug).maybeSingle();
  return !!data;
}

// ----------------------------------------------------------------------------
// staff + superadmin
// ----------------------------------------------------------------------------
async function handleList(ctx: ActionContext, body: Record<string, unknown>) {
  const category = body.category as string | undefined;
  const status = body.status as string | undefined;
  const q = body.q as string | undefined;

  let query = ctx.supabase
    .from("sybil_docs_pages")
    .select("id, slug, category, title, summary, status, order_index, author_name, updated_at, published_at")
    .order("category", { ascending: true })
    .order("order_index", { ascending: true });

  if (category) query = query.eq("category", category);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("title", `%${q}%`);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { pages: data ?? [] };
}

async function handleGet(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  const slug = body.slug as string | undefined;
  if (!id && !slug) return { ok: false, error: "Missing id or slug" };

  let query = ctx.supabase.from("sybil_docs_pages").select("*").limit(1);
  query = id ? query.eq("id", id) : query.eq("slug", slug!);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Not found" };
  return { page: data };
}

async function handleSlugCheck(ctx: ActionContext, body: Record<string, unknown>) {
  const slug = (body.slug as string | undefined)?.trim();
  if (!slug) return { ok: false, error: "Missing slug" };
  const excludeId = body.exclude_id as string | undefined;

  let query = ctx.supabase.from("sybil_docs_pages").select("id").eq("slug", slug).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  const available = !data || data.length === 0;
  const suggestion = available ? slug : await uniqueSlug(ctx.supabase, slugify(slug), excludeId);
  return { available, suggestion };
}

async function handleCreate(ctx: ActionContext, body: Record<string, unknown>) {
  const title = (body.title as string | undefined)?.trim();
  if (!title) return { ok: false, error: "Missing title" };

  const category = body.category as string | undefined;
  if (!category || !(await categoryExists(ctx.supabase, category))) {
    return { ok: false, error: "category must reference an existing category" };
  }

  const rawSlug = (body.slug as string | undefined)?.trim() || slugify(title);
  const slug = await uniqueSlug(ctx.supabase, slugify(rawSlug));

  const { data: profile } = await ctx.supabase
    .from("sybil_profiles")
    .select("display_name")
    .eq("user_id", ctx.callerId)
    .maybeSingle();

  const insertRow: Record<string, unknown> = {
    title,
    slug,
    category,
    status: "draft",
    author_user_id: ctx.callerId,
    author_name: profile?.display_name ?? null,
    content_md: typeof body.content_md === "string" ? body.content_md : "",
  };
  for (const field of ["summary", "order_index", "seo_title", "seo_description"]) {
    if (field in body) insertRow[field] = body[field as keyof typeof body];
  }

  const { data, error } = await ctx.supabase.from("sybil_docs_pages").insert(insertRow).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, page: data };
}

async function handleUpdate(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const patch: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) patch[field] = body[field as keyof typeof body];
  }
  if (typeof patch.category === "string" && !(await categoryExists(ctx.supabase, patch.category))) {
    return { ok: false, error: "category must reference an existing category" };
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };

  const { data, error } = await ctx.supabase.from("sybil_docs_pages").update(patch).eq("id", id).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, page: data };
}

async function handlePublish(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { data: page, error: fetchError } = await ctx.supabase
    .from("sybil_docs_pages")
    .select("published_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !page) return { ok: false, error: fetchError?.message ?? "Not found" };

  const { data, error } = await ctx.supabase
    .from("sybil_docs_pages")
    .update({ status: "published", published_at: page.published_at ?? new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, page: data };
}

async function handleUnpublish(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { data, error } = await ctx.supabase
    .from("sybil_docs_pages")
    .update({ status: "draft" })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, page: data };
}

async function handleReorder(ctx: ActionContext, body: Record<string, unknown>) {
  const items = body.items as Array<{ id: string; order_index: number }> | undefined;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Missing items" };
  for (const item of items) {
    if (!item.id || typeof item.order_index !== "number") {
      return { ok: false, error: "Each item needs id and order_index" };
    }
  }

  const { error } = await ctx.supabase.rpc("reorder_sybil_docs_pages", { items });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ----------------------------------------------------------------------------
// categories — staff + superadmin, except delete
// ----------------------------------------------------------------------------
async function handleCategoryList(ctx: ActionContext) {
  const { data, error } = await ctx.supabase
    .from("sybil_docs_categories")
    .select("id, slug, label, order_index")
    .order("order_index", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { categories: data ?? [] };
}

async function handleCategoryCreate(ctx: ActionContext, body: Record<string, unknown>) {
  const label = (body.label as string | undefined)?.trim();
  if (!label) return { ok: false, error: "Missing label" };

  const rawSlug = (body.slug as string | undefined)?.trim() || slugify(label);
  const slug = await uniqueCategorySlug(ctx.supabase, slugify(rawSlug));

  const insertRow: Record<string, unknown> = { slug, label };
  if (typeof body.order_index === "number") insertRow.order_index = body.order_index;

  const { data, error } = await ctx.supabase.from("sybil_docs_categories").insert(insertRow).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, category: data };
}

async function handleCategoryUpdate(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const patch: Record<string, unknown> = {};
  if (typeof body.label === "string") patch.label = body.label.trim();
  if (typeof body.order_index === "number") patch.order_index = body.order_index;
  if (typeof body.slug === "string" && body.slug.trim()) {
    // Renaming cascades onto sybil_docs_pages.category via the FK's
    // `on update cascade` — no need to touch pages here.
    patch.slug = await uniqueCategorySlug(ctx.supabase, slugify(body.slug.trim()), id);
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };

  const { data, error } = await ctx.supabase.from("sybil_docs_categories").update(patch).eq("id", id).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, category: data };
}

async function handleCategoryReorder(ctx: ActionContext, body: Record<string, unknown>) {
  const items = body.items as Array<{ id: string; order_index: number }> | undefined;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Missing items" };
  for (const item of items) {
    if (!item.id || typeof item.order_index !== "number") {
      return { ok: false, error: "Each item needs id and order_index" };
    }
  }

  const { error } = await ctx.supabase.rpc("reorder_sybil_docs_categories", { items });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ----------------------------------------------------------------------------
// superadmin only
// ----------------------------------------------------------------------------
async function handleDelete(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { error } = await ctx.supabase.from("sybil_docs_pages").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function handleCategoryDelete(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { error } = await ctx.supabase.from("sybil_docs_categories").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Can't delete a category that still has pages — move or delete its pages first." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
