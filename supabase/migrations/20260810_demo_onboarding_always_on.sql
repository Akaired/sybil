-- The shared demo account (demo@sybil.local, id 475cb475-f00b-4dd1-91ff-519e922b556d)
-- should always get the onboarding tour, for every visitor — not just once.
-- Reset its current flag and extend the existing demo hard-lock trigger
-- (see 20260810_demo_account_guards.sql) so nothing can ever persist it as
-- completed again. Frontend also treats this account as needsOnboarding
-- unconditionally (belt and suspenders) — see AuthContext.tsx.

update public.sybil_profiles
set onboarding_completed = false
where user_id = '475cb475-f00b-4dd1-91ff-519e922b556d'
  and onboarding_completed is distinct from false;

create or replace function public.guard_demo_profile()
returns trigger as $$
begin
  if OLD.user_id = '475cb475-f00b-4dd1-91ff-519e922b556d' then
    if NEW.display_name is distinct from OLD.display_name
      or NEW.status is distinct from OLD.status
      or NEW.deactivated_at is distinct from OLD.deactivated_at
      or NEW.onboarding_completed is distinct from OLD.onboarding_completed
    then
      raise exception 'Demo account settings cannot be changed.';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;
