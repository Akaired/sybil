// ============================================================================
// SYBIL — Edge Function: resolve
// Esegue l'azione interpretata e scrive la resolution
// Supporta: reply, create_task, update_task, delete_task, create_sentinel,
//           delete_sentinel, no_action, calendar_event (legacy),
//           create_calendar_event, read_calendar, send_email, read_emails,
//           delete_email
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/getSecret.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const BRIGHTDATA_FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/brightdata`;
const RESEARCH_SOURCE_CHARS = 2500; // per-source excerpt fed to the synthesis LLM, keeps token count bounded across up to 5 sources

const TASK_STATUSES = new Set(["backlog", "todo", "doing", "done"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function isValidTaskStatus(v: unknown): v is string {
  return typeof v === "string" && TASK_STATUSES.has(v);
}
function isValidTaskPriority(v: unknown): v is string {
  return typeof v === "string" && TASK_PRIORITIES.has(v);
}
function normalizeTaskStatus(v: unknown): string {
  return isValidTaskStatus(v) ? (v as string) : "backlog";
}
function normalizeTaskPriority(v: unknown): string {
  return isValidTaskPriority(v) ? (v as string) : "medium";
}
function normalizeLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    const body = await req.json();
    const { signal_id, interpretation } = body;

    if (!signal_id || !interpretation) {
      return json({ error: "signal_id and interpretation are required" }, 400);
    }

    // Carica signal
    const { data: signal, error: sigError } = await supabase
      .from("sybil_signals")
      .select("*")
      .eq("id", signal_id)
      .single();

    if (sigError || !signal) return json({ error: "Signal not found" }, 404);
    const workspaceId = signal.workspace_id;

    const action = interpretation.action || "no_action";
    let outcome: "success" | "partial" | "error" = "success";
    let detail: Record<string, any> = {};

    switch (action) {
      // ──────────────────────────────────────────────
      case "create_task": {
        let projectId = null;
        if (interpretation.project) {
          const { data: proj } = await supabase
            .from("sybil_projects")
            .select("id")
            .eq("workspace_id", workspaceId)
            .ilike("name", interpretation.project)
            .limit(1).single();
          if (proj) projectId = proj.id;
        }

        const isDormant = !!interpretation.wake_condition;

        const { data: task, error: taskErr } = await supabase
          .from("sybil_tasks")
          .insert({
            workspace_id: workspaceId,
            project_id: projectId,
            assignee_id: null,
            title: interpretation.title || "Untitled task",
            description: interpretation.description || null,
            status: normalizeTaskStatus(interpretation.status),
            priority: normalizeTaskPriority(interpretation.priority),
            labels: normalizeLabels(interpretation.labels),
            due_date: interpretation.due_date || null,
            wake_condition: interpretation.wake_condition || null,
            source_signal_id: signal.id,
            created_by: user.id,
          })
          .select().single();

        if (taskErr) {
          outcome = "error";
          detail = { error: taskErr.message };
        } else {
          detail = { task_id: task.id, task_title: task.title, status: task.status };

          // Se task dormiente con target, crea sentinella — non forziamo più
          // uno status speciale: il task resta dov'è stato messo (default
          // backlog) con sentinel_id valorizzato, mostrato come badge in UI.
          if (isDormant && interpretation.sentinel_target) {
            const { data: sentinel } = await supabase
              .from("sybil_sentinels")
              .insert({
                workspace_id: workspaceId,
                owner_id: user.id,
                task_id: task.id,
                condition_text: interpretation.wake_condition,
                type: interpretation.sentinel_type || "web",
                config: { target: interpretation.sentinel_target },
                frequency_min: 10,
                status: "active",
                next_check_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
              })
              .select().single();

            if (sentinel) {
              await supabase.from("sybil_tasks")
                .update({ sentinel_id: sentinel.id })
                .eq("id", task.id);
              detail.sentinel_id = sentinel.id;
            }
          }

          await supabase.from("sybil_activity_logs").insert({
            workspace_id: workspaceId,
            entity_type: "task", entity_id: task.id,
            action: "created", actor: "agent",
            payload: { title: task.title, from_signal: signal.id },
          });
        }
        break;
      }

      // ──────────────────────────────────────────────
      case "update_task": {
        const searchTitle = interpretation.title || "";
        const { data: candidates } = await supabase
          .from("sybil_tasks")
          .select("id, title, status, due_date, project_id")
          .eq("workspace_id", workspaceId)
          .neq("status", "done")
          .ilike("title", `%${searchTitle}%`)
          .limit(5);

        if (!candidates || candidates.length === 0) {
          outcome = "partial";
          detail = { error: "No matching task found", suggestion: "create_task" };
        } else if (candidates.length === 1) {
          const task = candidates[0];
          const updates: Record<string, any> = {};
          if (interpretation.due_date) updates.due_date = interpretation.due_date;
          if (interpretation.description) updates.description = interpretation.description;
          if (interpretation.wake_condition) updates.wake_condition = interpretation.wake_condition;
          if (isValidTaskStatus(interpretation.status)) {
            updates.status = interpretation.status;
            updates.completed_at = interpretation.status === "done" ? new Date().toISOString() : null;
          }
          if (isValidTaskPriority(interpretation.priority)) updates.priority = interpretation.priority;
          if (Array.isArray(interpretation.labels)) updates.labels = normalizeLabels(interpretation.labels);

          const { error: updErr } = await supabase
            .from("sybil_tasks").update(updates).eq("id", task.id);

          if (updErr) {
            outcome = "error";
            detail = { error: updErr.message };
          } else {
            detail = {
              task_id: task.id,
              updated_fields: Object.keys(updates).filter((f) => f !== "completed_at"),
              task_title: task.title,
              status: updates.status ?? task.status,
            };
            await supabase.from("sybil_activity_logs").insert({
              workspace_id: workspaceId,
              entity_type: "task", entity_id: task.id,
              action: "updated", actor: "agent",
              payload: { fields: Object.keys(updates), from_signal: signal.id },
            });
          }
        } else {
          outcome = "partial";
          detail = {
            error: "Multiple matching tasks found",
            candidates: candidates.map(t => ({ id: t.id, title: t.title })),
          };
        }
        break;
      }

      // ──────────────────────────────────────────────
      case "create_sentinel": {
        // Se l'utente ha chiesto anche un'azione da eseguire al trigger
        // (es. "manda una mail a X quando..."), l'LLM la estrae negli
        // stessi campi usati per action=send_email (to/subject/body).
        // La salviamo in config così sentinel-check sa cosa fare allo scatto.
        const triggerAction = interpretation.to
          ? {
              type: "send_email",
              to: Array.isArray(interpretation.to) ? interpretation.to : [interpretation.to],
              subject: interpretation.subject || `Sybil: ${interpretation.wake_condition || interpretation.title || "aggiornamento sentinella"}`,
              body_template: interpretation.body || "",
            }
          : null;

        const { data: sentinel, error: sentErr } = await supabase
          .from("sybil_sentinels")
          .insert({
            workspace_id: workspaceId,
            owner_id: user.id,
            task_id: interpretation.task_id || null,
            condition_text: interpretation.wake_condition || interpretation.title,
            type: interpretation.sentinel_type || "web",
            config: {
              target: interpretation.sentinel_target,
              recurring: interpretation.sentinel_recurring === true || interpretation.sentinel_recurring === "true",
              notify_always: interpretation.sentinel_notify_always === true || interpretation.sentinel_notify_always === "true",
              ...(triggerAction ? { action: triggerAction } : {}),
            },
            frequency_min: 10,
            status: "active",
            next_check_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          })
          .select().single();

        if (sentErr) {
          outcome = "error";
          detail = { error: sentErr.message };
        } else {
          detail = { sentinel_id: sentinel.id, condition: sentinel.condition_text };
          await supabase.from("sybil_activity_logs").insert({
            workspace_id: workspaceId,
            entity_type: "sentinel", entity_id: sentinel.id,
            action: "created", actor: "agent",
            payload: { from_signal: signal.id },
          });
        }
        break;
      }

      // ──────────────────────────────────────────────
      case "delete_sentinel": {
        if (interpretation.delete_scope === "all") {
          const { data: toDelete } = await supabase
            .from("sybil_sentinels")
            .select("id")
            .eq("owner_id", user.id);

          const ids = (toDelete || []).map((s: { id: string }) => s.id);

          if (ids.length === 0) {
            detail = { deleted_count: 0, reason: "No sentinels to delete" };
          } else {
            const { error: delErr } = await supabase
              .from("sybil_sentinels")
              .delete()
              .in("id", ids);

            if (delErr) {
              outcome = "error";
              detail = { error: delErr.message };
            } else {
              detail = { deleted_count: ids.length, scope: "all" };
              await supabase.from("sybil_activity_logs").insert({
                workspace_id: workspaceId,
                entity_type: "sentinel", entity_id: null,
                action: "deleted", actor: "agent",
                payload: { scope: "all", count: ids.length, from_signal: signal.id },
              });
            }
          }
        } else {
          const searchQuery = interpretation.sentinel_query || interpretation.title || "";
          const { data: candidates } = await supabase
            .from("sybil_sentinels")
            .select("id, condition_text")
            .eq("owner_id", user.id)
            .ilike("condition_text", `%${searchQuery}%`)
            .limit(5);

          if (!candidates || candidates.length === 0) {
            outcome = "partial";
            detail = { error: "No matching sentinel found" };
          } else if (candidates.length === 1) {
            const target = candidates[0];
            const { error: delErr } = await supabase
              .from("sybil_sentinels")
              .delete()
              .eq("id", target.id);

            if (delErr) {
              outcome = "error";
              detail = { error: delErr.message };
            } else {
              detail = { deleted_id: target.id, condition: target.condition_text, scope: "one" };
              await supabase.from("sybil_activity_logs").insert({
                workspace_id: workspaceId,
                entity_type: "sentinel", entity_id: target.id,
                action: "deleted", actor: "agent",
                payload: { from_signal: signal.id },
              });
            }
          } else {
            outcome = "partial";
            detail = {
              error: "Multiple matching sentinels found",
              candidates: candidates.map((s: { id: string; condition_text: string }) => ({
                id: s.id,
                condition: s.condition_text,
              })),
            };
          }
        }
        break;
      }

      // ──────────────────────────────────────────────
      case "delete_task": {
        if (interpretation.task_delete_scope === "all") {
          // Tasks have no per-user ownership at the RLS level, only a
          // created_by column — "delete all" is deliberately scoped to
          // tasks the caller themselves created, never the whole workspace.
          const { data: toDelete } = await supabase
            .from("sybil_tasks")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("created_by", user.id);

          const ids = (toDelete || []).map((t: { id: string }) => t.id);

          if (ids.length === 0) {
            detail = { deleted_count: 0, scope: "all", reason: "No tasks to delete" };
          } else {
            const { error: delErr } = await supabase
              .from("sybil_tasks")
              .delete()
              .in("id", ids);

            if (delErr) {
              outcome = "error";
              detail = { error: delErr.message };
            } else {
              detail = { deleted_count: ids.length, scope: "all" };
              await supabase.from("sybil_activity_logs").insert({
                workspace_id: workspaceId,
                entity_type: "task", entity_id: null,
                action: "deleted", actor: "agent",
                payload: { scope: "all", count: ids.length, from_signal: signal.id },
              });
            }
          }
        } else {
          const searchQuery = interpretation.task_query || interpretation.title || "";
          const { data: candidates } = await supabase
            .from("sybil_tasks")
            .select("id, title")
            .eq("workspace_id", workspaceId)
            .ilike("title", `%${searchQuery}%`)
            .limit(5);

          if (!candidates || candidates.length === 0) {
            outcome = "partial";
            detail = { error: "No matching task found" };
          } else if (candidates.length === 1) {
            const target = candidates[0];
            const { error: delErr } = await supabase
              .from("sybil_tasks")
              .delete()
              .eq("id", target.id);

            if (delErr) {
              outcome = "error";
              detail = { error: delErr.message };
            } else {
              detail = { deleted_id: target.id, task_title: target.title, scope: "one" };
              await supabase.from("sybil_activity_logs").insert({
                workspace_id: workspaceId,
                entity_type: "task", entity_id: target.id,
                action: "deleted", actor: "agent",
                payload: { from_signal: signal.id },
              });
            }
          } else {
            outcome = "partial";
            detail = {
              error: "Multiple matching tasks found",
              candidates: candidates.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
            };
          }
        }
        break;
      }

      case "reply":
        detail = { reply_text: interpretation.reply_text || "OK" };
        break;

      case "no_action":
        detail = { reason: interpretation.reply_text || "No action needed" };
        break;

      // ──────────────────────────────────────────────
      // LEGACY: calendar_event (mantiene compatibilità)
      case "calendar_event":
        // Redirect to new action
        if (interpretation.title || interpretation.start || interpretation.end) {
          // Fall through to create_calendar_event
          interpretation.summary = interpretation.title;
        } else {
          outcome = "partial";
          detail = { reason: "Calendar event placeholder — use create_calendar_event instead" };
          break;
        }
        // fallthrough intentional

      // ──────────────────────────────────────────────
      // NEW: create_calendar_event
      case "create_calendar_event": {
        const calResult = await executeCalendarAction(supabase, user.id, workspaceId, "create", {
          summary: interpretation.summary || interpretation.title || "Untitled Event",
          description: interpretation.description || null,
          start: interpretation.start || (interpretation.due_date ? { dateTime: interpretation.due_date } : null),
          end: interpretation.end || (interpretation.due_date ? { dateTime: interpretation.due_date } : null),
          attendees: interpretation.attendees || [],
          location: interpretation.location || null,
        });

        if (calResult.success) {
          detail = {
            calendar_event: calResult.data,
            event_id: calResult.data?.id,
            html_link: calResult.data?.htmlLink,
          };
        } else {
          outcome = calResult.connected === false ? "partial" : "error";
          detail = { error: calResult.error, calendar_not_connected: calResult.connected === false };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: read_calendar
      case "read_calendar": {
        const calResult = await executeCalendarAction(supabase, user.id, workspaceId, "list", {
          time_min: interpretation.time_min || new Date().toISOString(),
          time_max: interpretation.time_max || null,
          max_results: interpretation.max_results || 20,
          query: interpretation.query || null,
        });

        if (calResult.success) {
          detail = {
            events: calResult.data?.events || [],
            count: calResult.data?.count || 0,
            // Debug only, ignored by replyTextFor/replyTextForHistory —
            // the actual RFC3339 range sent to Google, to catch date
            // interpretation bugs like the model guessing the wrong day.
            queried_time_min: calResult.data?.queried_time_min,
            queried_time_max: calResult.data?.queried_time_max,
            interpreted_time_min: interpretation.time_min,
            interpreted_time_max: interpretation.time_max,
          };
        } else {
          outcome = calResult.connected === false ? "partial" : "error";
          // google_error carries the raw Google API error body (not shown to
          // the user, replyTextFor ignores it) — kept for debugging since
          // "Google Calendar API error" alone hides the actual cause.
          detail = {
            error: calResult.error,
            calendar_not_connected: calResult.connected === false,
            google_error: calResult.data,
          };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: send_email
      case "send_email": {
        const gmailResult = await executeGmailAction(supabase, user.id, workspaceId, "send", {
          to: interpretation.to || (interpretation.email ? [interpretation.email] : []),
          subject: interpretation.subject || interpretation.title || "Email from Sybil",
          body: interpretation.body || interpretation.description || interpretation.reply_text || "",
          cc: interpretation.cc || null,
          bcc: interpretation.bcc || null,
          html: interpretation.html || false,
        });

        if (gmailResult.success) {
          detail = {
            message_id: gmailResult.data?.message_id,
            thread_id: gmailResult.data?.thread_id,
            status: "sent",
          };
        } else {
          outcome = gmailResult.connected === false ? "partial" : "error";
          detail = { error: gmailResult.error, google_not_connected: gmailResult.connected === false };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: read_emails
      case "read_emails": {
        const gmailResult = await executeGmailAction(supabase, user.id, workspaceId, "list", {
          query: interpretation.query || interpretation.search || null,
          max_results: interpretation.max_results || 10,
        });

        if (gmailResult.success) {
          detail = {
            messages: gmailResult.data?.messages || [],
            count: gmailResult.data?.count || 0,
          };
        } else {
          outcome = gmailResult.connected === false ? "partial" : "error";
          detail = { error: gmailResult.error, google_not_connected: gmailResult.connected === false };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: delete_email — searches Gmail for a match (like delete_sentinel
      // searches sybil_sentinels), trashes it if exactly one match, otherwise
      // asks the user to be more specific.
      case "delete_email": {
        const searchQuery = interpretation.query || interpretation.title || "";
        // "cancella le ultime N mail" — no sender/subject given, just a count.
        // Delete the N most recent matches outright instead of asking to
        // disambiguate (there's nothing to disambiguate: recency order is
        // the whole instruction). Capped at 10 regardless of what the LLM
        // extracted, same ceiling as read_emails' "ultime N mail".
        const bulkCount = !searchQuery && interpretation.max_results
          ? Math.min(Number(interpretation.max_results) || 0, 10)
          : 0;

        if (!searchQuery && !bulkCount) {
          outcome = "partial";
          detail = { error: "No search terms given to find the email to delete" };
          break;
        }

        const gmailSearch = await executeGmailAction(supabase, user.id, workspaceId, "list", {
          query: searchQuery || null,
          max_results: bulkCount || 5,
        });

        if (!gmailSearch.success) {
          outcome = gmailSearch.connected === false ? "partial" : "error";
          detail = { error: gmailSearch.error, google_not_connected: gmailSearch.connected === false };
          break;
        }

        const candidates = gmailSearch.data?.messages || [];
        if (candidates.length === 0) {
          outcome = "partial";
          detail = { error: "No matching email found" };
        } else if (bulkCount) {
          const results = await Promise.all(
            candidates.map((m: any) => executeGmailAction(supabase, user.id, workspaceId, "trash", { message_id: m.id })),
          );
          const deleted = candidates.filter((_: any, i: number) => results[i].success);
          detail = {
            deleted_count: deleted.length,
            subjects: deleted.map((m: any) => m.headers?.Subject ?? ""),
            scope: "recent",
          };
          if (deleted.length < candidates.length) outcome = "partial";
        } else if (candidates.length === 1) {
          const target = candidates[0];
          const trashResult = await executeGmailAction(supabase, user.id, workspaceId, "trash", {
            message_id: target.id,
          });

          if (trashResult.success) {
            detail = {
              deleted_id: target.id,
              subject: target.headers?.Subject ?? "",
              scope: "one",
            };
          } else {
            outcome = "error";
            detail = { error: trashResult.error };
          }
        } else {
          outcome = "partial";
          detail = {
            error: "Multiple matching emails found",
            candidates: candidates.map((m: any) => ({
              id: m.id,
              subject: m.headers?.Subject ?? "",
              from: m.headers?.From ?? "",
            })),
          };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: web_visit
      case "web_visit": {
        const url = interpretation.web_url;
        if (!url) {
          outcome = "partial";
          detail = { error: "Missing url" };
          break;
        }

        const bd = await callBrightData(token, "visit", { url });
        if (bd.data?.ok) {
          detail = {
            url: bd.data.url,
            markdown: bd.data.markdown,
            truncated: bd.data.truncated,
            latency_ms: bd.data.latency_ms,
            used_brightdata: true,
          };
        } else {
          outcome = "error";
          detail = { error: bd.data?.error || "Visit failed", used_brightdata: true };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: web_search
      case "web_search": {
        const searchQuery = interpretation.web_query || interpretation.query;
        if (!searchQuery) {
          outcome = "partial";
          detail = { error: "Missing search query" };
          break;
        }

        const bd = await callBrightData(token, "search", { query: searchQuery });
        if (bd.data?.ok) {
          detail = {
            query: bd.data.query,
            results: bd.data.results || [],
            engine_used: bd.data.engine_used,
            used_brightdata: true,
          };
        } else {
          outcome = "error";
          detail = { error: bd.data?.error || "Search failed", engine_used: bd.data?.engine_used, used_brightdata: true };
        }
        break;
      }

      // ──────────────────────────────────────────────
      // NEW: web_research — one search + up to max_sources page visits,
      // then an LLM synthesis constrained to ONLY the fetched content
      // (never a silent fallback to the model's own training knowledge).
      case "web_research": {
        const researchQuery = interpretation.web_query || interpretation.query;
        if (!researchQuery) {
          outcome = "partial";
          detail = { error: "Missing research query" };
          break;
        }

        const maxSources = Math.min(Math.max(parseInt(interpretation.max_sources, 10) || 3, 1), 5);

        const searchRes = await callBrightData(token, "search", { query: researchQuery });
        if (!searchRes.data?.ok) {
          outcome = "error";
          detail = { error: searchRes.data?.error || "Search failed", used_brightdata: true };
          break;
        }

        // For broad "what's happening" queries, generic organic search often
        // ranks a portal's bare homepage (cnn.com, nbcnews.com, ...) above
        // any specific article — visiting it then yields nav/category
        // markdown, not real content, so the synthesis has nothing to work
        // with. Prefer deeper, article-shaped URLs when the search returned
        // any; only fall back to homepages if that's genuinely all there is.
        const isHomepage = (u: string) => {
          try {
            const path = new URL(u).pathname;
            return path === "/" || path === "";
          } catch {
            return false;
          }
        };
        const allResults = (searchRes.data.results || []).filter((r: any) => r.url);
        const nonHomepage = allResults.filter((r: any) => !isHomepage(r.url));
        const candidates = (nonHomepage.length > 0 ? nonHomepage : allResults).slice(0, maxSources);
        if (candidates.length === 0) {
          outcome = "partial";
          detail = { error: "No search results to research", query: researchQuery, used_brightdata: true };
          break;
        }

        const visits = await Promise.all(candidates.map((c: any) => callBrightData(token, "visit", { url: c.url })));
        const sources = candidates.map((c: any, i: number) => {
          const v = visits[i].data;
          return v?.ok
            ? { url: v.url, title: c.title || v.url, markdown: v.markdown as string }
            : { url: c.url, title: c.title || c.url, error: v?.error || "Visit failed" };
        });

        const usableSources = sources.filter((s: any) => typeof s.markdown === "string" && s.markdown.length > 0);

        if (usableSources.length === 0) {
          outcome = "partial";
          detail = {
            query: researchQuery,
            sources: sources.map(({ markdown, ...s }: any) => s),
            error: "Could not fetch content from any of the search results",
            used_brightdata: true,
          };
          break;
        }

        const synthesis = await synthesizeResearch(supabase, researchQuery, usableSources);

        detail = {
          query: researchQuery,
          sources: sources.map((s: any) => ({ url: s.url, title: s.title, ...(s.error ? { error: s.error } : {}) })),
          summary: synthesis.summary,
          used_brightdata: true,
        };
        if (usableSources.length < sources.length || !synthesis.success) outcome = "partial";
        break;
      }

      default:
        outcome = "error";
        detail = { error: `Unknown action: ${action}` };
    }

    // Scrivi resolution
    const { data: resolution, error: resErr } = await supabase
      .from("sybil_resolutions")
      .insert({
        workspace_id: workspaceId,
        signal_id: signal.id,
        action,
        outcome,
        detail,
        completed_at: new Date().toISOString(),
      })
      .select().single();

    if (resErr) return json({ error: "Failed to create resolution", detail: resErr.message }, 500);

    await supabase.from("sybil_activity_logs").insert({
      workspace_id: workspaceId,
      entity_type: "resolution", entity_id: resolution.id,
      action: "resolved", actor: "agent",
      payload: { action, outcome },
    });

    return json({
      signal_id: signal.id,
      resolution_id: resolution.id,
      action, outcome, detail,
    }, 200);

  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

// ============================================================================
// Google OAuth helpers
// ============================================================================

async function getGoogleConnection(supabase: any, userId: string) {
  const { data: conn, error } = await supabase
    .from("sybil_oauth_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .single();

  if (error || !conn) return null;
  return conn;
}

async function ensureValidToken(supabase: any, conn: any): Promise<{ token: string | null; error?: string }> {
  let accessToken = conn.access_token;
  const now = new Date();

  if (!accessToken || (conn.expires_at && new Date(conn.expires_at) <= now)) {
    const refreshResult = await refreshGoogleToken(supabase, conn);
    if (!refreshResult.success) {
      return { token: null, error: refreshResult.error };
    }
    accessToken = refreshResult.access_token!;
  }

  return { token: accessToken };
}

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

// ============================================================================
// Calendar action executor
// ============================================================================

function normalizeIsoDateTime(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function executeCalendarAction(
  supabase: any,
  userId: string,
  workspaceId: string,
  action: string,
  params: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string; connected?: boolean }> {
  const conn = await getGoogleConnection(supabase, userId);
  if (!conn) return { success: false, connected: false, error: "Google account not connected" };

  if (conn.status === "error" || conn.status === "disconnected") {
    return { success: false, connected: false, error: `Google connection status: ${conn.status}` };
  }

  const { token, error: tokenError } = await ensureValidToken(supabase, conn);
  if (!token) return { success: false, error: tokenError || "Failed to get valid token" };

  try {
    if (action === "list") {
      // The interpreter's dates aren't guaranteed to carry a timezone offset
      // (e.g. "2026-08-08T09:00:00"), but Google's list endpoint requires a
      // real RFC3339 timestamp for timeMin/timeMax and 400s on anything else.
      // Re-parse through Date so whatever comes in lands as a valid instant.
      const timeMin = normalizeIsoDateTime(params.time_min) || new Date().toISOString();
      const timeMax = normalizeIsoDateTime(params.time_max);

      const calUrl = new URL(`${GOOGLE_CALENDAR_BASE}/calendars/primary/events`);
      calUrl.searchParams.set("maxResults", String(params.max_results || 50));
      calUrl.searchParams.set("timeMin", timeMin);
      if (timeMax) calUrl.searchParams.set("timeMax", timeMax);
      if (params.query) calUrl.searchParams.set("q", params.query);
      calUrl.searchParams.set("singleEvents", "true");
      calUrl.searchParams.set("orderBy", "startTime");

      const res = await fetch(calUrl, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) return { success: false, error: "Google Calendar API error", data };

      return {
        success: true,
        data: { events: data.items || [], count: (data.items || []).length, queried_time_min: timeMin, queried_time_max: timeMax },
      };
    }

    if (action === "create") {
      const event: Record<string, any> = { summary: params.summary || "Untitled Event" };
      if (params.description) event.description = params.description;
      if (params.location) event.location = params.location;

      if (params.start) {
        const startVal = params.start.dateTime || params.start.date;
        // Validate: reject dates in the past (more than 1 day ago)
        const eventDate = new Date(startVal);
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        if (eventDate < oneDayAgo) {
          return { success: false, error: `Event date ${startVal} is in the past. Events must be in the present or future. Check that the year is correct (current year is ${now.getFullYear()}).` };
        }
        event.start = params.start.dateTime
          ? { dateTime: params.start.dateTime, timeZone: params.start.timeZone || "UTC" }
          : { date: params.start.date, timeZone: params.start.timeZone || "UTC" };
      } else {
        return { success: false, error: "start is required for calendar event creation" };
      }

      if (params.end) {
        event.end = params.end.dateTime
          ? { dateTime: params.end.dateTime, timeZone: params.end.timeZone || "UTC" }
          : { date: params.end.date, timeZone: params.end.timeZone || "UTC" };
      } else {
        // Default: 1 hour event
        const startTime = new Date(params.start.dateTime || params.start.date);
        const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
        event.end = { dateTime: endTime.toISOString(), timeZone: params.start.timeZone || "UTC" };
      }

      if (params.attendees && Array.isArray(params.attendees) && params.attendees.length > 0) {
        event.attendees = params.attendees.map((email: string) => ({ email }));
      }

      event.reminders = { useDefault: true };

      const createUrl = new URL(`${GOOGLE_CALENDAR_BASE}/calendars/primary/events`);
      createUrl.searchParams.set("sendUpdates", "all");

      const res = await fetch(createUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });

      const data = await res.json();
      if (!res.ok) return { success: false, error: "Google Calendar API error", data };

      await supabase.from("sybil_activity_logs").insert({
        workspace_id: workspaceId,
        entity_type: "calendar_event", entity_id: data.id,
        action: "created", actor: "agent",
        actor_id: userId,
        payload: { summary: data.summary, from_resolve: true },
      });

      return { success: true, data };
    }

    return { success: false, error: `Unsupported calendar action: ${action}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Gmail action executor
