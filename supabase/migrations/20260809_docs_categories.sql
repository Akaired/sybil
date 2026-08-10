-- Docs categories become a managed table instead of a hardcoded list —
-- staff can add/rename/reorder/delete them from /admin/docs. Public read
-- (needed by the unauthenticated /docs index and docs-public) follows the
-- same shape as sybil_docs_pages: RLS-open select, service_role-only writes.

create table public.sybil_docs_categories (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  label        text not null,
  order_index  int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index sybil_docs_categories_order_idx on public.sybil_docs_categories (order_index);

create or replace function public.touch_sybil_docs_categories()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_touch_sybil_docs_categories
before update on public.sybil_docs_categories
for each row execute function public.touch_sybil_docs_categories();

alter table public.sybil_docs_categories enable row level security;

-- Categories carry no draft/published state of their own — the list itself
-- isn't sensitive, so anon+authenticated get an unconditional read (unlike
-- docs_public_read on sybil_docs_pages, which filters on status).
create policy docs_categories_public_read on public.sybil_docs_categories
for select to anon, authenticated
using (true);

revoke insert, update, delete on public.sybil_docs_categories from anon, authenticated;

insert into public.sybil_docs_categories (slug, label, order_index) values
  ('getting-started', 'Getting Started', 0),
  ('agent',           'Agent',           1),
  ('sentinels',       'Sentinels',       2),
  ('integrations',    'Integrations',    3),
  ('account',         'Account',         4),
  ('reference',        'Reference',       5);

-- sybil_docs_pages.category was free text validated only in docs-admin's
-- code; tie it to the new table so a page can never reference a category
-- that doesn't exist, and deleting a category that still has pages fails
-- loudly instead of orphaning them silently.
alter table public.sybil_docs_pages
  add constraint sybil_docs_pages_category_fkey
  foreign key (category) references public.sybil_docs_categories(slug)
  on update cascade on delete restrict;

-- Used by docs-admin's category `reorder` action, same pattern as
-- reorder_sybil_docs_pages.
create or replace function public.reorder_sybil_docs_categories(items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  for item in select * from jsonb_array_elements(items)
  loop
    update public.sybil_docs_categories
    set order_index = (item->>'order_index')::int
    where id = (item->>'id')::uuid;
  end loop;
end;
$$;

revoke all on function public.reorder_sybil_docs_categories(jsonb) from anon, authenticated;

notify pgrst, 'reload schema';
