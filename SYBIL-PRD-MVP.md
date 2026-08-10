<p align="center">
  <img src="public/svg/sybil-mark.svg" alt="Sybil" width="96" height="96" />
</p>

# SYBIL — Product Description

**AI Factory / native.builder Hackathon**
Team: Davide (technical) · Federico (marketing & product)

---

## 0. What Sybil is

Sybil is an agentic workspace for freelancers and micro-agencies. The differentiator isn't "there's AI inside" — everyone has that — but three things together:

**1. The agent has more entry points.** In-app chat with persistent, multi-conversation history, continuous voice dictation, Telegram, forwarding of commitments via calendar, reading/writing mail. You don't open the app to update it: you talk — from the app or from Telegram — and the app updates itself.

**2. The agent has two senses.** It *hears* — real-time voice transcription via Speechmatics, with text-to-speech readback of responses. It *sees* — live web monitoring via Bright Data, with proof of the change.

**3. The sentinels.** A task may have no deadline but a **wake condition written in natural language**: *"let me know if the quote I sent doesn't get a reply within 5 days"*, *"let me know if the competitor changes their prices"*. The agent translates the sentence into a sentinel — today fully automated for anything on the web, with a mailbox or the workspace's internal state as the next targets for the same engine (§5.4) — and when the condition fires it brings the task back to the top of the Pulse **with proof of what changed**.

### 0.1 The thesis

The Greeks had two words for time. **Chronos** is clock time: dates, deadlines, calendars. **Kairos** is the right moment.

Every existing task manager — Notion, Asana, Trello, Linear, Todoist, Monday, ClickUp — is built on Chronos. The only question it knows how to ask a task is *"by when?"*. But most real work doesn't have a date: it has a **condition**.

> **Sybil is the workspace that knows when the right moment is, because it listens to you and watches the world.**

### 0.2 The name

**Sybil** — the sibyl, the oracle who sees before it happens. Chronos measures time, Kairos recognizes the moment, the sibyl announces it.

---

## 1. The user

**ICP: freelancers and micro-agencies of 2 to 10 people** — consulting, marketing, development, design.

Real, measurable pain: 6-11 clients in parallel, no project manager, and the cost of missing the right moment is counted in money. Competitive gap: those with 200 employees have Jira and someone to update it; those who are four people have a WhatsApp group.

### 1.1 Personas and their sentinel

| Persona | Role | Emblematic sentinel |
|---|---|---|
| Micro-agency owner | Manages multiple clients in parallel | *"Let me know if a quote I sent doesn't get a reply within 5 days"* — email sentinel |
| Freelance social media manager | Tracks brand and competitors | *"Let me know if negative brand mentions double in 24 hours"* — web sentinel |
| Freelance developer | Estimates and delivers milestones | *"Let me know if a deadline becomes unreachable"* — internal-state sentinel |
| Freelance designer/videomaker | Delivers files to clients | *"Let me know if a delivered file doesn't get approved within 3 days"* — same engine as the email sentinel |

> **The sentinel on silence** — the ignored quote, the unapproved file, the reply that never comes — is the one that sells: it serves four out of five people and anyone understands it in three seconds.

*The email and internal-state sentinels above describe the scenario the engine is built to serve — the same detect-and-wake mechanism, pointed at a different source. The web sentinel is the one fully automated end-to-end today (§5.4); mailbox and internal-state monitoring are the next targets for that same engine, not a separate build.*

---

## 2. Functional architecture

### 2.1 The central object is the Signal, not the task

Everything that enters the system enters as a **Signal**. An agent interprets it and decides what it should become.

```
   in-app chat  ─────┐
   voice        ─────┤
   Telegram     ─────┼──▶   SIGNAL
   calendar     ─────┤      (channel, raw content, author, timestamp)
   sentinels    ─────┘
                            │
                            ▼
                   INTERPRETER AGENT
        intent + entities (who, what, when, project, condition)
                            │
                            ▼
                        RESOLVER
        creates or updates a task, creates/deletes a sentinel,
        reads or writes calendar and mail, searches the web, replies
                            │
                            ▼
                          PULSE
        what changed · what to do now
```

