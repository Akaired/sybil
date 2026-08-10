// ============================================================================
// SYBIL — Edge Function: sentinel-check
// Cron: scorre sentinelle attive scadute, valuta condizione
// Se soddisfatta → crea WakeEvent + Signal
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/getSecret.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Per chiamate manuali (POST con auth), verifica
    // Per chiamate cron (senza auth), procedi direttamente
    const isCronCall = !req.headers.get("Authorization");
    if (!isCronCall) {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) return json({ error: "Invalid auth token" }, 401);
    }

    // A manual "Check now" call targets one sentinel directly, bypassing the
    // due-schedule filter — same checkSentinel() path the cron loop uses.
    const body = await req.json().catch(() => ({}));
    if (body?.sentinel_id) {
      const { data: sentinel, error: sentError } = await supabase
        .from("sybil_sentinels")
        .select("*")
        .eq("id", body.sentinel_id)
        .single();

      if (sentError || !sentinel) return json({ error: "Sentinel not found" }, 404);

      const deactivatedIds = await getDeactivatedOwnerWorkspaceIds(supabase, [sentinel]);
      if (deactivatedIds.has(sentinel.workspace_id)) {
        const result = { sentinel_id: sentinel.id, status: "skipped", detail: "Workspace owner account is deactivated" };
        return json({ checked: 0, triggered: 0, results: [result], timestamp: new Date().toISOString() }, 200);
      }

      const result = await checkSentinel(supabase, sentinel);
      return json({ checked: 1, triggered: result.status === "triggered" ? 1 : 0, results: [result], timestamp: new Date().toISOString() }, 200);
    }

    const now = new Date().toISOString();
    const { data: sentinels, error: sentError } = await supabase
      .from("sybil_sentinels")
      .select("*")
      .eq("status", "active")
      .or(`next_check_at.is.null,next_check_at.lte.${now}`)
      .limit(50);

    if (sentError) return json({ error: "Failed to fetch sentinels", detail: sentError.message }, 500);
    if (!sentinels || sentinels.length === 0) {
      return json({ checked: 0, triggered: 0, message: "No sentinels due" }, 200);
    }

    // Skip (don't touch next_check_at/state) sentinels whose workspace owner
    // has deactivated their account — they resume exactly where they left
    // off on reactivation. Not deleted, just left untouched this pass.
    const deactivatedWorkspaceIds = await getDeactivatedOwnerWorkspaceIds(supabase, sentinels);

    let triggered = 0;
    let checked = 0;
    const results: any[] = [];

    for (const sentinel of sentinels) {
      if (deactivatedWorkspaceIds.has(sentinel.workspace_id)) {
        results.push({ sentinel_id: sentinel.id, status: "skipped", detail: "Workspace owner account is deactivated" });
        continue;
      }
      checked++;
      try {
        const result = await checkSentinel(supabase, sentinel);
        results.push(result);
        if (result.status === "triggered") triggered++;
      } catch (err) {
        results.push({ sentinel_id: sentinel.id, status: "error", detail: err.message });
      }
    }

    return json({ checked, triggered, results, timestamp: now }, 200);

  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

// Owner = workspace_members.role='owner' (same source of truth as
// account-manage, not the legacy workspaces.owner_id pointer).
async function getDeactivatedOwnerWorkspaceIds(supabase: any, sentinels: any[]): Promise<Set<string>> {
  const workspaceIds = [...new Set(sentinels.map((s) => s.workspace_id).filter(Boolean))];
  if (workspaceIds.length === 0) return new Set();

  const { data: owners } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id")
    .eq("role", "owner")
    .in("workspace_id", workspaceIds);
  if (!owners || owners.length === 0) return new Set();

  const ownerUserIds = [...new Set(owners.map((o: any) => o.user_id))];
  const { data: deactivatedProfiles } = await supabase
    .from("sybil_profiles")
    .select("user_id")
    .eq("status", "deactivated")
    .in("user_id", ownerUserIds);
  const deactivatedUserIds = new Set((deactivatedProfiles ?? []).map((p: any) => p.user_id));

  return new Set(
    owners.filter((o: any) => deactivatedUserIds.has(o.user_id)).map((o: any) => o.workspace_id)
  );
}

