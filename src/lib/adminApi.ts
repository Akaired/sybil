// ============================================================
// Sybil Admin Panel API Client
// Single entry point for every /admin/* screen — POSTs {action, ...payload}
// to the admin-api edge function, which resolves the caller's platform role
// server-side (staff/superadmin) and never trusts a role sent from here.
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

export interface AdminApiError {
  error: string;
  status: number;
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

/**
 * Calls admin-api with { action, ...payload }. Never pass a `role` /
 * `platform_role` / `level` / `is_superadmin` key in payload — the server
 * rejects the whole request (400) if it sees one, since the level is always
 * resolved from the caller's JWT, never from the client.
 */
export async function adminApi<T = unknown>(
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/admin-api`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ action, ...payload }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: AdminApiError = {
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

export function isAdminApiError(err: unknown): err is AdminApiError {
  return typeof err === "object" && err !== null && "error" in err && "status" in err;
}

export function adminApiErrorMessage(err: unknown, fallback = "Something went wrong."): string {
  return isAdminApiError(err) ? err.error : fallback;
}
