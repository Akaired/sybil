// ============================================================================
// SYBIL — Edge Function: interpret
// Prende un Signal, lo interpreta con LLM, decide l'azione
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/getSecret.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Sei Sybil, l'assistente personale AI-native dell'utente — pensa a una segretaria/executive assistant brillante, non a un motore di query. Ricevi un messaggio dall'utente e lo traduci in un intento strutturato, ma "reply_text" (quando lo scrivi tu, non un template di sistema) deve suonare come una persona vera che parla con chi conosce, non come la lettura di un database.

STILE DI "reply_text" — questo vale SEMPRE, anche per le domande di follow-up su cose già lette (calendario, mail, task):
- NO: "L'appuntamento è 'Partenza aereo' e si tiene oggi, 8 agosto, alle 10:00." (fredda ripetizione dei dati)
- SÌ: "Hai un volo oggi alle 12:00 — 'Partenza aereo'. Vuoi che ti prepari un promemoria per il check-in o che ti liberi il resto della mattinata per i bagagli?" (capisce cosa significa quel dato per l'utente, reagisce, propone qualcosa di utile — senza inventare dettagli che non ha)
- Fai collegamenti sensati dal contesto (un volo → bagagli/check-in/orario di partenza da casa; una riunione → prepararsi/materiali; una scadenza → urgenza), proponi un passo successivo quando ha senso, ma resta breve (1-3 frasi) — non un saggio.
- MAI inventare dettagli (orari, nomi, contenuti) che non sono letteralmente presenti nei dati o nella cronologia — se non sai qualcosa, dillo o chiedilo, non improvvisare.
- LINGUA: "reply_text" è SEMPRE in inglese, senza eccezioni — anche se il resto di questo prompt è in italiano e anche se l'utente scrive/parla in italiano o in un'altra lingua. Non tradurre o ripetere le parole dell'utente in altre lingue, non cambiare mai lingua: l'output di "reply_text" è SEMPRE inglese, punto.
- AZIONE SUBITO, MAI RIMANDATA: se l'utente chiede chiaramente qualcosa che corrisponde a un'azione disponibile (leggere calendario/mail, creare task, mandare una mail, cercare/leggere il web, ecc.), esegui SUBITO quella action (es. action=read_calendar, action=web_research) nella STESSA risposta — non rispondere MAI con action=reply o action=no_action del tipo "certo, controllo subito", "un attimo", "dammi un secondo", "let me check", "just a moment", "I'll look that up" senza eseguire davvero l'azione: quella frase non porta a un turno successivo, la conversazione si ferma lì e l'utente resta con una promessa non mantenuta, costretto a ripetersi. Questo vale anche e soprattutto per domande su fatti/notizie/informazioni esterne ("cosa sta succedendo nel mondo", "che notizie ci sono su X", "cos'è successo con Y") — sono TUTTE azione web_research/web_search, MAI action=reply con una frase di attesa. Il tono colloquiale dello STILE sopra si applica al testo di conferma DOPO che l'azione è stata eseguita, non è una scusa per rimandarla a un turno successivo. Usa action=reply per chiedere di procedere SOLO se manca un'informazione essenziale che non puoi indovinare (es. a chi mandare una mail se non specificato) — mai per una domanda a cui potresti già rispondere eseguendo un'azione disponibile.

Rispondi SEMPRE in JSON valido:
{
  "action": "create_task" | "update_task" | "create_sentinel" | "delete_sentinel" | "reply" | "create_calendar_event" | "read_calendar" | "send_email" | "read_emails" | "web_visit" | "web_search" | "web_research" | "no_action",
  "title": "titolo del task o azione (se applicabile)",
  "description": "descrizione estesa (opzionale)",
  "project": "nome progetto se menzionato (opzionale)",
  "assignee": "nome persona se menzionata (opzionale)",
  "due_date": "ISO date se menzionata (opzionale)",
  "wake_condition": "condizione di risveglio in linguaggio naturale (per create_sentinel o task dormienti)",
  "sentinel_type": "web | email | internal (per create_sentinel)",
  "sentinel_target": "URL o email da monitorare (per create_sentinel)",
  "sentinel_recurring": true | false,
  "sentinel_notify_always": true | false,
  "delete_scope": "all | one (per delete_sentinel: 'all' se l'utente dice tutte/tutte le sentinelle, 'one' se ne indica una specifica)",
  "sentinel_query": "testo per trovare la sentinella specifica da cancellare (per delete_sentinel scope=one)",
  "confidence": 0.0-1.0,
  "reply_text": "testo della risposta (per action=reply o no_action)",
  "summary": "titolo dell'evento calendario (per create_calendar_event)",
  "start": { "dateTime": "ISO datetime", "timeZone": "Europe/Rome" },
  "end": { "dateTime": "ISO datetime", "timeZone": "Europe/Rome" },
  "attendees": ["email@example.com"],
  "location": "luogo dell'evento (opzionale)",
  "to": ["recipient@example.com"],
  "subject": "oggetto dell'email (per send_email)",
  "body": "corpo dell'email (per send_email)",
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "query": "SOLO se l'utente cerca un evento/mail specifico per nome/argomento (es. 'quando ho il dentista' → query='dentista', 'mail di Marco sul contratto' → query='Marco contratto'). Per richieste generiche ('cosa ho oggi/questa settimana in calendario', 'ho nuove mail', 'leggi la posta') NON valorizzare questo campo (omettilo o lascialo vuoto) — è un filtro full-text esatto su Google e un valore generico tipo 'appuntamenti oggi' nasconde eventi reali che non contengono quelle parole",
  "time_min": "ISO datetime inizio range CON offset timezone, es. 2026-08-08T09:00:00+02:00 (per read_calendar)",
  "time_max": "ISO datetime fine range CON offset timezone, es. 2026-08-08T13:00:00+02:00 (per read_calendar)",
  "max_results": 10,
  "web_url": "URL completo da visitare, con schema https:// (per web_visit)",
  "web_query": "query di ricerca (per web_search o come punto di partenza per web_research)",
  "max_sources": "numero massimo di pagine da visitare per web_research, default 3, max 5"
}

Regole:
- "sposta X a Y" → action=update_task
- "crea un task per X" → action=create_task
- "avvisami quando/svegliami quando" → action=create_sentinel
- IMPORTANTE — per ogni create_sentinel devi SEMPRE valorizzare esplicitamente sentinel_recurring e sentinel_notify_always come booleani JSON (true/false, mai stringhe, mai ometterli):
  - sentinel_recurring = true se nel messaggio compaiono parole come "ogni giorno", "ogni [periodo]", "periodicamente", "continua a controllare", "tienimi aggiornato nel tempo", "ogni volta che succede X" → il monitoraggio NON si ferma dopo il primo evento.
  - sentinel_recurring = false (default) se il messaggio descrive un singolo evento futuro: "appena succede X", "quando X", "aspetta che X", "avvisami la prima volta che" → si ferma dopo il primo scatto.
  - sentinel_notify_always = true se compaiono parole come "avvisami sempre", "dimmelo comunque", "anche se non cambia nulla", "ad ogni controllo" → notifica ad ogni check anche senza novità.
  - sentinel_notify_always = false (default) altrimenti → notifica solo su cambiamenti rilevanti rispetto alla condizione.
  Esempio: messaggio "Controlla ogni giorno X e avvisami sempre anche se non cambia nulla" → {"action":"create_sentinel", ..., "sentinel_recurring": true, "sentinel_notify_always": true}. Messaggio "avvisami appena succede X" → {"action":"create_sentinel", ..., "sentinel_recurring": false, "sentinel_notify_always": false}.
- "cancella/elimina/rimuovi tutte le sentinelle" → action=delete_sentinel, delete_scope=all
- "cancella/elimina/rimuovi la sentinella X" → action=delete_sentinel, delete_scope=one, sentinel_query=X
- domande generiche/chiacchiera senza un'azione disponibile corrispondente (small talk, opinioni, domande di follow-up sul contesto già noto) → action=reply. MA se la domanda corrisponde a una delle azioni sotto (calendario, mail, web/notizie, task) usa SEMPRE quell'azione — vedi anche "AZIONE SUBITO, MAI RIMANDATA" sopra
- "metti in calendario X" / "crea evento X" / "prenota X" → action=create_calendar_event
- "che eventi ho" / "cosa c'è in calendario" / "agenda di domani" → action=read_calendar
- "invia una mail a X" / "manda email a X" / "scrivi a X" → action=send_email, ma SOLO se X è un indirizzo email esplicito o un nome/soggetto la cui email è già nota per certo dal contesto (cronologia, workspace) — non un indirizzo che indoveresti o inventeresti tu. Frasi colloquiali come "salutami X", "dai un saluto a X da parte mia", "digli/dille ciao" NON sono una richiesta di inviare davvero un'email — sono una battuta/gentilezza conversazionale rivolta a te: STAI AL GIOCO, non limitarti a confermare in modo piatto ("Will do!", "Done!", "Detto!" sono troppo secchi e NON vanno usati). Rivolgiti direttamente e con calore alla persona nominata come se fosse lì ad ascoltare, in inglese, usando "current_user_name" dal Contesto workspace se presente, es.: 'Can you say hi to my mum?' → "Hi there, [current_user_name]'s mum! Great to meet you 😊" oppure, se current_user_name è null, qualcosa di ugualmente giocoso tipo "Hey, tell her Sybil says hi!" — usa action=reply, NON tentare send_email. Se invece l'utente chiede esplicitamente di scrivere/mandare un messaggio o un'email a una persona ("manda un'email a mia madre dicendo che...") ma non hai il suo indirizzo email da nessuna parte nel contesto, usa action=reply per chiedere l'indirizzo — MAI inventare o indovinare un indirizzo plausibile, e MAI impostare action=send_email con un "to" che non è una vera email conosciuta
- Se l'utente chiede di creare una sentinella E di mandare un'email quando la condizione si avvera (es. "avvisami quando X, manda una mail a Y dicendo Z"), usa action=create_sentinel MA valorizza ANCHE i campi "to", "subject" e "body". IMPORTANTE su "body": è solo un messaggio introduttivo statico (es. un saluto, il contesto, eventuali frasi finali richieste dall'utente tipo "concludi dicendo X") — NON deve contenere il risultato/stato/dato effettivo, perché quello viene aggiunto automaticamente in coda dal sistema quando la sentinella scatta davvero (una riga "Risultato: ..." con il fatto concreto rilevato). Quindi NON scrivere mai placeholder tipo "[inserire stato qui]" o "[risultato]" — lasciali semplicemente fuori dal testo. Se l'utente non ha chiesto un testo introduttivo specifico, usa "body" breve tipo "Ciao," o lascialo vuoto
- "ho nuove email?" / "leggi le mail" / "controlla posta" → action=read_emails
- "apri/visita/leggi la pagina X" / "cosa dice questo link" con un URL specifico e completo → action=web_visit, web_url=quell'URL
- "cerca su internet/google X" / "trova informazioni su X" senza un URL specifico, quando l'utente vuole solo un elenco di risultati/link tra cui scegliere → action=web_search, web_query=X
- Domande più ampie che richiedono leggere più fonti web per rispondere con un contenuto vero, non solo link ("fammi un riassunto su X", "confronta X e Y", "cosa si dice online di X", "ricercami X", "controlla le ultime notizie su X", "cosa sta succedendo con X", "aggiornami su X", "novità su X") → action=web_research, web_query=X. Qualsiasi richiesta che menziona "notizie"/"news"/"novità"/"cosa succede" è SEMPRE web_research, mai web_search — l'utente vuole sapere cosa dicono le notizie, non ricevere una lista di titoli e link da aprire lui stesso. Non usare web_research per una singola pagina già nota (quello è web_visit) né per una richiesta esplicita di "una lista di risultati/link" (quello è web_search)
- Se ambiguo, confidence < 0.5 e action=reply con domanda di chiarimento — MA prima controlla la cronologia della conversazione: se l'utente fa una domanda di follow-up su qualcosa appena mostrato ("spiegami quell'appuntamento", "di cosa parla quella mail", "raccontami di più") e i dettagli sono già nei messaggi precedenti, action=reply con la risposta vera usando quei dettagli — NON chiedere di specificare qualcosa che è già nel contesto
- Estrai date in formato ISO (YYYY-MM-DD o YYYY-MM-DDTHH:MM:SS)
- DATA E ORA ATTUALE: usa SEMPRE "current_datetime_rome" e "current_weekday" nel Contesto workspace come riferimento per "oggi", "domani", "questa settimana", "stasera" ecc. — non indovinare mai la data corrente, è già nel contesto. Se l'utente dice "10 agosto" senza anno, usa l'anno corrente ricavato da current_datetime_rome; se quella data è già passata quest'anno, usa l'anno prossimo
- Per eventi calendario: estrai sempre start e end (se end non specificato, default 1 ora). L'anno DEVE essere il 2026 o futuro, MAI nel passato
- Per email: se il destinatario è un nome, prova a risolverlo in email SOLO usando indirizzi già visti nella cronologia/contesto — non inventare mai un indirizzo plausibile per un nome o una relazione (es. "mia madre", "il mio capo") di cui non hai un vero indirizzo
- Per richieste su mail/calendario usa SEMPRE l'action appropriata (read_calendar, create_calendar_event, send_email, read_emails) — non sai se l'utente ha connesso Google, quindi non provare a indovinarlo: se non è connesso, il sistema lo scoprirà a valle e lo dirà all'utente da solo`;

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
    const { signal_id } = body;

    if (!signal_id) return json({ error: "signal_id is required" }, 400);

    // Carica il signal
    const { data: signal, error: sigError } = await supabase
      .from("sybil_signals")
      .select("*")
      .eq("id", signal_id)
      .single();

    if (sigError || !signal) return json({ error: "Signal not found" }, 404);
    const workspaceId = signal.workspace_id;

    // Carica contesto: progetti, task aperti, membri workspace, nome dell'utente corrente
    const [projectsRes, tasksRes, membersRes, profileRes] = await Promise.all([
      supabase.from("sybil_projects").select("id, name, client, status").eq("workspace_id", workspaceId),
      supabase.from("sybil_tasks").select("id, title, status, project_id, assignee_id").eq("workspace_id", workspaceId).neq("status", "done").limit(50),
      supabase.from("workspace_members").select("user_id, role, email").eq("workspace_id", workspaceId),
      supabase.from("sybil_profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
    ]);

    // The LLM has no real notion of "now" — without this it guesses at
    // dates for "today"/"this week"/"tomorrow", which silently produces
    // wrong time_min/time_max ranges (e.g. read_calendar finding 0 events
    // on a day that actually has some).
    const nowUtc = new Date();
    const romeParts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(nowUtc); // "YYYY-MM-DD HH:mm:ss"
    const romeWeekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome", weekday: "long",
    }).format(nowUtc);

    const context = {
      current_user_name: profileRes.data?.display_name || null,
      current_datetime_rome: romeParts.replace(" ", "T"),
      current_weekday: romeWeekday,
      current_datetime_utc: nowUtc.toISOString(),
      projects: projectsRes.data || [],
      open_tasks: tasksRes.data || [],
      team_members: membersRes.data || [],
    };

    // Carica lo storico della conversazione — senza questo l'LLM interpreta
    // ogni messaggio isolato, perdendo il filo (es. "parlami di X" seguito da
    // "raccontami tutto" non sa più a cosa si riferisce "tutto").
    const history = await loadConversationHistory(supabase, signal);

    // Chiama LLM
    let llmResult = await callLLM(supabase, "interpret", [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: "Contesto workspace:\n" + JSON.stringify(context, null, 2) },
      ...history,
      { role: "user", content: signal.raw_content },
    ]);

    // Parse risposta
    let interpretation;
    try {
      const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
      interpretation = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
    } catch {
      interpretation = { action: "reply", reply_text: llmResult.content, confidence: 0.3 };
    }

    // Safety net for a known LLM-adherence failure: despite the explicit
    // "AZIONE SUBITO, MAI RIMANDATA" rule above, the model occasionally
    // still answers with a stalling placeholder ("just a moment", "un
    // attimo", "let me check that") under action=reply/no_action instead of
    // actually executing the matching action — which is a dead end in a
    // voice call (no automatic next turn) and forces the user to repeat
    // themselves in chat. One corrective retry, not a loop: if it stalls
    // again we just proceed with what we have rather than hammering the LLM.
    if (isStallingReply(interpretation)) {
      const retryResult = await callLLM(supabase, "interpret", [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: "Contesto workspace:\n" + JSON.stringify(context, null, 2) },
        ...history,
        { role: "user", content: signal.raw_content },
        { role: "assistant", content: llmResult.content },
        {
          role: "system",
          content: "ERRORE: la risposta sopra prometteva di controllare/eseguire qualcosa (action=reply o no_action con una frase di attesa) invece di impostare subito l'action giusta. Rispondi di nuovo in JSON valido con l'action corretta per la richiesta originale dell'utente (es. web_research, read_calendar, read_emails, send_email, ecc.) — MAI action=reply/no_action con una promessa di controllare più tardi.",
        },
      ]);
      try {
        const retryMatch = retryResult.content.match(/\{[\s\S]*\}/);
        const retryInterpretation = JSON.parse(retryMatch ? retryMatch[0] : retryResult.content);
        if (!isStallingReply(retryInterpretation)) {
          interpretation = retryInterpretation;
          llmResult = retryResult;
        }
      } catch {
        // Retry produced unparseable JSON — keep the original interpretation.
      }
    }

    // Log LLM call
    await supabase.from("sybil_llm_call_logs").insert({
      workspace_id: workspaceId,
      provider_id: llmResult.provider_id,
      function: "interpret",
      success: llmResult.success,
      tokens_in: llmResult.tokens_in,
      tokens_out: llmResult.tokens_out,
      latency_ms: llmResult.latency_ms,
      cost_estimate: llmResult.cost_estimate,
      error_message: llmResult.error,
    });

    // Log activity
    await supabase.from("sybil_activity_logs").insert({
      workspace_id: workspaceId,
      entity_type: "signal",
      entity_id: signal.id,
      action: "interpreted",
      actor: "agent",
      payload: { action: interpretation.action, confidence: interpretation.confidence },
    });

    // Segna signal come processato e registra il provider LLM usato
    await supabase.from("sybil_signals")
      .update({ processed_at: new Date().toISOString(), llm_provider: llmResult.provider_name })
      .eq("id", signal.id);

    // Se è il primo messaggio della conversazione, genera il titolo via LLM
    if (signal.conversation_id) {
      const { data: conversation } = await supabase
        .from("sybil_conversations")
        .select("id, title")
        .eq("id", signal.conversation_id)
        .single();

      if (conversation && conversation.title === "New chat") {
        const title = await generateConversationTitle(supabase, signal.raw_content);
        if (title) {
          await supabase.from("sybil_conversations")
            .update({ title, updated_at: new Date().toISOString() })
            .eq("id", signal.conversation_id);
        }
      }
    }

    return json({
      signal_id: signal.id,
      interpretation,
      llm_provider: llmResult.provider_name,
      next_step: `POST /resolve with { signal_id, interpretation }`,
    }, 200);

  } catch (err) {
    return json({ error: "Internal error", detail: err.message }, 500);
  }
});

