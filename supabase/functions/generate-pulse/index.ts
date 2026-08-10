// ============================================================================
// SYBIL — Edge Function: generate-pulse
// Cron (06:00 UTC daily): builds a per-workspace daily briefing from the
// last 24h of signals, resolutions, sentinel wake events and open tasks.
// Also callable on demand (with a user's Authorization header) to
// regenerate today's briefing for a single workspace.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Cron calls arrive with no Authorization header (see pg_cron job
    // 'generate-pulse-daily') and process every workspace. Manual calls
    // from the Pulse page carry the user's JWT and target one workspace.
    const isCronCall = !req.headers.get("Authorization");

    if (isCronCall) {
      const { data: workspaces, error: wsError } = await supabase
        .from("workspaces")
        .select("id");

      if (wsError) return json({ error: "Failed to load workspaces", detail: wsError.message }, 500);

      let generated = 0;
      let skipped = 0;
      const results: any[] = [];

      for (const ws of workspaces ?? []) {
        try {
          const today = todayDate();
          const { data: existing } = await supabase
            .from("sybil_pulses")
            .select("id")
            .eq("workspace_id", ws.id)
            .eq("briefing_date", today)
            .maybeSingle();

          if (existing) {
            skipped++;
            results.push({ workspace_id: ws.id, status: "skipped" });
            continue;
          }

          const pulse = await generateForWorkspace(supabase, ws.id);
          generated++;
          results.push({ workspace_id: ws.id, status: "generated", pulse_id: pulse.id });
        } catch (err) {
          results.push({ workspace_id: ws.id, status: "error", detail: err.message });
        }
      }

      return json({ processed: (workspaces ?? []).length, generated, skipped, results }, 200);
    }

    // Manual / on-demand regeneration for one workspace
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth token" }, 401);

    const body = await req.json().catch(() => ({}));
    const { workspace_id } = body;
    if (!workspace_id) return json({ error: "workspace_id is required" }, 400);

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) return json({ error: "Not a member of this workspace" }, 403);

    const pulse = await generateForWorkspace(supabase, workspace_id);
    return json({ pulse }, 200);

  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function generateForWorkspace(supabase: any, workspaceId: string): Promise<any> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = todayDate();

  const [{ data: signals }, { data: resolutions }, { data: wakeEvents }, { data: tasksDue }] = await Promise.all([
    supabase.from("sybil_signals").select("id, origin, raw_content").eq("workspace_id", workspaceId).gte("received_at", since),
    supabase.from("sybil_resolutions").select("action, outcome, detail").eq("workspace_id", workspaceId).gte("created_at", since),
    supabase.from("sybil_wake_events").select("diff_summary, evidence_url").eq("workspace_id", workspaceId).gte("created_at", since),
    supabase.from("sybil_tasks").select("title, due_date, priority").eq("workspace_id", workspaceId).neq("status", "done").lte("due_date", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const stats = {
    new_signals: signals?.length ?? 0,
    resolutions: resolutions?.length ?? 0,
    wake_events: wakeEvents?.length ?? 0,
    tasks_due: tasksDue?.length ?? 0,
  };

  const { summary, highlights } = await summarizeWorkspace(supabase, workspaceId, {
    signals: signals ?? [],
    resolutions: resolutions ?? [],
    wakeEvents: wakeEvents ?? [],
    tasksDue: tasksDue ?? [],
  }, stats);

  const content = { summary, highlights, stats };

  const { data: pulse, error: upsertError } = await supabase
    .from("sybil_pulses")
    .upsert(
      { workspace_id: workspaceId, briefing_date: today, content, generated_at: new Date().toISOString() },
      { onConflict: "workspace_id,briefing_date" }
    )
    .select()
    .single();

  if (upsertError) throw new Error(upsertError.message);

  await supabase.from("sybil_activity_logs").insert({
    workspace_id: workspaceId,
    entity_type: "pulse",
    entity_id: pulse.id,
    action: "generated",
    actor: "system",
    payload: { stats },
  });

  return pulse;
}

async function summarizeWorkspace(
  supabase: any,
  workspaceId: string,
  data: { signals: any[]; resolutions: any[]; wakeEvents: any[]; tasksDue: any[] },
  stats: { new_signals: number; resolutions: number; wake_events: number; tasks_due: number }
): Promise<{ summary: string; highlights: string[] }> {
  const fallback = templatedSummary(stats, data.tasksDue);

  if (stats.new_signals + stats.resolutions + stats.wake_events + stats.tasks_due === 0) {
    return { summary: "It's been quiet in the last 24 hours — no new signals, actions or sentinel triggers.", highlights: [] };
  }

  const { data: providers } = await supabase
    .from("sybil_llm_providers")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (!providers || providers.length === 0) return fallback;

  const systemPrompt = `You are Sybil's daily briefing writer. You receive a summary of a workspace's activity over the last 24 hours and write a short morning briefing in English for the team.

Respond ONLY with valid JSON: {"summary": "2-3 sentence overview", "highlights": ["short bullet point", ...]}

Rules:
- "summary" is a friendly, concrete 2-3 sentence overview of what happened — no meta phrases like "the workspace had activity".
- "highlights" is 3-6 short bullet points, most important first (overdue/urgent tasks and sentinel triggers first, then resolved actions, then new signals). Each bullet must state a concrete fact, not a category count restatement.
- If there is very little to report, keep it brief and say so — do not invent activity.
- Never use Markdown formatting inside the strings.`;

  const userPrompt = `Last 24 hours for this workspace:
- New signals received: ${stats.new_signals}
- Actions resolved: ${stats.resolutions} (${JSON.stringify(data.resolutions.slice(0, 20))})
- Sentinel triggers: ${stats.wake_events} (${JSON.stringify(data.wakeEvents.slice(0, 10).map((w) => w.diff_summary))})
- Tasks due today or overdue: ${stats.tasks_due} (${JSON.stringify(data.tasksDue.slice(0, 10).map((t) => ({ title: t.title, due_date: t.due_date, priority: t.priority })))})`;

  for (const provider of providers) {
    try {
      const apiKey = Deno.env.get(provider.secret_name);
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
          max_tokens: 500,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) continue;
      const data2 = await response.json();
      const content = data2.choices?.[0]?.message?.content || "";

      await supabase.from("sybil_llm_call_logs").insert({
        workspace_id: workspaceId,
        provider_id: provider.id,
        function: "generate_pulse",
        success: true,
        tokens_in: data2.usage?.prompt_tokens || 0,
        tokens_out: data2.usage?.completion_tokens || 0,
      });

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        if (typeof result.summary === "string" && Array.isArray(result.highlights)) {
          return { summary: result.summary, highlights: result.highlights.filter((h: unknown) => typeof h === "string") };
        }
      } catch {
        // fall through to fallback
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

function templatedSummary(
  stats: { new_signals: number; resolutions: number; wake_events: number; tasks_due: number },
  tasksDue: any[]
): { summary: string; highlights: string[] } {
  const summary = `In the last 24 hours: ${stats.new_signals} new signal(s), ${stats.resolutions} action(s) resolved, ${stats.wake_events} sentinel trigger(s), and ${stats.tasks_due} task(s) due.`;
  const highlights = tasksDue.slice(0, 5).map((t) => `Task due: "${t.title}"${t.due_date ? ` (${new Date(t.due_date).toLocaleDateString("en-GB")})` : ""}`);
  return { summary, highlights };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
