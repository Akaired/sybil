-- Platform admin panel: role model, audit log, vault-backed secrets, sybil_profiles grant fix.
-- Written 2026-08-09, applied via Supabase Management API PAT (see reference_supabase-management-api-workflow memory).

begin;

-- 1.1 platform role -----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'platform_role') then
    create type platform_role as enum ('superadmin', 'staff');
  end if;
end $$;

alter table platform_admins
  add column if not exists role platform_role not null default 'staff',
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists note text;

-- superadmins: mayo@sybil.local (pre-existing row) + maiordavid.dm@gmail.com (new)
insert into platform_admins (user_id, role, note)
values
  ('6f02bc43-4106-48ae-8a3f-3c004885b142', 'superadmin', 'mayo@sybil.local'),
  ('96a80826-eb1f-41ed-bb7d-6758b7ba4b88', 'superadmin', 'maiordavid.dm@gmail.com')
on conflict (user_id) do update set role = excluded.role, note = excluded.note;

-- staff: fede@sybil.local (pre-existing row) + valterino@sybil.local + diegone@sybil.local (new)
insert into platform_admins (user_id, role, note)
values
  ('591abff8-b9fc-4589-bd70-dcada2637ca8', 'staff', 'fede@sybil.local'),
  ('874ab4a3-4ade-4928-886c-b3fe128db90d', 'staff', 'valterino@sybil.local'),
  ('4d0523cf-692f-4f24-8fa8-463537612864', 'staff', 'diegone@sybil.local')
on conflict (user_id) do update set role = excluded.role, note = excluded.note;

-- 1.2 lock the table down completely -------------------------------------
revoke all on platform_admins from authenticated, anon;
alter table platform_admins enable row level security;
-- no policies for authenticated/anon: only service_role (bypasses RLS) can touch this table

create or replace function get_platform_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role::text from platform_admins where user_id = auth.uid()
$$;
revoke all on function get_platform_role() from public, anon;
grant execute on function get_platform_role() to authenticated;

-- 1.3 audit ---------------------------------------------------------------
create table if not exists sybil_admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  admin_role platform_role not null,
  action text not null,
  target_type text,
  target_id text,
  payload jsonb default '{}'::jsonb,
  outcome text not null default 'ok', -- ok | denied | error
  created_at timestamptz not null default now()
);
create index if not exists sybil_admin_audit_created_at_idx on sybil_admin_audit (created_at desc);
revoke all on sybil_admin_audit from authenticated, anon;
alter table sybil_admin_audit enable row level security;
-- no policies: only service_role can read/write

-- 1.4 vault-backed secrets --------------------------------------------------
-- supabase_vault extension is already enabled on this project.

-- getSecret(name): read-only, service_role only. Falls back to Deno.env.get in the
-- shared helper if the row isn't in the vault yet.
create or replace function public.get_vault_secret(secret_name text)
returns text
language sql
security definer
stable
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;
revoke all on function public.get_vault_secret(text) from public, anon, authenticated;
grant execute on function public.get_vault_secret(text) to service_role;

-- set_vault_secret(name, value): upsert, service_role only. Used both for the
-- one-time seed and for admin-api's secret_set action.
create or replace function public.set_vault_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.secrets where name = secret_name;
  if existing_id is null then
    perform vault.create_secret(secret_value, secret_name);
  else
    perform vault.update_secret(existing_id, secret_value);
  end if;
end;
$$;
revoke all on function public.set_vault_secret(text, text) from public, anon, authenticated;
grant execute on function public.set_vault_secret(text, text) to service_role;

-- workspace_suspend support -------------------------------------------------
alter table workspaces add column if not exists suspended boolean not null default false;
alter table workspaces add column if not exists suspended_at timestamptz;

-- sybil_profiles column-level grant fix (long-standing debt, see
-- feedback_backend-infra-confirm / project_sybil-settings-backend memory) --
-- table-wide grant must be revoked first: Postgres column-level REVOKE cannot
-- carve an exception out of an existing table-wide grant.
revoke update on sybil_profiles from authenticated;
grant update (display_name, avatar_url) on sybil_profiles to authenticated;

commit;

notify pgrst, 'reload schema';
