import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ExternalLink, Copy, Check, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { copy } from "../config/tokens";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import { docs, type DocsCategoryRow, type DocsPage as DocsPageType, type DocsPageSummary } from "../lib/docsApi";
import { useDocumentMeta } from "../hooks/useDocumentMeta";
import DocsShell from "../components/docs/DocsShell";
import DocsMarkdown, { type DocsHeading } from "../components/docs/DocsMarkdown";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get("preview") === "1";
  const { platformRole } = useContext(AuthContext);
  const showDraft = isPreview && !!platformRole;

  const [page, setPage] = useState<DocsPageType | null | undefined>(undefined);
  const [siblings, setSiblings] = useState<DocsPageSummary[]>([]);
  const [categories, setCategories] = useState<DocsCategoryRow[]>([]);
  const [allPages, setAllPages] = useState<DocsPageSummary[]>([]);
  const [headings, setHeadings] = useState<DocsHeading[]>([]);
  const [copied, setCopied] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target as Node)) {
        setMobileNavOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("sybil_docs_categories")
      .select("id, slug, label, order_index")
      .order("order_index", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setCategories((data as DocsCategoryRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadNav() {
      if (showDraft) {
        try {
          const { pages } = await docs.list();
          if (!cancelled) setAllPages(pages);
          return;
        } catch {
          // fall through to public read
        }
      }
      const { data } = await supabase
        .from("sybil_docs_pages")
        .select("id, slug, category, title, summary, status, order_index, author_name, updated_at, published_at")
        .eq("status", "published")
        .order("category", { ascending: true })
        .order("order_index", { ascending: true });
      if (!cancelled) setAllPages((data as DocsPageSummary[]) ?? []);
    }

    loadNav();
    return () => {
      cancelled = true;
    };
  }, [showDraft]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    async function load() {
      if (showDraft) {
        try {
          const { page: p } = await docs.get({ slug });
          if (!cancelled) setPage(p);
          return;
        } catch {
          // fall through to public read
        }
      }
      const { data, error } = await supabase
        .from("sybil_docs_pages")
        .select(
          "id, slug, category, title, summary, content_md, status, order_index, author_name, author_user_id, seo_title, seo_description, published_at, updated_at, created_at",
        )
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setPage(null);
        return;
      }
      setPage(data as unknown as DocsPageType);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, showDraft]);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;

    async function loadSiblings() {
      if (showDraft) {
        try {
          const { pages } = await docs.list({ category: page!.category });
          if (!cancelled) setSiblings(pages);
          return;
        } catch {
          // fall through to public read
        }
      }
      const { data } = await supabase
        .from("sybil_docs_pages")
        .select("id, slug, category, title, summary, status, order_index, author_name, updated_at, published_at")
        .eq("status", "published")
        .eq("category", page!.category)
        .order("order_index", { ascending: true });
      if (!cancelled) setSiblings((data as DocsPageSummary[]) ?? []);
    }

    loadSiblings();
    return () => {
      cancelled = true;
    };
  }, [page, showDraft]);

  const handleHeadings = useCallback((h: DocsHeading[]) => setHeadings(h), []);

  useDocumentMeta({
    title: page ? `${page.seo_title || page.title} · ${copy.appName}` : `Documentation · ${copy.appName}`,
    description: page?.seo_description || page?.summary || undefined,
    canonical: page ? `${window.location.origin}/docs/${page.slug}` : undefined,
  });

  async function handleCopyForLlm() {
    if (!page) return;
    try {
      const res = await fetch(`/docs/md/${page.slug}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard/network failures are non-critical here; button just doesn't confirm
    }
  }

  if (page === undefined) {
    return (
      <DocsShell>
        <div className="w-full min-h-[60vh]" />
      </DocsShell>
    );
  }

  if (page === null) {
    return (
      <DocsShell>
        <div className="w-full min-h-[60vh] flex flex-col items-center justify-center px-6 text-center gap-5">
          <h1 className="text-2xl font-semibold text-fg-primary">Page not found</h1>
          <p className="text-fg-muted">This doc doesn&apos;t exist, or moved.</p>
          <Link
            to="/docs"
            className="inline-flex items-center px-6 py-3 rounded-lg border border-fg-accent text-fg-accent font-medium text-sm hover:bg-fg-accent/10 transition-colors duration-150"
          >
            ← Back to docs
          </Link>
        </div>
      </DocsShell>
    );
  }

  const idx = siblings.findIndex((s) => s.id === page.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const grouped = categories
    .map((category) => ({
      category,
      pages: allPages.filter((p) => p.category === category.slug),
    }))
    .filter((g) => g.pages.length > 0);

  return (
    <DocsShell>
      <div className="w-full max-w-6xl mx-auto px-6 md:px-8 py-10">
        {isPreview && page.status !== "published" && (
          <div className="bg-fg-accent/10 border border-fg-accent/30 text-fg-accent text-sm text-center py-2 rounded-md mb-6">
            Preview — this page is not published yet
          </div>
        )}

        <nav className="flex items-center gap-2 text-sm text-fg-muted mb-6">
          <Link to="/docs" className="text-fg-accent hover:text-[#ff5c40] transition-colors duration-150">
            Docs
          </Link>
          <span>/</span>
          <span className="text-fg-subtle truncate">{page.title}</span>
        </nav>

        {grouped.length > 0 && (
          <div ref={mobileNavRef} className="relative lg:hidden mb-6">
            <button
              onClick={() => setMobileNavOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-2 text-sm font-medium text-fg-primary border border-fg-subtle/20 rounded-lg px-3.5 py-2.5 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                {mobileNavOpen ? <X size={15} /> : <Menu size={15} />}
                Browse docs
              </span>
              <span className="text-fg-subtle truncate max-w-[55%]">{page.title}</span>
            </button>

            {mobileNavOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] max-h-[60vh] overflow-y-auto bg-bg-elevated border border-fg-subtle/20 rounded-lg shadow-lg p-4 space-y-5 z-40">
                {grouped.map((g) => (
                  <div key={g.category.id}>
                    <h2 className="text-xs font-semibold tracking-wide uppercase text-fg-subtle mb-1.5">
                      {g.category.label}
                    </h2>
                    <div className="flex flex-col gap-0.5">
                      {g.pages.map((p) => {
                        const isActive = p.slug === page.slug;
                        return (
                          <Link
                            key={p.id}
                            to={`/docs/${p.slug}`}
                            className={`text-sm py-1 transition-colors duration-150 ${
                              isActive ? "text-fg-accent font-medium" : "text-fg-muted hover:text-fg-accent"
                            }`}
                          >
                            {p.title}
                            {p.status !== "published" && (
                              <span className="ml-1.5 text-[10px] text-warning">draft</span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_220px] gap-10">
          {/* Left nav */}
          {grouped.length > 0 && (
            <nav className="hidden lg:block lg:sticky lg:top-8 lg:self-start space-y-5">
              {grouped.map((g) => (
                <div key={g.category.id}>
                  <h2 className="text-xs font-semibold tracking-wide uppercase text-fg-subtle mb-1.5">
                    {g.category.label}
                  </h2>
                  <div className="flex flex-col gap-0.5">
                    {g.pages.map((p) => {
                      const isActive = p.slug === page.slug;
                      return (
                        <Link
                          key={p.id}
                          to={`/docs/${p.slug}`}
                          className={`text-sm py-0.5 transition-colors duration-150 ${
                            isActive
                              ? "text-fg-accent font-medium"
                              : "text-fg-muted hover:text-fg-accent"
                          }`}
                        >
                          {p.title}
                          {p.status !== "published" && (
                            <span className="ml-1.5 text-[10px] text-warning">draft</span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          )}

          <article className="min-w-0">
            <header className="pb-6 mb-8 border-b border-fg-subtle/15">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <span className="px-2.5 py-1 rounded-full text-xs font-medium border border-fg-accent/40 text-fg-accent">
                  {categories.find((c) => c.slug === page.category)?.label ?? page.category}
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={`/docs/md/${page.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg-primary border border-fg-subtle/25 rounded-md px-2.5 py-1.5 transition-colors duration-150"
                  >
                    <ExternalLink size={13} /> View as Markdown
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyForLlm}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg-primary border border-fg-subtle/25 rounded-md px-2.5 py-1.5 transition-colors duration-150 cursor-pointer"
                  >
                    {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy for LLM"}
                  </button>
                </div>
              </div>
              <h1 className="font-semibold text-[clamp(26px,3.2vw,36px)] leading-[1.25] tracking-[-0.015em] mb-3 text-fg-primary">
                {page.title}
              </h1>
              {page.summary && <p className="text-[15px] leading-[1.6] text-fg-muted mb-3">{page.summary}</p>}
              <p className="text-xs text-fg-subtle">Last updated {formatDate(page.updated_at)}</p>
            </header>

            <DocsMarkdown content={page.content_md} onHeadingsChange={handleHeadings} />

            {(prev || next) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-14 pt-8 border-t border-fg-subtle/15">
                {prev ? (
                  <Link
                    to={`/docs/${prev.slug}`}
                    className="flex items-center gap-2 rounded-lg border border-fg-subtle/20 p-4 hover:border-fg-accent/50 transition-colors duration-150"
                  >
                    <ChevronLeft size={16} className="text-fg-subtle shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-fg-subtle mb-0.5">Previous</p>
                      <p className="text-sm font-medium text-fg-primary truncate">{prev.title}</p>
                    </div>
                  </Link>
                ) : (
                  <div />
                )}
                {next && (
                  <Link
                    to={`/docs/${next.slug}`}
                    className="flex items-center justify-end gap-2 rounded-lg border border-fg-subtle/20 p-4 hover:border-fg-accent/50 transition-colors duration-150 text-right"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-fg-subtle mb-0.5">Next</p>
                      <p className="text-sm font-medium text-fg-primary truncate">{next.title}</p>
                    </div>
                    <ChevronRight size={16} className="text-fg-subtle shrink-0" />
                  </Link>
                )}
              </div>
            )}
          </article>

          {/* TOC */}
          {headings.length > 0 && (
            <aside className="hidden lg:block">
              <nav className="sticky top-8 space-y-1.5">
                <p className="text-xs font-semibold tracking-wide uppercase text-fg-subtle mb-2">On this page</p>
                {headings.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className={`block text-sm text-fg-muted hover:text-fg-accent transition-colors duration-150 ${
                      h.level === 3 ? "pl-3" : ""
                    }`}
                  >
                    {h.text}
                  </a>
                ))}
              </nav>
            </aside>
          )}
        </div>
      </div>
    </DocsShell>
  );
}
