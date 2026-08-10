// ============================================================
// Sybil Calendar — Google Calendar edge function client
// oauth-google-start / oauth-status / calendar-actions
// ============================================================

import { supabase } from "../config/supabase";

const EDGE_BASE = "https://uhrqlwoejawnnhdeabob.supabase.co/functions/v1";
const ANON_KEY = "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

// ── Types ────────────────────────────────────────────────────

export interface GoogleEventDateTime {
  date?: string; // all-day events
  dateTime?: string; // ISO with offset
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  location?: string;
  attendees?: { email: string; responseStatus?: string }[];
  htmlLink?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  creator?: { email?: string; self?: boolean };
  organizer?: { email?: string; self?: boolean };
}

export interface OauthStartResponse {
  authorization_url: string;
  state: string;
}

export interface OauthStatusResponse {
  user_id?: string;
  connections?: {
    google?: {
      connected: boolean;
      status?: string;
      email?: string;
      expired?: boolean;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

export function isGoogleConnected(status: OauthStatusResponse): boolean {
  const google = status.connections?.google;
  return Boolean(google?.connected && !google?.expired);
}

export interface CalendarListResponse {
  action: string;
  calendar_id?: string;
  events: GoogleCalendarEvent[];
  next_page_token?: string | null;
  count: number;
}

/** Thrown by listCalendarEvents on a non-2xx response. */
export class CalendarActionsError extends Error {
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

// ── Public API ───────────────────────────────────────────────

export async function fetchOauthStatus(): Promise<OauthStatusResponse> {
  const res = await fetch(`${EDGE_BASE}/oauth-status`, {
    method: "GET",
    headers: await getHeaders(),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? res.statusText);
  }
  return body as OauthStatusResponse;
}

export async function startGoogleOauth(
  redirectPath: string = "/calendar",
): Promise<OauthStartResponse> {
  const res = await fetch(`${EDGE_BASE}/oauth-google-start`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({
      redirect_path: redirectPath,
      frontend_origin: window.location.origin,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? res.statusText);
  }
  return body as OauthStartResponse;
}

export interface CalendarShareResponse {
  success: true;
  email: string;
  role: "reader" | "writer";
  downgraded: boolean;
}

/** Thrown by shareCalendar on a non-2xx response. */
export class CalendarShareError extends Error {}

export async function shareCalendar(params: {
  email: string;
  role: "reader" | "writer";
}): Promise<CalendarShareResponse> {
  const res = await fetch(`${EDGE_BASE}/calendar-share`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify(params),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new CalendarShareError(body?.error ?? body?.message ?? res.statusText);
  }
  return body as CalendarShareResponse;
}

export interface SharedCalendar {
  id: string;
  ownerUserId: string;
  ownerTeamEmail: string;
  ownerCalendarId: string;
  role: "reader" | "writer";
}

/** Calendars a teammate has shared with the current user (see calendar-share). */
export async function listSharedCalendars(): Promise<SharedCalendar[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("calendar_shares")
    .select("id, owner_user_id, owner_team_email, owner_calendar_id, role")
    .order("owner_team_email", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => row.owner_user_id !== user?.id)
    .map((row) => ({
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerTeamEmail: row.owner_team_email,
      ownerCalendarId: row.owner_calendar_id,
      role: row.role as "reader" | "writer",
    }));
}

export async function listCalendarEvents(params: {
  time_min?: string;
  time_max?: string;
  max_results?: number;
  query?: string | null;
  calendar_id?: string;
}): Promise<CalendarListResponse> {
  const res = await fetch(`${EDGE_BASE}/calendar-actions`, {
    method: "POST",
    headers: await getHeaders(),
    body: JSON.stringify({ action: "list", ...params }),
  });
  const body = await res.json();
  if (!res.ok) {
    const message: string = body?.error ?? body?.message ?? res.statusText;
    const notConnected = res.status === 401 || /not connected/i.test(message);
    throw new CalendarActionsError(message, notConnected);
  }
  return body as CalendarListResponse;
}
