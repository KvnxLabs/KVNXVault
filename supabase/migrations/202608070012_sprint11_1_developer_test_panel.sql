-- KVNX Vault Sprint 11.1: staging-only developer test clock.
-- Apply after 202608070011_sprint11_achievements.sql.
-- Migrations 001-009 and 011 remain immutable. There is no migration 010.
--
-- SAFETY MODEL
-- 1. The environment gate is inserted disabled and can be changed only by a
--    database administrator in a separate staging Supabase project.
-- 2. The authenticated account must also be explicitly allowlisted by a
--    database administrator.
-- 3. Browser RPCs accept no user id, timestamp, interval, XP, skill, mission,
--    achievement, reward, or replacement-count input.
-- 4. When either gate is closed, the effective clock is clock_timestamp(), so
--    production behavior is unchanged even if this migration is installed by
--    mistake. Production installation is still not recommended.

create table public.dev_environment_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.dev_environment_config (singleton, enabled)
values (true, false);

create table public.dev_test_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.dev_test_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  simulated_now timestamptz not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.dev_environment_config enable row level security;
alter table public.dev_test_accounts enable row level security;
alter table public.dev_test_state enable row level security;

-- No table policy is intentionally created. Browser roles cannot read or
-- mutate environment configuration, allowlists, or simulated clocks directly.
revoke all on public.dev_environment_config from public, anon, authenticated;
revoke all on public.dev_test_accounts from public, anon, authenticated;
revoke all on public.dev_test_state from public, anon, authenticated;

create or replace function public.dev_tools_authorized(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select environment.enabled
    from public.dev_environment_config as environment
    where environment.singleton = true
  ), false)
  and exists (
    select 1
    from public.dev_test_accounts as account
    where account.user_id = p_user_id
      and account.enabled = true
  );
$$;

revoke all on function public.dev_tools_authorized(uuid) from public, anon, authenticated;

create or replace function public.dev_require_tools()
returns uuid
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
  if not public.dev_tools_authorized(v_user_id) then
    raise exception 'Development tools are unavailable' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

revoke all on function public.dev_require_tools() from public, anon, authenticated;

-- Production authorities call this internal clock source. It returns a
-- simulated instant only when both server gates and the current user's clock
-- row are enabled. No browser role can invoke it directly.
create or replace function public.dev_effective_vault_now()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_simulated_now timestamptz;
begin
  if v_user_id is not null and public.dev_tools_authorized(v_user_id) then
    select state.simulated_now
    into v_simulated_now
    from public.dev_test_state as state
    where state.user_id = v_user_id
      and state.enabled = true;
  end if;
  return coalesce(v_simulated_now, clock_timestamp());
end;
$$;

revoke all on function public.dev_effective_vault_now() from public, anon, authenticated;

create or replace function public.dev_get_test_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.dev_require_tools();
  v_real_now timestamptz := clock_timestamp();
  v_effective_now timestamptz;
  v_enabled boolean := false;
begin
  select state.enabled
  into v_enabled
  from public.dev_test_state as state
  where state.user_id = v_user_id;

  v_enabled := coalesce(v_enabled, false);
  v_effective_now := public.dev_effective_vault_now();

  return jsonb_build_object(
    'testClockEnabled', v_enabled,
    'simulatedNow', v_effective_now,
    'realDatabaseNow', v_real_now,
    'nextResetAt', public.next_vault_reset_at(v_user_id, v_effective_now)
  );
end;
$$;

create or replace function public.dev_advance_one_hour()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.dev_require_tools();
  v_real_now timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kvnx-dev-clock:' || v_user_id::text, 0)
  );

  insert into public.dev_test_state as state
    (user_id, simulated_now, enabled, updated_at)
  values
    (v_user_id, v_real_now + interval '1 hour', true, v_real_now)
  on conflict (user_id) do update
  set simulated_now = case
        when state.enabled then state.simulated_now + interval '1 hour'
        else v_real_now + interval '1 hour'
      end,
      enabled = true,
      updated_at = v_real_now;

  return public.dev_get_test_state();
end;
$$;