The pipeline is implemented as three server functions in sequence: the first records the signal, the second interprets it with a language model and returns a structured intent, the third executes the resulting action — creates or updates an existing task instead of duplicating it, opens or closes a sentinel, reads or writes the calendar, reads or sends an email, performs a web search or visit, or replies in chat. Every turn is fully logged: the original signal, the interpretation, the resolution, and the outcome each land in their own table, so the agent's action timeline (the **Activity** screen, §4.2) is a direct read of the real history, not a reconstruction.

**The Resolver is the part clones don't do.** Without the Resolver, saying *"move Rossi's quote to Monday"* would create a new task instead of moving the existing one. Sybil compares title, project, and assignee of the workspace's open tasks and updates the right one.

### 2.2 Task lifecycle

Tasks follow a four-column board — **Backlog, To Do, Doing, Done** — with drag-and-drop, sorting by priority or due date, and free-form labels.

A task can additionally have a **wake condition** in natural language and a linked sentinel: this isn't a fifth board state, but an attribute any task in Backlog/To Do/Doing can carry. When the linked sentinel detects that the condition has been met, the task is automatically moved to **Doing** and the board shows it at the top with a reference to the event that woke it.

### 2.3 LLM layer

No call to a language model is hardwired to a single provider. Every server function that needs an LLM (signal interpretation, resolution, Pulse generation, judging a change detected by a sentinel) reads the provider table ordered by priority and tries each in sequence against an OpenAI-compatible endpoint, moving to the next on error or timeout. Calls are logged to a shared `sybil_llm_call_logs` table with provider, calling function, tokens, and latency — the main signal-interpretation call logs its outcome whether it succeeds or exhausts every provider, while the sentinel-judgement and Pulse-generation calls log a successful attempt only, so a fully-failed failover on those two leaves no row behind.

**Active providers today:** AI/ML API as primary, OpenRouter as fallback, a third OpenAI provider configured and ready but disabled. Adding a fourth provider means inserting a row in the table: zero application code changes.

### 2.4 Skills and subagents

**Skills** — sector-specialized behavior modules (agency, marketing, development, student) that shape how the agent reasons and which sentinels it proposes — are present in the Settings interface with their full description, awaiting integration with the interpretation engine. **Subagents** — specialists Sybil consults internally for a domain opinion — are likewise planned in the same Settings screen. Both appear on the public `/roadmap` page.

---

## 3. Data model

Multi-workspace tenancy: every row of work carries a `workspace_id`, and isolation is guaranteed by Row Level Security on Postgres, not by an application-level check.

```
─── Identity and tenancy ──────────────────────────────────────────
workspaces            id · name · plan · owner_id · created_at · suspended
workspace_members     workspace_id · user_id · email · role [owner|admin|member|guest]
                       invited_by · joined_at
workspace_join_links   workspace_id · code · role · expires_at · revoked_at · use_count
invites                workspace_id · email · role · token · expires_at
sybil_profiles         user_id · display_name · avatar_url · status [active|deactivated]
                       onboarding_completed · job_profile
sybil_onboarding_feedback  user_id · rating [1-10] · willingness_to_pay
                           comment · contact_email · created_at

─── Work ──────────────────────────────────────────────────────────
sybil_projects         id · workspace_id · name · client · status · color
sybil_tasks            id · workspace_id · project_id · title · description
                       assignee_id · status [backlog|todo|doing|done] · priority
                       due_date · wake_condition · sentinel_id · labels · position
                       source_signal_id · created_by · created_at · completed_at

─── The engine ────────────────────────────────────────────────────
sybil_signals          id · workspace_id · sentinel_id · conversation_id
                       origin [chat|telegram|voice|email|calendar|web|sentinel|system]
                       raw_content · transcript · metadata · llm_provider
                       received_at · processed_at
sybil_resolutions      id · signal_id · workspace_id
                       action [reply|create_task|update_task|create_sentinel|delete_sentinel
                              |delete_task|calendar_event|read_calendar|send_email|read_emails
                              |delete_email|web_visit|web_search|web_research|no_action]
                       outcome [success|partial|error|pending] · detail · feedback
sybil_sentinels        id · workspace_id · owner_id · task_id · condition_text
                       type [web|email|internal] · config · frequency_min
                       status [active|paused|triggered|error]
                       last_checked_at · next_check_at · last_snapshot · last_hash
                       last_error · last_error_at
sybil_wake_events      id · sentinel_id · task_id · workspace_id
                       diff_summary · evidence_url · evidence_snippet · read_at
sybil_pulses           id · workspace_id · briefing_date · content · generated_at
sybil_activity_logs    id · workspace_id · entity_type · entity_id · action
                       actor [user|agent|system] · actor_id · payload · created_at
sybil_conversations    id · author_id · title · created_at · updated_at
chat_shares            workspace_id · owner_user_id · shared_with_user_id/email
                       mode · chat_ids · access
sybil_web_call_logs    workspace_id · action · target · status · latency_ms · bytes

─── Agent ─────────────────────────────────────────────────────────
sybil_llm_providers    id · name · base_url · secret_name · model · priority
                       is_active · max_tokens
sybil_llm_call_logs    id · workspace_id · provider_id · function · success
                       tokens_in · tokens_out · latency_ms · cost_estimate

─── Connectors ────────────────────────────────────────────────────
sybil_oauth_connections  workspace_id · user_id · provider · status · scope
                          access_token · refresh_token · expires_at
                          calendar_enabled · gmail_enabled
calendar_shares          owner_user_id · owner_calendar_id · shared_with_email · role
sybil_telegram_links     id · workspace_id · user_id · telegram_chat_id
                          telegram_username · telegram_first_name
                          link_code · code_expires_at · linked_at
                          last_message_at · revoked_at · conversation_id

─── Public content ────────────────────────────────────────────────
sybil_blog_posts       slug · title · content_json/html · status [draft|published|archived]
                       author · tags · seo_title/description · published_at
sybil_docs_pages       slug · category · title · content_md · status
                       order_index · seo_title/description · published_at
sybil_docs_categories  slug · label · order_index

─── Observability and admin ───────────────────────────────────────
platform_admins        user_id · role [staff|superadmin] · granted_at · created_by
sybil_admin_audit      admin_user_id · admin_role · action · target_type/id · payload · outcome
```

