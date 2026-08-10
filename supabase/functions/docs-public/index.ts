// ============================================================================
// SYBIL — Edge Function: docs-public
// Public, unauthenticated doc server for /docs/:slug.md, /llms.txt, and
// /llms-full.txt (see public/_redirects). No Authorization header is read,
// no JWT is verified — this only ever reads rows the docs_public_read RLS
// policy already allows anon to see (status = 'published'). Never serve a
// secret, an internal hostname, or the project ref in a response body.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SITE_URL = "https://sybil-agent.com";

interface DocsCategory {
  slug: string;
  label: string;
}

interface DocsPage {
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  content_md: string;
  published_at: string;
  updated_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const url = new URL(req.url);
  // Netlify's `:slug.md` redirect placeholder captures the literal ".md"
  // suffix along with the slug instead of splitting it off (confirmed
  // empirically — the placeholder is greedy across the dot), so strip it
  // here rather than relying on the redirect rule to do it.
  const slug = url.searchParams.get("slug")?.replace(/\.md$/, "") ?? null;
  const isIndex = url.searchParams.get("index") === "1";
  const isFull = url.searchParams.get("full") === "1";

  try {
    if (slug) return await servePage(supabase, slug);
    if (isIndex) return await serveIndex(supabase);
    if (isFull) return await serveFull(supabase);
    return md("Missing ?slug=, ?index=1 or ?full=1", 400);
  } catch (err) {
    console.error("docs-public error:", err);
    return md("Internal error", 500);
  }
});

async function servePage(supabase: ReturnType<typeof createClient>, slug: string) {
  const { data, error } = await supabase
    .from("sybil_docs_pages")
    .select("slug, category, title, summary, content_md, published_at, updated_at")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error || !data) return md("Not found", 404);
  const page = data as unknown as DocsPage;

  const frontMatter = [
    "---",
    `title: ${yamlString(page.title)}`,
    `summary: ${yamlString(page.summary ?? "")}`,
    `category: ${yamlString(page.category)}`,
    `updated_at: ${page.updated_at}`,
    `canonical: ${SITE_URL}/docs/${page.slug}`,
    "---",
    "",
  ].join("\n");

  return md(frontMatter + page.content_md);
}

async function orderedCategories(supabase: ReturnType<typeof createClient>): Promise<DocsCategory[]> {
  const { data } = await supabase
    .from("sybil_docs_categories")
    .select("slug, label")
    .order("order_index", { ascending: true });
  return (data ?? []) as unknown as DocsCategory[];
}

async function serveIndex(supabase: ReturnType<typeof createClient>) {
  const [categories, { data, error }] = await Promise.all([
    orderedCategories(supabase),
    supabase
      .from("sybil_docs_pages")
      .select("slug, category, title, summary, order_index")
      .eq("status", "published")
      .order("order_index", { ascending: true }),
  ]);

  if (error) return md("Internal error", 500);
  const pages = (data ?? []) as unknown as Array<Pick<DocsPage, "slug" | "category" | "title" | "summary"> & { order_index: number }>;

  const lines: string[] = [
    "# Sybil",
    "",
    "Sybil turns dormant tasks into action with sentinels that watch, wait, and act at the right moment.",
    "",
  ];

  for (const cat of categories) {
    const inCategory = pages.filter((p) => p.category === cat.slug);
    if (inCategory.length === 0) continue;
    lines.push(`## ${cat.label}`, "");
    for (const p of inCategory) {
      lines.push(`- [${p.title}](${SITE_URL}/docs/md/${p.slug}): ${p.summary ?? ""}`);
    }
    lines.push("");
  }

  return md(lines.join("\n"));
}

async function serveFull(supabase: ReturnType<typeof createClient>) {
  const [categories, { data, error }] = await Promise.all([
    orderedCategories(supabase),
    supabase
      .from("sybil_docs_pages")
      .select("slug, category, title, summary, content_md, published_at, updated_at")
      .eq("status", "published")
      .order("order_index", { ascending: true }),
  ]);

  if (error) return md("Internal error", 500);
  const pages = (data ?? []) as unknown as DocsPage[];
  const categoryRank = new Map(categories.map((c, i) => [c.slug, i]));
  pages.sort((a, b) => (categoryRank.get(a.category) ?? 999) - (categoryRank.get(b.category) ?? 999));

  const sections = pages.map((page) => {
    const frontMatter = [
      "---",
      `title: ${yamlString(page.title)}`,
      `summary: ${yamlString(page.summary ?? "")}`,
      `category: ${yamlString(page.category)}`,
      `updated_at: ${page.updated_at}`,
      `canonical: ${SITE_URL}/docs/${page.slug}`,
      "---",
      "",
    ].join("\n");
    return frontMatter + page.content_md;
  });

  return md(sections.join("\n\n---\n\n"));
}

function yamlString(value: string): string {
  return JSON.stringify(value ?? "");
}

function md(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...CORS,
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
