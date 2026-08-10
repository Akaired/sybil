import { useContext, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import { docs, type DocsCategoryRow, type DocsPageSummary } from "../lib/docsApi";
import DocsShell from "../components/docs/DocsShell";

// Picks the first page by CATEGORY ORDER (sybil_docs_categories.order_index),
// not alphabetical category-slug order — "agent" would otherwise sort before
// "getting-started" and hijack the /docs landing page from "What is Sybil".
function firstByCategoryOrder(pages: DocsPageSummary[], categories: DocsCategoryRow[]): string | null {
  const rank = new Map(categories.map((c) => [c.slug, c.order_index]));
  const sorted = [...pages].sort((a, b) => {
    const ra = rank.get(a.category) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.category) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.order_index - b.order_index;
  });
  return sorted[0]?.slug ?? null;
}

export default function Docs() {
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get("preview") === "1";
  const { platformRole } = useContext(AuthContext);
  const showDrafts = isPreview && !!platformRole;

  const [firstSlug, setFirstSlug] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: categoryData } = await supabase
        .from("sybil_docs_categories")
        .select("id, slug, label, order_index")
        .order("order_index", { ascending: true });
      const categories = (categoryData as DocsCategoryRow[]) ?? [];
      if (cancelled) return;

      if (showDrafts) {
        try {
          const { pages } = await docs.list();
          if (!cancelled) setFirstSlug(firstByCategoryOrder(pages, categories));
          return;
        } catch {
          // fall through to public read
        }
      }
      const { data } = await supabase
        .from("sybil_docs_pages")
        .select("id, slug, category, order_index")
        .eq("status", "published");
      if (cancelled) return;
      setFirstSlug(firstByCategoryOrder((data as DocsPageSummary[]) ?? [], categories));
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [showDrafts]);

  if (firstSlug === undefined) {
    return (
      <DocsShell>
        <div className="w-full min-h-[60vh]" />
      </DocsShell>
    );
  }

  if (firstSlug === null) {
    return (
      <DocsShell>
        <div className="w-full min-h-[60vh] flex flex-col items-center justify-center px-6 text-center gap-2">
          <h1 className="text-2xl font-semibold text-fg-primary">No pages published yet</h1>
          <p className="text-fg-muted">Check back soon.</p>
        </div>
      </DocsShell>
    );
  }

  return <Navigate to={`/docs/${firstSlug}${isPreview ? "?preview=1" : ""}`} replace />;
}
