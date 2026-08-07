-- KVNX Vault Sprint 9: server-authoritative daily mission identity, creation,
-- rollover, and replacement selection.
-- Apply after 202608070005_sprint8_server_authority.sql.
-- Migrations 001-005 remain immutable.

-- Timezone is user-owned profile data, but PostgreSQL validates it against its
-- IANA timezone catalog. Existing accounts safely begin in UTC; a later
-- settings UI may update this field without changing onboarding.
create or replace function public.is_valid_iana_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_timezone
  );
$$;

alter table public.profiles
  add column timezone_name text not null default 'UTC';

alter table public.profiles
  add constraint profiles_timezone_name_valid
  check (public.is_valid_iana_timezone(timezone_name));

revoke all on function public.is_valid_iana_timezone(text) from public;
revoke all on function public.is_valid_iana_timezone(text) from anon;
grant execute on function public.is_valid_iana_timezone(text) to authenticated;

-- The original table held one replaceable row per user. Sprint 9 retains each
-- logical day as durable history and makes (user, day) the database invariant.
alter table public.daily_mission_state
  add column daily_key date;

update public.daily_mission_state as daily
set daily_key = (daily.created_at at time zone profile.timezone_name)::date
from public.profiles as profile
where profile.user_id = daily.user_id
  and daily.daily_key is null;

update public.daily_mission_state
set daily_key = (created_at at time zone 'UTC')::date
where daily_key is null;

alter table public.daily_mission_state
  alter column daily_key set not null;

alter table public.daily_mission_state
  drop constraint daily_mission_state_pkey;

alter table public.daily_mission_state
  add constraint daily_mission_state_pkey primary key (user_id, daily_key);

create index daily_mission_state_user_day_desc_idx
  on public.daily_mission_state(user_id, daily_key desc);

