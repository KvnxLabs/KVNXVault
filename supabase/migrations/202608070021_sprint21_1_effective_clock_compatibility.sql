-- KVNX Vault Sprint 21.1: production effective-clock compatibility.
-- Apply after 202608070020_sprint21_skill_path_mission_offers.sql.
-- Installed migrations 001-020 remain immutable. There is intentionally no 010.

-- Production intentionally omits staging-only Migration 012. Install the
-- narrow real-clock fallback only when its zero-argument helper is absent.
-- CREATE (never CREATE OR REPLACE) preserves Migration 012 byte-for-behavior
-- anywhere the staging implementation already exists.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.dev_effective_vault_now()') is null then
    execute $function$
      create function public.dev_effective_vault_now()
      returns timestamptz
      language sql
      volatile
      security definer
      set search_path = ''
      as $body$
        select pg_catalog.clock_timestamp();
      $body$
    $function$;

    execute 'revoke all on function public.dev_effective_vault_now() from public, anon, authenticated';

    execute $comment$
      comment on function public.dev_effective_vault_now()
      is 'Sprint 21.1 production compatibility fallback. Returns real database time only; installs only when the staging helper is absent.'
    $comment$;
  end if;
end;
$migration$;
