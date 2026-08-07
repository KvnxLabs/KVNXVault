-- KVNX Vault Sprint 8: server-authoritative mission validation and XP awards.
-- Apply after 202608070004_sprint7_2_replacement_persistence.sql.
-- Migrations 001-004 remain immutable.

-- The current mission catalog awards 25 XP. Canonicalize already-saved rows so
-- a definition originally seeded by prototype code cannot carry a forged
-- reward into the authoritative action function.
update public.daily_mission_state
set mission_definition = jsonb_set(mission_definition, '{xpReward}', '25'::jsonb, true)
where mission_definition -> 'xpReward' is distinct from '25'::jsonb;

-- Baseline creation accepts mission content for the current generator contract,
-- but PostgreSQL owns the authoritative reward stored with that definition.
create or replace function public.initialize_vault_session(
  p_daily_session_id text,
  p_mission_definition jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_definition jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(coalesce(p_daily_session_id, '')) not between 10 and 120 then
    raise exception 'Invalid daily session id' using errcode = '22023';
  end if;
  if jsonb_typeof(p_mission_definition) <> 'object'
    or not (p_mission_definition ?& array[
      'id', 'focus', 'title', 'description', 'estimatedDuration',
      'difficulty', 'xpReward'
    ])
    or char_length(coalesce(trim(p_mission_definition ->> 'id'), '')) not between 1 and 160 then
    raise exception 'Invalid mission definition' using errcode = '22023';
  end if;

  v_definition := jsonb_set(p_mission_definition, '{xpReward}', '25'::jsonb, true);

  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, 75)
  on conflict (user_id) do nothing;

  insert into public.daily_mission_state (
    user_id, daily_session_id, mission_definition, lifecycle_state,
    completion_awarded, replacements_used, terminal_at, terminal_recorded
  ) values (
    v_user_id, p_daily_session_id, v_definition, 'ready',
    false, 0, null, false
  )
  on conflict (user_id) do nothing;

  return jsonb_build_object('initialized', true);
end;
$$;

revoke all on function public.initialize_vault_session(text, jsonb) from public;
revoke all on function public.initialize_vault_session(text, jsonb) from anon;
grant execute on function public.initialize_vault_session(text, jsonb) to authenticated;

-- Sprint 7.2's completion function remains installed for migration history, but
-- production browser execution now goes exclusively through the intent RPC.
revoke all on function public.persist_validated_prototype_progression(
  text, jsonb, jsonb
) from authenticated;

comment on function public.persist_validated_prototype_progression(text, jsonb, jsonb)
is 'DEPRECATED Sprint 7.2 compatibility contract. Authenticated execution revoked in Sprint 8; use request_vault_mission_action.';

