// ============================================================================
// SYBIL — Edge Function: blog-admin
// Blog is platform content, not workspace content. Level (staff/superadmin)
// is always resolved server-side from platform_admins — never trusted from
// the client. Public read of published posts bypasses this function entirely
// (RLS on sybil_blog_posts handles that). Mutations, plus upload_media, write
// to sybil_admin_audit; pure reads (list/get/slug_check) do not — auditing
// reads floods the audit screen in dev under React StrictMode (see admin-api
// precedent).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import sanitizeHtml from "https://esm.sh/sanitize-html@2.13.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FORBIDDEN_BODY_KEYS = ["role", "platform_role", "level", "is_superadmin"];

const STAFF_ACTIONS = new Set([
  "list",
  "get",
  "slug_check",
]);

const SUPERADMIN_ACTIONS = new Set([
  "create",
  "update",
  "publish",
  "unpublish",
  "upload_media",
  "delete",
]);

const READ_ONLY_ACTIONS = new Set(["list", "get", "slug_check"]);

const UPDATABLE_FIELDS = [
  "title",
  "slug",
  "excerpt",
  "cover_url",
  "content_json",
  "content_html",
  "tags",
  "seo_title",
  "seo_description",
  "og_image_url",
  "reading_minutes",
];

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code",
    "strong", "em", "u", "s", "a", "img", "figure", "figcaption", "hr", "br",
    "iframe", "div", "span", "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
    iframe: ["src", "allow", "allowfullscreen", "frameborder"],
    div: ["class"],
    span: ["class"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedIframeHostnames: ["www.youtube.com", "player.vimeo.com", "www.loom.com"],
  transformTags: {
    iframe: (tagName, attribs) => {
      const src = attribs.src ?? "";
      const ok =
        /^https:\/\/(www\.)?youtube\.com\/embed\//.test(src) ||
        /^https:\/\/player\.vimeo\.com\/video\//.test(src) ||
        /^https:\/\/(www\.)?loom\.com\/embed\//.test(src);
      if (!ok) return { tagName: "div", attribs: {} };
      return { tagName, attribs: { src, allowfullscreen: "true", frameborder: "0" } };
    },
  },
  disallowedTagsMode: "discard",
};

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
        action: "blog_unknown",
        outcome: "denied",
        payload: { reason: "not a platform admin" },
      });
      return json({ error: "Forbidden" }, 403);
    }
    const callerRole = adminRow.role as "staff" | "superadmin";

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    const smuggledKey = FORBIDDEN_BODY_KEYS.find((k) => k in (body || {}));
    if (smuggledKey) {
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: callerRole,
        action: `blog_${action || "unknown"}`,
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
        action: `blog_${action}`,
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
      case "delete":
        result = await handleDelete(ctx, body);
        break;
      case "upload_media":
        result = await handleUploadMedia(ctx, body);
        break;
      default:
        return json({ error: "Unknown action" }, 400);
    }

    if (!READ_ONLY_ACTIONS.has(action)) {
      const r = result as { ok?: boolean; error?: string; post?: { id?: string; slug?: string; title?: string } };
      await writeAudit(supabase, {
        adminUserId: user.id,
        adminRole: callerRole,
        action: `blog_${action}`,
        targetType: "blog_post",
        targetId: (body.id as string) ?? r?.post?.id,
        payload: { slug: (body.slug as string) ?? r?.post?.slug, title: r?.post?.title },
        outcome: r?.error ? "error" : "ok",
      });
    }

    return json(result);
  } catch (err) {
    console.error("blog-admin error:", err);
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
    .slice(0, 80) || "post";
}