**Security:** Row Level Security is active on every workspace table. `sybil_llm_providers`, `platform_admins`, and `sybil_admin_audit` are unreachable via the end-user token: they're only touched by server functions with service privilege. `sybil_admin_audit` in particular doesn't even have an application policy — writes happen exclusively server-side, to guarantee the audit log can never be altered by the client.

Access to the admin panel is governed by `platform_admins`, a table separate from the workspace role: promoting a user to platform administrator requires a dedicated administrative action with explicit confirmation, and the last remaining superadmin cannot be removed.

---

## 4. Application surface

### 4.1 Public site

| Route | Content |
|---|---|
| `/` | Landing page: the Chronos/Kairos thesis, the three features, animated chat scene, technology partner logos |
| `/pricing` | The four plans with real prices; activation buttons are placeholders |
| `/roadmap` | What's available today, what's coming next |
| `/blog`, `/blog/:slug` | Markdown articles with a rich editor on the admin side |
| `/docs`, `/docs/:slug` | Public documentation, with dedicated `llms.txt` and `llms-full.txt` endpoints meant to be read by external AI agents |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | Email/password authentication |
| `/welcome`, `/join/:code` | Onboarding: creating a new workspace or joining an existing one via invite link |
| `/legal/*` | Legal pages |

### 4.2 Authenticated app

Ten screens in the sidebar (Pulse through Settings), plus an eleventh conditional entry for platform administrators. Below the screen list, the sidebar also carries the user's own chat history and any conversations another member has shared with them — both scrollable panels, not just a static nav.

| Screen | Content |
|---|---|
| **Pulse** *(home)* | The daily-generated briefing, with a row of live counters (signals today, active sentinels, open tasks), a calendar/deadlines rail, and a recent-activity feed — not just the briefing text. Text-to-speech readback |
| **Chat** | Conversation with the agent, multi-conversation with a side history panel, sharing a chat with another workspace member |
| **Team** | Workspace members, roles, email invites, generatable and revocable invite links |
| **Calendar** | Reading and writing to Google Calendar, sharing calendars between workspace members (view-only access for guest roles, write access for others) |
| **Mail** | Reading, sending, and deleting mail on the connected Gmail account |
| **Tasks** | Backlog/To Do/Doing/Done board with drag-and-drop, priority, labels |
| **Activity** | Timeline of the agent's actions and received signals, split between actions and signals |
| **Sentinels** | List of active sentinels, natural-language condition, target, last check, "check now" button; active-sentinel limit shown in real time. A sentinel can be created by asking in chat or from a "New sentinel" button on the page itself — talking to the agent isn't the only way in |
| **Documentation** | Same public documentation, reachable from inside the app |
| **Settings** | Account · Connections · Skills · Plan. Connections is also where a Telegram account is linked to Sybil (§5.6) |
| **Admin** *(staff/superadmin only)* | Platform management panel, see §4.3 |

