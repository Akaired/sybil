// ============================================================
// Sybil Edge Function API Client
// Handles ingest → interpret → resolve flow.
// No hardcoded values — reads from supabase config.
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

// ── Types ────────────────────────────────────────────────────

export interface IngestResponse {
  signal_id: string;
  conversation_id: string | null;
  status: "ingested";
  next_step: string;
}

export interface Interpretation {
  action:
    | "create_task"
    | "update_task"
    | "delete_task"
    | "create_sentinel"
    | "delete_sentinel"
    | "reply"
    | "calendar_event"
    | "create_calendar_event"
    | "read_calendar"
    | "send_email"
    | "read_emails"
    | "delete_email"
    | "no_action";
  reply_text?: string;
  title?: string;
  description?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface InterpretResponse {
  signal_id: string;
  interpretation: Interpretation;
  llm_provider: string;
  next_step: string;
}

export interface ResolutionDetail {
  reply_text?: string;
  task_id?: string;
  task_title?: string;
  sentinel_id?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ResolveResponse {
  signal_id: string;
  resolution_id: string;
  action: Interpretation["action"];
  outcome: "success" | "partial" | "error";
  detail: ResolutionDetail;
}

export interface SybilError {
  error: string;
  status: number;
}

// ── Helpers ──────────────────────────────────────────────────

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

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err: SybilError = {
      error: body?.error ?? body?.message ?? res.statusText,
      status: res.status,
    };
    throw err;
  }
  return body as T;
}

// ── Public API ───────────────────────────────────────────────

export async function ingestSignal(
  content: string,
  origin: string = "chat",
  metadata?: Record<string, unknown>,
  transcript?: string | null,
  conversation_id?: string | null,
): Promise<IngestResponse> {
  const res = await fetch(`${EDGE_BASE}/ingest`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({
      content,
      origin,
      metadata: metadata ?? {},
      transcript: transcript ?? null,
      conversation_id: conversation_id ?? null,
    }),
  });
  return handleResponse<IngestResponse>(res);
}

export async function interpretSignal(
  signal_id: string,
): Promise<InterpretResponse> {
  const res = await fetch(`${EDGE_BASE}/interpret`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ signal_id }),
  });
  return handleResponse<InterpretResponse>(res);
}

export async function resolveSignal(
  signal_id: string,
  interpretation: Interpretation,
): Promise<ResolveResponse> {
  const res = await fetch(`${EDGE_BASE}/resolve`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ signal_id, interpretation }),
  });
  return handleResponse<ResolveResponse>(res);
}

/**
 * Full pipeline: ingest → interpret → resolve.
 * Returns the final resolution; throws on any step failure.
 */
export async function processMessage(
  content: string,
  conversation_id?: string | null,
  origin: string = "chat",
  transcript?: string | null,
  metadata?: Record<string, unknown>,
): Promise<ResolveResponse & { conversation_id: string | null; llm_provider: string }> {
  // Step 1 — Ingest
  const { signal_id, conversation_id: resolvedConversationId } = await ingestSignal(
    content,
    origin,
    metadata,
    transcript,
    conversation_id,
  );

  // Step 2 — Interpret
  const { interpretation, llm_provider } = await interpretSignal(signal_id);

  // Step 3 — Resolve
  const resolution = await resolveSignal(signal_id, interpretation);
  return { ...resolution, conversation_id: resolvedConversationId, llm_provider };
}

// ── Chat message actions (edit / retry / feedback) ──────────────
// sybil_signals/sybil_resolutions have no client-writable RLS policy, so
// these go through the chat-message edge function rather than a direct
// Supabase call.

