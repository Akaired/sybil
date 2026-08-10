// ============================================================
// Sybil Account — account-manage edge function client
// (deactivate / reactivate / pre_delete_check / delete —
// purge_expired is service-role-only, no client caller)
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

/** Thrown by account-manage calls on a non-2xx response. */
export class AccountManageError extends Error {}

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

async function callAccountManage<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/account-manage`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const message: string = body?.error ?? body?.message ?? res.statusText;
    throw new AccountManageError(message);
  }
  return body as T;
}

export async function deactivateAccount(): Promise<{ status: "deactivated" }> {
  return callAccountManage({ action: "deactivate" });
}

export async function reactivateAccount(): Promise<{ status: "active" }> {
  return callAccountManage({ action: "reactivate" });
}

// ── Account deletion ────────────────────────────────────────
// Contract confirmed by reading the deployed account-manage source
// (2026-08-09) — not guessed.

export interface DeleteCandidateMember {
  user_id: string;
  /** Falls back to email server-side when the member has no display_name. */
  display_name: string;
  email: string;
  role: string;
}

/** A workspace where the current user is the sole owner-role member. */
export interface WorkspaceRequiringChoice {
  workspace_id: string;
  workspace_name: string;
  members: DeleteCandidateMember[];
}

export interface PreDeleteCheckResponse {
  requires_choice: WorkspaceRequiringChoice[];
}

export type DeleteChoice =
  | { workspace_id: string; mode: "transfer"; new_owner_user_id: string }
  | { workspace_id: string; mode: "delete" };

export async function preDeleteCheck(): Promise<PreDeleteCheckResponse> {
  return callAccountManage({ action: "pre_delete_check" });
}

export async function deleteAccount(choices: DeleteChoice[]): Promise<{ status: "deleted" }> {
  return callAccountManage({ action: "delete", choices });
}
