<p align="center">
  <img src="public/svg/sybil-mark.svg" alt="Sybil" width="120" height="76" />
</p>

<div align="center">

# Sybil

### The agentic workspace that knows *when*, because it listens to you and watches the world.

**Built for the AI Factory / native.builder Hackathon — August 2026**

[Live demo](https://sybil-agent.com) · [Product description](SYBIL-PRD-MVP.md) · [Architecture](#architecture) · [Getting started](#getting-started)

Powered by **Bright Data** · **Speechmatics** · **AI/ML API** (with **OpenRouter** as fallback)

</div>

---

## Table of contents

- [The problem](#the-problem)
- [What Sybil does](#what-sybil-does)
- [Sponsor technology](#sponsor-technology)
- [Architecture](#architecture)
- [The signal pipeline](#the-signal-pipeline)
- [Sentinels and dormant tasks](#sentinels-and-dormant-tasks)
- [Model-agnostic LLM layer](#model-agnostic-llm-layer)
- [Application surface](#application-surface)
- [Data model](#data-model)
- [Edge function reference](#edge-function-reference)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Configuration reference](#configuration-reference)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Team](#team)

---

## The problem

The Greeks had two words for time. **Chronos** is clock time — dates, deadlines, calendars. **Kairos** is the *right moment*.

Every project tool in existence — Notion, Asana, Trello, Linear, Todoist, Monday, ClickUp — is built entirely on Chronos. The only question they know how to ask a task is *"by when?"*

But most real work doesn't have a date. It has a **condition**.

- Redo the pricing **when** the competitor moves
- Follow up **when** the client hasn't replied
- Send the file **when** the previous round is approved

Today those things end up in one of two places: a fake due date invented so it isn't forgotten, or a head that's already full. Both fail.

**Sybil is built for that second kind of work.**

---

## What Sybil does

### Many doors in

Chat in the app, message it on Telegram, hold a button and talk, forward an email, or connect a calendar — or do nothing at all, and it updates itself.

| Door | What it does |
|---|---|
| **In-app chat** | Multi-conversation history, sharing a chat with a teammate, edit/like/dislike on any message |
| **Telegram** | The same agent, from a phone — linked with a one-time code, same memory, same pipeline |
| **Voice in** | Real-time dictation and a continuous voice call with the agent, via Speechmatics |
| **Voice out** | The Pulse briefing, read out loud |
| **Calendar** | Reads the week, writes events and time blocks, shares calendars between teammates |
| **Mail** | Reads, sends and deletes Gmail on the connected Google account |
| **Web** | Sentinels watching live pages, with change detection and proof |

### Two senses

Sybil **hears** (Speechmatics — real-time transcription and text-to-speech) and **sees** (Bright Data — live web monitoring). Most agents only read what's typed at them.

### Sentinels — dormant tasks

A task in Sybil doesn't need a due date. It can carry a **wake condition written in plain language**:

> *"Wake me when Competitor X changes their prices."*
> *"Let me know if this quote gets no reply within 5 days."*

The agent turns that sentence into a **sentinel**. Today the full detect-and-wake cycle — fetch, hash, diff, judge, wake — runs end to end for **web** sentinels. Email (silence on a sent thread) and internal-state sentinels are visible and creatable in the UI as the next targets for the same engine, not a separate build (see [Known limitations](#known-limitations)).

### The Pulse

Not a task list. A generated briefing — what changed while you were away, what's worth doing now, and why — with live counters, a calendar/deadlines rail, and a recent-activity feed, optionally read out loud.

---

## Sponsor technology

Sybil doesn't call a model. It orchestrates three services doing three different things: **one watches the world, one listens to the user, one decides what it all means.**

| Partner | Role in Sybil | Stage | Where in the code |
|---|---|---|---|
| **Bright Data** | **The eyes.** Web sentinel checks, chat-triggered visits/search/research, change detection, evidence capture | World perception | `sentinel-check`, `brightdata` |
| **Speechmatics** | **The ears and the voice.** Real-time transcription (dictation and voice call), Pulse read-aloud | User perception | `speechmatics-token`, `speechmatics-tts` |
| **AI/ML API** (primary) **+ OpenRouter** (fallback) | **The brain.** Interpreter, Resolver, Pulse generation, sentinel judgement | Interpretation & decision | `_shared/llm.ts`, `interpret`, `resolve`, `generate-pulse` |

---

## Architecture

The frontend is a **Vite + React** SPA, hosted on **Netlify**. All state, secrets and server logic live in **Supabase**: Postgres with Row Level Security, Auth, Storage, and Edge Functions (Deno). There is no application server to operate — every privileged operation happens inside an edge function, which is the only place an API key ever exists.

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT — Vite + React (Netlify)                                     │
│  public site (prerendered routes)  ·  authenticated app  ·  admin    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ supabase-js (anon key + user JWT)
┌───────────────────────────────▼──────────────────────────────────────┐
│  SUPABASE                                                            │
│  Postgres + RLS   Auth   Storage   Vault                             │
│                                                                      │
│  ┌────────────────────── EDGE FUNCTIONS (Deno) ──────────────────┐   │
│  │ ingest        interpret        resolve       chat-message      │   │
│  │ chat-share    sentinel-check   brightdata     generate-pulse   │   │
│  │ speechmatics-token/tts        calendar-actions/share           │   │
│  │ gmail-actions  oauth-google-*  telegram-link  telegram-webhook │   │
│  │ team-invite/manage  workspace-onboarding  account-manage       │   │
│  │ admin-api     blog-admin      docs-admin     docs-public       │   │
│  └──────┬──────────────┬──────────────┬──────────────┬───────────┘   │
└─────────┼──────────────┼──────────────┼──────────────┼───────────────┘
          │              │              │              │
     Bright Data   Speechmatics   LLM providers    Google / Telegram
                                 (OpenAI-compatible)
```

**Design rules baked into the codebase**

1. Secrets never reach the browser. If a key would need to be in client code, the feature moves into an edge function.
2. Tenant isolation lives in Postgres RLS, never in a frontend `if`.
3. No module imports a model vendor SDK directly. Everything goes through `_shared/llm.ts`.
4. Every agent action writes to `sybil_activity_logs` with `actor = 'agent'`, so the app can always show *what it did and why*.

---

## The signal pipeline

Everything that enters Sybil enters as a **Signal** — a chat message, a Telegram message, a voice note, a sentinel trigger. One agent interprets it, another resolves it into an action. The pipeline is three server functions in sequence, and every step of every turn — signal, interpretation, resolution, outcome — lands in its own table, so the **Activity** screen is a direct read of real history, not a reconstruction.

```
  in-app chat ──┐
  Telegram    ──┤
  voice       ──┼──▶  ingest  ──▶  SIGNAL { channel, raw_content, transcript, author, ts }
  sentinels   ──┘
                          │
                          ▼
              ┌───────────────────────┐
              │  interpret            │   intent + entities
              │                       │   who · what · when · project · condition
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │  resolve              │   creates/updates a task, opens/deletes a
              │                       │   sentinel, reads/writes calendar & mail,
              │                       │   searches the web, or replies in chat
              └───────────┬───────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │ generate-pulse│  what changed · what to do now · why
                  └───────────────┘
```

### Why the Resolver is the interesting part

Without a resolver, *"move Rossi's quote to Monday"* creates a **new task literally titled that** instead of moving the one that already exists. The resolver compares title, project and assignee across the workspace's open tasks and updates the right one — or asks, when more than one candidate is plausible.

---

## Sentinels and dormant tasks

A **sentinel** is a natural-language condition, a target and a check frequency, linked to a task. A task with a linked sentinel is dormant until the condition fires — then it's moved to Doing and shown at the top of the board with a reference to the event that woke it.

### Check cycle (web sentinels — fully automated today)

```
sentinel-check(sentinel_id)
   │
   ├─▶ fetch target content        ← Bright Data
   │
   ├─▶ normalise text  →  hash
   │
   ├─▶ hash == last_hash ?
   │       yes → update last_checked_at, return.        ← no LLM call, no cost
   │       no  ↓
   │
   ├─▶ compute textual diff
   │
   ├─▶ llm.complete: "does this change satisfy: {condition_text}?"
   │
   └─▶ yes → insert wake_event { diff_summary, evidence_url, evidence_snippet }
             task moves to 'doing'
             sentinel.status = 'triggered'
             (optionally) send the notification email configured at creation time
```

**Hashing before diffing keeps the whole thing affordable.** A page that hasn't changed never reaches a language model.

### Three sentinel types

| Type | Target | Status |
|---|---|---|
| `web` | URL or search query, via Bright Data | Fully automated end to end |
| `email` | Silence on an outbound thread | Creatable and visible in the UI; automated verification is the next step for the same engine |
| `internal` | Workspace state (e.g. a deadline at risk) | Creatable and visible in the UI; automated verification is the next step for the same engine |

---

## Model-agnostic LLM layer

No module in this codebase knows the name of a model vendor. Every call goes through one shared function.

```ts
// supabase/functions/_shared/llm.ts
export async function complete(
  messages: ChatMessage[],
  opts?: { workspaceId?: string; fn?: string; json?: boolean; maxTokens?: number }
): Promise<CompletionResult>
```

`complete()` reads `sybil_llm_providers` ordered by `priority`, and calls the first active provider at an **OpenAI-compatible** endpoint. On error or timeout it falls through to the next provider. Adding a provider is one table row — no code change:

```sql
insert into sybil_llm_providers (name, base_url, secret_name, model, priority, is_active)
values ('primary', 'https://api.aimlapi.com/v1', 'LLM_PRIMARY_KEY', '<model>', 10, true);
```

**Active today:** AI/ML API as primary, OpenRouter as fallback, a third provider configured and disabled. Every call is logged to `sybil_llm_call_logs` (provider, function, tokens, latency, cost estimate) — the main interpretation call logs its outcome even on a fully-failed failover; sentinel-judgement and Pulse-generation log a successful attempt only.

**Why this exists:** hackathon credit pools are finite and expire mid-week. An architecture bolted to a single vendor dies the moment they run out.

---

## Application surface

### Public site

| Route | Content |
|---|---|
| `/` | Landing: Chronos/Kairos thesis, animated chat scene, partner logos, demo login |
| `/pricing` | Four plans, real prices, placeholder activation buttons |
| `/roadmap` | Today / next / later |
| `/blog`, `/blog/:slug` | Articles, rich editor on the admin side |
| `/docs`, `/docs/:slug` | Public docs, plus `llms.txt` / `llms-full.txt` for external AI agents |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | Email/password auth |
| `/welcome`, `/join/:code` | Create or join a workspace |

### Authenticated app

| Screen | Content |
|---|---|
| **Pulse** *(home)* | Daily briefing, live counters, calendar/deadlines rail, recent-activity feed, TTS readback |
| **Chat** | Multi-conversation, side history panel, sharing with a teammate |
| **Team** | Members, roles, email invites, invite links |
| **Calendar** | Google Calendar read/write, calendar sharing between teammates |
| **Mail** | Gmail read/send/delete |
| **Tasks** | Backlog/To Do/Doing/Done board, drag-and-drop, priority, labels |
| **Activity** | Timeline split between the agent's actions and received signals |
| **Sentinels** | Active sentinels, condition, target, last check, "check now", plan-based active-sentinel limit |
| **Documentation** | The public docs, reachable from inside the app |
| **Settings** | Account · Connections (incl. Telegram linking) · Skills · Plan |
| **Admin** *(platform_admins only)* | Overview · Usage · Providers · Health · Audit · Secrets · Blog/Docs |

First-login onboarding runs once (`sybil_profiles.onboarding_completed`): a job-category question personalizes a spotlighted, click-through tour of every screen, ending in a feedback survey saved to `sybil_onboarding_feedback`.

---

## Data model

Every workspace-scoped table carries `workspace_id` and is protected by Row Level Security. See [SYBIL-PRD-MVP.md §3](SYBIL-PRD-MVP.md#3-data-model) for the full table-by-table breakdown; the load-bearing ones:

```
── Identity & tenancy ─────────────────────────────────────────────
workspaces · workspace_members · workspace_join_links · invites
sybil_profiles · sybil_onboarding_feedback

── Work ───────────────────────────────────────────────────────────
sybil_projects · sybil_tasks

── The engine ────────────────────────────────────────────────────
sybil_signals · sybil_resolutions · sybil_sentinels · sybil_wake_events
sybil_pulses · sybil_activity_logs · sybil_conversations · chat_shares
sybil_web_call_logs

── Agent ──────────────────────────────────────────────────────────
sybil_llm_providers · sybil_llm_call_logs

── Connectors ─────────────────────────────────────────────────────
sybil_oauth_connections · calendar_shares · sybil_telegram_links

── Public content ────────────────────────────────────────────────
sybil_blog_posts · sybil_docs_pages · sybil_docs_categories

── Observability & admin ──────────────────────────────────────────
platform_admins · sybil_admin_audit
```

### Reference RLS policy

```sql
alter table sybil_tasks enable row level security;

create policy "members access their own workspace"
on sybil_tasks for all
using (
  workspace_id in (
    select workspace_id from workspace_members
    where user_id = auth.uid()
  )
);
```

`sybil_llm_providers`, `platform_admins` and `sybil_admin_audit` are **not reachable with a user token at all** — only touched from edge functions using the service role. `sybil_admin_audit` has no client-facing policy whatsoever: writes happen exclusively server-side.

---

## Edge function reference

| Function | Does | Secrets used |
|---|---|---|
| `ingest` | Records an incoming signal from chat, voice or Telegram | — |
| `interpret` | Interprets the signal with the LLM layer, returns a structured intent | via `llm.ts` |
| `resolve` | Executes the intent: create/update task, open/delete sentinel, calendar/mail read-write, web search/visit, chat reply | via `llm.ts` |
| `chat-message` | Edit or like/dislike an already-sent message | — |
| `chat-share` | Share one or more conversations with another workspace member | — |
| `sentinel-check` | Fetch → hash → diff → LLM judgement → `wake_event` + task reactivation for a web sentinel | `BRIGHTDATA_API_TOKEN`, via `llm.ts` |
| `brightdata` | Search, page visits and structured web queries requested in chat | `BRIGHTDATA_API_TOKEN` |
| `generate-pulse` | Builds the daily briefing from the last 24h of workspace state | via `llm.ts` |
| `speechmatics-token` | Issues a short-lived token for real-time transcription | `SPEECHMATICS_API_KEY` |
| `speechmatics-tts` | Synthesizes Pulse/agent text into audio | `SPEECHMATICS_API_KEY` |
| `oauth-google-start`, `oauth-status` | Google OAuth flow and connection status | `GOOGLE_CLIENT_ID`/`SECRET` |
| `calendar-actions` | CRUD on Google Calendar events | Google OAuth token |
| `calendar-share` | Share a calendar with a teammate (view-only enforced for guests) | — |
| `gmail-actions` | Read, send, delete Gmail | Google OAuth token |
| `team-invite`, `team-manage` | Email invites, role changes, member removal, invite links | `RESEND_API_KEY` |
| `workspace-onboarding` | Create a new workspace or join one via invite/link | — |
| `account-manage` | Deactivate/reactivate/delete an account, with workspace transfer or closure | — |
| `admin-api` | All admin panel actions, role-checked (staff/superadmin), every action audited | service role |
| `blog-admin`, `docs-admin` | Editorial management of the blog and docs | service role |
| `docs-public` | Serves public docs content, incl. `llms.txt` for external AI agents | — |
| `telegram-link` | Generates, checks and revokes the one-time Telegram linking code | — |
| `telegram-webhook` | Receives Telegram updates, authenticates via a secret header, feeds the signal pipeline | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` |

### Shared modules

```
supabase/functions/_shared/
  llm.ts          provider registry, failover, call logging
```

---

## Project structure

```
sybil/
├── src/
│   ├── pages/
│   │   ├── (public)         Landing · Pricing · Roadmap · Blog · Docs · auth
│   │   ├── admin/           AdminOverview · AdminUsage · AdminHealth · AdminAudit
│   │   │                    AdminProviders · AdminSecrets · BlogList/Edit · DocsList/Edit
│   │   └── settings/        SettingsAccount · SettingsConnections · SettingsSkills · SettingsPlan
│   │   Pulse · ChatList · Calendar · Mail · Projects · Tasks · Sentinels · Activity · Team
│   ├── components/
│   ├── lib/                 one client module per edge function (sybil.ts, mail.ts,
│   │                        calendar.ts, adminApi.ts, telegramLink.ts, workspace.ts, …)
│   ├── contexts/            AuthContext and friends
│   └── styles/
├── supabase/
│   ├── functions/           one directory per edge function + _shared/
│   └── migrations/          schema changes tracked in git (not the full history —
│                             see note below)
└── public/                  svg/ (brand mark, states, lockups) · robots.txt · sitemap.xml
```

> Some schema and edge-function changes in this project were applied directly against the live Supabase project (via the Management API) rather than committed as migration files first. `supabase/migrations/` is not a complete history of the schema — [SYBIL-PRD-MVP.md §3](SYBIL-PRD-MVP.md#3-data-model) reflects the real, current state.

---

## Getting started

### Prerequisites

- Node 20+
- A Supabase project
- A Telegram bot token (from **@BotFather**)
- API credentials for Bright Data and Speechmatics
- Google OAuth credentials (Calendar + Gmail scopes)
- A Resend account (team invite emails)
- At least one OpenAI-compatible model endpoint

### 1. Install and configure the client

```bash
npm install
cp .env.example .env.local
```

```dotenv
# .env.local — client side, public by design
VITE_TELEGRAM_BOT_USERNAME=your_bot_username
```

> Supabase URL and anon key are currently inlined as `EDGE_BASE` in `src/lib/*.ts` rather than read from env vars — the anon key is public by design (RLS does the real work), but if you fork this project, point those constants at your own Supabase project.

### 2. Apply the schema

Run the schema against your own Supabase project (tables, RLS policies, and the built-in skill/provider seed rows) using the SQL in `supabase/migrations/` as a starting point — see the note in [Project structure](#project-structure) about its coverage.

### 3. Set the server secrets

```bash
supabase secrets set \
  LLM_PRIMARY_KEY=...        \
  LLM_FALLBACK_KEY=...       \
  BRIGHTDATA_API_TOKEN=...   \
  SPEECHMATICS_API_KEY=...   \
  TELEGRAM_BOT_TOKEN=...     \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  RESEND_API_KEY=...         \
  GOOGLE_CLIENT_ID=...       \
  GOOGLE_CLIENT_SECRET=...
```

### 4. Register the model providers

```sql
insert into sybil_llm_providers (name, base_url, secret_name, model, priority, is_active) values
  ('primary',  'https://api.aimlapi.com/v1', 'LLM_PRIMARY_KEY',  '<model>', 10, true),
  ('fallback', 'https://openrouter.ai/api/v1', 'LLM_FALLBACK_KEY', '<model>', 20, true);
```

Any endpoint that speaks `POST /chat/completions` works. Priority is ascending — lowest number tried first.

### 5. Deploy the functions

```bash
supabase functions deploy --no-verify-jwt telegram-webhook
supabase functions deploy ingest interpret resolve chat-message chat-share \
                          sentinel-check brightdata generate-pulse \
                          speechmatics-token speechmatics-tts \
                          calendar-actions calendar-share gmail-actions \
                          oauth-google-start oauth-status \
                          team-invite team-manage workspace-onboarding account-manage \
                          admin-api blog-admin docs-admin docs-public telegram-link
```

> `telegram-webhook` is called by Telegram, so it cannot require a Supabase JWT — it authenticates with a shared secret header instead. See [Security](#security).

### 6. Wire the Telegram webhook

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<project>.supabase.co/functions/v1/telegram-webhook",
    "secret_token": "'"${TELEGRAM_WEBHOOK_SECRET}"'"
  }'
```

### 7. Schedule the periodic jobs

The Pulse is generated daily and web sentinels are checked on their own `frequency_min` cadence by an **external scheduler** calling `generate-pulse` and `sentinel-check` — not `pg_cron` in this deployment. Point whatever scheduler you use (a VPS cron job, a hosted scheduler) at those two functions' URLs. Every sentinel also has a **"Check now"** button in the UI that calls `sentinel-check` directly.

### 8. Run

```bash
npm run dev            # development
npm run build          # production build + prerender of public routes
npm run preview
```

---

## Configuration reference

### Client (`.env.local`)

| Variable | Required | Purpose |
|---|:---:|---|
| `VITE_TELEGRAM_BOT_USERNAME` | ✅ | Used to build the `t.me/<bot>` deep link in Settings → Connections |

### Server (Supabase vault)

| Secret | Purpose |
|---|---|
| `LLM_PRIMARY_KEY` | AI/ML API, primary provider |
| `LLM_FALLBACK_KEY` | OpenRouter, fallback provider |
| `BRIGHTDATA_API_TOKEN` | `sentinel-check`, `brightdata` |
| `SPEECHMATICS_API_KEY` | `speechmatics-token`, `speechmatics-tts` |
| `TELEGRAM_BOT_TOKEN` | `telegram-webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | Inbound Telegram request verification |
| `RESEND_API_KEY` | `team-invite` (transactional email) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Calendar + Gmail OAuth |

**No secret is ever passed through the chat interface, committed to the repository, or read by client code.** If one is ever pasted somewhere it shouldn't be, treat it as compromised and rotate it.

---

## Security

1. **Row Level Security on every table with a `workspace_id`.** Isolation lives in Postgres, never in a frontend check.
2. **The platform administrator role is not a workspace role.** It lives in `platform_admins`, a table separate from `workspace_members.role` and unreachable by application policies. Admin functions run with service privilege; every action lands in `sybil_admin_audit`, which has no client-facing write policy at all.
3. **Third-party callers authenticate on their own terms, not with a Supabase JWT.** `telegram-webhook` checks a dedicated secret header on every request. The sentinel scheduler is invoked by an external cron with no credential — a deliberate tradeoff (a private URL, not a protected endpoint) called out here rather than presented as solved.
4. **Service-privilege keys never leave the server.**
5. **Skills in Settings are descriptive content today, not yet wired into the agent's system prompt** — there is currently no path by which user-authored instructions could alter base agent behavior.
6. **The public demo account is hardened at the database level, not just hidden in the UI.** `demo@sybil.local` cannot change its own password, email or display name, and cannot be deactivated or deleted — enforced by triggers, so the guarantee holds even against a direct API call. Usage is capped per visitor via an atomic server-side counter keyed to IP.
7. **Storage:** voice and media assets served only via signed URLs where applicable.

---

## Known limitations

Stated plainly, because a hackathon project that pretends to have none is not credible.

- **Email and internal-state sentinels are visible and creatable, but not yet automatically checked.** The web sentinel's fetch → hash → diff → judge → wake cycle runs fully today; the other two types are the next target for the same engine, not a separate build.
- **Skills and subagents are described in Settings but not yet wired into the interpretation engine.** No user-authored skill instruction can currently change agent behavior.
- **The `/projects` route exists but isn't linked from the sidebar**, and there's no creation path yet in the UI or the agent.
- **Payments are not implemented.** The pricing page shows real plans and prices; the subscribe buttons are placeholders.
- **Voice is real-time but Google Calendar runs in OAuth testing mode**, limited to a small number of authorized test accounts with short-lived refresh tokens.
- **The sentinel/Pulse scheduler is an unauthenticated external cron hitting a private URL**, not a protected endpoint — a deliberate tradeoff for the timeframe, not a solved problem.
- **The notification bell in the top bar is a UI placeholder** — no real notifications are wired to it yet.
- **Some integrations appear in the UI as "Coming soon"** — static, disabled, no backend behind them, shown to make direction legible rather than to imply they work.

See [SYBIL-PRD-MVP.md](SYBIL-PRD-MVP.md) for the full, current product description this README is derived from.

---

## Roadmap

**Today** — Chat · Telegram · real-time voice in and out · calendar · Gmail · web sentinels · Pulse · team management

**Next** — Email and internal-state sentinels made fully automatic · active skills and subagents · MCP server (Sybil inside Claude, ChatGPT and other assistants) · notifications · Slack · Notion · payments

**Later** — LinkedIn · Instagram · X · WhatsApp · Jira · Trello · Outlook · n8n · cloud-based Italian e-invoicing

**The enterprise bridge:** the same engine with sentinels pointed at internal sources as well as external ones — tickets, repositories, CRM, sector regulations. *The engine doesn't change; only what you ask it to watch does.*

---

## Team

| | |
|---|---|
| **Davide Maiorana** | Engineering — architecture, agent pipeline, integrations, infrastructure |
| **Federico Patanè** | Product & marketing — positioning, personas, design direction, narrative |

---

<div align="center">

**Sybil** — *Chronos measures time. Kairos recognises the moment. The Sibyl announces it.*

</div>
