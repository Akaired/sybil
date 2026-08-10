// ============================================================================
// SYBIL — Edge Function: brightdata
// Shared Bright Data client used by both the agent (chat tool-calls) and
// sentinels (scheduled checks). The BRIGHTDATA_API_KEY never reaches the browser.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSecretCache, getSecret } from "../_shared/getSecret.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request";
const MARKDOWN_MAX_CHARS = 15000;
const DATASET_POLL_INTERVAL_MS = 3000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const VISIT_REQUEST_TIMEOUT_MS = 75000; // hard-protected pages retry internally against anti-bot; edge fn wall-clock limit is 150s on Free plan
const TRANSIENT_RETRY_DELAYS_MS = [2000, 5000]; // up to 3 total attempts (initial + 2 retries)
const TRANSIENT_ERROR_CODES = new Set(["expect_body", "captcha", "failed_query_rejected"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let supabase;
  let workspaceId;

  try {
    supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    // Verifica membership nel workspace, come speechmatics-token/ingest/interpret/resolve
    const { data: membership, error: wsError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, email")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (wsError || !membership) return json({ error: "User not in any workspace" }, 403);

    workspaceId = membership.workspace_id;
  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const { action, ...params } = body || {};

  try {
    switch (action) {
      case "visit":
        return json(await handleVisit(supabase, workspaceId, params));
      case "search":
        return json(await handleSearch(supabase, workspaceId, params));
      case "dataset":
        return json(await handleDataset(supabase, workspaceId, params));
      default:
        return json({ ok: false, error: `Unknown action: ${action}`, status: 400 }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: "Internal error", detail: err.message, status: 500 }, 500);
  }
});

// ----------------------------------------------------------------------------
// shared: POST to Bright Data with one retry-with-backoff on transient rejection.
//
// Bright Data's REST API returns HTTP 200 for the API call itself; the TARGET
// fetch result is reported separately via x-brd-status-code / x-brd-error-code /
// x-brd-error response headers (or status_code / error_code / error_message in a
// JSON body as a fallback). resp.ok therefore never reflects target failures —
// the resolved status below is the only reliable success signal.
// ----------------------------------------------------------------------------
function resolveTargetStatus(resp, bodyText) {
  const headerStatus = resp.headers.get("x-brd-status-code");
  if (headerStatus) {
    return {
      status: parseInt(headerStatus, 10),
      errorCode: resp.headers.get("x-brd-error-code") || null,
      errorMessage: resp.headers.get("x-brd-error") || resp.headers.get("x-brd-err-msg") || null,
      source: "headers"
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
          source: "body"
        };
      }
    } catch {
      // body isn't JSON (e.g. markdown/html) — fall through to the outer HTTP status
    }
  }

  return { status: resp.status, errorCode: null, errorMessage: null, source: "http" };
}

function isCallSuccessful(resolved, bodyText) {
  return resolved.status >= 200 && resolved.status < 300 && !!bodyText && bodyText.length > 0;
}

function isTransientRejection(resolved, bodyText) {
  if (resolved.status === 429) return true;
  if (resolved.status === 502) return true;
  if (resolved.errorCode && TRANSIENT_ERROR_CODES.has(resolved.errorCode)) return true;
  if (!bodyText || bodyText.length === 0) return true;
  return false;
}