-- Preserve the narrow replacement architecture while making the stored reward
-- authoritative. This function accepts no XP value and never changes XP.
create or replace function public.persist_validated_prototype_replacement(
  p_previous_mission_id text,
  p_replacement_event jsonb,
  p_mission_definition jsonb,
  p_replacements_used integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_state public.daily_mission_state%rowtype;
  v_replacement_mission_id text;
  v_event_xp integer;
  v_total_xp integer;
  v_definition jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(coalesce(trim(p_previous_mission_id), '')) not between 1 and 160
    or jsonb_typeof(p_replacement_event) <> 'object'
    or jsonb_typeof(p_mission_definition) <> 'object'
    or not (p_mission_definition ?& array[
      'id', 'focus', 'title', 'description', 'estimatedDuration',
      'difficulty', 'xpReward'
    ]) then
    raise exception 'Invalid replacement request' using errcode = '22023';
  end if;

  begin
    v_replacement_mission_id := trim(p_mission_definition ->> 'id');
    v_event_xp := (p_replacement_event ->> 'xpAwarded')::integer;
  exception when others then
    raise exception 'Invalid replacement values' using errcode = '22023';
  end;

  if char_length(coalesce(v_replacement_mission_id, '')) not between 1 and 160
    or v_replacement_mission_id = p_previous_mission_id
    or p_replacement_event ->> 'eventType' <> 'coordinator.mission-replaced'
    or p_replacement_event ->> 'previousMissionId' <> p_previous_mission_id
    or p_replacement_event ->> 'missionId' <> v_replacement_mission_id
    or v_event_xp is distinct from 0 then
    raise exception 'A validated zero-XP replacement event is required' using errcode = '22023';
  end if;

  select *
  into v_daily_state
  from public.daily_mission_state
  where user_id = v_user_id
  for update;

  select total_xp
  into v_total_xp
  from public.progression_state
  where user_id = v_user_id;

  if not found then
    raise exception 'Progression state is not initialized' using errcode = 'P0002';
  end if;

  if v_daily_state.user_id is null
    or v_daily_state.mission_definition ->> 'id' <> p_previous_mission_id then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'mission-mismatch',
      'missionId', v_daily_state.mission_definition ->> 'id',
      'replacementsUsed', v_daily_state.replacements_used,
      'mission', jsonb_build_object(
        'definition', v_daily_state.mission_definition,
        'lifecycle', jsonb_build_object(
          'state', v_daily_state.lifecycle_state,
          'completionAwarded', v_daily_state.completion_awarded,
          'terminalAt', v_daily_state.terminal_at,
          'terminalRecorded', v_daily_state.terminal_recorded
        )
      ),
      'progression', jsonb_build_object('totalXP', v_total_xp),
      'dailyStatus', jsonb_build_object(
        'replacementsUsed', v_daily_state.replacements_used,
        'replacementsRemaining', 1 - v_daily_state.replacements_used
      )
    );
  end if;

  if v_daily_state.lifecycle_state not in ('completed', 'skipped', 'expired') then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'current-mission-not-terminal',
      'missionId', v_daily_state.mission_definition ->> 'id',
      'replacementsUsed', v_daily_state.replacements_used,
      'mission', jsonb_build_object(
        'definition', v_daily_state.mission_definition,
        'lifecycle', jsonb_build_object(
          'state', v_daily_state.lifecycle_state,
          'completionAwarded', v_daily_state.completion_awarded,
          'terminalAt', v_daily_state.terminal_at,
          'terminalRecorded', v_daily_state.terminal_recorded
        )
      ),
      'progression', jsonb_build_object('totalXP', v_total_xp),
      'dailyStatus', jsonb_build_object(
        'replacementsUsed', v_daily_state.replacements_used,
        'replacementsRemaining', 1 - v_daily_state.replacements_used
      )
    );
  end if;
  if v_daily_state.replacements_used >= 1 then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'replacement-limit-reached',
      'missionId', v_daily_state.mission_definition ->> 'id',
      'replacementsUsed', v_daily_state.replacements_used,
      'mission', jsonb_build_object(
        'definition', v_daily_state.mission_definition,
        'lifecycle', jsonb_build_object(
          'state', v_daily_state.lifecycle_state,
          'completionAwarded', v_daily_state.completion_awarded,
          'terminalAt', v_daily_state.terminal_at,
          'terminalRecorded', v_daily_state.terminal_recorded
        )
      ),
      'progression', jsonb_build_object('totalXP', v_total_xp),
      'dailyStatus', jsonb_build_object(
        'replacementsUsed', v_daily_state.replacements_used,
        'replacementsRemaining', 1 - v_daily_state.replacements_used
      )
    );
  end if;
  if p_replacements_used <> v_daily_state.replacements_used + 1
    or p_replacements_used <> 1 then
    raise exception 'Invalid replacement count' using errcode = '22023';
  end if;

  v_definition := jsonb_set(p_mission_definition, '{xpReward}', '25'::jsonb, true);

  update public.daily_mission_state
  set mission_definition = v_definition,
      lifecycle_state = 'ready',
      completion_awarded = false,
      replacements_used = p_replacements_used,
      terminal_at = null,
      terminal_recorded = false
  where user_id = v_user_id;

  return jsonb_build_object(
    'accepted', true,
    'reason', null,
    'missionId', v_replacement_mission_id,
    'replacementsUsed', p_replacements_used,
    'mission', jsonb_build_object(
      'definition', v_definition,
      'lifecycle', jsonb_build_object(
        'state', 'ready',
        'completionAwarded', false,
        'terminalAt', null,
        'terminalRecorded', false
      )
    ),
    'progression', jsonb_build_object('totalXP', v_total_xp),
    'dailyStatus', jsonb_build_object(
      'replacementsUsed', p_replacements_used,
      'replacementsRemaining', 0
    )
  );
end;
$$;

revoke all on function public.persist_validated_prototype_replacement(
  text, jsonb, jsonb, integer
) from public;
revoke all on function public.persist_validated_prototype_replacement(
  text, jsonb, jsonb, integer
) from anon;
grant execute on function public.persist_validated_prototype_replacement(
  text, jsonb, jsonb, integer
) to authenticated;

comment on function public.persist_validated_prototype_replacement(text, jsonb, jsonb, integer)
is 'TRANSITIONAL replacement boundary retained in Sprint 8. Canonicalizes reward, accepts no XP, and returns authoritative mission/progression state.';

-- The production mission-action authority. The browser supplies only mission
-- identity and action intent. Row locks serialize tabs/devices, so exactly one
-- valid completion can award the saved canonical reward and create history.
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
  v_now timestamptz := timezone('utc', now());
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

  select *
  into v_daily_state
  from public.daily_mission_state
  where user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'mission-not-found');
  end if;

  select total_xp
  into v_total_xp
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
      update public.progression_state
      set total_xp = v_total_xp
      where user_id = v_user_id;
    end if;

    if v_current_state in ('completed', 'skipped') then
      insert into public.mission_history (
        user_id, daily_session_id, mission_id, title, focus,
        final_state, xp_awarded, terminal_at
      ) values (
        v_user_id,
        v_daily_state.daily_session_id,
        v_daily_state.mission_definition ->> 'id',
        v_daily_state.mission_definition ->> 'title',
        v_daily_state.mission_definition ->> 'focus',
        v_current_state,
        v_xp_awarded,
        v_terminal_at
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
    where user_id = v_user_id;
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

comment on function public.request_vault_mission_action(text, text)
is 'Sprint 8 server authority. Accepts mission intent only; serializes lifecycle, XP, and history mutation under auth.uid().';

-- Defense in depth: keep the Sprint 7.1 direct-write revocations explicit in
-- the authority migration without restoring any broad browser grant.
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert on public.mission_history from authenticated;