// ============================================================================

async function executeGmailAction(
  supabase: any,
  userId: string,
  workspaceId: string,
  action: string,
  params: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string; connected?: boolean }> {
  const conn = await getGoogleConnection(supabase, userId);
  if (!conn) return { success: false, connected: false, error: "Google account not connected" };

  if (conn.status === "error" || conn.status === "disconnected") {
    return { success: false, connected: false, error: `Google connection status: ${conn.status}` };
  }

  const { token, error: tokenError } = await ensureValidToken(supabase, conn);
  if (!token) return { success: false, error: tokenError || "Failed to get valid token" };

  try {
    if (action === "list") {
      const maxResults = Math.min(params.max_results || 10, 100);
      const listUrl = new URL(`${GMAIL_BASE}/messages`);
      listUrl.searchParams.set("maxResults", String(maxResults));
      if (params.query) listUrl.searchParams.set("q", params.query);

      const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) return { success: false, error: "Gmail API error", data };

      // Fetch metadata for each message
      const messages = data.messages || [];
      const detailedMessages = await Promise.all(
        messages.slice(0, maxResults).map(async (msg: { id: string; threadId: string }) => {
          try {
            const msgRes = await fetch(
              `${GMAIL_BASE}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (msgRes.ok) {
              const msgData = await msgRes.json();
              const headers: Record<string, string> = {};
              if (msgData.payload?.headers) {
                for (const h of msgData.payload.headers) {
                  headers[h.name] = h.value;
                }
              }
              return {
                id: msg.id,
                threadId: msg.threadId,
                snippet: msgData.snippet,
                headers,
                labelIds: msgData.labelIds || [],
                internalDate: msgData.internalDate,
              };
            }
            return { id: msg.id, threadId: msg.threadId, error: "Failed to fetch details" };
          } catch {
            return { id: msg.id, threadId: msg.threadId, error: "Fetch error" };
          }
        })
      );

      return { success: true, data: { messages: detailedMessages, count: detailedMessages.length } };
    }

    if (action === "send") {
      const { to, subject, body: emailBody, cc, bcc, html } = params;

      if (!to || (Array.isArray(to) && to.length === 0)) {
        return { success: false, error: "to is required for send" };
      }
      if (!subject || !emailBody) {
        return { success: false, error: "subject and body are required for send" };
      }

      const toAddresses = Array.isArray(to) ? to.join(", ") : to;
      const ccAddresses = cc ? (Array.isArray(cc) ? cc.join(", ") : cc) : "";
      const bccAddresses = bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc) : "";

      const emailLines: string[] = [
        `To: ${toAddresses}`,
        `Subject: ${encodeHeaderValue(subject)}`,
      ];
      if (ccAddresses) emailLines.push(`Cc: ${ccAddresses}`);
      if (bccAddresses) emailLines.push(`Bcc: ${bccAddresses}`);
      emailLines.push("Content-Type: " + (html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8"));
      emailLines.push("MIME-Version: 1.0");
      emailLines.push("");
      emailLines.push(emailBody);

      const rawEmail = emailLines.join("\r\n");
      const encodedEmail = utf8ToBase64(rawEmail);

      const sendRes = await fetch(`${GMAIL_BASE}/messages/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: encodedEmail }),
      });

      const sendData = await sendRes.json();
      if (!sendRes.ok) return { success: false, error: "Gmail API error", data: sendData };

      // entity_id is a uuid column and Gmail message ids aren't UUIDs, so the
      // message id goes in payload instead (entity_id: sendData.id here
      // silently failed the insert on every send).
      await supabase.from("sybil_activity_logs").insert({
        workspace_id: workspaceId,
        entity_type: "email", entity_id: null,
        action: "sent", actor: "agent",
        actor_id: userId,
        payload: { to: toAddresses, subject, message_id: sendData.id, from_resolve: true },
      });

      return { success: true, data: { message_id: sendData.id, thread_id: sendData.threadId } };
    }

    if (action === "trash") {
      const messageId = params.message_id;
      if (!messageId) return { success: false, error: "message_id is required for trash" };

      const trashRes = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/trash`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!trashRes.ok) {
        const errData = await trashRes.json().catch(() => ({}));
        return { success: false, error: "Gmail API error", data: errData };
      }

      await supabase.from("sybil_activity_logs").insert({
        workspace_id: workspaceId,
        entity_type: "email", entity_id: null,
        action: "trashed", actor: "agent",
        actor_id: userId,
        payload: { message_id: messageId, from_resolve: true },
      });

      return { success: true, data: { message_id: messageId } };
    }

    return { success: false, error: `Unsupported gmail action: ${action}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Bright Data (web) action executor
// ============================================================================

async function callBrightData(
  token: string,
  action: string,
  params: Record<string, any>
): Promise<{ status: number; data: any }> {
  try {
    const resp = await fetch(BRIGHTDATA_FN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    const data = await resp.json().catch(() => ({ ok: false, error: "Invalid response from brightdata function" }));
    return { status: resp.status, data };
  } catch (err) {
    return { status: 502, data: { ok: false, error: err.message } };
  }
}

/**
 * Synthesizes a research answer strictly from the fetched source content —
 * never falls back to the LLM's own training knowledge, and only cites URLs
 * that were actually returned by Bright Data.
 */
async function synthesizeResearch(
  supabase: any,
  query: string,
  sources: Array<{ url: string; title: string; markdown: string }>
): Promise<{ summary: string; success: boolean }> {
  const sourcesBlock = sources
    .map((s, i) => `SOURCE ${i + 1}: ${s.title}\nURL: ${s.url}\nCONTENT:\n${s.markdown.slice(0, RESEARCH_SOURCE_CHARS)}`)
    .join("\n\n---\n\n");

  const systemPrompt =
    "You are a research assistant. You are given real web pages fetched just now for a specific query. " +
    "Write a concise answer (3-6 sentences) in English, based ONLY on the CONTENT of the sources below — " +
    "never use anything you already know from training, even if it seems relevant or you are confident about it. " +
    "If the sources don't actually answer the query, say so explicitly instead of guessing. " +
    "Write plain prose only — no markdown links, no [Title](URL) citations, no bracketed references. " +
    "The sources are already shown to the user separately, so just write the answer as running text.";

  const result = await callSynthesisLLM(supabase, [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Query: ${query}\n\n${sourcesBlock}` },
  ]);

  if (!result.success) {
    return { summary: "Could not generate a summary from the fetched sources.", success: false };
  }
  return { summary: result.content.trim(), success: true };
}

async function callSynthesisLLM(
  supabase: any,
  messages: Array<{ role: string; content: string }>
): Promise<{ content: string; success: boolean }> {
  const { data: providers } = await supabase
    .from("sybil_llm_providers")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (!providers || providers.length === 0) return { content: "", success: false };

  for (const provider of providers) {
    try {
      const apiKey = await getSecret(provider.secret_name);
      if (!apiKey) continue;

      const response = await fetch(`${provider.base_url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: provider.model, messages, max_tokens: provider.max_tokens, temperature: 0.2 }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      if (!content) continue;
      return { content, success: true };
    } catch {
      continue;
    }
  }

  return { content: "", success: false };
}

/**
 * btoa() throws on any char outside Latin1 (curly quotes, em-dashes, etc,
 * common in real email text) — encode via UTF-8 bytes first instead.
 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * RFC 2822 headers are 7-bit ASCII — a raw UTF-8 subject (accented Italian
 * text, em-dashes, etc) gets silently mangled by Gmail's inbound parser.
 * RFC 2047 encoded-words (=?UTF-8?B?...?=) are the standard fix.
 */
function encodeHeaderValue(value: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}