-- One helper owns the server-date calculation. The public RPCs never accept a
-- browser date. Invalid/missing profile timezones safely resolve to UTC.
create or replace function public.current_vault_daily_key(
  p_user_id uuid,
  p_now timestamptz
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text := 'UTC';
begin
  select profile.timezone_name
  into v_timezone
  from public.profiles as profile
  where profile.user_id = p_user_id;

  if v_timezone is null or not public.is_valid_iana_timezone(v_timezone) then
    v_timezone := 'UTC';
  end if;

  return (p_now at time zone v_timezone)::date;
end;
$$;

revoke all on function public.current_vault_daily_key(uuid, timestamptz) from public;
revoke all on function public.current_vault_daily_key(uuid, timestamptz) from anon;
revoke all on function public.current_vault_daily_key(uuid, timestamptz) from authenticated;

-- Trusted mission catalog. Onboarding is supplied only by a row selected with
-- auth.uid() inside a security-definer caller. The database owns template,
-- instance UUID, difficulty, and the canonical 25 XP reward.
create or replace function public.build_vault_daily_mission(
  p_onboarding public.onboarding_profiles,
  p_instance_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_focus text := trim(p_onboarding.primary_focus);
  v_key text := lower(trim(p_onboarding.primary_focus));
  v_template_id text;
  v_title text;
  v_description text;
  v_duration text;
  v_difficulty text;
begin
  case v_key
    when 'career' then
      v_template_id := 'career-focused-session';
      v_title := 'Advance Your Career';
      v_description := 'Complete one focused action that moves your career forward today.';
      v_duration := '30 minutes';
    when 'business' then
      v_template_id := 'business-focused-session';
      v_title := 'Build Your Business';
      v_description := 'Spend 30 focused minutes working on the next meaningful business priority.';
      v_duration := '30 minutes';
    when 'programming' then
      v_template_id := 'programming-focused-session';
      v_title := 'Complete a Coding Session';
      v_description := 'Complete one focused coding session today without switching tasks.';
      v_duration := '30 minutes';
    when 'fitness' then
      v_template_id := 'fitness-focused-session';
      v_title := 'Move With Intention';
      v_description := 'Complete a 20-minute workout or purposeful movement session.';
      v_duration := '20 minutes';
    when 'health' then
      v_template_id := 'health-focused-session';
      v_title := 'Invest in Your Health';
      v_description := 'Complete one deliberate action that supports your physical well-being.';
      v_duration := '20 minutes';
    when 'learning' then
      v_template_id := 'learning-focused-session';
      v_title := 'Complete a Learning Session';
      v_description := 'Study one focused topic and capture the most important lesson.';
      v_duration := '30 minutes';
    when 'reading' then
      v_template_id := 'reading-focused-session';
      v_title := 'Read With Focus';
      v_description := 'Read without distraction and capture one idea worth remembering.';
      v_duration := '20 minutes';
    when 'creativity' then
      v_template_id := 'creativity-focused-session';
      v_title := 'Create Something Today';
      v_description := 'Complete one uninterrupted creative session and leave with something tangible.';
      v_duration := '30 minutes';
    when 'finance' then
      v_template_id := 'finance-focused-session';
      v_title := 'Review Your Finances';
      v_description := 'Review your current finances and identify one clear next action.';
      v_duration := '20 minutes';
    when 'relationships' then
      v_template_id := 'relationships-focused-session';
      v_title := 'Strengthen a Relationship';
      v_description := 'Reach out to someone important and give the conversation your full attention.';
      v_duration := '15 minutes';
    when 'mindset' then
      v_template_id := 'mindset-focused-session';
      v_title := 'Reflect With Honesty';
      v_description := 'Journal for 10 minutes about what is helping or limiting your progress.';
      v_duration := '10 minutes';
    else
      v_template_id := left(regexp_replace(v_key, '[^a-z0-9]+', '-', 'g'), 80);
      v_template_id := trim(both '-' from v_template_id);
      if v_template_id = '' then v_template_id := 'general'; end if;
      v_template_id := v_template_id || '-focused-session';
      v_title := case when v_focus = '' then 'Build Focused Momentum' else 'Make Progress in ' || v_focus end;
      v_description := case when v_focus = ''
        then 'Complete one intentional work session toward the direction you chose.'
        else 'Complete one intentional work session that moves your ' || lower(v_focus) || ' journey forward.'
      end;
      v_duration := '30 minutes';
  end case;

  v_difficulty := case lower(trim(p_onboarding.intensity))
    when 'focused' then 'Focused'
    when 'relentless' then 'Challenging'
    else 'Balanced'
  end;

  return jsonb_build_object(
    'id', v_template_id || '-' || p_instance_id::text,
    'focus', case when v_focus = '' then 'Personal Growth' else v_focus end,
    'title', v_title,
    'description', v_description,
    'estimatedDuration', v_duration,
    'difficulty', v_difficulty,
    'xpReward', 25
  );
end;
$$;

revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid) from public;
revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid) from anon;
revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid) from authenticated;

create or replace function public.vault_daily_mission_response(
  p_state public.daily_mission_state,
  p_accepted boolean,
  p_reason text,
  p_total_xp integer default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'accepted', p_accepted,
    'reason', p_reason,
    'dailyKey', p_state.daily_key::text,
    'mission', jsonb_build_object(
      'definition', p_state.mission_definition,
      'lifecycle', jsonb_build_object(
        'state', p_state.lifecycle_state,
        'completionAwarded', p_state.completion_awarded,
        'terminalAt', p_state.terminal_at,
        'terminalRecorded', p_state.terminal_recorded
      )
    ),
    'dailyStatus', jsonb_build_object(
      'replacementsUsed', p_state.replacements_used,
      'replacementsRemaining', 1 - p_state.replacements_used
    ),
    'progression', case when p_total_xp is null then null
      else jsonb_build_object('totalXP', p_total_xp)
    end
  ));
$$;

revoke all on function public.vault_daily_mission_response(public.daily_mission_state, boolean, text, integer) from public;
revoke all on function public.vault_daily_mission_response(public.daily_mission_state, boolean, text, integer) from anon;
revoke all on function public.vault_daily_mission_response(public.daily_mission_state, boolean, text, integer) from authenticated;

-- Internal clock-injectable function for deterministic local/staging rollover
-- tests. Browser roles cannot execute it; the public wrapper below supplies the
-- real database clock and no arguments.
create or replace function public.request_daily_mission_at(p_now timestamptz)
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

  -- Rollover is server-driven. Any stale nonterminal mission expires with zero
  -- XP and exactly one history record before today's mission is created.
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

  v_definition := public.build_vault_daily_mission(v_onboarding, public.gen_random_uuid());

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

