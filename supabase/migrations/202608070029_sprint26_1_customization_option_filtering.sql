-- KVNX Vault Sprint 26.1: Mission Customization option filtering hotfix.
-- Apply after 202608070028_sprint26_mission_customization.sql.
-- Historical migrations 001-028 remain immutable. There is intentionally no 010.

-- One internal predicate is the complete Daily Mission Customization contract.
-- Catalog focus groups used by other systems (including skill_path) are not
-- customization options merely because their templates are active.
create or replace function public.vault_mission_customization_focus_allowed(
  p_focus_key text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(p_focus_key in (
    'career', 'business', 'programming', 'fitness', 'health', 'learning',
    'creativity', 'finance', 'relationships', 'mindset', 'general'
  ), false);
$$;

revoke all on function public.vault_mission_customization_focus_allowed(text)
from public, anon, authenticated;

-- The effective-focus path uses the same contract as restoration and saving.
-- An unavailable or non-customizable preference safely falls back to the
-- existing onboarding normalization without mutating the saved row.
create or replace function public.vault_effective_mission_focus_key(
  p_user_id uuid,
  p_primary_focus text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preferred_focus_key text;
begin
  select preference.preferred_focus_key
  into v_preferred_focus_key
  from public.user_mission_preferences as preference
  where preference.user_id = p_user_id;

  if public.vault_mission_customization_focus_allowed(v_preferred_focus_key)
    and exists (
      select 1
      from public.mission_catalog as catalog
      join public.skill_catalog as skill
        on skill.skill_key = catalog.primary_skill_key
       and skill.active = true
      where catalog.focus_key = v_preferred_focus_key
        and catalog.active = true
    ) then
    return v_preferred_focus_key;
  end if;

  return public.vault_mission_focus_key(p_primary_focus);
end;
$$;

revoke all on function public.vault_effective_mission_focus_key(uuid, text)
from public, anon, authenticated;

-- Zero-argument restoration now filters active catalog groups through the
-- exact closed customization contract and excludes any key without a canonical
-- non-null product label.
create or replace function public.get_mission_customization()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_primary_focus text;
  v_onboarding_focus_key text;
  v_preferred_focus_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select onboarding.primary_focus
  into v_primary_focus
  from public.onboarding_profiles as onboarding
  where onboarding.user_id = v_user_id
    and onboarding.completed = true;

  if not found then
    raise exception 'Completed onboarding required' using errcode = '22023';
  end if;

  v_onboarding_focus_key := public.vault_mission_focus_key(v_primary_focus);

  select preference.preferred_focus_key
  into v_preferred_focus_key
  from public.user_mission_preferences as preference
  where preference.user_id = v_user_id;

  return jsonb_build_object(
    'accepted', true,
    'preferredFocusKey', v_preferred_focus_key,
    'preferredFocusName', public.vault_mission_focus_label(v_preferred_focus_key),
    'effectiveFocusKey', public.vault_effective_mission_focus_key(v_user_id, v_primary_focus),
    'onboardingFocusKey', v_onboarding_focus_key,
    'onboardingFocusName', public.vault_mission_focus_label(v_onboarding_focus_key),
    'effectiveTiming', 'next-uncreated-daily-choice',
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', available.focus_key,
        'name', available.focus_label
      ) order by available.display_order)
      from (
        select
          catalog.focus_key,
          public.vault_mission_focus_label(catalog.focus_key) as focus_label,
          min(case catalog.focus_key
            when 'career' then 10 when 'business' then 20
            when 'programming' then 30 when 'fitness' then 40
            when 'health' then 50 when 'learning' then 60
            when 'creativity' then 70 when 'finance' then 80
            when 'relationships' then 90 when 'mindset' then 100
            when 'general' then 110 end) as display_order
        from public.mission_catalog as catalog
        join public.skill_catalog as skill
          on skill.skill_key = catalog.primary_skill_key
         and skill.active = true
        where catalog.active = true
          and public.vault_mission_customization_focus_allowed(catalog.focus_key)
          and public.vault_mission_focus_label(catalog.focus_key) is not null
        group by catalog.focus_key
      ) as available
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_mission_customization()
from public, anon, authenticated;
grant execute on function public.get_mission_customization() to authenticated;

-- Saving consumes the same closed predicate. It accepts one focus key and
-- persists preference state only; no mission/choice generation is invoked.
create or replace function public.set_mission_customization(p_focus_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_focus_key text := lower(pg_catalog.btrim(coalesce(p_focus_key, '')));
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.vault_mission_customization_focus_allowed(v_focus_key)
    or not exists (
      select 1
      from public.mission_catalog as catalog
      join public.skill_catalog as skill
        on skill.skill_key = catalog.primary_skill_key
       and skill.active = true
      where catalog.focus_key = v_focus_key
        and catalog.active = true
    ) then
    raise exception 'Canonical active mission focus required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':mission-customization', 0)
  );

  insert into public.user_mission_preferences (user_id, preferred_focus_key)
  values (v_user_id, v_focus_key)
  on conflict (user_id) do update
    set preferred_focus_key = excluded.preferred_focus_key;

  return public.get_mission_customization();
end;
$$;

revoke all on function public.set_mission_customization(text)
from public, anon, authenticated;
grant execute on function public.set_mission_customization(text) to authenticated;

comment on function public.set_mission_customization(text)
is 'Sprint 26.1 closed-contract preference mutation. It creates no mission or choice set, awards no XP, and cannot alter current mission, history, capacity, lifecycle, streaks, or achievements.';

-- Reassert Sprint 26 table isolation. Existing preference rows are untouched.
alter table public.user_mission_preferences enable row level security;
revoke all on public.user_mission_preferences from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
on public.user_mission_preferences from authenticated;