**Cross-cutting elements:** active workspace switcher for multi-workspace users, a notification bell in the top bar (UI placeholder today — no real notifications are wired to it yet), background music player, always-reachable voice button.

**First-login onboarding.** Shown once, on the very first authenticated session (`sybil_profiles.onboarding_completed`), skippable at any point and never shown again either way. One click on a job category (agency owner / developer / designer / marketer / other) personalizes the example shown in the Sentinels stop of the tour that follows — a spotlighted, click-through walkthrough of every sidebar screen plus the chat composer's call and dictation buttons. Completing the tour (not skipping it) ends with a short survey — a 1–10 rating, a willingness-to-pay question shown only above a 6, an optional 150-character comment, and an optional contact email — saved to `sybil_onboarding_feedback` and readable only from the admin panel. Ambient music (the same track library as the topbar player) fades in for the duration and hands back to the topbar player's normal volume once onboarding ends, never overlapping if the topbar player was already running.

A `/projects` route already exists for grouping tasks and sentinels by client or initiative, not yet linked from the sidebar and with no creation path yet either — there's currently no way, in the UI or the agent, to bring a project into existence. It's the natural next step to give structure to the multi-client work described in §1.

### 4.3 Admin panel

Accessible only to those with a row in `platform_admins`; some actions are reserved for the `superadmin` role, others are also available to `staff`.

| Section | Content |
|---|---|
| **Overview** | Number of workspaces, total LLM calls, total web calls |
| **Usage** | Consumption from `sybil_llm_call_logs`: calls, tokens, estimated cost, filterable by range |
| **Providers** | Status and priority of LLM providers, reorderable and enable/disable from here |
| **Health** | Sentinel status and the ability to force an immediate check |
| **Audit** | Every administrative action logged, without exception |
| **Secrets** | List of secrets configured in the vault, with the ability to set new ones without the value ever passing through the client in plaintext |
| **Blog / Docs** | Editorial management of the blog and public documentation, including publication status. Read-only for `staff` — creating, editing, publishing, reordering, and deleting content is `superadmin`-only |

Administration also includes suspending an entire workspace and managing who has access to the panel itself (granting/revoking the admin role, with protection against removing the last superadmin).

---

## 5. Integrations

### 5.1 The constraint that governs everything

The application is **Vite + React**, an SPA published on Netlify. Anything that requires a secret key or needs to run without the user having the app open lives in **Supabase**: Postgres database, authentication, storage, server functions, and secrets vault.

### 5.2 The server functions

| Function | What it does |
|---|---|
| `ingest` | Records an incoming signal from chat, voice, or Telegram |
| `interpret` | Interprets the signal with the LLM layer and returns a structured intent |
| `resolve` | Executes the intent: creates or updates a task, opens or deletes a sentinel, reads/writes the calendar, reads/sends email, performs web searches or visits, replies in chat |
| `chat-message` | Edits or rates (like/dislike) an already-sent message |
| `chat-share` | Sharing one or more conversations with another workspace member |
| `sentinel-check` | Checks a web-type sentinel: fetches the target's content via Bright Data, computes a hash and compares it against the last known one — if identical, stops at no LLM cost; if changed, computes the diff and asks the LLM layer whether the condition has been met, creates the `WakeEvent`, and reactivates the task |
| `generate-pulse` | Builds the daily briefing from the workspace's state over the last 24 hours |
| `speechmatics-token` | Issues a short-lived token for real-time voice transcription, so the long-lived key never reaches the browser |
| `speechmatics-tts` | Synthesizes the Pulse text or the agent's responses into audio |
| `brightdata` | Performs searches, page visits, and structured web queries on behalf of the agent in chat |
| `oauth-google-start`, `oauth-google-callback`, `oauth-refresh`, `oauth-status` | Google OAuth flow and access-token upkeep |
| `calendar-actions` | CRUD on Google Calendar events from the Calendar page |
| `calendar-share` | Sharing a calendar with another workspace member, with view-only access enforced for guest roles |
| `gmail-actions` | Reading, sending, and deleting Gmail mail from the Mail page |
| `team-invite`, `team-manage` | Email invites, role changes, member removal, generating and revoking invite links |
| `workspace-onboarding` | Creating a new workspace or joining an existing one via invite or link |
| `account-manage` | Account deactivation, reactivation, and deletion, with transfer or closure of workspaces the user is the sole owner of |
| `admin-api` | All admin panel actions, resolved server-side with level verification (staff/superadmin) and every action written to audit |
| `blog-admin`, `docs-admin` | Editorial management of the blog and documentation |
| `docs-public` | Serves public documentation content, including text views for external AI agents (`llms.txt`) |
| `telegram-link` | Generates, checks, and revokes the one-time code that links a Telegram chat to a Sybil account |
| `telegram-webhook` | Receives Telegram updates, authenticates the caller via a dedicated secret header, and drives the same signal pipeline as every other channel |

