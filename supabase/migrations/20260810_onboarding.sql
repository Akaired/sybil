-- First-login product tour: completion flag + declared job profile.
-- job_profile is used only to personalize the example string shown inside
-- the tour UI (client-side copy selection) — it is never read by ingest/
-- interpret/resolve or any agent behavior.

alter table public.sybil_profiles
  add column onboarding_completed boolean not null default false,
  add column job_profile text;

alter table public.sybil_profiles
  add constraint sybil_profiles_job_profile_check
  check (job_profile is null or job_profile in ('agency_owner', 'developer', 'designer', 'marketer', 'other'));

-- Existing users predate this feature — treat them as already onboarded so
-- the tour only ever appears for genuinely new signups from this point on.
update public.sybil_profiles set onboarding_completed = true;

-- Client self-reports onboarding progress the same way it already
-- self-reports display_name/avatar_url. Column-level REVOKE is a no-op
-- while the table-level UPDATE grant still stands, so revoke it first.
revoke update on public.sybil_profiles from authenticated;
grant update (display_name, avatar_url, onboarding_completed, job_profile) on public.sybil_profiles to authenticated;

notify pgrst, 'reload schema';
