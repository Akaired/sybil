// ============================================================
// Sybil Telegram link — telegram-link edge function client
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

export type TelegramLinkStatus =
  | { state: "not_connected" }
  | { state: "pending"; code: string; expires_at: string }
  | { state: "connected"; telegram_username: string | null; telegram_first_name: string | null; linked_at: string };

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

async function callTelegramLink<T>(action: string): Promise<T> {
  const res = await fetch(`${EDGE_BASE}/telegram-link`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ action }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? res.statusText);
  }
  return body as T;
}

export function createTelegramLinkCode(): Promise<{ code: string; expires_at: string }> {
  return callTelegramLink("create_code");
}

export function fetchTelegramLinkStatus(): Promise<TelegramLinkStatus> {
  return callTelegramLink("status");
}

export function unlinkTelegram(): Promise<{ state: "not_connected" }> {
  return callTelegramLink("unlink");
}
