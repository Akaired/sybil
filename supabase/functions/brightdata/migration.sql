-- ============================================================================
-- SYBIL — sybil_web_call_logs
-- Call log for the shared `brightdata` edge function (agent + sentinels).
-- Mirrors the sybil_llm_call_logs pattern.
-- ============================================================================

create table if not exists sybil_web_call_logs (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null,
  action text not null,
  target text,
  status text not null,
  latency_ms integer,
  bytes integer,
  created_at timestamptz not null default now()
);

alter table sybil_web_call_logs enable row level security;

create policy sybil_web_logs_select
  on sybil_web_call_logs
  for select
  using (is_workspace_member(workspace_id));