revoke all on function public.request_daily_mission_at(timestamptz) from public;
revoke all on function public.request_daily_mission_at(timestamptz) from anon;
revoke all on function public.request_daily_mission_at(timestamptz) from authenticated;

create or replace function public.request_daily_mission()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.request_daily_mission_at(clock_timestamp());
$$;

revoke all on function public.request_daily_mission() from public;
revoke all on function public.request_daily_mission() from anon;
grant execute on function public.request_daily_mission() to authenticated;

comment on function public.request_daily_mission()
is 'Sprint 9 zero-argument daily authority. Derives auth.uid(), timezone, date, onboarding, template, reward, lifecycle, and instance identity server-side.';

-- Replacement selection is now fully server-authoritative and zero-argument.
-- It preserves the one-replacement limit and never accepts or changes XP.
create or replace function public.request_daily_mission_replacement()
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
  set mission_definition = public.build_vault_daily_mission(v_onboarding, public.gen_random_uuid()),
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

revoke all on function public.request_daily_mission_replacement() from public;
revoke all on function public.request_daily_mission_replacement() from anon;
grant execute on function public.request_daily_mission_replacement() to authenticated;

comment on function public.request_daily_mission_replacement()
is 'Sprint 9 zero-argument replacement authority. Selects the trusted replacement definition and reward; never accepts XP, user id, or client mission state.';

-- Sprint 8 action authority is retained, but it now addresses only the row for
-- the server-authoritative current day.
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
  v_now timestamptz := clock_timestamp();
  v_daily_key date;
  v_terminal_at timestamptz;
  v_terminal_recorded boolean;
  v_history_record jsonb := null;
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
    v_accepted := true;
    v_current_state := 'completed';
    v_event_type := 'mission.completed';
    v_xp_awarded := v_reward;
    v_completion_awarded := true;
    v_terminal_at := v_now;
    v_total_xp := v_total_xp + v_reward;
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
      update public.progression_state set total_xp = v_total_xp
      where user_id = v_user_id;
    end if;

    if v_current_state in ('completed', 'skipped') then
      insert into public.mission_history (
        user_id, daily_session_id, mission_id, title, focus,
        final_state, xp_awarded, terminal_at
      ) values (
        v_user_id, v_daily_state.daily_session_id,
        v_daily_state.mission_definition ->> 'id',
        v_daily_state.mission_definition ->> 'title',
        v_daily_state.mission_definition ->> 'focus',
        v_current_state, v_xp_awarded, v_terminal_at
      )
      on conflict (user_id, daily_session_id, mission_id, terminal_at) do nothing;
      v_terminal_recorded := true;
      v_history_record := jsonb_build_object(
        'missionId', v_daily_state.mission_definition ->> 'id',
        'title', v_daily_state.mission_definition ->> 'title',
        'focus', v_daily_state.mission_definition ->> 'focus',
        'finalState', v_current_state,
        'xpAwarded', v_xp_awarded,
        'terminalAt', v_terminal_at
      );
    end if;

    update public.daily_mission_state
    set lifecycle_state = v_current_state,
        completion_awarded = v_completion_awarded,
        terminal_at = v_terminal_at,
        terminal_recorded = v_terminal_recorded
    where user_id = v_user_id and daily_key = v_daily_key;
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
    'dailyStatus', jsonb_build_object(
      'replacementsUsed', v_daily_state.replacements_used,
      'replacementsRemaining', 1 - v_daily_state.replacements_used
    ),
    'historyRecord', v_history_record
  );
end;
$$;

revoke all on function public.request_vault_mission_action(text, text) from public;
revoke all on function public.request_vault_mission_action(text, text) from anon;
grant execute on function public.request_vault_mission_action(text, text) to authenticated;

-- Retire every client-content creation/replacement path from authenticated
-- production execution. Historical source adapters remain for unchanged tests.
revoke all on function public.initialize_vault_session(text, jsonb) from authenticated;
revoke all on function public.persist_validated_prototype_replacement(text, jsonb, jsonb, integer) from authenticated;

-- Defense in depth: Sprint 7.1 direct-write revocations and RLS remain active.
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert on public.mission_history from authenticated;

comment on table public.daily_mission_state
is 'Sprint 9 retains one authoritative row per authenticated user and server-derived logical day.';
