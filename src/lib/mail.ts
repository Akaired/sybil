// ============================================================
// Sybil Mail — Gmail edge function client (gmail-actions)
// Reuses the shared Google connection helpers from calendar.ts —
// both calendar and mail ride the same `google` oauth connection.
// ============================================================

import { supabase } from "../config/supabase";

export {
  fetchOauthStatus,
  isGoogleConnected,
  startGoogleOauth,
  type OauthStatusResponse,
} from "./calendar";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

// ── Types ────────────────────────────────────────────────────

export interface GmailHeaders {
  Subject?: string;
  From?: string;
  To?: string;
  Date?: string;
  [key: string]: string | undefined;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  // gmail-actions falls back to just {id, threadId, error} when a
  // per-message metadata fetch fails, so these are never guaranteed.
  snippet?: string;
  headers?: GmailHeaders;
  labelIds?: string[];
  internalDate?: string;
  error?: string;
}

export interface GmailMessageDetail {
  message_id: string;
  thread_id: string;
  label_ids: string[];
  snippet: string;
  headers: GmailHeaders;
  internal_date: string;
  body: string;
}

export interface GmailListResponse {
  action: string;
  messages: GmailMessageSummary[];
  count: number;
  next_page_token: string | null;
  result_size_estimate: number;
}

/** Thrown by mail functions on a non-2xx response. */
export class GmailActionsError extends Error {
  /** True when the edge function reported Google isn't connected (vs. some other failure). */
  notConnected: boolean;

  constructor(message: string, notConnected: boolean) {
    super(message);
    this.notConnected = notConnected;
  }
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

async function callGmailActions<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/gmail-actions`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const message: string = body?.error ?? body?.message ?? res.statusText;
    // gmail-actions returns 403 both when Google isn't connected and when
    // gmail_enabled is toggled off — status alone can't distinguish them, so
    // match on message like calendar.ts does, rather than bucketing every
    // 403 (including "disabled" ones) as notConnected and hiding the real
    // error behind a generic "not connected" empty state.
    const notConnected = /not connected/i.test(message);
    throw new GmailActionsError(message, notConnected);
  }
  return body as T;
}

// ── Public API ───────────────────────────────────────────────

export async function listEmails(params: {
  query?: string | null;
  max_results?: number;
  label_ids?: string[];
  page_token?: string | null;
} = {}): Promise<GmailListResponse> {
  return callGmailActions<GmailListResponse>({ action: "list", ...params });
}

export async function readEmail(messageId: string): Promise<GmailMessageDetail> {
  return callGmailActions<GmailMessageDetail>({ action: "read", message_id: messageId });
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  html?: boolean;
}

export async function sendEmail(
  params: SendEmailParams,
): Promise<{ message_id: string; thread_id: string; status: string }> {
  return callGmailActions({ action: "send", ...params });
}

export async function deleteEmail(messageId: string): Promise<{ message_id: string; status: string }> {
  return callGmailActions({ action: "delete", message_id: messageId });
}

/**
 * Gmail message ids of emails Sybil itself sent — via the chat "send_email"
 * intent (sybil_activity_logs entity_type=email, actor=agent) or a
 * triggered sentinel's email action (entity_type=sentinel, action=action_sent).
 * Both log the Gmail message id inside `payload.message_id` (entity_id can't
 * hold it — it's a uuid column and Gmail ids aren't UUIDs).
 */
export async function listSybilSentMessageIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("sybil_activity_logs")
    .select("entity_type, action, actor, payload")
    .in("entity_type", ["email", "sentinel"])
    .order("created_at", { ascending: false })
    .limit(300);

  const ids = new Set<string>();
  if (error || !data) return ids;

  for (const row of data as { entity_type: string; action: string; actor: string; payload: Record<string, unknown> }[]) {
    const messageId = row.payload?.message_id;
    if (typeof messageId !== "string") continue;
    if (row.entity_type === "email" && row.actor === "agent") ids.add(messageId);
    if (row.entity_type === "sentinel" && row.action === "action_sent" && row.payload?.type === "send_email") {
      ids.add(messageId);
    }
  }
  return ids;
}

/** True if the message is unread (has the Gmail UNREAD label). */
export function isUnread(msg: GmailMessageSummary): boolean {
  return msg.labelIds?.includes("UNREAD") ?? false;
}

/** Best-effort display name from a "Name <email@x.com>" header value. */
export function formatSender(fromHeader: string | undefined): string {
  if (!fromHeader) return "(unknown sender)";
  const match = fromHeader.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim();
    return name || match[2];
  }
  return fromHeader;
}

/** Full "weekday, day month year, HH:MM" label for an email's date, for detail views. */
export function formatFullDate(headerDate: string | undefined, internalDate: string | undefined): string {
  const d = headerDate ? new Date(headerDate) : internalDate ? new Date(Number(internalDate)) : null;
  if (!d || Number.isNaN(d.getTime())) return headerDate || "";
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Converts an email body to safe-to-render plain text. The body may be
 * text/plain or text/html depending on the message — we never render raw
 * HTML from an email (XSS risk from untrusted senders), so HTML bodies are
 * reduced to their text content via DOMParser rather than innerHTML.
 */
export function bodyToDisplayText(body: string): string {
  if (!/<\/?[a-z][\s\S]*>/i.test(body)) return body;
  const doc = new DOMParser().parseFromString(body, "text/html");
  return doc.body.textContent?.trim() || body;
}