create or replace function public.dev_advance_to_next_day()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.dev_require_tools();
  v_now timestamptz;
  v_target timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kvnx-dev-clock:' || v_user_id::text, 0)
  );

  v_now := public.dev_effective_vault_now();
  v_target := public.next_vault_reset_at(v_user_id, v_now) + interval '1 second';

  insert into public.dev_test_state
    (user_id, simulated_now, enabled, updated_at)
  values
    (v_user_id, v_target, true, clock_timestamp())
  on conflict (user_id) do update
  set simulated_now = excluded.simulated_now,
      enabled = true,
      updated_at = excluded.updated_at;

  return public.dev_get_test_state();
end;
$$;

create or replace function public.dev_clear_test_clock()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.dev_require_tools();
begin
  delete from public.dev_test_state
  where user_id = v_user_id;
  return public.dev_get_test_state();
end;
$$;

revoke all on function public.dev_get_test_state() from public, anon;
revoke all on function public.dev_advance_one_hour() from public, anon;
revoke all on function public.dev_advance_to_next_day() from public, anon;
revoke all on function public.dev_clear_test_clock() from public, anon;
grant execute on function public.dev_get_test_state() to authenticated;
grant execute on function public.dev_advance_one_hour() to authenticated;
grant execute on function public.dev_advance_to_next_day() to authenticated;
grant execute on function public.dev_clear_test_clock() to authenticated;

-- Reuse the Sprint 9 clock-injectable daily engine. Production users receive
-- clock_timestamp(); approved staging accounts receive only their own test
-- clock. The public zero-argument contract is unchanged.
create or replace function public.request_daily_mission()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := public.dev_effective_vault_now();
begin
  return public.request_daily_mission_at(v_now);
end;
$$;

revoke all on function public.request_daily_mission() from public, anon;
grant execute on function public.request_daily_mission() to authenticated;

-- Preserve the Sprint 10.1 UUID source and Sprint 9 replacement rules while
-- injecting the approved account's effective clock.
create or replace function public.request_daily_mission_replacement_sprint9()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
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

revoke all on function public.request_daily_mission_replacement_sprint9() from public, anon, authenticated;

create or replace function public.request_daily_mission_replacement()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_result := public.request_daily_mission_replacement_sprint9();
  return v_result || jsonb_build_object(
    'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
  );
end;
$$;

revoke all on function public.request_daily_mission_replacement() from public, anon;
grant execute on function public.request_daily_mission_replacement() to authenticated;

-- Today's skill gain follows the same simulated logical day as the mission.
create or replace function public.get_skill_progression()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', progression.skill_key,
      'name', catalog.display_name,
      'totalXP', progression.skill_xp,
      'todayGain', coalesce(today.skill_xp, 0)
    ) order by progression.skill_xp desc, catalog.sort_order)
    from public.skill_progression as progression
    join public.skill_catalog as catalog
      on catalog.skill_key = progression.skill_key
    left join lateral (
      select sum(history.skill_xp_awarded)::integer as skill_xp
      from public.mission_history as history
      where history.user_id = v_user_id
        and history.skill_key = progression.skill_key
        and (history.terminal_at at time zone coalesce((
          select profile.timezone_name
          from public.profiles as profile
          where profile.user_id = v_user_id
        ), 'UTC'))::date = v_daily_key
    ) as today on true
    where progression.user_id = v_user_id
      and catalog.active = true
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_skill_progression() from public, anon;
grant execute on function public.get_skill_progression() to authenticated;

