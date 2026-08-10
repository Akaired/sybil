-- Sybil Docs: platform-level content, not workspace-scoped. Same shape as
-- sybil_blog_posts — no workspace_id, no is_workspace_member. Public anon
-- read of published pages, service_role-only writes via docs-admin.
-- content_md is the single source of truth — no content_html column, the
-- public docs-public function and the frontend both render markdown at read time.

create table public.sybil_docs_pages (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  category          text not null,
  title             text not null,
  summary           text,
  content_md        text not null default '',
  status            blog_post_status not null default 'draft',
  order_index       int not null default 0,
  author_user_id    uuid references auth.users(id) on delete set null,
  author_name       text,
  seo_title         text,
  seo_description   text,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index sybil_docs_pages_category_order_idx on public.sybil_docs_pages (category, order_index);
create index sybil_docs_pages_slug_idx on public.sybil_docs_pages (slug);

create or replace function public.touch_sybil_docs_pages()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_touch_sybil_docs_pages
before update on public.sybil_docs_pages
for each row execute function public.touch_sybil_docs_pages();

alter table public.sybil_docs_pages enable row level security;

create policy docs_public_read on public.sybil_docs_pages
for select to anon, authenticated
using (status = 'published' and published_at is not null and published_at <= now());

revoke insert, update, delete on public.sybil_docs_pages from anon, authenticated;

-- Used by docs-admin's `reorder` action so a batch of order_index writes
-- commits atomically instead of as N separate update() calls from the client.
create or replace function public.reorder_sybil_docs_pages(items jsonb)
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
    update public.sybil_docs_pages
    set order_index = (item->>'order_index')::int
    where id = (item->>'id')::uuid;
  end loop;
end;
$$;

revoke all on function public.reorder_sybil_docs_pages(jsonb) from anon, authenticated;

-- Seed: 6 empty draft pages, one per category. Content written later via /admin/docs.
insert into public.sybil_docs_pages (slug, category, title, order_index) values
  ('getting-started-with-sybil', 'getting-started', 'Getting started with Sybil', 0),
  ('how-the-agent-works',        'agent',           'How the agent works',       0),
  ('sentinels-overview',         'sentinels',        'Sentinels overview',        0),
  ('connecting-integrations',    'integrations',     'Connecting integrations',   0),
  ('managing-your-account',      'account',          'Managing your account',     0),
  ('api-and-reference',          'reference',        'API and reference',         0);

notify pgrst, 'reload schema';
