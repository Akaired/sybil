import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Undo2,
  ChevronDown,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Link2,
  List,
  Code,
  Table,
} from "lucide-react";
import {
  docs,
  docsApiErrorMessage,
  type DocsCategory,
  type DocsCategoryRow,
  type DocsPage,
} from "../../lib/docsApi";
import { AuthContext } from "../../contexts/AuthContext";
import { AdminLoading, AdminError } from "../../components/admin/AdminStatus";
import DocsMarkdown from "../../components/docs/DocsMarkdown";

function localSlugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function wordStats(md: string): { words: number; minutes: number } {
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 200)) };
}

interface ToolbarAction {
  icon: typeof Bold;
  label: string;
  apply: (selected: string) => { text: string; cursorOffset?: number };
}

const TOOLBAR: ToolbarAction[] = [
  { icon: Heading2, label: "Heading 2", apply: (s) => ({ text: `## ${s || "Heading"}` }) },
  { icon: Heading3, label: "Heading 3", apply: (s) => ({ text: `### ${s || "Heading"}` }) },
  { icon: Bold, label: "Bold", apply: (s) => ({ text: `**${s || "bold text"}**` }) },
  { icon: Italic, label: "Italic", apply: (s) => ({ text: `*${s || "italic text"}*` }) },
  { icon: Link2, label: "Link", apply: (s) => ({ text: `[${s || "link text"}](https://)` }) },
  { icon: List, label: "List", apply: (s) => ({ text: (s || "item").split("\n").map((l) => `- ${l}`).join("\n") }) },
  { icon: Code, label: "Code block", apply: (s) => ({ text: `\`\`\`\n${s || "code"}\n\`\`\`` }) },
  {
    icon: Table,
    label: "Table",
    apply: () => ({
      text: "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |",
    }),
  },
];

