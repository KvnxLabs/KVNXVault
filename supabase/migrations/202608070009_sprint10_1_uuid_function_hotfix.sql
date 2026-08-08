-- KVNX Vault Sprint 10.1: correct the schema-qualified UUID generator used by
-- the internal Sprint 9 daily mission creation and replacement authorities.
-- Apply after 202608070008_sprint10_skill_progression.sql.
-- Migrations 001-008 remain immutable.
--
-- Supabase installs pgcrypto in the extensions schema. These SECURITY DEFINER
-- functions keep an explicit empty search_path, so the UUID generator must be
-- explicitly addressed as extensions.gen_random_uuid().

-- Migration 007 preserved the Sprint 9 clock-injectable creation authority by
-- renaming it to request_daily_mission_at_sprint9(). Replace only that active
-- internal definition; the Sprint 9.2 public wrapper and nextResetAt contract
-- remain unchanged.
create or replace function public.request_daily_mission_at_sprint9(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_key date;
  v_onboarding public.onboarding_profiles%rowtype;
  v_state public.daily_mission_state%rowtype;
  v_now timestamptz := p_now;
  v_definition jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_onboarding
  from public.onboarding_profiles
  where user_id = v_user_id and completed = true;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'onboarding-incomplete');
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text, 0)
  );

  -- Rollover remains server-driven. Any stale nonterminal mission expires with
  -- zero XP and exactly one history record before today's mission is created.
  with expired as (
    update public.daily_mission_state
    set lifecycle_state = 'expired',
        completion_awarded = false,
        terminal_at = v_now,
        terminal_recorded = true
    where user_id = v_user_id
      and daily_key < v_daily_key
      and lifecycle_state in ('ready', 'active')
    returning *
  )
  insert into public.mission_history (
    user_id, daily_session_id, mission_id, title, focus,
    final_state, xp_awarded, terminal_at
  )
  select user_id, daily_session_id, mission_definition ->> 'id',
    mission_definition ->> 'title', mission_definition ->> 'focus',
    'expired', 0, terminal_at
  from expired
  on conflict (user_id, daily_session_id, mission_id, terminal_at) do nothing;

  select * into v_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if found then
    return public.vault_daily_mission_response(v_state, true, 'existing', null);
  end if;

  v_definition := public.build_vault_daily_mission(
    v_onboarding,
    extensions.gen_random_uuid()
  );

  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, 75)
  on conflict (user_id) do nothing;

  insert into public.daily_mission_state (
    user_id, daily_key, daily_session_id, mission_definition,
    lifecycle_state, completion_awarded, replacements_used,
    terminal_at, terminal_recorded
  ) values (
    v_user_id, v_daily_key, v_daily_key::text, v_definition,
    'ready', false, 0, null, false
  )
  on conflict (user_id, daily_key) do nothing;

  select * into strict v_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  return public.vault_daily_mission_response(v_state, true, 'created', null);
end;
$$;

revoke all on function public.request_daily_mission_at_sprint9(timestamptz) from public;
revoke all on function public.request_daily_mission_at_sprint9(timestamptz) from anon;
revoke all on function public.request_daily_mission_at_sprint9(timestamptz) from authenticated;

comment on function public.request_daily_mission_at_sprint9(timestamptz)
is 'Sprint 10.1 internal daily authority. Generates mission instance identity with extensions.gen_random_uuid() while preserving Sprint 9 rules.';

-- Migration 007 likewise preserved the Sprint 9 replacement authority under
-- this internal name. Replace only its definition; the zero-argument public
-- wrapper continues to append the Sprint 9.2 nextResetAt value.
create or replace function public.request_daily_mission_replacement_sprint9()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_daily_key date;
  v_onboarding public.onboarding_profiles%rowtype;
  v_state public.daily_mission_state%rowtype;
  v_total_xp integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text, 0)
  );

  select * into v_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'mission-not-found');
  end if;

  select total_xp into strict v_total_xp
  from public.progression_state
  where user_id = v_user_id
  for update;

  if v_state.lifecycle_state not in ('completed', 'skipped', 'expired') then
    return public.vault_daily_mission_response(v_state, false, 'current-mission-not-terminal', v_total_xp);
  end if;
  if v_state.replacements_used >= 1 then
    return public.vault_daily_mission_response(v_state, false, 'replacement-limit-reached', v_total_xp);
  end if;

  select * into v_onboarding
  from public.onboarding_profiles
  where user_id = v_user_id and completed = true;
  if not found then
    return public.vault_daily_mission_response(v_state, false, 'onboarding-incomplete', v_total_xp);
  end if;

  update public.daily_mission_state
  set mission_definition = public.build_vault_daily_mission(
        v_onboarding,
        extensions.gen_random_uuid()
      ),
      lifecycle_state = 'ready',
      completion_awarded = false,
      replacements_used = 1,
      terminal_at = null,
      terminal_recorded = false
  where user_id = v_user_id and daily_key = v_daily_key
  returning * into strict v_state;

  return public.vault_daily_mission_response(v_state, true, 'replaced', v_total_xp);
end;
$$;

revoke all on function public.request_daily_mission_replacement_sprint9() from public;
revoke all on function public.request_daily_mission_replacement_sprint9() from anon;
revoke all on function public.request_daily_mission_replacement_sprint9() from authenticated;

comment on function public.request_daily_mission_replacement_sprint9()
is 'Sprint 10.1 internal replacement authority. Generates replacement identity with extensions.gen_random_uuid() while preserving the one-replacement limit.';
