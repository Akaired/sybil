// ============================================================================
// SYBIL — Edge Function: calendar-actions
// Interfaccia a Google Calendar API per list/create/update/delete eventi
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const workspaceId = membership?.workspace_id ?? null;

    // Parse body
    const body = await req.json();
    const { action, ...params } = body;

    if (!action) return json({ error: "action is required" }, 400);

    // Get Google OAuth connection for this user
    const { data: conn, error: connError } = await supabase
      .from("sybil_oauth_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .single();

    if (connError || !conn) {
      return json({ error: "Google account not connected", detail: "Connect your Google account first." }, 403);
    }

    if (conn.status === "error" || conn.status === "disconnected") {
      return json({ error: "Google connection is not active", status: conn.status }, 403);
    }

    // Ensure token is valid (refresh if needed)
    let accessToken = conn.access_token;
    const now = new Date();

    if (!accessToken || (conn.expires_at && new Date(conn.expires_at) <= now)) {
      const refreshResult = await refreshGoogleToken(supabase, conn);
      if (!refreshResult.success) {
        return json({ error: "Failed to refresh Google token", detail: refreshResult.error }, 401);
      }
      accessToken = refreshResult.access_token;
    }

    // Execute action
    switch (action) {
      // ──────────────────────────────────────────────
      case "list": {
        const calendarId = params.calendar_id || "primary";
        const maxResults = Math.min(params.max_results || 50, 250);
        const timeMin = params.time_min || new Date().toISOString();
        const timeMax = params.time_max || undefined;
        const q = params.query || undefined;
        const singleEvents = params.single_events !== false; // default true
        const orderBy = params.order_by || "startTime";

        const calUrl = new URL(`${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
        calUrl.searchParams.set("maxResults", String(maxResults));
        calUrl.searchParams.set("timeMin", timeMin);
        if (timeMax) calUrl.searchParams.set("timeMax", timeMax);
        if (q) calUrl.searchParams.set("q", q);
        calUrl.searchParams.set("singleEvents", String(singleEvents));
        calUrl.searchParams.set("orderBy", orderBy);

        const res = await fetch(calUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const data = await res.json();
        if (!res.ok) return json({ error: "Google Calendar API error", detail: data }, res.status);

        return json({
          action: "list",
          calendar_id: calendarId,
          events: data.items || [],
          next_page_token: data.nextPageToken || null,
          count: (data.items || []).length,
        }, 200);
      }

      // ──────────────────────────────────────────────
      case "create": {
        const calendarId = params.calendar_id || "primary";

        // Build event object
        const event: Record<string, any> = {
          summary: params.summary || "Untitled Event",
        };

        if (params.description) event.description = params.description;
        if (params.location) event.location = params.location;

        // Start/End (required)
        if (!params.start || !params.end) {
          return json({ error: "start and end are required for create" }, 400);
        }

        event.start = params.start.dateTime
          ? { dateTime: params.start.dateTime, timeZone: params.start.timeZone || "UTC" }
          : { date: params.start.date, timeZone: params.start.timeZone || "UTC" };

        event.end = params.end.dateTime
          ? { dateTime: params.end.dateTime, timeZone: params.end.timeZone || "UTC" }
          : { date: params.end.date, timeZone: params.end.timeZone || "UTC" };

        // Attendees
        if (params.attendees && Array.isArray(params.attendees) && params.attendees.length > 0) {
          event.attendees = params.attendees.map((email: string) => ({ email }));
        }

        // Reminders
        if (params.reminders) {
          event.reminders = params.reminders;
        } else {
          event.reminders = { useDefault: true };
        }

        // Recurrence
        if (params.recurrence && Array.isArray(params.recurrence)) {
          event.recurrence = params.recurrence;
        }

        // Conference data (Google Meet)
        if (params.conference_data) {
          event.conferenceData = {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          };
        }

        const createUrl = new URL(`${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
        if (params.conference_data) {
          createUrl.searchParams.set("conferenceDataVersion", "1");
        }
        if (params.send_notifications) {
          createUrl.searchParams.set("sendUpdates", "all");
        }

        const res = await fetch(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        });

        const data = await res.json();
        if (!res.ok) return json({ error: "Google Calendar API error", detail: data }, res.status);

        // Log activity
        await supabase.from("sybil_activity_logs").insert({
          workspace_id: workspaceId,
          entity_type: "calendar_event",
          entity_id: data.id,
          action: "created",
          actor: "user",
          actor_id: user.id,
          payload: { summary: data.summary, start: event.start, end: event.end },
        });

        return json({
          action: "create",
          event: data,
          event_id: data.id,
          html_link: data.htmlLink,
        }, 201);
      }

      // ──────────────────────────────────────────────
      case "update": {
        const calendarId = params.calendar_id || "primary";
        const eventId = params.event_id;

        if (!eventId) return json({ error: "event_id is required for update" }, 400);

        const event: Record<string, any> = {};

        if (params.summary) event.summary = params.summary;
        if (params.description) event.description = params.description;
        if (params.location) event.location = params.location;
        if (params.start) {
          event.start = params.start.dateTime
            ? { dateTime: params.start.dateTime, timeZone: params.start.timeZone || "UTC" }
            : { date: params.start.date, timeZone: params.start.timeZone || "UTC" };
        }
        if (params.end) {
          event.end = params.end.dateTime
            ? { dateTime: params.end.dateTime, timeZone: params.end.timeZone || "UTC" }
            : { date: params.end.date, timeZone: params.end.timeZone || "UTC" };
        }
        if (params.attendees && Array.isArray(params.attendees)) {
          event.attendees = params.attendees.map((email: string) => ({ email }));
        }

        const updateUrl = new URL(`${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
        if (params.send_notifications) {
          updateUrl.searchParams.set("sendUpdates", "all");
        }

        const res = await fetch(updateUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        });

        const data = await res.json();
        if (!res.ok) return json({ error: "Google Calendar API error", detail: data }, res.status);

        await supabase.from("sybil_activity_logs").insert({
          entity_type: "calendar_event",
          entity_id: eventId,
          action: "updated",
          actor: "user",
          actor_id: user.id,
          payload: { updated_fields: Object.keys(event) },
        });

        return json({
          action: "update",
          event: data,
          event_id: data.id,
        }, 200);
      }

      // ──────────────────────────────────────────────
      case "delete": {
        const calendarId = params.calendar_id || "primary";
        const eventId = params.event_id;

        if (!eventId) return json({ error: "event_id is required for delete" }, 400);

        const deleteUrl = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

        const res = await fetch(deleteUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}));
          return json({ error: "Google Calendar API error", detail: data }, res.status);
        }

        await supabase.from("sybil_activity_logs").insert({
          entity_type: "calendar_event",
          entity_id: eventId,
          action: "deleted",
          actor: "user",
          actor_id: user.id,
        });

        return json({
          action: "delete",
          event_id: eventId,
          deleted: true,
        }, 200);
      }

      // ──────────────────────────────────────────────
      case "list_calendars": {
        const res = await fetch(`${GOOGLE_CALENDAR_BASE}/users/me/calendarList`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const data = await res.json();
        if (!res.ok) return json({ error: "Google Calendar API error", detail: data }, res.status);

        return json({
          action: "list_calendars",
          calendars: data.items || [],
          count: (data.items || []).length,
        }, 200);
      }

      default:
        return json({ error: `Unknown action: ${action}. Supported: list, create, update, delete, list_calendars` }, 400);
    }

  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

// ============================================================================
// Token refresh helper
// ============================================================================

async function refreshGoogleToken(
  supabase: any,
  conn: any
): Promise<{ success: boolean; access_token?: string; error?: string }> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret || !conn.refresh_token) {
    return { success: false, error: "Missing credentials or refresh token" };
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();

      // Mark connection as error if token is revoked
      if (response.status === 400 || response.status === 401) {
        await supabase
          .from("sybil_oauth_connections")
          .update({ status: "error" })
          .eq("id", conn.id);
      }

      return { success: false, error: errText };
    }

    const tokens = await response.json();
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    await supabase
      .from("sybil_oauth_connections")
      .update({
        access_token: tokens.access_token,
        expires_at: expiresAt,
        status: "connected",
      })
      .eq("id", conn.id);

    return { success: true, access_token: tokens.access_token };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}