async function checkSentinel(supabase: any, sentinel: any): Promise<any> {
  const now = new Date();
  const nextCheck = new Date(now.getTime() + sentinel.frequency_min * 60 * 1000);
  const workspaceId = sentinel.workspace_id;

  if (sentinel.type === "web") {
    // config.target is the single source of truth for the URL — no separate
    // target_url column (deliberately, to avoid two sources of truth).
    const targetUrl = sentinel.config?.target;
    if (!targetUrl) {
      await logCheckError(supabase, workspaceId, sentinel.id, "No target URL configured");
      await touchSentinel(supabase, sentinel.id, now, nextCheck);
      return { sentinel_id: sentinel.id, status: "error", detail: "No target URL" };
    }

    try {
      const visit = await visitViaBrightData(supabase, workspaceId, targetUrl);

      if (!visit.ok) {
        await logCheckError(supabase, workspaceId, sentinel.id, visit.error || "Bright Data visit failed", targetUrl);
        await touchSentinel(supabase, sentinel.id, now, nextCheck);
        return { sentinel_id: sentinel.id, status: "error", detail: visit.error || "Bright Data visit failed" };
      }

      const normalized = normalizeContent(visit.markdown || "");

      // Some pages (client-rendered SPAs whose content only appears after JS
      // hydration) come back from Bright Data as just a <title> tag or empty
      // shell — a handful of characters. Treating that sliver as a baseline
      // means the sentinel "works" forever while blindly watching nothing.
      // Surface it as a readable error instead of a silent no-op baseline.
      if (normalized.length < MIN_READABLE_CONTENT_CHARS) {
        await touchSentinel(supabase, sentinel.id, now, nextCheck, {
          status: "error",
          last_error: "This page could not be read — it may require JavaScript rendering.",
          last_error_at: now.toISOString(),
        });
        await logCheckError(supabase, workspaceId, sentinel.id, "Content too short to be a usable baseline (possible JS-rendered page)", targetUrl);
        return { sentinel_id: sentinel.id, status: "error", detail: "Page content too short — likely requires JS rendering" };
      }

      const contentHash = await sha256Hex(normalized);

      // First run: no baseline to compare against yet. Store it and stop —
      // a brand new sentinel must never fire on its own baseline.
      if (!sentinel.last_hash) {
        await touchSentinel(supabase, sentinel.id, now, nextCheck, {
          last_snapshot: normalized.slice(0, 10000),
          last_hash: contentHash,
          ...recoveryFields(sentinel),
        });
        await supabase.from("sybil_activity_logs").insert({
          workspace_id: workspaceId,
          entity_type: "sentinel", entity_id: sentinel.id,
          action: "checked", actor: "system",
          payload: { url: targetUrl, status: "baseline_stored" },
        });
        return { sentinel_id: sentinel.id, status: "baseline_stored" };
      }

      // Cost control: identical normalized content → no LLM call. Not optional.
      if (contentHash === sentinel.last_hash) {
        await touchSentinel(supabase, sentinel.id, now, nextCheck, recoveryFields(sentinel));
        await supabase.from("sybil_activity_logs").insert({
          workspace_id: workspaceId,
          entity_type: "sentinel", entity_id: sentinel.id,
          action: "checked", actor: "system",
          payload: { url: targetUrl, status: "unchanged" },
        });
        return { sentinel_id: sentinel.id, status: "unchanged" };
      }

      // Content changed → line-level diff, then the one LLM judgement call.
      const diff = computeLineDiff(sentinel.last_snapshot || "", normalized, DIFF_CAP_CHARS);
      const judgement = await judgeSentinelChange(supabase, workspaceId, sentinel.condition_text, targetUrl, diff);

      await supabase.from("sybil_activity_logs").insert({
        workspace_id: workspaceId,
        entity_type: "sentinel", entity_id: sentinel.id,
        action: "checked", actor: "system",
        payload: { url: targetUrl, status: judgement.matched ? "matched" : "changed_not_matched", summary: judgement.summary },
      });

      if (!judgement.matched) {
        // Always store the new snapshot/hash whether matched or not.
        await touchSentinel(supabase, sentinel.id, now, nextCheck, {
          last_snapshot: normalized.slice(0, 10000),
          last_hash: contentHash,
          ...recoveryFields(sentinel),
        });
        return { sentinel_id: sentinel.id, status: "changed_not_triggered", detail: judgement.summary };
      }

      // Condition satisfied → WakeEvent + Signal
      const detectedAt = now.toISOString();

      const { data: wakeEvent } = await supabase.from("sybil_wake_events").insert({
        workspace_id: workspaceId,
        sentinel_id: sentinel.id,
        task_id: sentinel.task_id,
        diff_summary: judgement.summary,
        evidence_url: targetUrl,
        evidence_snippet: judgement.evidence_snippet,
      }).select().single();

      // Se la sentinella ha un'azione configurata (es. mandare un'email), eseguila
      if (sentinel.config?.action?.type === "send_email") {
        const emailResult = await sendSentinelEmail(supabase, sentinel, { summary: judgement.summary, snippet: judgement.evidence_snippet });
        await supabase.from("sybil_activity_logs").insert({
          workspace_id: workspaceId,
          entity_type: "sentinel", entity_id: sentinel.id,
          action: emailResult.success ? "action_sent" : "action_error",
          actor: "system",
          payload: emailResult.success
            ? { type: "send_email", to: sentinel.config.action.to, message_id: emailResult.message_id }
            : { type: "send_email", to: sentinel.config.action.to, error: emailResult.error },
        });
      }

      const signalContent = `Sentinel triggered: "${sentinel.condition_text}". What changed: ${judgement.summary}. Target: ${targetUrl}`;

      const { data: signal } = await supabase.from("sybil_signals").insert({
        workspace_id: workspaceId,
        sentinel_id: sentinel.id,
        author_id: null,
        origin: "sentinel",
        raw_content: signalContent,
        metadata: {
          wake_event_id: wakeEvent?.id,
          sentinel_id: sentinel.id,
          diff_summary: judgement.summary,
          evidence_url: targetUrl,
          evidence_snippet: judgement.evidence_snippet,
          detected_at: detectedAt,
        },
        received_at: detectedAt,
      }).select().single();

      // Sentinelle "ricorrenti" restano attive e continuano a monitorare dopo lo scatto;
      // quelle "singole" (default) si fermano al primo evento, come prima.
      const recurring = sentinel.config?.recurring === true;
      const newStatus = recurring ? "active" : "triggered";

      await touchSentinel(supabase, sentinel.id, now, nextCheck, {
        last_snapshot: normalized.slice(0, 10000),
        last_hash: contentHash,
        status: newStatus,
        last_error: null,
        last_error_at: null,
      });

      // Riattiva task collegato — la sentinella è scattata, il task è ora
      // azionabile: lo spostiamo in Doing sulla board.
      if (sentinel.task_id) {
        await supabase.from("sybil_tasks").update({ status: "doing" }).eq("id", sentinel.task_id);
        await supabase.from("sybil_activity_logs").insert({
          workspace_id: workspaceId,
          entity_type: "task", entity_id: sentinel.task_id,
          action: "triggered", actor: "system",
          payload: { sentinel_id: sentinel.id, wake_event_id: wakeEvent?.id },
        });
      }

      return {
        sentinel_id: sentinel.id, status: "triggered",
        detail: {
          signal_id: signal?.id, wake_event_id: wakeEvent?.id,
          summary: judgement.summary, evidence_url: targetUrl,
          evidence_snippet: judgement.evidence_snippet, detected_at: detectedAt,
          sentinel_status: newStatus,
        },
      };

    } catch (err) {
      await logCheckError(supabase, workspaceId, sentinel.id, err.message, targetUrl);
      await touchSentinel(supabase, sentinel.id, now, nextCheck);
      return { sentinel_id: sentinel.id, status: "error", detail: err.message };
    }
  }

  // Tipi email/internal non ancora implementati
  await touchSentinel(supabase, sentinel.id, now, nextCheck);
  return { sentinel_id: sentinel.id, status: "skipped", detail: `Type ${sentinel.type} not implemented` };
}

