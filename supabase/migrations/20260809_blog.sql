-- Sybil Blog: platform-level content, not workspace-scoped.
-- No workspace_id column, no is_workspace_member — public anon read of
-- published posts, service_role-only writes via the blog-admin edge function.

create type blog_post_status as enum ('draft', 'published', 'archived');

create table public.sybil_blog_posts (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  excerpt           text,
  cover_url         text,
  content_json      jsonb not null default '{}'::jsonb,
  content_html      text  not null default '',
  status            blog_post_status not null default 'draft',
  author_user_id    uuid references auth.users(id) on delete set null,
  author_name       text,
  tags              text[] not null default '{}',
  reading_minutes   int,
  seo_title         text,
  seo_description   text,
  og_image_url      text,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index sybil_blog_posts_slug_idx on public.sybil_blog_posts (slug);
create index sybil_blog_posts_pub_idx  on public.sybil_blog_posts (status, published_at desc);

create or replace function public.touch_sybil_blog_posts()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_touch_sybil_blog_posts
before update on public.sybil_blog_posts
for each row execute function public.touch_sybil_blog_posts();

alter table public.sybil_blog_posts enable row level security;

create policy blog_public_read on public.sybil_blog_posts
for select to anon, authenticated
using (status = 'published' and published_at is not null and published_at <= now());

revoke insert, update, delete on public.sybil_blog_posts from anon, authenticated;

notify pgrst, 'reload schema';