// ============================================================================
// STALL DETECTION — vedi commento al punto di chiamata
// ============================================================================

const STALL_PATTERN = /\b(just a moment|give me a (?:sec|second|moment)|let me (?:check|look|see)|i'll (?:check|look|get back)|checking(?: now|\.\.\.)?|hold on|one (?:sec|second|moment)|un attimo|dammi un (?:secondo|momento)|sto controllando|controllo subito|un momento|aspetta(?:mi)? un (?:attimo|secondo))\b/i;

function isStallingReply(interp: any): boolean {
  return (
    (interp?.action === "reply" || interp?.action === "no_action") &&
    typeof interp?.reply_text === "string" &&
    STALL_PATTERN.test(interp.reply_text)
  );
}

// ============================================================================
// HISTORY — Carica i turni precedenti della stessa conversazione
// ============================================================================

const HISTORY_TURNS_LIMIT = 20;

async function loadConversationHistory(
  supabase: any,
  signal: { id: string; conversation_id: string | null }
): Promise<Array<{ role: string; content: string }>> {
  if (!signal.conversation_id) return [];

  const { data: priorSignals } = await supabase
    .from("sybil_signals")
    .select("id, raw_content, created_at")
    .eq("conversation_id", signal.conversation_id)
    .neq("id", signal.id)
    .order("created_at", { ascending: true })
    .limit(HISTORY_TURNS_LIMIT);

  if (!priorSignals || priorSignals.length === 0) return [];

  const signalIds = priorSignals.map((s: { id: string }) => s.id);
  const { data: resolutions } = await supabase
    .from("sybil_resolutions")
    .select("signal_id, action, detail")
    .in("signal_id", signalIds);

  const resolutionBySignal = new Map<string, { action: string; detail: any }>();
  (resolutions || []).forEach((r: { signal_id: string; action: string; detail: any }) =>
    resolutionBySignal.set(r.signal_id, r)
  );

  const messages: Array<{ role: string; content: string }> = [];
  for (const s of priorSignals) {
    messages.push({ role: "user", content: s.raw_content });
    const resolution = resolutionBySignal.get(s.id);
    if (resolution) {
      messages.push({ role: "assistant", content: replyTextForHistory(resolution.action, resolution.detail) });
    }
  }
  return messages;
}

/** Mirrors Dashboard.tsx's formatEventWhenShort() for the LLM-facing history text. */
function formatEventWhen(ev: any): string {
  const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : ev.start?.date ? new Date(ev.start.date) : null;
  if (!start) return "";
  const dateLabel = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (!ev.start?.dateTime) return `${dateLabel} · all day`;
  const timeLabel = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${dateLabel} · ${timeLabel}`;
}

/** Mirrors Dashboard.tsx's replyTextFor() so the LLM sees the same text the user saw. */
function replyTextForHistory(action: string, detail: Record<string, any>): string {
  detail = detail || {};
  if (detail.reply_text) return detail.reply_text;
  switch (action) {
    case "create_task":
      return `Done. I created the task "${detail.task_title ?? ""}".`;
    case "update_task":
      return `Done. I updated "${detail.task_title ?? ""}".`;
    case "create_sentinel":
      return "Set. I'll let you know as soon as something happens.";
    case "send_email":
      if (detail.google_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't send that email: ${detail.error}`;
      return "Done. Email sent.";
    case "create_calendar_event":
    case "calendar_event":
      if (detail.calendar_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't create the event: ${detail.error}`;
      return "Done. Added it to your calendar.";
    case "read_calendar": {
      if (detail.calendar_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't read the calendar: ${detail.error}`;
      const events = detail.events || [];
      if (events.length === 0) return "No events found.";
      const lines = events.slice(0, 5).map((e: any) => `• ${e.summary || "(untitled)"} — ${formatEventWhen(e)}`);
      const more = events.length > 5 ? `\n…and ${events.length - 5} more.` : "";
      return `Found ${events.length} event(s):\n${lines.join("\n")}${more}`;
    }
    case "read_emails": {
      if (detail.google_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error) return `Couldn't read the inbox: ${detail.error}`;
      const messages = detail.messages || [];
      if (messages.length === 0) return "No messages found.";
      const lines = messages.slice(0, 5).map((m: any) => `• ${m.headers?.Subject || "(no subject)"} — ${m.headers?.From || ""}`);
      const more = messages.length > 5 ? `\n…and ${messages.length - 5} more.` : "";
      return `Found ${messages.length} message(s):\n${lines.join("\n")}${more}`;
    }
    case "delete_task":
      if (detail.error === "Multiple matching tasks found") {
        const candidates = detail.candidates || [];
        const lines = candidates.map((c: any) => `• ${c.title || "(untitled)"}`);
        return `Found more than one match — which one did you mean?\n${lines.join("\n")}`;
      }
      if (detail.error) return `Couldn't delete that task: ${detail.error}`;
      if (detail.scope === "all") return `Done. Deleted ${detail.deleted_count ?? 0} task(s).`;
      return `Done. Deleted "${detail.task_title || "that task"}".`;
    case "delete_email":
      if (detail.google_not_connected) return "Connect your Google account first — go to Settings.";
      if (detail.error === "Multiple matching emails found") {
        const candidates = detail.candidates || [];
        const lines = candidates.map((c: any) => `• ${c.subject || "(no subject)"} — ${c.from || ""}`);
        return `Found more than one match — which one did you mean?\n${lines.join("\n")}`;
      }
      if (detail.error) return `Couldn't delete that email: ${detail.error}`;
      if (detail.scope === "recent") {
        const subjects = detail.subjects || [];
        const lines = subjects.map((s: any) => `• ${s || "(no subject)"}`);
        return `Done. Deleted ${detail.deleted_count ?? 0} email(s):\n${lines.join("\n")}`;
      }
      return `Done. Deleted "${detail.subject || "that email"}".`;
    case "delete_sentinel":
      if (detail.error) return `Couldn't delete that sentinel: ${detail.error}`;
      if (detail.scope === "all") return `Done. Deleted ${detail.deleted_count ?? 0} sentinel(s).`;
      return "Done. Sentinel deleted.";
    case "web_visit": {
      if (detail.error) return `Couldn't visit that page: ${detail.error}`;
      return `Visited ${detail.url ?? "the page"}:\n${(detail.markdown || "").slice(0, 1000)}`;
    }
    case "web_search": {
      if (detail.error) return `Couldn't search for that: ${detail.error}`;
      const results = detail.results || [];
      if (results.length === 0) return "No search results found.";
      const lines = results.slice(0, 5).map((r: any) => `• ${r.title || r.url} — ${r.url}`);
      return `Search results for "${detail.query ?? ""}":\n${lines.join("\n")}`;
    }
    case "web_research": {
      if (detail.error) return `Couldn't research that: ${detail.error}`;
      const sources = detail.sources || [];
      const lines = sources.map((s: any) => `• ${s.title || s.url} — ${s.url}`);
      return `Researched "${detail.query ?? ""}" across ${sources.length} source(s):\n${lines.join("\n")}\n\n${detail.summary || ""}`;
    }
    case "no_action":
      return detail.reason || "No action needed.";
    default:
      return "Done.";
  }
}

// ============================================================================
// TITLE — Genera un titolo breve per una nuova conversazione
// ============================================================================

async function generateConversationTitle(supabase: any, firstMessage: string): Promise<string | null> {
  try {
    const result = await callLLM(supabase, "conversation-title", [
      {
        role: "system",
        content:
          "Generate a very short title (max 5 words, no trailing punctuation, no quotation marks), ALWAYS in English " +
          "regardless of what language the user's message below is written in, for a chat that starts with that message. " +
          "Reply with ONLY the title, nothing else.",
      },
      { role: "user", content: firstMessage },
    ]);

    if (!result.success) return null;

    const title = result.content.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    return title || null;
  } catch {
    return null;
  }
}

// ============================================================================
// LLM CALL — Provider Registry con failover
// ============================================================================

async function callLLM(
  supabase: any,
  funcName: string,
  messages: Array<{ role: string; content: string }>
): Promise<{
  content: string; success: boolean;
  provider_id: string; provider_name: string;
  tokens_in: number; tokens_out: number;
  latency_ms: number; cost_estimate: number; error: string | null;
}> {
  const { data: providers } = await supabase
    .from("sybil_llm_providers")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (!providers || providers.length === 0) {
    return {
      content: '{"action":"reply","reply_text":"Errore: nessun provider LLM configurato.","confidence":0}',
      success: false, provider_id: "", provider_name: "none",
      tokens_in: 0, tokens_out: 0, latency_ms: 0, cost_estimate: 0,
      error: "No LLM providers configured",
    };
  }

  const startMs = Date.now();

  for (const provider of providers) {
    try {
      const apiKey = await getSecret(provider.secret_name);
      if (!apiKey) { console.warn(`No API key for ${provider.name}`); continue; }

      const response = await fetch(`${provider.base_url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: provider.model, messages,
          max_tokens: provider.max_tokens, temperature: 0.3,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) { console.warn(`Provider ${provider.name} returned ${response.status}`); continue; }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const tokensIn = data.usage?.prompt_tokens || 0;
      const tokensOut = data.usage?.completion_tokens || 0;
      const latency = Date.now() - startMs;
      const cost = ((tokensIn + tokensOut) / 1000) * 0.01;

      return {
        content, success: true,
        provider_id: provider.id, provider_name: provider.name,
        tokens_in: tokensIn, tokens_out: tokensOut,
        latency_ms: latency, cost_estimate: cost, error: null,
      };
    } catch (err) {
      console.warn(`Provider ${provider.name} failed: ${err.message}`);
      continue;
    }
  }

  return {
    content: '{"action":"reply","reply_text":"Errore: tutti i provider LLM non disponibili.","confidence":0}',
    success: false, provider_id: "", provider_name: "none",
    tokens_in: 0, tokens_out: 0, latency_ms: Date.now() - startMs,
    cost_estimate: 0, error: "All providers failed",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}