// Clears a prior "page unreadable" error on any successful read. Only
// restores status to "active" if the sentinel was actually stuck in "error"
// — must never touch a "paused" or "triggered" status here.
function recoveryFields(sentinel: any): Record<string, any> {
  if (!sentinel.last_error && sentinel.status !== "error") return {};
  return {
    last_error: null,
    last_error_at: null,
    ...(sentinel.status === "error" ? { status: "active" } : {}),
  };
}

async function touchSentinel(supabase: any, sentinelId: string, now: Date, nextCheck: Date, extra: Record<string, any> = {}) {
  await supabase.from("sybil_sentinels").update({
    last_checked_at: now.toISOString(),
    next_check_at: nextCheck.toISOString(),
    ...extra,
  }).eq("id", sentinelId);
}

async function logCheckError(supabase: any, workspaceId: string, sentinelId: string, detail: string, url: string | null = null) {
  await supabase.from("sybil_activity_logs").insert({
    workspace_id: workspaceId,
    entity_type: "sentinel", entity_id: sentinelId,
    action: "check_error", actor: "system",
    payload: { url, detail },
  });
}

// ============================================================================
// Bright Data (web visit) — duplicated from brightdata/index.ts, not called
// over HTTP: that function requires a real user JWT (workspace membership
// check via supabase.auth.getUser), which a cron invocation never has. Same
// duplicate-rather-than-bypass pattern already used for sendSentinelEmail
// below instead of routing through gmail-actions. Keep the retry/timeout
// constants and status-resolution logic in sync with brightdata/index.ts by
// hand if that file changes.
// ============================================================================

const BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request";
const MARKDOWN_MAX_CHARS = 15000;
const VISIT_REQUEST_TIMEOUT_MS = 75000;
const TRANSIENT_RETRY_DELAYS_MS = [2000, 5000];
const TRANSIENT_ERROR_CODES = new Set(["expect_body", "captcha", "failed_query_rejected"]);
const DIFF_CAP_CHARS = 4000;
const MIN_READABLE_CONTENT_CHARS = 200;

function resolveTargetStatus(resp: Response, bodyText: string) {
  const headerStatus = resp.headers.get("x-brd-status-code");
  if (headerStatus) {
    return {
      status: parseInt(headerStatus, 10),
      errorCode: resp.headers.get("x-brd-error-code") || null,
      errorMessage: resp.headers.get("x-brd-error") || resp.headers.get("x-brd-err-msg") || null,
    };
  }
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && (parsed.status_code || parsed.error_code || parsed.error_message || parsed.error)) {
        return {
          status: parsed.status_code ?? resp.status,
          errorCode: parsed.error_code ?? null,
          errorMessage: parsed.error_message ?? parsed.error ?? null,
        };
      }
    } catch {
      // body isn't JSON (e.g. markdown) — fall through to the outer HTTP status
    }
  }
  return { status: resp.status, errorCode: null, errorMessage: null };
}

function isCallSuccessful(resolved: { status: number }, bodyText: string): boolean {
  return resolved.status >= 200 && resolved.status < 300 && !!bodyText && bodyText.length > 0;
}

function isTransientRejection(resolved: { status: number; errorCode: string | null }, bodyText: string): boolean {
  if (resolved.status === 429) return true;
  if (resolved.status === 502) return true;
  if (resolved.errorCode && TRANSIENT_ERROR_CODES.has(resolved.errorCode)) return true;
  if (!bodyText || bodyText.length === 0) return true;
  return false;
}

async function logBrightDataCall(supabase: any, workspaceId: string, target: string, status: string, latencyMs: number, bytes: number) {
  try {
    await supabase.from("sybil_web_call_logs").insert({
      workspace_id: workspaceId, action: "visit", target, status, latency_ms: latencyMs, bytes,
    });
  } catch {
    // Logging failures must never break the check.
  }
}

