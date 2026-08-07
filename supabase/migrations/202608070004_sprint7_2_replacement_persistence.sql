-- KVNX Vault Sprint 7.2: transitional prototype replacement persistence.
-- Apply after 202608070003_sprint7_2_prototype_persistence.sql.
--
-- This is not Sprint 8 mission authority. It persists only a coordinator-
-- validated replacement definition after rechecking the saved terminal mission
-- and the one-replacement limit. It accepts no XP value and never touches the
-- progression table.

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
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(coalesce(trim(p_previous_mission_id), '')) not between 1 and 160
    or jsonb_typeof(p_replacement_event) <> 'object'
    or jsonb_typeof(p_mission_definition) <> 'object' then
    raise exception 'Invalid prototype replacement request' using errcode = '22023';
  end if;

  begin
    v_replacement_mission_id := trim(p_mission_definition ->> 'id');
    v_event_xp := (p_replacement_event ->> 'xpAwarded')::integer;
  exception when others then
    raise exception 'Invalid prototype replacement values' using errcode = '22023';
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

  if not found or v_daily_state.mission_definition ->> 'id' <> p_previous_mission_id then
    return jsonb_build_object('accepted', false, 'reason', 'mission-mismatch');
  end if;

  if v_daily_state.lifecycle_state not in ('completed', 'skipped', 'expired') then
    return jsonb_build_object('accepted', false, 'reason', 'current-mission-not-terminal');
  end if;

  if v_daily_state.replacements_used >= 1 then
    return jsonb_build_object('accepted', false, 'reason', 'replacement-limit-reached');
  end if;

  if p_replacements_used <> v_daily_state.replacements_used + 1
    or p_replacements_used <> 1 then
    raise exception 'Invalid prototype replacement count' using errcode = '22023';
  end if;

  update public.daily_mission_state
  set mission_definition = p_mission_definition,
      lifecycle_state = 'ready',
      completion_awarded = false,
      replacements_used = p_replacements_used,
      terminal_at = null,
      terminal_recorded = false
  where user_id = v_user_id;

  return jsonb_build_object(
    'accepted', true,
    'missionId', v_replacement_mission_id,
    'replacementsUsed', p_replacements_used
  );
end;
$$;

revoke all on function public.persist_validated_prototype_replacement(text, jsonb, jsonb, integer) from public;
revoke all on function public.persist_validated_prototype_replacement(text, jsonb, jsonb, integer) from anon;
grant execute on function public.persist_validated_prototype_replacement(text, jsonb, jsonb, integer) to authenticated;

comment on function public.persist_validated_prototype_replacement(text, jsonb, jsonb, integer)
is 'TRANSITIONAL Sprint 7.2 adapter. Persists one coordinator-validated replacement without modifying XP; replace with request_vault_mission_action in Sprint 8.';