async function chatMessageAction(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${EDGE_BASE}/chat-message`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  await handleResponse<{ success: true }>(res);
}

/** Deletes the signal's existing reply so it can be regenerated (caller re-runs interpret+resolve). */
export async function retryResolution(signalId: string): Promise<void> {
  await chatMessageAction({ action: "retry", signal_id: signalId });
}

/** Updates a message's text and clears its existing reply (caller re-runs interpret+resolve). */
export async function editSignal(signalId: string, rawContent: string): Promise<void> {
  await chatMessageAction({ action: "edit", signal_id: signalId, raw_content: rawContent });
}

/** Recorded only — nothing currently reads this feedback. */
export async function setResolutionFeedback(
  resolutionId: string,
  feedback: "up" | "down" | null,
): Promise<void> {
  await chatMessageAction({ action: "set_feedback", resolution_id: resolutionId, feedback });
}

// ── Conversations ────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export async function listConversations(): Promise<ConversationRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // RLS also allows selecting conversations shared with this user (see
  // listSharedConversations) — filter explicitly so this only ever
  // returns chats the caller actually owns.
  const { data, error } = await supabase
    .from("sybil_conversations")
    .select("id, title, created_at, updated_at")
    .eq("author_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase
    .from("sybil_conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("sybil_conversations").delete().eq("id", id);
  if (error) throw error;
}

// ── Chat sharing ─────────────────────────────────────────────

export interface ChatShareResponse {
  success: true;
  share_id: string;
  shared_with_user_id: string;
  mode: "all" | "specific";
  chat_ids: string[] | null;
  access: "reader" | "writer";
  downgraded: boolean;
}

/** Thrown by shareChat on a non-2xx response. */
export class ChatShareError extends Error {}

export async function shareChat(params: {
  workspace_id: string;
  shared_with_user_id: string;
  mode: "all" | "specific";
  chat_ids?: string[];
  access: "reader" | "writer";
}): Promise<ChatShareResponse> {
  const res = await fetch(`${EDGE_BASE}/chat-share`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(params),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ChatShareError(body?.error ?? body?.message ?? res.statusText);
  }
  return body as ChatShareResponse;
}

export interface SharedConversationRow extends ConversationRow {
  ownerUserId: string;
  ownerEmail: string;
  access: "reader" | "writer";
}

/** Conversations someone else in the workspace has shared with the caller. */
export async function listSharedConversations(): Promise<SharedConversationRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: shares, error: sharesError } = await supabase
    .from("chat_shares")
    .select("owner_user_id, owner_team_email, mode, chat_ids, access")
    .eq("shared_with_user_id", user.id);
  if (sharesError) throw sharesError;
  if (!shares || shares.length === 0) return [];

  const rows: SharedConversationRow[] = [];
  for (const share of shares) {
    let query = supabase
      .from("sybil_conversations")
      .select("id, title, created_at, updated_at")
      .eq("author_id", share.owner_user_id);
    if (share.mode === "specific") {
      query = query.in("id", share.chat_ids ?? []);
    }
    const { data: conversations, error } = await query;
    if (error) throw error;
    for (const c of conversations ?? []) {
      rows.push({
        ...c,
        ownerUserId: share.owner_user_id,
        ownerEmail: share.owner_team_email,
        access: share.access as "reader" | "writer",
      });
    }
  }
  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return rows;
}

/**
 * Mints a short-lived Speechmatics JWT via the speechmatics-token edge
 * function, so the long-lived Speechmatics API key never reaches the browser.
 */
export async function fetchSpeechmaticsToken(
  mode: "dictation" | "call" = "dictation",
): Promise<{ key_value: string }> {
  const res = await fetch(`${EDGE_BASE}/speechmatics-token`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ mode }),
  });
  return handleResponse<{ key_value: string }>(res);
}

/**
 * Requests spoken audio for the given text via the speechmatics-tts edge
 * function. Returns the raw WAV blob — this endpoint streams binary audio,
 * not JSON, so it doesn't go through handleResponse().
 */
export async function fetchSpeechmaticsTTS(text: string, voice?: string): Promise<Blob> {
  const res = await fetch(`${EDGE_BASE}/speechmatics-tts`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    let error = res.statusText;
    try {
      const body = await res.json();
      error = body?.error ?? body?.message ?? error;
    } catch {
      // Non-JSON error body — fall back to statusText.
    }
    throw { error, status: res.status } as SybilError;
  }
  return res.blob();
}
