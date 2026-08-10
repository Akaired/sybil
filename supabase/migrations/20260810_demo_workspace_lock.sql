-- The shared demo account (demo@sybil.local, id 475cb475-f00b-4dd1-91ff-519e922b556d)
-- already has its one workspace ("My Team"). Nothing previously stopped a
-- visitor from creating or joining additional workspaces via
-- workspace-onboarding's create/join_by_invite/join_by_code actions — each
-- extra one would leave the account owning/belonging to several workspaces,
-- and Layout.tsx's workspace switcher would expose them all to the next
-- visitor. Same DB-trigger-as-security-boundary pattern as the existing
-- demo guards (20260810_demo_account_guards.sql): block it below the app
-- layer so it can't be bypassed by any future code path.

create or replace function public.guard_demo_no_extra_workspace()
returns trigger as $$
begin
  if NEW.owner_id = '475cb475-f00b-4dd1-91ff-519e922b556d' then
    raise exception 'Demo account cannot create additional workspaces.';
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_demo_no_extra_workspace on public.workspaces;
create trigger guard_demo_no_extra_workspace
  before insert on public.workspaces
  for each row execute function public.guard_demo_no_extra_workspace();

create or replace function public.guard_demo_no_extra_membership()
returns trigger as $$
begin
  if NEW.user_id = '475cb475-f00b-4dd1-91ff-519e922b556d' then
    raise exception 'Demo account cannot join or create additional workspaces.';
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_demo_no_extra_membership on public.workspace_members;
create trigger guard_demo_no_extra_membership
  before insert on public.workspace_members
  for each row execute function public.guard_demo_no_extra_membership();
