import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import { ArrowLeft, Check, Send, Undo2, X, Upload, ChevronDown } from "lucide-react";
import BlogEditor from "../../components/blog/BlogEditor";
import { blog, blogApiErrorMessage, type BlogPost } from "../../lib/blogApi";
import { AuthContext } from "../../contexts/AuthContext";
import { AdminLoading, AdminError } from "../../components/admin/AdminStatus";

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

export default function BlogEdit() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { platformRole } = useContext(AuthContext);

  const [id, setId] = useState<string | null>(routeId && routeId !== "new" ? routeId : null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [excerpt, setExcerpt] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [seoOpen, setSeoOpen] = useState(false);

  const [status, setStatus] = useState<BlogPost["status"]>("draft");
  const [contentJson, setContentJson] = useState<Record<string, unknown> | null>(null);
  const [initialContent, setInitialContent] = useState<Record<string, unknown> | string | null>(null);
  const [readingMinutes, setReadingMinutes] = useState(1);
  const [wordCount, setWordCount] = useState(0);

  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosave = useRef(false);

  // ── Load / create ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!routeId || routeId === "new") {
        try {
          const { post } = await blog.create({ title: "Untitled" });
          if (cancelled) return;
          navigate(`/admin/blog/${post.id}`, { replace: true });
        } catch (err) {
          if (!cancelled) setLoadError(blogApiErrorMessage(err, "Couldn't create the article."));
        }
        return;
      }
      try {
        const { post } = await blog.get({ id: routeId });
        if (cancelled) return;
        skipNextAutosave.current = true;
        setId(post.id);
        setTitle(post.title);
        setSlug(post.slug);
        setSlugTouched(true);
        setExcerpt(post.excerpt ?? "");
        setTags(post.tags ?? []);
        setCoverUrl(post.cover_url ?? "");
        setSeoTitle(post.seo_title ?? "");
        setSeoDescription(post.seo_description ?? "");
        setOgImageUrl(post.og_image_url ?? "");
        setStatus(post.status);
        const hasJson = post.content_json && Object.keys(post.content_json).length > 0;
        setContentJson(hasJson ? post.content_json : null);
        setInitialContent(hasJson ? post.content_json : post.content_html || null);
        setReadingMinutes(post.reading_minutes ?? 1);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(blogApiErrorMessage(err, "Couldn't load the article."));
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

  // ── Slug: auto-derive from title until touched ────────────
  useEffect(() => {
    if (!slugTouched) setSlug(localSlugify(title));
  }, [title, slugTouched]);

  useEffect(() => {
    if (!id || !slug) return;
    setSlugStatus("checking");
    const t = setTimeout(() => {
      blog
        .slugCheck({ slug, exclude_id: id })
        .then((res) => setSlugStatus(res.available ? "available" : "taken"))
        .catch(() => setSlugStatus("idle"));
    }, 400);
    return () => clearTimeout(t);
  }, [slug, id]);

  // ── Autosave (debounced 2s) ────────────────────────────────
  const saveNow = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      await blog.update({
        id,
        title,
        slug,
        excerpt,
        cover_url: coverUrl || undefined,
        tags,
        content_json: editorRef.current?.getJSON() ?? contentJson ?? {},
        content_html: editorRef.current?.getHTML() ?? "",
        reading_minutes: readingMinutes,
        seo_title: seoTitle || undefined,
        seo_description: seoDescription || undefined,
        og_image_url: ogImageUrl || undefined,
      });
      setLastSavedAt(new Date());
      setDirty(false);
    } catch (err) {
      setActionError(blogApiErrorMessage(err, "Autosave failed."));
    } finally {
      setSaving(false);
    }
  }, [id, title, slug, excerpt, coverUrl, tags, contentJson, readingMinutes, seoTitle, seoDescription, ogImageUrl]);

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
  }, [title, slug, excerpt, coverUrl, tags, seoTitle, seoDescription, ogImageUrl]);

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

  function handleEditorUpdate(editor: Editor) {
    editorRef.current = editor;
    scheduleSave();
  }

  function handleWordStats(stats: { words: number; readingMinutes: number }) {
    setWordCount(stats.words);
    setReadingMinutes(stats.readingMinutes);
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }

  const MISSING_FIELD_LABEL: Record<string, string> = {
    title: "Title",
    slug: "Slug",
    excerpt: "Excerpt",
    content_html: `Body content (needs at least 200 characters — currently ${(editorRef.current?.storage.characterCount?.characters() ?? 0)})`,
  };

  async function handlePublishToggle() {
    if (!id) return;
    setActionError(null);
    setMissingFields([]);
    try {
      if (status === "published") {
        const { post } = await blog.unpublish({ id });
        setStatus(post.status);
        return;
      }

      if (saveTimer.current) clearTimeout(saveTimer.current);
      await saveNow();

      const { post, missing } = (await blog.publish({ id })) as unknown as {
        post?: BlogPost;
        missing?: string[];
        error?: string;
      };
      if (missing && missing.length > 0) {
        setMissingFields(missing);
        setActionError(`Missing before publishing: ${missing.map((f) => MISSING_FIELD_LABEL[f] ?? f).join(", ")}`);
        return;
      }
      if (post) setStatus(post.status);
    } catch (err) {
      setActionError(blogApiErrorMessage(err, "Action failed."));
    }
  }

  async function handleCoverUpload(file: File) {
    if (!id) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const { url } = await blog.uploadMedia({
        post_id: id,
        filename: file.name,
        content_type: file.type,
        data_base64: dataUrl,
      });
      setCoverUrl(url);
    } catch (err) {
      setActionError(blogApiErrorMessage(err, "Cover upload failed."));
    }
  }

  if (platformRole !== "superadmin") return <Navigate to="/admin/blog" replace />;
  if (loadError) return <AdminError message={loadError} />;
  if (loading || !id) return <AdminLoading />;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate("/admin/blog")}
          className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg-primary text-sm transition-colors duration-150 cursor-pointer"
        >
          <ArrowLeft size={15} /> Back to articles
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
            href={`/blog/${slug}?preview=1`}
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

      <div className="grid grid-cols-1 min-[1100px]:grid-cols-[1fr_340px] gap-5">
        {/* Editor column */}
        <div className="min-w-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Article title"
            className={`w-full text-2xl font-semibold bg-transparent border-none outline-none text-fg-primary mb-4 placeholder:text-fg-subtle ${
              missingFields.includes("title") ? "ring-1 ring-danger rounded-sm" : ""
            }`}
          />
          {missingFields.includes("content_html") && (
            <p className="text-xs text-danger -mt-3 mb-3">
              Body needs at least 200 characters before publishing.
            </p>
          )}
          <BlogEditor postId={id} content={initialContent} onUpdate={handleEditorUpdate} onWordStats={handleWordStats} />
        </div>

        {/* Meta panel */}
        <aside className="space-y-4 min-w-0">
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Slug</label>
              <div className="flex items-center gap-2">
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(localSlugify(e.target.value));
                  }}
                  className={`flex-1 text-sm bg-bg-base border rounded-md px-2.5 py-1.5 text-fg-primary outline-none ${
                    missingFields.includes("slug") ? "border-danger" : "border-fg-subtle/25"
                  }`}
                />
                {slugStatus === "available" && <Check size={15} className="text-success shrink-0" />}
                {slugStatus === "taken" && <X size={15} className="text-danger shrink-0" />}
              </div>
              {slugStatus === "taken" && <p className="text-xs text-danger mt-1">Slug already in use.</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-fg-muted">Excerpt</label>
                <span className="text-[11px] text-fg-subtle">{excerpt.length}/180</span>
              </div>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                rows={3}
                placeholder="140–180 characters recommended"
                className={`w-full text-sm bg-bg-base border rounded-md px-2.5 py-1.5 text-fg-primary outline-none resize-none ${
                  missingFields.includes("excerpt") ? "border-danger" : "border-fg-subtle/25"
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg-base border border-fg-subtle/25 text-fg-primary"
                  >
                    {t}
                    <button onClick={() => setTags(tags.filter((x) => x !== t))} className="cursor-pointer">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag, press Enter"
                className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Cover image</label>
              {coverUrl && <img src={coverUrl} alt="" className="w-full h-28 object-cover rounded-md mb-2" />}
              <div className="flex items-center gap-2">
                <input
                  value={coverUrl}
                  onChange={(e) => setCoverUrl(e.target.value)}
                  placeholder="https://…"
                  className="flex-1 text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
                />
                <label className="w-8 h-8 flex items-center justify-center rounded-md border border-fg-subtle/25 text-fg-muted hover:text-fg-primary cursor-pointer transition-colors duration-150">
                  <Upload size={14} />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleCoverUpload(e.target.files[0])}
                  />
                </label>
              </div>
            </div>

            <p className="text-xs text-fg-subtle pt-1 border-t border-fg-subtle/15">
              {wordCount} words · {readingMinutes} min read
            </p>
          </div>

          {/* SEO panel */}
          <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg p-4">
            <button
              onClick={() => setSeoOpen(!seoOpen)}
              className="flex items-center justify-between w-full text-sm font-medium text-fg-primary cursor-pointer"
            >
              SEO & social
              <ChevronDown size={15} className={`transition-transform duration-150 ${seoOpen ? "rotate-180" : ""}`} />
            </button>
            {seoOpen && (
              <div className="space-y-3 mt-3">
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
                    rows={2}
                    placeholder={excerpt}
                    className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg-muted mb-1">OG image URL</label>
                  <input
                    value={ogImageUrl}
                    onChange={(e) => setOgImageUrl(e.target.value)}
                    placeholder={coverUrl}
                    className="w-full text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
                  />
                </div>

                <div className="rounded-md border border-fg-subtle/20 overflow-hidden">
                  {(ogImageUrl || coverUrl) && (
                    <img src={ogImageUrl || coverUrl} alt="" className="w-full h-28 object-cover" />
                  )}
                  <div className="p-2.5 bg-bg-base">
                    <p className="text-xs text-fg-primary font-medium truncate">{seoTitle || title || "Untitled"}</p>
                    <p className="text-[11px] text-fg-subtle line-clamp-2 mt-0.5">{seoDescription || excerpt}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