async function visitViaBrightData(supabase: any, workspaceId: string, url: string): Promise<{ ok: boolean; markdown?: string; error?: string }> {
  const apiKey = await getSecret("BRIGHTDATA_API_KEY");
  const zone = await getSecret("BRIGHTDATA_UNLOCKER_ZONE");
  if (!apiKey || !zone) return { ok: false, error: "Bright Data not configured" };

  const requestBody = { zone, url, format: "raw", data_format: "markdown" };

  const attempt = async () => {
    const startedAt = Date.now();
    const resp = await fetch(BRIGHTDATA_REQUEST_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(VISIT_REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    const latencyMs = Date.now() - startedAt;
    const resolved = resolveTargetStatus(resp, text);
    const success = isCallSuccessful(resolved, text);
    await logBrightDataCall(supabase, workspaceId, url, success ? "ok" : "error", latencyMs, text.length);
    return { text, resolved, success };
  };

  let result = await attempt();
  let wasTransient = !result.success && isTransientRejection(result.resolved, result.text);
  for (const delayMs of TRANSIENT_RETRY_DELAYS_MS) {
    if (result.success || !wasTransient) break;
    await sleep(delayMs);
    result = await attempt();
    wasTransient = !result.success && isTransientRejection(result.resolved, result.text);
  }

  if (!result.success) {
    return {
      ok: false,
      error: result.resolved.errorCode || result.resolved.errorMessage || (result.text ? "Bright Data request failed" : "Bright Data returned an empty response"),
    };
  }

  let markdown = result.text;
  if (markdown.length > MARKDOWN_MAX_CHARS) markdown = markdown.slice(0, MARKDOWN_MAX_CHARS);
  return { ok: true, markdown };
}

// ============================================================================
// Normalization, hashing, diffing
// ============================================================================

// Matches clock times, ISO/slash dates, "Month Day[, Year]" / "Day Month"
// forms, and weekday names — collapsed out so a page whose only change is
// "Updated 2 minutes ago" doesn't produce a new hash every check.
const DATE_TOKEN_RE =
  /\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{0,4}\b|\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*\d{0,4}\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

const BOILERPLATE_LINE_RE =
  /cookie|accept all|we use cookies|subscribe to (our )?newsletter|sign in|log in|skip to (main )?content|back to top|privacy policy|terms of service|all rights reserved/i;

/** Collapses whitespace, strips date/time tokens, drops cookie/nav boilerplate lines, lowercases. Keeps line boundaries so the result can still be diffed line-by-line. */
function normalizeContent(markdown: string): string {
  const cleanLines: string[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replace(DATE_TOKEN_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (!line) continue;
    if (BOILERPLATE_LINE_RE.test(line)) continue;
    cleanLines.push(line);
  }
  return cleanLines.join("\n");
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Naive line-level diff (added/removed lines by set membership, not a true LCS) — enough for the LLM to judge a change, capped to bound token cost. */
function computeLineDiff(oldText: string, newText: string, capChars: number): string {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const parts: string[] = [];
  for (const line of newLines) if (!oldSet.has(line)) parts.push(`+ ${line}`);
  for (const line of oldLines) if (!newSet.has(line)) parts.push(`- ${line}`);

  const diff = parts.join("\n");
  return diff.length > capChars ? diff.slice(0, capChars) : diff;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// LLM judgement — one call per changed sentinel
// ============================================================================

async function judgeSentinelChange(
  supabase: any,
  workspaceId: string,
  condition: string,
  url: string,
  diff: string
): Promise<{ matched: boolean; summary: string; evidence_snippet: string }> {
  const fallback = { matched: false, summary: "Could not evaluate the change — no LLM provider available.", evidence_snippet: diff.slice(0, 500) };

  const { data: providers } = await supabase
    .from("sybil_llm_providers")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (!providers || providers.length === 0) return fallback;

  const systemPrompt = `You are Sybil's sentinel evaluator. You receive a condition to monitor and a line-level diff of what changed on a web page since the last check. Decide whether this change satisfies the condition.

Respond ALWAYS in JSON:
{"matched": true/false, "summary": "the concrete fact detected, not a description of the evaluation", "evidence_snippet": "the relevant excerpt (max 500 chars)"}

IMPORTANT for "summary": report the actual factual information extracted from the change (e.g. the exact score and match status, the exact text found, the relevant number/value) — NOT a meta statement like "the condition is satisfied" or "the change relates to X". Someone reading "summary" should know the result without opening the page.

Be conservative: minor or unrelated changes should NOT satisfy substantial conditions.`;

  const userPrompt = `Condition: ${condition}. Here is what changed on ${url}: ${diff}. Does this change satisfy the condition? Answer JSON: {matched: bool, summary: string, evidence_snippet: string}`;

  for (const provider of providers) {
    try {
      const apiKey = await getSecret(provider.secret_name);
      if (!apiKey) continue;

      const response = await fetch(`${provider.base_url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 500, temperature: 0.2,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) continue;
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";

      await supabase.from("sybil_llm_call_logs").insert({
        workspace_id: workspaceId,
        provider_id: provider.id,
        function: "sentinel_check",
        success: true,
        tokens_in: data.usage?.prompt_tokens || 0,
        tokens_out: data.usage?.completion_tokens || 0,
      });

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        return {
          matched: result.matched === true,
          summary: typeof result.summary === "string" && result.summary ? result.summary : diff.slice(0, 200),
          evidence_snippet: typeof result.evidence_snippet === "string" && result.evidence_snippet ? result.evidence_snippet : diff.slice(0, 500),
        };
      } catch {
        return fallback;
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

// btoa() codifica solo Latin1: il contenuto delle pagine web spesso ha
// virgolette tipografiche, em-dash, emoji ecc. fuori da quel range, che
// altrimenti fanno fallire l'encoding dell'email in silenzio (check_error).
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

// RFC 2822 headers are 7-bit ASCII — a raw UTF-8 subject (accented Italian
// text, em-dashes, etc) gets silently mangled by Gmail's inbound parser.
// RFC 2047 encoded-words (=?UTF-8?B?...?=) are the standard fix.
function encodeHeaderValue(value: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Manda l'email configurata su una sentinella al momento del trigger.
// Gira come cron (service role, nessun JWT utente) quindi recupera la
// connessione Google dell'owner direttamente, invece di passare da gmail-actions.
async function sendSentinelEmail(
  supabase: any,
  sentinel: any,
  diffSummary: { summary: string; snippet: string }
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const action = sentinel.config.action;

  const { data: conn, error: connError } = await supabase
    .from("sybil_oauth_connections")
    .select("*")
    .eq("user_id", sentinel.owner_id)
    .eq("provider", "google")
    .single();

  if (connError || !conn) return { success: false, error: "Google account not connected for sentinel owner" };
  if (conn.status === "error" || conn.status === "disconnected") {
    return { success: false, error: `Google connection is ${conn.status}` };
  }

  let accessToken = conn.access_token;
  const now = new Date();
  if (!accessToken || (conn.expires_at && new Date(conn.expires_at) <= now)) {
    const refreshResult = await refreshGoogleToken(supabase, conn);
    if (!refreshResult.success) return { success: false, error: refreshResult.error };
    accessToken = refreshResult.access_token;
  }

  const bodyText = (action.body_template ? action.body_template + "\n\n" : "") +
    `Result: ${diffSummary.summary}` +
    (diffSummary.snippet ? `\n\nDetail from the page: ${diffSummary.snippet}` : "");

  const emailLines = [
    `To: ${Array.isArray(action.to) ? action.to.join(", ") : action.to}`,
    `Subject: ${encodeHeaderValue(action.subject)}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    bodyText,
  ];
  const encodedEmail = utf8ToBase64(emailLines.join("\r\n"));

  const sendRes = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodedEmail }),
  });

  const sendData = await sendRes.json();
  if (!sendRes.ok) return { success: false, error: JSON.stringify(sendData) };

  return { success: true, message_id: sendData.id };
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
        await supabase.from("sybil_oauth_connections").update({ status: "error" }).eq("id", conn.id);
      }
      return { success: false, error: errText };
    }

    const tokens = await response.json();
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    await supabase
      .from("sybil_oauth_connections")
      .update({ access_token: tokens.access_token, expires_at: expiresAt, status: "connected" })
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
