-- Post-tour micro-survey (rating, optional willingness-to-pay, a short
-- comment, and a contact email) shown once at the end of the onboarding
-- tour. One row per submission; a user only ever completes onboarding once,
-- so this is effectively one row per user, but it's not modeled as a
-- profile column since it's feedback data, not account state.

create table public.sybil_onboarding_feedback (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  rating              smallint not null check (rating between 1 and 10),
  willingness_to_pay  numeric check (willingness_to_pay is null or willingness_to_pay >= 0),
  comment             text check (comment is null or char_length(comment) <= 150),
  contact_email       text,
  created_at          timestamptz not null default now()
);

create index sybil_onboarding_feedback_user_idx on public.sybil_onboarding_feedback (user_id);

alter table public.sybil_onboarding_feedback enable row level security;

-- Client writes its own row once, at the end of the tour. No client update
-- policy — a submission is final, matching how the tour itself only ever
-- runs once per user.
create policy onboarding_feedback_insert_own on public.sybil_onboarding_feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- Only platform admins can read responses back (reusing the existing
-- get_platform_role() RPC from the admin panel migration — the table
-- itself has no broad SELECT grant).
create policy onboarding_feedback_admin_read on public.sybil_onboarding_feedback
  for select to authenticated
  using (get_platform_role() is not null);

notify pgrst, 'reload schema';