**Secrets rule:** every external key lives in the Supabase vault and is read only server-side. No key ever appears in the client bundle.

### 5.3 Speechmatics — voice

**Real-time** voice transcription: the client opens a direct session with Speechmatics using a short-lived token issued by `speechmatics-token`, so the long-lived key never passes through the browser. The same infrastructure powers both short dictation and a continuous voice call with the agent. On the output side, `speechmatics-tts` synthesizes the text generated by Sybil into audio for the Pulse's text-to-speech readback.

### 5.4 Bright Data — sentinels and web search

Bright Data covers two distinct paths: web actions requested directly in chat (visiting a page, search, deep multi-source research) and the periodic checking of web-type sentinels. In both cases the retrieved content is normalized and reduced to a hash before any call to a language model: a page that hasn't changed never generates an LLM cost. Only when the hash changes is the text diff submitted to the LLM layer with the question "does this change satisfy the sentinel's condition?" — if so, a `WakeEvent` is created with a summary of the change, the url, and an evidence snippet, and the linked task returns to the top of the board. If the sentinel was set up with a notification action — "and email me when it happens" — the trigger also sends that email at the moment it fires; this is a per-sentinel choice made at creation time, not something every sentinel does automatically.

A sentinel can also watch a mailbox (silence on a sent thread) or the workspace's internal state, not just the web: the agent creates and shows them in Sentinels the same way. The automatic verification cycle — fetch, compare, judge, `WakeEvent` — is fully operational end-to-end for the web type today; for the other two types, it's the next step.

### 5.5 Google Calendar and Gmail

Calendar and mail are connected with a **single Google account per user**, authorized via OAuth with separable permissions: the user can independently enable or disable calendar access and mail access even after the account is connected, without having to disconnect it. Once connected, the agent reads commitments to give context to the Pulse and chat replies, creates events and time blocks when requested in natural language, reads incoming mail, and sends or deletes emails on the user's behalf.

### 5.6 Telegram

Telegram is a full entry point into the agent, on the same footing as chat and voice. Linking is initiated from the app, not from Telegram: a user generates a one-time code in Settings → Connections and sends it to the bot as `/start CODE`. The bot claims the code, ties that Telegram chat to the user's Sybil account, and confirms in-chat. From then on, every message sent to the bot is ingested with `origin = telegram`, runs through the same interpreter and resolver as every other channel, and carries the same conversational memory — a follow-up question on Telegram is answered with the context of what was said earlier in that same Telegram conversation, exactly as it would be in the in-app chat. Disconnecting is a `/unlink` command away, from either side.

### 5.7 Periodic execution

The Pulse is automatically generated every day by a job scheduled on the database. Web sentinels are automatically checked at regular intervals by an external scheduler, following each one's desired cadence (`frequency_min`) and the date of the last check — the same cycle can be forced at any time via the **"Check now"** button in Sentinels or the Health section of the admin panel.

---

## 6. Security

