// ============================================================
// Sybil Blog Admin API Client
// Single entry point for /admin/blog — POSTs {action, ...payload} to the
// blog-admin edge function, which resolves the caller's platform role
// server-side (staff/superadmin), exactly like adminApi.ts.
// Public blog reads (/blog, /blog/:slug) do NOT go through this — they
// query sybil_blog_posts directly with the anon key, relying on RLS.
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

export interface BlogApiError {
  error: string;
  status: number;
  missing?: string[];
}

export type BlogPostStatus = "draft" | "published" | "archived";

export interface BlogPostSummary {
  id: string;
  slug: string;
  title: string;
  status: BlogPostStatus;
  author_name: string | null;
  tags: string[];
  updated_at: string;
  published_at: string | null;
}

export interface BlogPost extends BlogPostSummary {
  excerpt: string | null;
  cover_url: string | null;
  content_json: Record<string, unknown>;
  content_html: string;
  author_user_id: string | null;
  reading_minutes: number | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  created_at: string;
}

async function getHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  return {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
}

async function blogApi<T = unknown>(
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/blog-admin`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ action, ...payload }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: BlogApiError = {
      error:
        res.status === 403
          ? "You don't have permission for this action."
          : (body?.error ?? res.statusText),
      status: res.status,
      missing: body?.missing,
    };
    throw err;
  }
  return body as T;
}

export function isBlogApiError(err: unknown): err is BlogApiError {
  return typeof err === "object" && err !== null && "error" in err && "status" in err;
}

export function blogApiErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  return isBlogApiError(err) ? err.error : fallback;
}

export const blog = {
  list: (params?: { status?: BlogPostStatus; q?: string; limit?: number; offset?: number }) =>
    blogApi<{ posts: BlogPostSummary[]; total: number }>("list", params),

  get: (params: { id?: string; slug?: string }) => blogApi<{ post: BlogPost }>("get", params),

  slugCheck: (params: { slug: string; exclude_id?: string }) =>
    blogApi<{ available: boolean; suggestion: string }>("slug_check", params),

  create: (params: {
    title: string;
    slug?: string;
    content_json?: Record<string, unknown>;
    content_html?: string;
    excerpt?: string;
    tags?: string[];
  }) => blogApi<{ ok: boolean; post: BlogPost }>("create", params),

  update: (
    params: { id: string } & Partial<
      Pick<
        BlogPost,
        | "title"
        | "slug"
        | "excerpt"
        | "cover_url"
        | "content_json"
        | "content_html"
        | "tags"
        | "seo_title"
        | "seo_description"
        | "og_image_url"
        | "reading_minutes"
      >
    >,
  ) => blogApi<{ ok: boolean; post: BlogPost }>("update", params),

  publish: (params: { id: string }) => blogApi<{ ok: boolean; post: BlogPost }>("publish", params),

  unpublish: (params: { id: string }) => blogApi<{ ok: boolean; post: BlogPost }>("unpublish", params),

  remove: (params: { id: string }) => blogApi<{ ok: boolean }>("delete", params),

  uploadMedia: (params: {
    post_id: string;
    filename: string;
    content_type: string;
    data_base64: string;
  }) => blogApi<{ ok: boolean; url: string }>("upload_media", params),
};
