-- Follow-up to 20260809_platform_admin_panel.sql, needed while building admin-api.

begin;

-- A caller who isn't in platform_admins at all has no role — the audit row for
-- that denial (step c of admin-api's auth flow) can't satisfy a NOT NULL
-- admin_role. Every other audit path (an actual staff/superadmin acting) still
-- always has a role, so this only loosens the one case that needs it.
alter table sybil_admin_audit alter column admin_role drop not null;

-- secrets_list needs {name, last4, updated_at, source} without ever returning
-- the value itself — vault.secrets/vault.decrypted_secrets aren't exposed to
-- PostgREST, so this is a thin SECURITY DEFINER wrapper same as get_vault_secret.
create or replace function public.list_managed_secrets(names text[])
returns table(name text, last4 text, updated_at timestamptz, source text)
language sql
security definer
stable
set search_path = public, vault
as $$
  select
    n.name,
    right(v.decrypted_secret, 4) as last4,
    vs.updated_at,
    case when v.decrypted_secret is not null then 'vault' else 'env' end as source
  from unnest(names) as n(name)
  left join vault.secrets vs on vs.name = n.name
  left join vault.decrypted_secrets v on v.name = n.name;
$$;
revoke all on function public.list_managed_secrets(text[]) from public, anon, authenticated;
grant execute on function public.list_managed_secrets(text[]) to service_role;

commit;