async function postToBrightData(supabase, workspaceId, action, target, requestBody, apiKey, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const attempt = async () => {
    const startedAt = Date.now();
    const resp = await fetch(BRIGHTDATA_REQUEST_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await resp.text();
    const latencyMs = Date.now() - startedAt;
    const resolved = resolveTargetStatus(resp, text);
    const success = isCallSuccessful(resolved, text);
    await logCall(supabase, workspaceId, action, target, success ? "ok" : "error", latencyMs, text.length);
    return { resp, text, latencyMs, resolved, success };
  };

  let result = await attempt();
  let wasTransient = !result.success && isTransientRejection(result.resolved, result.text);

  for (const delayMs of TRANSIENT_RETRY_DELAYS_MS) {
    if (result.success || !wasTransient) break;
    await sleep(delayMs);
    result = await attempt();
    wasTransient = !result.success && isTransientRejection(result.resolved, result.text);
  }

  return { ...result, wasTransient };
}

// ----------------------------------------------------------------------------
// action: visit
// ----------------------------------------------------------------------------
async function handleVisit(supabase, workspaceId, params) {
  const { url, expect_selector } = params || {};
  const startedAt = Date.now();

  if (!url) {
    await logCall(supabase, workspaceId, "visit", null, "error", Date.now() - startedAt, 0);
    return { ok: false, error: "Missing url", status: 400 };
  }

  try {
    const secretCache = createSecretCache();
    const apiKey = await getSecret("BRIGHTDATA_API_KEY", secretCache);
    const zone = await getSecret("BRIGHTDATA_UNLOCKER_ZONE", secretCache);
    if (!apiKey || !zone) {
      await logCall(supabase, workspaceId, "visit", url, "error", Date.now() - startedAt, 0);
      return { ok: false, error: "Bright Data not configured", status: 500 };
    }

    const requestBody = {
      zone,
      url,
      format: "raw",
      data_format: "markdown"
    };
    if (expect_selector) {
      requestBody.headers = { "x-unblock-expect": expect_selector };
    }

    const { text, resolved, success, latencyMs } = await postToBrightData(
      supabase, workspaceId, "visit", url, requestBody, apiKey, VISIT_REQUEST_TIMEOUT_MS
    );

    if (!success) {
      return {
        ok: false,
        error: resolved.errorCode || resolved.errorMessage || (text ? "Bright Data request failed" : "Bright Data returned an empty response"),
        detail: text,
        status: resolved.status,
        latency_ms: latencyMs
      };
    }

    let markdown = text;
    let truncated = false;
    if (markdown.length > MARKDOWN_MAX_CHARS) {
      markdown = markdown.slice(0, MARKDOWN_MAX_CHARS);
      truncated = true;
    }

    return {
      ok: true,
      url,
      markdown,
      fetched_at: new Date().toISOString(),
      truncated,
      latency_ms: latencyMs
    };
  } catch (err) {
    await logCall(supabase, workspaceId, "visit", url, "error", Date.now() - startedAt, 0);
    return { ok: false, error: "Visit failed", detail: err.message, status: 502 };
  }
}

// ----------------------------------------------------------------------------
// action: search
// ----------------------------------------------------------------------------
function buildSearchUrl(engine, query, num) {
  const q = encodeURIComponent(query);
  switch (engine) {
    case "bing":
      return `https://www.bing.com/search?q=${q}&count=${num}&brd_json=1`;
    case "duckduckgo":
      return `https://duckduckgo.com/html/?q=${q}&brd_json=1`;
    case "google":
    default:
      return `https://www.google.com/search?q=${q}&hl=en&gl=us&brd_json=1`;
  }
}

async function runSearch(supabase, workspaceId, apiKey, zone, engine, query, num) {
  const searchUrl = buildSearchUrl(engine, query, num);
  const { text: raw, resolved, success, wasTransient } = await postToBrightData(
    supabase, workspaceId, "search", searchUrl, { zone, url: searchUrl, format: "raw" }, apiKey
  );

  if (!success) {
    return {
      ok: false,
      wasTransient,
      error: resolved.errorCode || resolved.errorMessage || (raw ? "Bright Data request failed" : "Bright Data returned an empty response"),
      detail: raw,
      status: resolved.status
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, wasTransient: false, error: "Failed to parse Bright Data search response", status: 502 };
  }

  const organic = Array.isArray(parsed.organic) ? parsed.organic : [];
  const results = organic.map((r, i) => ({
    position: r.rank ?? i + 1,
    title: r.title ?? "",
    url: r.link ?? r.url ?? "",
    snippet: r.description ?? r.snippet ?? ""
  }));

  return { ok: true, results };
}

async function handleSearch(supabase, workspaceId, params) {
  const { query, engine = "google", num = 10 } = params || {};
  const startedAt = Date.now();

  if (!query) {
    await logCall(supabase, workspaceId, "search", null, "error", Date.now() - startedAt, 0);
    return { ok: false, error: "Missing query", status: 400 };
  }

  try {
    const secretCache = createSecretCache();
    const apiKey = await getSecret("BRIGHTDATA_API_KEY", secretCache);
    const zone = await getSecret("BRIGHTDATA_SERP_ZONE", secretCache);
    if (!apiKey || !zone) {
      await logCall(supabase, workspaceId, "search", buildSearchUrl(engine, query, num), "error", Date.now() - startedAt, 0);
      return { ok: false, error: "Bright Data not configured", status: 500 };
    }

    const primary = await runSearch(supabase, workspaceId, apiKey, zone, engine, query, num);
    if (primary.ok) {
      return { ok: true, query, results: primary.results, engine_used: engine };
    }

    // Only fall back to bing when the primary engine's failure was a transient
    // target-side rejection (captcha, rate limit, empty body, etc) — not for
    // config/auth/zone errors, which bing would fail identically.
    if (engine !== "bing" && primary.wasTransient) {
      const fallback = await runSearch(supabase, workspaceId, apiKey, zone, "bing", query, num);
      if (fallback.ok) {
        return { ok: true, query, results: fallback.results, engine_used: "bing" };
      }
      return {
        ok: false,
        error: fallback.error || primary.error,
        detail: fallback.detail || primary.detail,
        status: fallback.status || primary.status,
        engine_used: "bing"
      };
    }

    return { ok: false, error: primary.error, detail: primary.detail, status: primary.status, engine_used: engine };
  } catch (err) {
    await logCall(supabase, workspaceId, "search", buildSearchUrl(engine, query, num), "error", Date.now() - startedAt, 0);
    return { ok: false, error: "Search failed", detail: err.message, status: 502 };
  }
}

// ----------------------------------------------------------------------------
// action: dataset
// ----------------------------------------------------------------------------
async function handleDataset(supabase, workspaceId, params) {
  const { dataset_id, input, timeout_ms = 45000 } = params || {};
  const startedAt = Date.now();
  const target = dataset_id ? `dataset:${dataset_id}` : null;

  if (!dataset_id || !Array.isArray(input)) {
    await logCall(supabase, workspaceId, "dataset", target, "error", Date.now() - startedAt, 0);
    return { ok: false, error: "Missing dataset_id or input array", status: 400 };
  }

  try {
    const apiKey = await getSecret("BRIGHTDATA_API_KEY");
    if (!apiKey) {
      await logCall(supabase, workspaceId, "dataset", target, "error", Date.now() - startedAt, 0);
      return { ok: false, error: "Bright Data not configured", status: 500 };
    }

    const triggerUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${encodeURIComponent(dataset_id)}&format=json`;
    const triggerResp = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000)
    });

    if (triggerResp.status === 200) {
      const data = await triggerResp.json();
      const latencyMs = Date.now() - startedAt;
      await logCall(supabase, workspaceId, "dataset", target, "ok", latencyMs, JSON.stringify(data).length);
      return { ok: true, data };
    }

    if (triggerResp.status !== 202) {
      const detail = await triggerResp.text();
      const latencyMs = Date.now() - startedAt;
      await logCall(supabase, workspaceId, "dataset", target, "error", latencyMs, detail.length);
      return { ok: false, error: "Bright Data dataset trigger failed", detail, status: triggerResp.status };
    }

    const { snapshot_id } = await triggerResp.json();
    const snapshotUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshot_id}?format=json`;

    while (Date.now() - startedAt < timeout_ms) {
      await sleep(DATASET_POLL_INTERVAL_MS);

      const pollResp = await fetch(snapshotUrl, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000)
      });

      if (pollResp.status === 200) {
        const data = await pollResp.json();
        const latencyMs = Date.now() - startedAt;
        await logCall(supabase, workspaceId, "dataset", target, "ok", latencyMs, JSON.stringify(data).length);
        return { ok: true, data };
      }

      if (pollResp.status !== 202) {
        const detail = await pollResp.text();
        const latencyMs = Date.now() - startedAt;
        await logCall(supabase, workspaceId, "dataset", target, "error", latencyMs, detail.length);
        return { ok: false, error: "Bright Data snapshot poll failed", detail, status: pollResp.status };
      }
      // 202 — snapshot not ready yet, keep polling
    }

    const latencyMs = Date.now() - startedAt;
    await logCall(supabase, workspaceId, "dataset", target, "timeout", latencyMs, 0);
    return { ok: false, pending: true, snapshot_id };
  } catch (err) {
    await logCall(supabase, workspaceId, "dataset", target, "error", Date.now() - startedAt, 0);
    return { ok: false, error: "Dataset request failed", detail: err.message, status: 502 };
  }
}

// ----------------------------------------------------------------------------
// shared helpers
// ----------------------------------------------------------------------------
async function logCall(supabase, workspaceId, action, target, status, latencyMs, bytes) {
  try {
    await supabase.from("sybil_web_call_logs").insert({
      workspace_id: workspaceId,
      action,
      target,
      status,
      latency_ms: latencyMs,
      bytes
    });
  } catch {
    // Logging failures must never break the caller's request.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
