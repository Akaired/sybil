// ============================================================
// Sybil Workspace onboarding — workspace-onboarding edge function client
// Entry point for a user with zero (or an additional) workspace: create a
// new one, or join an existing one via a pending email invite or a
// shareable join link/code.
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

export interface PendingInvite {
  id: string;
  role: string;
  expires_at: string;
  workspace_id: string;
  workspace_name: string;
}

export class WorkspaceOnboardingError extends Error {}

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

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/workspace-onboarding`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new WorkspaceOnboardingError(data?.error ?? res.statusText);
  }
  return data as T;
}

export function createWorkspace(name: string): Promise<{ workspace: { id: string; name: string } }> {
  return call("create", { name });
}

export function listMyInvites(): Promise<{ invites: PendingInvite[] }> {
  return call("list_my_invites");
}

export function joinByInvite(inviteId: string): Promise<{ workspace_id: string; role: string }> {
  return call("join_by_invite", { invite_id: inviteId });
}

export function joinByCode(code: string): Promise<{ workspace_id: string; role: string }> {
  return call("join_by_code", { code });
}

export function previewJoinLink(code: string): Promise<{ workspace_name: string; member_count: number }> {
  return call("preview_link", { code });
}