1. **Row Level Security on every table with a `workspace_id`.** Isolation lives in Postgres, not in a frontend check.
2. **The platform administrator role is not a workspace role.** It lives in `platform_admins`, a separate table unreachable by application policies; admin functions run with service privilege and every action lands in `sybil_admin_audit`.
3. **Server functions that receive third-party calls authenticate the caller on its own terms, not with a Supabase JWT.** The Telegram webhook checks a dedicated secret header on every request and rejects anything that doesn't match. The sentinel scheduler is invoked by an external cron with no credential at all — it's a deliberate tradeoff (a private URL, not a public one) rather than a protected endpoint, and is called out here as a known limitation rather than a solved one.
4. **Service-privilege keys never leave the server.**
5. **Skills in Settings are descriptive content**, not yet wired into the agent's system prompt: there is currently no path by which user instructions could alter the base behavior.
6. **The public demo account is hardened against tampering, not just hidden behind a disabled button.** `demo@sybil.local` cannot change its own password, email, or display name, and cannot be deactivated or deleted — enforced by database triggers on the affected tables, not only by the UI, so the guarantee holds even against a direct API call. Usage is capped per visitor (three chat messages, one voice transcription, one call of up to five turns) via an atomic server-side counter keyed to the visitor's IP; once spent, every further request is rejected before it reaches the language model, and the app shows a fixed screen inviting the visitor to register with their own account.

---

## 7. Demo scenario

A single continuous story, starring Marco, owner of a four-person agency.

**Opening.** The Pulse opens on its own and starts **talking**: *"while you were asleep, client Ferri wrote at 11pm. I've already prepared the draft for you."*

**The voice.** Marco steps out of a call and holds down a button, talking continuously for twenty seconds with the agent: *"we closed the deal with Rossi: I'll send the quote myself by Friday, Giulia needs to call the supplier about prices by Wednesday, the presentation is pushed to next week."* Three tasks, two people assigned, two deadlines — no one typed anything.

**The Resolver.** Later, in chat: *"send Rossi's quote on Monday, not Friday."* The agent finds the right task — it doesn't create a new one — and moves it.

**The sentinel on silence.** Marco sends the quote and says: *"let me know if they don't reply within five days."* The agent registers the sentinel on the thread and shows it immediately in Sentinels, with the condition and the timer.

**The eyes.** Marco creates a task with no date: *"redo the pricing... wake me up when the competitor changes their prices."* The competitor's website changes. The task reactivates with the diff and a link to the proof.

**The Pulse.** The next morning: the briefing doesn't list tasks, it says what changed overnight and what's worth doing now.

> *"Through all of this, no one ever opened a form to create a task. And tasks resurface on their own because the world changed, not because a timer expired."*

**Trying it yourself.** The landing page's "Demo platform" button drops any visitor straight into a live, shared account — no signup, no credentials to type. It's meant for a quick look, not a working session: usage is capped (three messages, one voice transcription, one short call) so the account stays usable for the next visitor too.

---

## 8. Submission

