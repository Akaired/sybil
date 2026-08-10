import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../config/tokens";
import { supabase } from "../config/supabase";
import { useDocumentMeta } from "../hooks/useDocumentMeta";
import { AuthContext } from "../contexts/AuthContext";
import PublicUserMenu from "../components/PublicUserMenu";
import PublicNavLinks from "../components/PublicNavLinks";
import PublicLegalLinks from "../components/PublicLegalLinks";
import { useIubendaScript } from "../hooks/useIubendaScript";

interface PublicPost {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  tags: string[];
  author_name: string | null;
  published_at: string;
  reading_minutes: number | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function Thumb({ post }: { post: PublicPost }) {
  if (post.cover_url) {
    return (
      <div className="h-44 rounded-t-xl overflow-hidden">
        <img src={post.cover_url} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className="h-44 rounded-t-xl bg-gradient-to-br from-bg-surface to-bg-elevated" />
  );
}

function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl border border-fg-subtle/20 bg-bg-elevated/30 overflow-hidden animate-pulse">
      <div className="h-44 bg-bg-surface" />
      <div className="p-6 flex flex-col gap-3">
        <div className="h-3 w-16 bg-bg-surface rounded" />
        <div className="h-4 w-full bg-bg-surface rounded" />
        <div className="h-4 w-3/4 bg-bg-surface rounded" />
        <div className="h-3 w-full bg-bg-surface rounded mt-2" />
      </div>
    </div>
  );
}

