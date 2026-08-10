import { useContext, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { copy } from "../config/tokens";
import { supabase } from "../config/supabase";
import { AuthContext } from "../contexts/AuthContext";
import { blog, type BlogPost as BlogPostType } from "../lib/blogApi";
import { useDocumentMeta } from "../hooks/useDocumentMeta";
import "../styles/blog-content.css";

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code",
    "strong", "em", "u", "s", "a", "img", "figure", "figcaption", "hr", "br",
    "iframe", "div", "span", "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "class", "allow", "allowfullscreen", "frameborder"],
};

interface RelatedPost {
  slug: string;
  title: string;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get("preview") === "1";
  const { platformRole } = useContext(AuthContext);

  const [post, setPost] = useState<BlogPostType | null | undefined>(undefined);
  const [related, setRelated] = useState<RelatedPost[]>([]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    async function load() {
      if (isPreview && platformRole) {
        try {
          const { post: p } = await blog.get({ slug });
          if (!cancelled) setPost(p);
          return;
        } catch {
          // fall through to public read
        }
      }
      const { data, error } = await supabase
        .from("sybil_blog_posts")
        .select(
          "id, slug, title, excerpt, cover_url, content_html, status, author_name, author_user_id, tags, reading_minutes, seo_title, seo_description, og_image_url, published_at, updated_at, created_at",
        )
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setPost(null);
        return;
      }
      setPost(data as unknown as BlogPostType);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, isPreview, platformRole]);

  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    supabase
      .from("sybil_blog_posts")
      .select("slug, title")
      .eq("status", "published")
      .neq("slug", post.slug)
      .order("published_at", { ascending: false })
      .limit(2)
      .then(({ data }) => {
        if (!cancelled) setRelated((data as RelatedPost[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [post]);

  useDocumentMeta({
    title: post ? `${post.seo_title || post.title} · ${copy.appName}` : `Blog · ${copy.appName}`,
    description: post?.seo_description || post?.excerpt || undefined,
    ogImage: post?.og_image_url || post?.cover_url || undefined,
    ogType: "article",
    canonical: post ? `${window.location.origin}/blog/${post.slug}` : undefined,
    jsonLd: post
      ? {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt ?? undefined,
          image: post.og_image_url || post.cover_url || undefined,
          author: { "@type": "Person", name: post.author_name ?? "Sybil" },
          datePublished: post.published_at ?? undefined,
          dateModified: post.updated_at,
        }
      : undefined,
  });

  if (post === undefined) {
    return <div className="w-full min-h-screen bg-bg-base" />;
  }

  if (post === null) {
    return (
      <div className="w-full min-h-screen bg-bg-base flex flex-col items-center justify-center px-6 text-center gap-5">
        <h1 className="text-2xl font-semibold text-fg-primary">Article not found</h1>
        <p className="text-fg-muted">This post doesn&apos;t exist, or moved.</p>
        <Link
          to="/blog"
          className="inline-flex items-center px-6 py-3 rounded-lg border border-fg-accent text-fg-accent font-medium text-sm hover:bg-fg-accent/10 transition-colors duration-150"
        >
          ← Back to blog
        </Link>
      </div>
    );
  }

  const cleanHtml = DOMPurify.sanitize(post.content_html, SANITIZE_CONFIG);

  return (
    <div className="w-full min-h-screen bg-bg-base">
      {isPreview && post.status !== "published" && (
        <div className="bg-fg-accent/10 border-b border-fg-accent/30 text-fg-accent text-sm text-center py-2">
          Preview — this post is not published yet
        </div>
      )}
      <div className="max-w-[980px] mx-auto px-6 md:px-8">
        <Link to="/" className="flex items-center gap-2 sm:gap-3 py-6 sm:py-8 border-b border-fg-subtle/15">
          <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 sm:h-7 w-auto shrink-0" />
          <span className="font-bold text-lg sm:text-xl tracking-[-0.01em] text-fg-primary">{copy.appName}</span>
        </Link>

        <nav className="flex items-center gap-3 text-sm text-fg-muted py-6 min-w-0">
          <Link to="/" className="shrink-0 text-fg-accent hover:text-[#ff5c40] transition-colors duration-150">
            Home
          </Link>
          <span className="shrink-0">/</span>
          <Link to="/blog" className="shrink-0 text-fg-accent hover:text-[#ff5c40] transition-colors duration-150">
            Blog
          </Link>
          <span className="shrink-0">/</span>
          <span className="text-fg-subtle truncate min-w-0">{post.title}</span>
        </nav>

        <header className="pb-8 mb-12 border-b border-fg-subtle/15">
          <h1 className="font-semibold text-[clamp(28px,3.6vw,40px)] leading-[1.3] tracking-[-0.015em] mb-6 text-fg-primary max-w-[70ch]">
            {post.title}
          </h1>
          <div className="flex items-center gap-5 flex-wrap text-sm text-fg-muted">
            {post.tags[0] && (
              <span className="px-3 py-1 rounded-full text-xs font-medium border border-fg-accent/40 text-fg-accent">
                {post.tags[0]}
              </span>
            )}
            <span>{post.author_name ?? "Sybil"}</span>
            {post.published_at && <span>{formatDate(post.published_at)}</span>}
            {post.reading_minutes && <span>{post.reading_minutes} min read</span>}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-14 pb-24">
          <article>
            {post.cover_url && (
              <img
                src={post.cover_url}
                alt=""
                className="w-full rounded-xl mb-10 max-h-[420px] object-cover"
              />
            )}
            <div className="blog-content" dangerouslySetInnerHTML={{ __html: cleanHtml }} />

            <div className="flex gap-6 p-8 rounded-xl border border-fg-accent/20 bg-fg-accent/[0.05] mt-16">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-lg"
                style={{
                  background: "color-mix(in srgb, var(--color-fg-accent) 20%, transparent)",
                  color: "var(--color-fg-accent)",
                }}
              >
                {initials(post.author_name ?? "Sybil")}
              </div>
              <div>
                <h4 className="font-semibold text-fg-primary mb-1">{post.author_name ?? "Sybil"}</h4>
                <p className="text-sm text-fg-muted leading-[1.6]">Contributor at Sybil.</p>
              </div>
            </div>

            {related.length > 0 && (
              <div className="mt-16">
                <h4 className="font-semibold text-fg-primary mb-5">More from the blog</h4>
                <div className="flex flex-col gap-3">
                  {related.map((r) => (
                    <Link
                      key={r.slug}
                      to={`/blog/${r.slug}`}
                      className="text-fg-accent hover:text-[#ff5c40] transition-colors duration-150 text-sm"
                    >
                      {r.title} →
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>

          <aside>
            <div className="rounded-xl border border-fg-accent/20 bg-fg-accent/[0.05] p-7 sticky top-8">
              <h3 className="font-semibold text-lg mb-3 text-fg-primary">Try Sybil free</h3>
              <p className="text-sm text-fg-muted leading-[1.6] mb-6">
                Create your first dormant task and discover how Sybil changes the way you work.
              </p>
              <Link
                to="/register"
                className="block w-full text-center py-3.5 rounded-lg bg-fg-accent text-bg-base font-semibold text-sm hover:bg-[#ff5c40] transition-colors duration-150"
              >
                Get started →
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