export default function DocsEdit() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { platformRole } = useContext(AuthContext);

  const [id, setId] = useState<string | null>(routeId && routeId !== "new" ? routeId : null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [category, setCategory] = useState<DocsCategory>("");
  const [summary, setSummary] = useState("");
  const [orderIndex, setOrderIndex] = useState(0);
  const [contentMd, setContentMd] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoOpen, setSeoOpen] = useState(false);

  const [status, setStatus] = useState<DocsPage["status"]>("draft");
  const [categories, setCategories] = useState<DocsCategoryRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    docs
      .categoryList()
      .then((res) => {
        if (!cancelled) setCategories(res.categories);
      })
      .catch(() => {
        // Non-fatal for an existing page (category select just stays empty);
        // fatal for "new", handled separately below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load / create ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!routeId || routeId === "new") {
        try {
          const { categories: cats } = await docs.categoryList();
          if (cats.length === 0) {
            if (!cancelled) setLoadError("Create a category first — see Manage categories.");
            return;
          }
          const { page } = await docs.create({ title: "Untitled", category: cats[0].slug });
          if (cancelled) return;
          navigate(`/admin/docs/${page.id}`, { replace: true });
        } catch (err) {
          if (!cancelled) setLoadError(docsApiErrorMessage(err, "Couldn't create the page."));
        }
        return;
      }
      try {
        const { page } = await docs.get({ id: routeId });
        if (cancelled) return;
        skipNextAutosave.current = true;
        setId(page.id);
        setTitle(page.title);
        setSlug(page.slug);
        setSlugTouched(true);
        setCategory(page.category);
        setSummary(page.summary ?? "");
        setOrderIndex(page.order_index);
        setContentMd(page.content_md);
        setSeoTitle(page.seo_title ?? "");
        setSeoDescription(page.seo_description ?? "");
        setStatus(page.status);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(docsApiErrorMessage(err, "Couldn't load the page."));
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  // ── Slug preview: auto-derive from title until touched. Slug itself is
  // immutable server-side after create (not in docs-admin's UPDATABLE_FIELDS)
  // — this only keeps the on-screen preview in sync pre-save via slug_check. ──
  useEffect(() => {
    if (!slugTouched) setSlug(localSlugify(title));
  }, [title, slugTouched]);

  // ── Autosave (debounced 2s) ────────────────────────────────
  const saveNow = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const { page } = await docs.update({
        id,
        title,
        slug,
        summary,
        content_md: contentMd,
        category,
        order_index: orderIndex,
        seo_title: seoTitle || undefined,
        seo_description: seoDescription || undefined,
      });
      // The server may have deduplicated the slug (e.g. a collision) — keep
      // the field in sync so the preview link and next save use the real value.
      setSlug(page.slug);
      setLastSavedAt(new Date());
      setDirty(false);
    } catch (err) {
      setActionError(docsApiErrorMessage(err, "Autosave failed."));
    } finally {
      setSaving(false);
    }
  }, [id, title, slug, summary, contentMd, category, orderIndex, seoTitle, seoDescription]);

  const scheduleSave = useCallback(() => {
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, 2000);
  }, [saveNow]);

  useEffect(() => {
    if (loading || !id) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, slug, summary, contentMd, category, orderIndex, seoTitle, seoDescription]);

  // ── beforeunload guard ──────────────────────────────────────
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function applyToolbarAction(action: ToolbarAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value } = ta;
    const selected = value.slice(selectionStart, selectionEnd);
    const { text } = action.apply(selected);
    const next = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
    setContentMd(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = selectionStart + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function handlePublishToggle() {
    if (!id) return;
    setActionError(null);
    try {
      if (status === "published") {
        const { page } = await docs.unpublish({ id });
        setStatus(page.status);
        return;
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await saveNow();
      const { page } = await docs.publish({ id });
      setStatus(page.status);
    } catch (err) {
      setActionError(docsApiErrorMessage(err, "Action failed."));
    }
  }

  if (platformRole !== "superadmin") return <Navigate to="/admin/docs" replace />;
  if (loadError) return <AdminError message={loadError} />;
  if (loading || !id) return <AdminLoading />;

  const { words, minutes } = wordStats(contentMd);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate("/admin/docs")}
          className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg-primary text-sm transition-colors duration-150 cursor-pointer"
        >
          <ArrowLeft size={15} /> Back to documentation
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-subtle">
            {saving ? "Saving…" : lastSavedAt ? `Saved · ${formatTime(lastSavedAt)}` : dirty ? "Unsaved changes" : ""}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              status === "published" ? "bg-success/14 text-success" : "bg-warning/14 text-warning"
            }`}
          >
            {status === "published" ? "Published" : "Draft"}
          </span>
          <a
            href={`/docs/${slug}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fg-muted hover:text-fg-primary border border-fg-subtle/25 rounded-md px-3 py-1.5 transition-colors duration-150"
          >
            Preview
          </a>
          <button
            onClick={handlePublishToggle}
            className="inline-flex items-center gap-1.5 bg-fg-accent text-bg-base font-semibold text-sm rounded-md px-3.5 py-1.5 hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            {status === "published" ? (
              <>
                <Undo2 size={14} /> Back to draft
              </>
            ) : (
              <>
                <Send size={14} /> Publish
              </>
            )}
          </button>
        </div>
      </div>

      {actionError && <AdminError message={actionError} />}

      {/* Meta bar */}
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-fg-muted mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
          />
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[11px] text-fg-subtle shrink-0">/docs/</span>
            <input
              value={slug}
              onChange={(e) => {
                setSlug(localSlugify(e.target.value));
                setSlugTouched(true);
              }}
              placeholder="page-slug"
              className="flex-1 min-w-0 text-[11px] bg-transparent border-b border-transparent hover:border-fg-subtle/25 focus:border-fg-accent/50 text-fg-subtle focus:text-fg-primary outline-none transition-colors duration-150"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DocsCategory)}
            className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none cursor-pointer"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Order</label>
          <input
            type="number"
            value={orderIndex}
            onChange={(e) => setOrderIndex(Number(e.target.value) || 0)}
            className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-fg-muted">Summary</label>
            <span className="text-[11px] text-fg-subtle">Shown in the index and in llms.txt</span>
          </div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder="1–2 sentence summary"
            className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none resize-none"
          />
        </div>
      </div>

      {/* Editor + preview */}
      <div className="grid grid-cols-1 min-[1100px]:grid-cols-2 gap-5">
        <div className="min-w-0 flex flex-col">
          <div className="flex items-center gap-0.5 bg-bg-elevated border border-fg-subtle/20 rounded-t-lg px-1.5 py-1">
            {TOOLBAR.map((action) => (
              <button
                key={action.label}
                type="button"
                title={action.label}
                onClick={() => applyToolbarAction(action)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 cursor-pointer"
              >
                <action.icon size={14} />
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={contentMd}
            onChange={(e) => setContentMd(e.target.value)}
            placeholder="Write in Markdown…"
            spellCheck={false}
            className="w-full flex-1 min-h-[480px] text-sm font-mono leading-[1.6] bg-bg-elevated border border-t-0 border-fg-subtle/20 rounded-b-lg px-3.5 py-3 text-fg-primary outline-none resize-none"
          />
          <p className="text-xs text-fg-subtle pt-2">
            {words} words · {minutes} min read
          </p>
        </div>

        <div className="min-w-0">
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-1.5 py-1 mb-0 flex items-center h-[38px]">
            <span className="text-xs font-medium text-fg-subtle px-2">Preview</span>
          </div>
          <div className="border border-t-0 border-fg-subtle/20 rounded-b-lg px-5 py-4 min-h-[480px] bg-bg-base overflow-auto">
            {contentMd.trim() ? (
              <DocsMarkdown content={contentMd} />
            ) : (
              <p className="text-sm text-fg-subtle">Nothing to preview yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* SEO panel */}
      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg p-4">
        <button
          onClick={() => setSeoOpen(!seoOpen)}
          className="flex items-center justify-between w-full text-sm font-medium text-fg-primary cursor-pointer"
        >
          SEO
          <ChevronDown size={15} className={`transition-transform duration-150 ${seoOpen ? "rotate-180" : ""}`} />
        </button>
        {seoOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">SEO title</label>
              <input
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder={title}
                className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">SEO description</label>
              <textarea
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                rows={1}
                placeholder={summary}
                className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none resize-none"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
