-- KVNX Vault Sprint 7.2: transitional prototype progression persistence.
-- Apply after 202608070002_sprint7_1_security_correction.sql.
--
-- This function is not the Sprint 8 authoritative mission service. It accepts
-- a client-validated completion event, but it never accepts a standalone XP
-- total and never trusts the snapshot as the value to write. PostgreSQL locks
-- the saved rows, reads the saved mission reward, computes the permitted next
-- total, and requires the progression-engine snapshot to match that result.

create or replace function public.persist_validated_prototype_progression(
  p_mission_id text,
  p_lifecycle_event jsonb,
  p_progression_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_state public.daily_mission_state%rowtype;
  v_current_total_xp integer;
  v_saved_reward integer;
  v_snapshot_total_xp integer;
  v_event_reward integer;
  v_terminal_at timestamptz;
  v_next_total_xp integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(coalesce(trim(p_mission_id), '')) not between 1 and 160
    or jsonb_typeof(p_lifecycle_event) <> 'object'
    or jsonb_typeof(p_progression_snapshot) <> 'object' then
    raise exception 'Invalid prototype progression request' using errcode = '22023';
  end if;

  select *
  into v_daily_state
  from public.daily_mission_state
  where user_id = v_user_id
  for update;

  if not found or v_daily_state.mission_definition ->> 'id' <> p_mission_id then
    return jsonb_build_object('accepted', false, 'reason', 'mission-mismatch');
  end if;

  if v_daily_state.completion_awarded then
    select total_xp into v_current_total_xp
    from public.progression_state
    where user_id = v_user_id;
    return jsonb_build_object(
      'accepted', false,
      'reason', 'completion-already-persisted',
      'totalXP', v_current_total_xp
    );
  end if;

  if p_lifecycle_event ->> 'missionId' <> p_mission_id
    or p_lifecycle_event ->> 'eventType' <> 'mission.completed'
    or p_lifecycle_event ->> 'currentState' <> 'completed' then
    raise exception 'A completed lifecycle event is required' using errcode = '22023';
  end if;

  begin
    v_saved_reward := (v_daily_state.mission_definition ->> 'xpReward')::integer;
    v_event_reward := (p_lifecycle_event ->> 'xpAwarded')::integer;
    v_snapshot_total_xp := (p_progression_snapshot ->> 'currentXP')::integer;
    v_terminal_at := (p_lifecycle_event ->> 'timestamp')::timestamptz;
  exception when others then
    raise exception 'Invalid prototype progression values' using errcode = '22023';
  end;

  if v_saved_reward <= 0 or v_event_reward <> v_saved_reward then
    raise exception 'Prototype reward does not match the saved mission' using errcode = '22023';
  end if;
  if v_terminal_at is null then
    raise exception 'A completion timestamp is required' using errcode = '22023';
  end if;

  select total_xp
  into v_current_total_xp
  from public.progression_state
  where user_id = v_user_id
  for update;

  if not found then
    raise exception 'Progression state is not initialized' using errcode = 'P0002';
  end if;

  v_next_total_xp := v_current_total_xp + v_saved_reward;
  if v_snapshot_total_xp <> v_next_total_xp then
    raise exception 'Progression snapshot does not match the permitted prototype result' using errcode = '22023';
  end if;

  update public.progression_state
  set total_xp = v_next_total_xp
  where user_id = v_user_id;

  update public.daily_mission_state
  set lifecycle_state = 'completed',
      completion_awarded = true,
      terminal_at = v_terminal_at,
      terminal_recorded = false
  where user_id = v_user_id;

  return jsonb_build_object(
    'accepted', true,
    'missionId', p_mission_id,
    'xpAwarded', v_saved_reward,
    'totalXP', v_next_total_xp
  );
end;
$$;

revoke all on function public.persist_validated_prototype_progression(text, jsonb, jsonb) from public;
revoke all on function public.persist_validated_prototype_progression(text, jsonb, jsonb) from anon;
grant execute on function public.persist_validated_prototype_progression(text, jsonb, jsonb) to authenticated;

comment on function public.persist_validated_prototype_progression(text, jsonb, jsonb)
is 'TRANSITIONAL Sprint 7.2 adapter. Persists one locally validated prototype completion with database-bounded reward math; replace with request_vault_mission_action in Sprint 8.';