**Live application:** [sybil-agent.com](https://sybil-agent.com)

| Criterion | What we demonstrate |
|---|---|
| **Application of Technology** | Not one model but three services orchestrated in a multi-step pipeline — Signal → Interpreter → Resolver → Action — with a provider-agnostic language model layer and automatic failover |
| **Business Value** | A precise ICP, the cost of the problem, four plans with real prices |
| **Originality** | Chronos vs. Kairos: no existing task manager knows how to handle a task whose condition isn't a date |
| **Presentation** | One single story, no architecture slides in the video |

### 8.1 APIs and third-party services

| Service | Used for |
|---|---|
| **Supabase** | Postgres database, authentication, storage, server functions, secrets vault |
| **Netlify** | Hosting and deployment of the frontend |
| **Bright Data** | Web sentinels, page visits, search, and multi-source research |
| **Speechmatics** | Real-time voice transcription and text-to-speech |
| **AI/ML API** (primary) **and OpenRouter** (fallback) | The language model layer behind interpretation, resolution, Pulse generation, and sentinel judgment |
| **Google OAuth, Calendar API, Gmail API** | Calendar read/write and mail read/send/delete |
| **Telegram Bot API** | The Telegram entry point (§5.6) |
| **Resend** | Transactional email — team invites today |
| **iubenda** | Cookie/privacy policy widget on the public site |

### 8.2 The three sponsor partners

| Partner | Role in Sybil | Stage |
|---|---|---|
| **Bright Data** | The eyes: live web sentinels, change detection, evidence proof | Perception of the world |
| **Speechmatics** | The ears and the voice: real-time conversation transcription, Pulse readback | Perception of the user |
| **AI/ML API** (with OpenRouter as fallback) | The brain: interpretation, resolution, Pulse generation, judgment on detected changes | Interpretation and decision |

> *"Sybil doesn't call a model: it orchestrates three services doing three different things — one watches the world, one listens to the user, one decides what it means."*

---

## 9. Building Sybil with native.builder

Sybil was built on native.builder from the first screen to the deployed application. The entire frontend — the public site, the authenticated app, and every screen described in §4 — was generated and iterated on inside the platform, and it is what runs today at sybil-agent.com.

### 9.1 How we used it

We followed native.builder's workflow end to end: we described the product, generated the application, then refined design, UX, workflows and data connections through successive passes inside the platform. Sybil is not a static page with an API bolted on — it is a multi-screen authenticated application with routing, protected routes, real-time state, drag-and-drop, a rich text editor, and an admin panel, all assembled in native.builder.

The division of labour was deliberate:

- **native.builder owns the application.** Every route, screen, component and interaction the user touches was generated and refined there. Iterating on a screen meant describing the change and letting the platform's agents restructure it — that is how the Pulse, the Kanban board, the Sentinels page, Settings and the admin panel all took shape.
- **Supabase owns what a browser cannot hold.** Anything requiring a secret key or execution while the user is away — the agent pipeline, the LLM layer, the connectors, the sentinel scheduler — lives in edge functions, as §5.1 explains. This is an architectural constraint of any SPA, not a limit of the platform.

We consumed 49 of the 50 native.builder credits available to us during the hackathon — essentially the full allocation. The number is the honest measure of how much of this product came out of the platform.

### 9.2 What the platform made possible

A two-person team shipped, in seven days, an application with 36 screens, a role-separated admin panel, two content management systems, and four external service integrations. That pace is a direct consequence of generating and reshaping whole screens by description rather than by hand: the time we saved on scaffolding, layout and wiring went into the part that actually differentiates Sybil — the agent pipeline and the sentinels.

### 9.3 What we learned

We hit friction, as anyone building something this size in a week does: *[SPECIFIC ISSUE — one sentence, factual — to fill in]*. We worked through it with direct troubleshooting and coordination with the native.builder team, and completed development from there — it did not change the outcome: the application shipped on the platform, deployed from the platform, and is publicly reachable today.

The takeaway is the one that matters for a tool like this: native.builder carried a genuinely non-trivial product, not a demo. The complexity we threw at it — nested routing, row-level-secured multi-tenancy, an editorial CMS, a live agent chat — is well past what a builder is usually asked to hold, and it held.

---

# APPENDIX — Public content

## A. Pricing

| | **Free** | **Pro** | **Team** | **Business** |
|---|---|---|---|---|
| **Price** | €0 | €14/month | €12/seat, min. 3 | from €39/seat |
| Users | 1 | 1 | 3+ | unlimited |
| **Active sentinels** | **3** | **25** | **25 × seats**, shared | unlimited |
| Voice | 30 min/month | 5 hours/month | 10 hours/seat | unlimited |
| Projects | 3 | unlimited | unlimited | unlimited |
| History | 30 days | 1 year | 2 years | configurable |
| Custom skills | 1 | unlimited | unlimited | unlimited |
| Subagents | — | ✓ | ✓ | ✓ |
| Assignment to people | — | — | ✓ | ✓ |
| SSO, audit log, internal sentinels | — | — | — | ✓ |

Annual billing at -20%: Pro €134/year · Team €115/seat/year. All buttons on this page are placeholders: no payment logic is active.

## B. Public roadmap

**Today** — Chat, voice, Telegram, calendar, email, web sentinels, Pulse, team management.

**Next** — Email and internal-state sentinels, active skills and subagents, MCP server (Sybil inside Claude and ChatGPT), notifications, Slack, Notion, payments.

**Later** — LinkedIn, Instagram, X, WhatsApp, Jira, Trello, Outlook, n8n, cloud-based Italian invoicing.

## C. The enterprise bridge

> *"The same engine, with sentinels pointed at internal sources as well as external ones — tickets, repositories, CRM, industry regulations. The engine doesn't change: only what you ask it to watch changes."*

---

*Product document. Reflects the state of the code at the time of writing.*

*Version 2 — 2026-08-09.*
