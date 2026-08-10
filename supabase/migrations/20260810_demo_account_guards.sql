-- Demo account hard lock (demo@sybil.local, id 475cb475-f00b-4dd1-91ff-519e922b556d)
-- Blocks email/password change and account deletion at the auth.users level,
-- and display_name/status(deactivate) changes at the sybil_profiles level.
-- Defense in depth below the app-level checks in account-manage/SettingsAccount.

create or replace function public.guard_demo_auth_user()
returns trigger as $$
begin
  if OLD.id = '475cb475-f00b-4dd1-91ff-519e922b556d' then
    if TG_OP = 'DELETE' then
      raise exception 'Demo account cannot be deleted.';
    end if;
    if NEW.encrypted_password is distinct from OLD.encrypted_password
      or NEW.email is distinct from OLD.email
      or NEW.email_change is distinct from OLD.email_change
    then
      raise exception 'Demo account credentials cannot be changed.';
    end if;
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_guard_demo_auth_user_upd on auth.users;
create trigger trg_guard_demo_auth_user_upd
  before update on auth.users
  for each row execute function public.guard_demo_auth_user();

drop trigger if exists trg_guard_demo_auth_user_del on auth.users;
create trigger trg_guard_demo_auth_user_del
  before delete on auth.users
  for each row execute function public.guard_demo_auth_user();

create or replace function public.guard_demo_profile()
returns trigger as $$
begin
  if OLD.user_id = '475cb475-f00b-4dd1-91ff-519e922b556d' then
    if NEW.display_name is distinct from OLD.display_name
      or NEW.status is distinct from OLD.status
      or NEW.deactivated_at is distinct from OLD.deactivated_at
    then
      raise exception 'Demo account settings cannot be changed.';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_guard_demo_profile on public.sybil_profiles;
create trigger trg_guard_demo_profile
  before update on public.sybil_profiles
  for each row execute function public.guard_demo_profile();

-- ── Demo rate limiting ────────────────────────────────────────────────────
create table if not exists public.demo_usage (
  ip_address text primary key,
  chat_count integer not null default 0,
  transcription_count integer not null default 0,
  call_turn_count integer not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.demo_usage enable row level security;
-- No policies: only the service role (used inside edge functions) touches this table.

-- Atomic check-and-increment, called from the ingest/speechmatics-token edge
-- functions (service role). Returns true (and increments) if under p_limit,
-- false (no-op) if already at/over it — avoids a read-then-write race.
create or replace function public.increment_demo_usage(p_ip text, p_kind text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_kind = 'chat' then
    insert into demo_usage (ip_address, chat_count) values (p_ip, 1)
    on conflict (ip_address) do update
      set chat_count = demo_usage.chat_count + 1, last_seen = now()
      where demo_usage.chat_count < p_limit
    returning chat_count into v_count;
  elsif p_kind = 'transcription' then
    insert into demo_usage (ip_address, transcription_count) values (p_ip, 1)
    on conflict (ip_address) do update
      set transcription_count = demo_usage.transcription_count + 1, last_seen = now()
      where demo_usage.transcription_count < p_limit
    returning transcription_count into v_count;
  elsif p_kind = 'call_turn' then
    insert into demo_usage (ip_address, call_turn_count) values (p_ip, 1)
    on conflict (ip_address) do update
      set call_turn_count = demo_usage.call_turn_count + 1, last_seen = now()
      where demo_usage.call_turn_count < p_limit
    returning call_turn_count into v_count;
  else
    raise exception 'unknown demo_usage kind %', p_kind;
  end if;

  return v_count is not null;
end;
$$;