export default function Blog() {
  const { session, loading: authLoading } = useContext(AuthContext);
  const [posts, setPosts] = useState<PublicPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useIubendaScript();

  useDocumentMeta({
    title: `Blog · ${copy.appName}`,
    description: "Articles on sentinels, dormant tasks, and how conditional work changes everything.",
    canonical: `${window.location.origin}/blog`,
  });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("sybil_blog_posts")
      .select("slug, title, excerpt, cover_url, tags, author_name, published_at, reading_minutes")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        setPosts((data as PublicPost[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featured = posts && posts.length > 0 ? posts[0] : null;
  const rest = posts && posts.length > 0 ? posts.slice(1) : [];

  return (
    <div className="w-full min-h-screen bg-bg-base">
      {/* Nav */}
      <nav className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-16 py-5 sm:py-7 max-w-[1440px] mx-auto">
        <div className="flex items-center gap-6 lg:gap-10 min-w-0">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
            <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 sm:h-7 w-auto shrink-0" />
            <span className="font-bold text-lg sm:text-xl tracking-[-0.01em] text-fg-primary truncate">
              {copy.appName}
            </span>
          </Link>
          <PublicNavLinks />
        </div>
        <div className="flex items-center gap-3 sm:gap-5 md:gap-8 shrink-0">
          {authLoading ? null : session ? (
            <PublicUserMenu />
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm sm:text-[15px] font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 whitespace-nowrap"
              >
                {copy.pages.landing.login}
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center px-3.5 py-2 sm:px-5 sm:py-2.5 border border-fg-accent rounded-lg text-fg-accent font-semibold text-xs sm:text-sm whitespace-nowrap hover:bg-fg-accent/10 transition-colors duration-150"
              >
                {copy.pages.landing.cta}
              </Link>
            </>
          )}
        </div>
      </nav>

      <main className="max-w-[1440px] mx-auto px-6 md:px-16 pt-6 pb-28">
        {/* Header */}
        <header className="pt-10 pb-14">
          <h1 className="font-semibold text-[clamp(32px,4.2vw,48px)] leading-[1.1] tracking-[-0.015em] mb-5 text-fg-primary">
            The Pulse of Sybil
          </h1>
          <p className="text-[16px] leading-[1.7] text-fg-muted max-w-[680px]">
            Discover how Sybil transforms the way you work. Dormant tasks, intelligent
            sentinels, and the right moment to act.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-14">
          <div>
            {error && (
              <p className="text-sm text-fg-accent mb-8">Couldn&apos;t load articles: {error}</p>
            )}

            {posts === null && !error && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            )}

            {posts !== null && posts.length === 0 && (
              <div className="rounded-xl border border-fg-subtle/20 bg-bg-elevated/30 p-14 text-center">
                <p className="text-fg-muted">No articles published yet — check back soon.</p>
              </div>
            )}

            {/* Featured article */}
            {featured && (
              <Link
                to={`/blog/${featured.slug}`}
                className="group grid grid-cols-1 md:grid-cols-2 gap-10 mb-16 p-8 md:p-10 rounded-xl border border-fg-subtle/20 bg-bg-elevated/40 transition-all duration-200 hover:border-fg-accent/60 hover:-translate-y-0.5"
              >
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-bg-surface to-bg-elevated min-h-[220px]">
                  {featured.cover_url && (
                    <img src={featured.cover_url} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex flex-col justify-center">
                  <h2 className="font-semibold text-2xl md:text-[28px] leading-[1.3] mb-4 text-fg-primary group-hover:text-fg-accent transition-colors duration-150">
                    {featured.title}
                  </h2>
                  <div className="flex items-center gap-4 mb-5 flex-wrap">
                    {featured.tags[0] && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium border border-fg-accent/40 text-fg-accent">
                        {featured.tags[0]}
                      </span>
                    )}
                    {featured.reading_minutes && (
                      <span className="text-sm text-fg-muted">{featured.reading_minutes} min read</span>
                    )}
                  </div>
                  <p className="text-[15px] leading-[1.7] text-fg-muted mb-7">{featured.excerpt}</p>
                  <span className="inline-flex items-center gap-2 w-fit px-6 py-3 rounded-lg border border-fg-accent text-fg-accent font-medium text-sm transition-colors duration-150 group-hover:bg-fg-accent/10">
                    Read the article
                    <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                  </span>
                </div>
              </Link>
            )}

            {/* Articles grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              {rest.map((post) => (
                <Link
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="group flex flex-col rounded-xl border border-fg-subtle/20 bg-bg-elevated/30 overflow-hidden transition-all duration-200 hover:border-fg-accent/50 hover:-translate-y-1"
                >
                  <Thumb post={post} />
                  <div className="p-6 flex flex-col flex-1">
                    {post.tags[0] && (
                      <div className="mb-3">
                        <span className="px-3 py-1 rounded-full text-xs font-medium border border-fg-accent/40 text-fg-accent">
                          {post.tags[0]}
                        </span>
                      </div>
                    )}
                    <h3 className="font-semibold text-[17px] leading-[1.4] mb-3 text-fg-primary flex-1 group-hover:text-fg-accent transition-colors duration-150">
                      {post.title}
                    </h3>
                    <p className="text-sm leading-[1.6] text-fg-muted mb-5">{post.excerpt}</p>
                    <div className="flex items-center justify-between text-xs text-fg-subtle pt-4 border-t border-fg-subtle/15">
                      <span>{post.author_name ?? "Sybil"}</span>
                      <span>
                        {formatDate(post.published_at)}
                        {post.reading_minutes ? ` · ${post.reading_minutes} min read` : ""}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside>
            <div className="rounded-xl border border-fg-accent/20 bg-fg-accent/[0.05] p-7 sticky top-8">
              <h3 className="font-semibold text-lg mb-3 text-fg-primary">Get the Weekly Pulse</h3>
              <p className="text-sm text-fg-muted leading-[1.6] mb-6">
                Articles on sentinels, dormant tasks, and how conditional work changes
                everything.
              </p>
              <input
                type="email"
                placeholder="Your email"
                className="w-full px-4 py-3.5 rounded-lg bg-bg-base border border-fg-subtle/20 text-fg-primary text-sm placeholder:text-fg-subtle mb-4 focus:outline-none focus:border-fg-accent focus:ring-2 focus:ring-fg-accent/10 transition-colors duration-150"
              />
              <button
                type="button"
                className="w-full py-3.5 rounded-lg bg-fg-accent text-bg-base font-semibold text-sm hover:bg-[#ff5c40] transition-colors duration-150 cursor-pointer"
              >
                Subscribe
              </button>
              <p className="text-xs text-fg-subtle text-center mt-4">No spam, just the best.</p>
            </div>
          </aside>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-[1440px] mx-auto px-6 md:px-16 pt-12 pb-16 border-t border-fg-subtle/20 flex flex-col gap-8">
        <div className="flex gap-10 flex-wrap justify-center">
          <a
            href="https://sybilagent.statuspage.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
          >
            Status
          </a>
          <Link to="/pricing" className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150">
            Pricing
          </Link>
          <Link to="/roadmap" className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150">
            Roadmap
          </Link>
          <Link to="/blog" className="text-sm text-fg-primary transition-colors duration-150">
            Blog
          </Link>
          <PublicLegalLinks />
        </div>
        <div className="flex items-center justify-center gap-3">
          <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 w-auto opacity-60" />
          <span className="font-bold text-[15px] tracking-[0.02em] text-[#5A6167]">{copy.appName}</span>
        </div>
      </footer>
    </div>
  );
}