async function uniqueSlug(supabase: ReturnType<typeof createClient>, base: string, excludeId?: string) {
  let candidate = base;
  let n = 2;
  for (;;) {
    let query = supabase.from("sybil_blog_posts").select("id").eq("slug", candidate).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query;
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

// ----------------------------------------------------------------------------
// staff + superadmin
// ----------------------------------------------------------------------------
async function handleList(ctx: ActionContext, body: Record<string, unknown>) {
  const status = body.status as string | undefined;
  const q = body.q as string | undefined;
  const limit = typeof body.limit === "number" && body.limit > 0 && body.limit <= 200 ? body.limit : 50;
  const offset = typeof body.offset === "number" && body.offset >= 0 ? body.offset : 0;

  let query = ctx.supabase
    .from("sybil_blog_posts")
    .select("id, slug, title, status, author_name, tags, updated_at, published_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("title", `%${q}%`);

  const { data, count, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { posts: data ?? [], total: count ?? 0 };
}

async function handleGet(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  const slug = body.slug as string | undefined;
  if (!id && !slug) return { ok: false, error: "Missing id or slug" };

  let query = ctx.supabase.from("sybil_blog_posts").select("*").limit(1);
  query = id ? query.eq("id", id) : query.eq("slug", slug!);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Not found" };
  return { post: data };
}

async function handleSlugCheck(ctx: ActionContext, body: Record<string, unknown>) {
  const slug = (body.slug as string | undefined)?.trim();
  if (!slug) return { ok: false, error: "Missing slug" };
  const excludeId = body.exclude_id as string | undefined;

  let query = ctx.supabase.from("sybil_blog_posts").select("id").eq("slug", slug).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  const available = !data || data.length === 0;
  const suggestion = available ? slug : await uniqueSlug(ctx.supabase, slug, excludeId);
  return { available, suggestion };
}

async function handleCreate(ctx: ActionContext, body: Record<string, unknown>) {
  const title = (body.title as string | undefined)?.trim();
  if (!title) return { ok: false, error: "Missing title" };

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
    status: "draft",
    author_user_id: ctx.callerId,
    author_name: profile?.display_name ?? null,
    content_json: body.content_json ?? {},
    content_html: typeof body.content_html === "string" ? sanitizeHtml(body.content_html, SANITIZE_OPTS) : "",
  };
  for (const field of ["excerpt", "cover_url", "tags", "seo_title", "seo_description", "og_image_url", "reading_minutes"]) {
    if (field in body) insertRow[field] = body[field as keyof typeof body];
  }

  const { data, error } = await ctx.supabase.from("sybil_blog_posts").insert(insertRow).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, post: data };
}

async function handleUpdate(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const patch: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in body) patch[field] = body[field as keyof typeof body];
  }
  if (typeof patch.content_html === "string") {
    patch.content_html = sanitizeHtml(patch.content_html, SANITIZE_OPTS);
  }
  if (typeof patch.slug === "string") {
    patch.slug = slugify(patch.slug);
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };

  const { data, error } = await ctx.supabase.from("sybil_blog_posts").update(patch).eq("id", id).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, post: data };
}

async function handlePublish(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { data: post, error: fetchError } = await ctx.supabase
    .from("sybil_blog_posts")
    .select("title, slug, content_html, excerpt, published_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !post) return { ok: false, error: fetchError?.message ?? "Not found" };

  const missing: string[] = [];
  if (!post.title || !post.title.trim()) missing.push("title");
  if (!post.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) missing.push("slug");
  if (!post.content_html || post.content_html.length < 200) missing.push("content_html");
  if (!post.excerpt || !post.excerpt.trim()) missing.push("excerpt");
  if (missing.length > 0) return { ok: false, error: "Missing required fields to publish", missing };

  const { data, error } = await ctx.supabase
    .from("sybil_blog_posts")
    .update({ status: "published", published_at: post.published_at ?? new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, post: data };
}

async function handleUnpublish(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { data, error } = await ctx.supabase
    .from("sybil_blog_posts")
    .update({ status: "draft" })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, post: data };
}

async function handleUploadMedia(ctx: ActionContext, body: Record<string, unknown>) {
  const postId = body.post_id as string | undefined;
  const filename = body.filename as string | undefined;
  const contentType = body.content_type as string | undefined;
  const dataBase64 = body.data_base64 as string | undefined;

  if (!postId || !filename || !contentType || !dataBase64) {
    return { ok: false, error: "Missing post_id, filename, content_type or data_base64" };
  }
  if (!ALLOWED_MIME.includes(contentType)) {
    return { ok: false, error: `Unsupported content type: ${contentType}` };
  }

  const bytes = base64ToBytes(dataBase64);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File exceeds 5MB limit" };
  }

  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const slugName = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  const path = `posts/${postId}/${Date.now()}-${slugName}.${ext}`;

  const { error } = await ctx.supabase.storage.from("blog-media").upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };

  const { data: pub } = ctx.supabase.storage.from("blog-media").getPublicUrl(path);
  return { ok: true, url: pub.publicUrl };
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ----------------------------------------------------------------------------
// superadmin only
// ----------------------------------------------------------------------------
async function handleDelete(ctx: ActionContext, body: Record<string, unknown>) {
  const id = body.id as string | undefined;
  if (!id) return { ok: false, error: "Missing id" };

  const { error } = await ctx.supabase.from("sybil_blog_posts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  const { data: files } = await ctx.supabase.storage.from("blog-media").list(`posts/${id}`);
  if (files && files.length > 0) {
    await ctx.supabase.storage.from("blog-media").remove(files.map((f) => `posts/${id}/${f.name}`));
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
