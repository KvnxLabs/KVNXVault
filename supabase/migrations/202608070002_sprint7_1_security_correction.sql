-- KVNX Vault Sprint 7.1: security and persistence-contract correction.
-- Apply after 202608070001_sprint7_foundation.sql.

-- RLS isolates users but does not validate values submitted for a user's own
-- rows. Remove browser write privileges from authoritative mission/progression
-- tables and require narrowly granted functions instead.
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert on public.mission_history from authenticated;

-- Sprint 7 compatibility function accepted a browser-selected final XP total.
-- Keep the object for migration compatibility, but make it unreachable from
-- browser roles. Frontend code no longer calls it.
revoke all on function public.persist_vault_transition(
  text, jsonb, text, boolean, smallint, timestamptz, integer, jsonb
) from authenticated;

comment on function public.persist_vault_transition(
  text, jsonb, text, boolean, smallint, timestamptz, integer, jsonb
) is 'DEPRECATED Sprint 7 prototype contract. Accepted client-calculated XP; execution revoked in Sprint 7.1.';

-- Creates missing baseline state without accepting an XP value. The definition
-- may be restored by the client, but its reward is not trusted for XP awarding.
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
    ]) then
    raise exception 'Invalid mission definition' using errcode = '22023';
  end if;

  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, 75)
  on conflict (user_id) do nothing;

  insert into public.daily_mission_state (
    user_id, daily_session_id, mission_definition, lifecycle_state,
    completion_awarded, replacements_used, terminal_at, terminal_recorded
  ) values (
    v_user_id, p_daily_session_id, p_mission_definition, 'ready',
    false, 0, null, false
  )
  on conflict (user_id) do nothing;

  return jsonb_build_object('initialized', true);
end;
$$;

revoke all on function public.initialize_vault_session(text, jsonb) from public;
revoke all on function public.initialize_vault_session(text, jsonb) from anon;
grant execute on function public.initialize_vault_session(text, jsonb) to authenticated;

-- Intent-only contract reserved for Sprint 8's trusted implementation. It
-- accepts no XP, reward, lifecycle state, history record, or user id and makes
-- no mutation in Sprint 7.1.
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
  v_saved_mission_id text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_action not in ('start', 'complete', 'skip', 'expire') then
    raise exception 'Unsupported mission action' using errcode = '22023';
  end if;

  select mission_definition ->> 'id'
  into v_saved_mission_id
  from public.daily_mission_state
  where user_id = v_user_id;

  if v_saved_mission_id is null then
    return jsonb_build_object('accepted', false, 'reason', 'mission-not-found');
  end if;
  if v_saved_mission_id <> p_mission_id then
    return jsonb_build_object('accepted', false, 'reason', 'mission-mismatch');
  end if;

  return jsonb_build_object(
    'accepted', false,
    'reason', 'server-authority-pending-sprint-8'
  );
end;
$$;

revoke all on function public.request_vault_mission_action(text, text) from public;
revoke all on function public.request_vault_mission_action(text, text) from anon;
grant execute on function public.request_vault_mission_action(text, text) to authenticated;
