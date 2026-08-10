// ============================================================
// Sybil Docs Admin API Client
// Single entry point for /admin/docs — POSTs {action, ...payload} to the
// docs-admin edge function, which resolves the caller's platform role
// server-side (staff/superadmin), exactly like adminApi.ts / blogApi.ts.
// Public doc reads (/docs, /docs/:slug) do NOT go through this — they
// query sybil_docs_pages directly with the anon key, relying on RLS.
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

export interface DocsApiError {
  error: string;
  status: number;
}

export type DocsPageStatus = "draft" | "published" | "archived";

// Categories are a managed table (sybil_docs_categories), not a hardcoded
// list — a page's `category` is just the slug of a row in it. Public reads
// of the category list go straight through PostgREST (RLS-open, see
// docs_categories_public_read); admin CRUD goes through docs-admin below.
export type DocsCategory = string;

export interface DocsCategoryRow {
  id: string;
  slug: string;
  label: string;
  order_index: number;
}

export interface DocsPageSummary {
  id: string;
  slug: string;
  category: DocsCategory;
  title: string;
  summary: string | null;
  status: DocsPageStatus;
  order_index: number;
  author_name: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface DocsPage extends DocsPageSummary {
  content_md: string;
  author_user_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
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

async function docsApiCall<T = unknown>(
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/docs-admin`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ action, ...payload }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: DocsApiError = {
      error:
        res.status === 403
          ? "You don't have permission for this action."
          : (body?.error ?? res.statusText),
      status: res.status,
    };
    throw err;
  }
  return body as T;
}

export function isDocsApiError(err: unknown): err is DocsApiError {
  return typeof err === "object" && err !== null && "error" in err && "status" in err;
}

export function docsApiErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  return isDocsApiError(err) ? err.error : fallback;
}

export const docs = {
  list: (params?: { category?: DocsCategory; status?: DocsPageStatus; q?: string }) =>
    docsApiCall<{ pages: DocsPageSummary[] }>("list", params),

  get: (params: { id?: string; slug?: string }) => docsApiCall<{ page: DocsPage }>("get", params),

  slugCheck: (params: { slug: string; exclude_id?: string }) =>
    docsApiCall<{ available: boolean; suggestion: string }>("slug_check", params),

  create: (params: { title: string; slug?: string; category: DocsCategory; content_md?: string }) =>
    docsApiCall<{ ok: boolean; page: DocsPage }>("create", params),

  update: (
    params: { id: string } & Partial<
      Pick<DocsPage, "title" | "slug" | "summary" | "content_md" | "category" | "order_index" | "seo_title" | "seo_description">
    >,
  ) => docsApiCall<{ ok: boolean; page: DocsPage }>("update", params),

  publish: (params: { id: string }) => docsApiCall<{ ok: boolean; page: DocsPage }>("publish", params),

  unpublish: (params: { id: string }) => docsApiCall<{ ok: boolean; page: DocsPage }>("unpublish", params),

  reorder: (params: { items: Array<{ id: string; order_index: number }> }) =>
    docsApiCall<{ ok: boolean }>("reorder", params),

  remove: (params: { id: string }) => docsApiCall<{ ok: boolean }>("delete", params),

  categoryList: () => docsApiCall<{ categories: DocsCategoryRow[] }>("category_list"),

  categoryCreate: (params: { label: string; slug?: string; order_index?: number }) =>
    docsApiCall<{ ok: boolean; category: DocsCategoryRow }>("category_create", params),

  categoryUpdate: (params: { id: string; label?: string; slug?: string; order_index?: number }) =>
    docsApiCall<{ ok: boolean; category: DocsCategoryRow }>("category_update", params),

  categoryReorder: (params: { items: Array<{ id: string; order_index: number }> }) =>
    docsApiCall<{ ok: boolean }>("category_reorder", params),

  categoryRemove: (params: { id: string }) => docsApiCall<{ ok: boolean }>("category_delete", params),
};
