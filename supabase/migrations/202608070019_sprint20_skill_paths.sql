-- KVNX Vault Sprint 20: server-authoritative canonical Skill Paths.
-- Apply after 202608070018_sprint19_daily_mission_choice.sql.
-- Installed migrations 001-018 remain immutable. There is intentionally no 010.

-- Development intent is deliberately separate from lifetime skill progression.
-- A path can be active with zero XP, and deactivation never deletes progression
-- or history. Browser roles cannot read or mutate this persistence directly.
create table public.user_skill_paths (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null references public.skill_catalog(skill_key),
  path_active boolean not null,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, skill_key),
  constraint user_skill_paths_state_consistent check (
    (path_active and activated_at is not null and deactivated_at is null)
    or
    (not path_active and deactivated_at is not null)
  )
);

create index user_skill_paths_user_active_idx
  on public.user_skill_paths(user_id, path_active, updated_at desc);

create trigger user_skill_paths_set_updated_at
before update on public.user_skill_paths
for each row execute function public.set_updated_at();

alter table public.user_skill_paths enable row level security;

-- No policy is intentional. All owner reads and mutations cross the narrow,
-- auth.uid()-derived SECURITY DEFINER contracts below.
revoke all on public.user_skill_paths from public, anon, authenticated;

create or replace function public.vault_skill_path_response(
  p_user_id uuid,
  p_skill_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', path.skill_key,
    'name', catalog.display_name,
    'pathActive', path.path_active,
    'catalogActive', catalog.active,
    'activatedAt', case when path.activated_at is null then null else to_jsonb(path.activated_at) end,
    'deactivatedAt', case when path.deactivated_at is null then null else to_jsonb(path.deactivated_at) end,
    'updatedAt', to_jsonb(path.updated_at)
  )
  from public.user_skill_paths as path
  join public.skill_catalog as catalog on catalog.skill_key = path.skill_key
  where path.user_id = p_user_id
    and path.skill_key = p_skill_key;
$$;

revoke all on function public.vault_skill_path_response(uuid, text)
from public, anon, authenticated;

-- Zero-argument restoration. Identity is derived exclusively from auth.uid().
create or replace function public.get_skill_paths()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', path.skill_key,
      'name', catalog.display_name,
      'pathActive', path.path_active,
      'catalogActive', catalog.active,
      'activatedAt', case when path.activated_at is null then null else to_jsonb(path.activated_at) end,
      'deactivatedAt', case when path.deactivated_at is null then null else to_jsonb(path.deactivated_at) end,
      'updatedAt', to_jsonb(path.updated_at)
    ) order by catalog.sort_order)
    from public.user_skill_paths as path
    join public.skill_catalog as catalog on catalog.skill_key = path.skill_key
    where path.user_id = v_user_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_skill_paths() from public, anon, authenticated;
grant execute on function public.get_skill_paths() to authenticated;

comment on function public.get_skill_paths()
is 'Sprint 20 zero-argument restoration of the authenticated user development-path preferences. Returns no progression or mission authority.';

-- Activation accepts one canonical key. The server validates active catalog
-- membership and serializes same-user/same-skill mutations before persisting.
create or replace function public.activate_skill_path(p_skill_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_skill_key text := lower(trim(coalesce(p_skill_key, '')));
  v_now timestamptz := clock_timestamp();
  v_path public.user_skill_paths%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.skill_catalog as catalog
    where catalog.skill_key = v_skill_key
      and catalog.active = true
  ) then
    raise exception 'Canonical active skill required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':skill-path:' || v_skill_key, 0)
  );

  select * into v_path
  from public.user_skill_paths
  where user_id = v_user_id and skill_key = v_skill_key
  for update;

  if not found then
    insert into public.user_skill_paths (
      user_id, skill_key, path_active, activated_at, deactivated_at
    ) values (
      v_user_id, v_skill_key, true, v_now, null
    );
  elsif not v_path.path_active then
    update public.user_skill_paths
    set path_active = true,
        activated_at = v_now,
        deactivated_at = null
    where user_id = v_user_id and skill_key = v_skill_key;
  end if;

  return public.vault_skill_path_response(v_user_id, v_skill_key);
end;
$$;

revoke all on function public.activate_skill_path(text) from public, anon, authenticated;
grant execute on function public.activate_skill_path(text) to authenticated;

comment on function public.activate_skill_path(text)
is 'Sprint 20 idempotent canonical path activation. Awards no XP, creates no mission/history, and does not alter Daily Mission Choice, streaks, or achievements.';

-- Deactivation is soft state. It validates canonical identity but deliberately
-- does not require the catalog row to remain active, so a retired path can be
-- switched off without deleting lifetime skill progression or Vault history.
create or replace function public.deactivate_skill_path(p_skill_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_skill_key text := lower(trim(coalesce(p_skill_key, '')));
  v_now timestamptz := clock_timestamp();
  v_path public.user_skill_paths%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.skill_catalog as catalog
    where catalog.skill_key = v_skill_key
  ) then
    raise exception 'Canonical skill required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':skill-path:' || v_skill_key, 0)
  );

  select * into v_path
  from public.user_skill_paths
  where user_id = v_user_id and skill_key = v_skill_key
  for update;

  if not found then
    insert into public.user_skill_paths (
      user_id, skill_key, path_active, activated_at, deactivated_at
    ) values (
      v_user_id, v_skill_key, false, null, v_now
    );
  elsif v_path.path_active then
    update public.user_skill_paths
    set path_active = false,
        deactivated_at = v_now
    where user_id = v_user_id and skill_key = v_skill_key;
  end if;

  return public.vault_skill_path_response(v_user_id, v_skill_key);
end;
$$;

revoke all on function public.deactivate_skill_path(text) from public, anon, authenticated;
grant execute on function public.deactivate_skill_path(text) to authenticated;

comment on function public.deactivate_skill_path(text)
is 'Sprint 20 idempotent soft deactivation. Lifetime progression, Vault history, XP, missions, streaks, achievements, onboarding focus, and Daily Mission Choice remain untouched.';

-- Reassert direct-write denial after all objects exist.
revoke insert, update, delete, truncate, references, trigger
on public.user_skill_paths from authenticated;