-- Sprint 11 completion authority is reproduced exactly with one clock-source
-- substitution. The public input contract remains mission id plus action.
create or replace function public.request_vault_mission_action(
  p_mission_id text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_state public.daily_mission_state%rowtype;
  v_total_xp integer;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_previous_state text;
  v_current_state text;
  v_event_type text := 'mission.transition-rejected';
  v_reason text := null;
  v_accepted boolean := false;
  v_completion_awarded boolean;
  v_xp_awarded integer := 0;
  v_reward integer := 0;
  v_skill_key text;
  v_skill_name text;
  v_skill_reward integer := 0;
  v_skill_total_xp integer := null;
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_terminal_at timestamptz;
  v_terminal_recorded boolean;
  v_history_record jsonb := null;
  v_updated_skill jsonb := null;
  v_new_achievements jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_mission_id), '')) not between 1 and 160 then
    return jsonb_build_object('accepted', false, 'reason', 'invalid-mission-id');
  end if;
  if v_action not in ('start', 'complete', 'skip') then
    return jsonb_build_object('accepted', false, 'reason', 'invalid-action');
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);

  select * into v_daily_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'mission-not-found');
  end if;

  select total_xp into v_total_xp
  from public.progression_state
  where user_id = v_user_id
  for update;
  if not found then
    raise exception 'Progression state is not initialized' using errcode = 'P0002';
  end if;

  v_previous_state := v_daily_state.lifecycle_state;
  v_current_state := v_previous_state;
  v_completion_awarded := v_daily_state.completion_awarded;
  v_terminal_at := v_daily_state.terminal_at;
  v_terminal_recorded := v_daily_state.terminal_recorded;

  if v_daily_state.mission_definition ->> 'id' <> p_mission_id then
    v_reason := 'mission-mismatch';
  elsif v_action = 'start' and v_previous_state = 'ready' then
    v_accepted := true;
    v_current_state := 'active';
    v_event_type := 'mission.started';
  elsif v_action = 'complete' and v_previous_state in ('ready', 'active') then
    if jsonb_typeof(v_daily_state.mission_definition -> 'xpReward') <> 'number' then
      raise exception 'Invalid saved mission reward' using errcode = '22023';
    end if;
    v_reward := (v_daily_state.mission_definition ->> 'xpReward')::integer;
    if v_reward <> 25 then
      raise exception 'Invalid saved mission reward' using errcode = '22023';
    end if;

    v_skill_key := v_daily_state.mission_definition ->> 'primarySkill';
    select catalog.display_name into v_skill_name
    from public.skill_catalog as catalog
    where catalog.skill_key = v_skill_key and catalog.active = true;
    if not found then
      raise exception 'Invalid saved mission skill' using errcode = '22023';
    end if;

    v_skill_reward := 15;
    insert into public.skill_progression (user_id, skill_key, skill_xp)
    values (v_user_id, v_skill_key, 0)
    on conflict (user_id, skill_key) do nothing;

    select skill_xp into strict v_skill_total_xp
    from public.skill_progression
    where user_id = v_user_id and skill_key = v_skill_key
    for update;

    v_accepted := true;
    v_current_state := 'completed';
    v_event_type := 'mission.completed';
    v_xp_awarded := v_reward;
    v_completion_awarded := true;
    v_terminal_at := v_now;
    v_total_xp := v_total_xp + v_reward;
    v_skill_total_xp := v_skill_total_xp + v_skill_reward;
  elsif v_action = 'skip' and v_previous_state in ('ready', 'active') then
    v_accepted := true;
    v_current_state := 'skipped';
    v_event_type := 'mission.skipped';
    v_completion_awarded := false;
    v_terminal_at := v_now;
  elsif v_previous_state = 'completed' then
    v_reason := 'already-completed';
  elsif v_previous_state = 'skipped' then
    v_reason := 'already-skipped';
  elsif v_previous_state = 'expired' then
    v_reason := 'mission-expired';
  else
    v_reason := 'invalid-transition';
  end if;

  if v_accepted then
    if v_xp_awarded > 0 then
      update public.progression_state
      set total_xp = v_total_xp
      where user_id = v_user_id;

      update public.skill_progression
      set skill_xp = v_skill_total_xp
      where user_id = v_user_id and skill_key = v_skill_key;

      v_updated_skill := jsonb_build_object(
        'key', v_skill_key,
        'name', v_skill_name,
        'totalXP', v_skill_total_xp,
        'todayGain', coalesce((
          select sum(history.skill_xp_awarded)::integer
          from public.mission_history as history
          where history.user_id = v_user_id
            and history.skill_key = v_skill_key
            and history.daily_session_id = v_daily_state.daily_session_id
        ), 0) + v_skill_reward
      );
    end if;

    if v_current_state in ('completed', 'skipped') then
      insert into public.mission_history (
        user_id, daily_session_id, mission_id, title, focus,
        final_state, xp_awarded, terminal_at, skill_key, skill_xp_awarded
      ) values (
        v_user_id, v_daily_state.daily_session_id,
        v_daily_state.mission_definition ->> 'id',
        v_daily_state.mission_definition ->> 'title',
        v_daily_state.mission_definition ->> 'focus',
        v_current_state, v_xp_awarded, v_terminal_at,
        v_skill_key, v_skill_reward
      )
      on conflict (user_id, daily_session_id, mission_id, terminal_at) do nothing;
      v_terminal_recorded := true;
      v_history_record := jsonb_build_object(
        'missionId', v_daily_state.mission_definition ->> 'id',
        'title', v_daily_state.mission_definition ->> 'title',
        'focus', v_daily_state.mission_definition ->> 'focus',
        'finalState', v_current_state,
        'xpAwarded', v_xp_awarded,
        'skillKey', v_skill_key,
        'skillXPAwarded', v_skill_reward,
        'terminalAt', v_terminal_at
      );
    end if;

    update public.daily_mission_state
    set lifecycle_state = v_current_state,
        completion_awarded = v_completion_awarded,
        terminal_at = v_terminal_at,
        terminal_recorded = v_terminal_recorded
    where user_id = v_user_id and daily_key = v_daily_key;

    if v_xp_awarded > 0 then
      v_new_achievements := public.evaluate_vault_achievements(
        v_user_id,
        v_total_xp,
        v_daily_state.replacements_used = 1,
        v_now
      );
    end if;
  end if;

  return jsonb_build_object(
    'accepted', v_accepted,
    'reason', v_reason,
    'event', jsonb_build_object(
      'missionId', v_daily_state.mission_definition ->> 'id',
      'previousState', v_previous_state,
      'currentState', v_current_state,
      'eventType', v_event_type,
      'requestedAction', v_action,
      'xpAwarded', v_xp_awarded,
      'primarySkill', v_skill_key,
      'skillXPAwarded', v_skill_reward,
      'timestamp', v_now
    ),
    'mission', jsonb_build_object(
      'definition', v_daily_state.mission_definition,
      'lifecycle', jsonb_build_object(
        'state', v_current_state,
        'completionAwarded', v_completion_awarded,
        'terminalAt', v_terminal_at,
        'terminalRecorded', v_terminal_recorded
      )
    ),
    'progression', jsonb_build_object('totalXP', v_total_xp),
    'overallProgression', jsonb_build_object('totalXP', v_total_xp),
    'updatedSkill', v_updated_skill,
    'newAchievements', v_new_achievements,
    'dailyStatus', jsonb_build_object(
      'replacementsUsed', v_daily_state.replacements_used,
      'replacementsRemaining', 1 - v_daily_state.replacements_used
    ),
    'historyRecord', v_history_record
  );
end;
$$;

revoke all on function public.request_vault_mission_action(text, text) from public, anon;
grant execute on function public.request_vault_mission_action(text, text) to authenticated;

-- Defense in depth: no browser data mutation is enabled by the test clock.
revoke insert, update, delete on public.dev_environment_config from authenticated;
revoke insert, update, delete on public.dev_test_accounts from authenticated;
revoke insert, update, delete on public.dev_test_state from authenticated;
revoke insert, update, delete on public.user_achievements from authenticated;
revoke insert, update, delete on public.skill_progression from authenticated;
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert, update on public.mission_history from authenticated;

comment on function public.dev_get_test_state()
is 'Sprint 11.1 staging-only test clock read. Requires a disabled-by-default server environment gate and an allowlisted auth.uid().';

comment on function public.dev_advance_one_hour()
is 'Sprint 11.1 staging-only zero-argument test-clock advance for the current allowlisted auth.uid().';

comment on function public.dev_advance_to_next_day()
is 'Sprint 11.1 staging-only zero-argument advance beyond the current user timezone reset boundary.';

comment on function public.dev_clear_test_clock()
is 'Sprint 11.1 staging-only zero-argument removal of the current user simulated clock.';
