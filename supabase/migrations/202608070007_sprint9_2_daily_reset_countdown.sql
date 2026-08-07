-- KVNX Vault Sprint 9.2: server-provided next daily reset timestamp.
-- Apply after 202608070006_sprint9_daily_mission_authority.sql.
-- Migrations 001-006 remain immutable.

-- One internal helper owns the next logical-day boundary. PostgreSQL resolves
-- the saved IANA timezone and converts the user's next local midnight back to
-- an absolute timestamptz. Browser roles cannot execute this helper.
create or replace function public.next_vault_reset_at(
  p_user_id uuid,
  p_now timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text := 'UTC';
  v_next_local_midnight timestamp without time zone;
begin
  select profile.timezone_name
  into v_timezone
  from public.profiles as profile
  where profile.user_id = p_user_id;

  if v_timezone is null or not public.is_valid_iana_timezone(v_timezone) then
    v_timezone := 'UTC';
  end if;

  v_next_local_midnight := ((p_now at time zone v_timezone)::date + 1)::timestamp;
  return v_next_local_midnight at time zone v_timezone;
end;
$$;

revoke all on function public.next_vault_reset_at(uuid, timestamptz) from public;
revoke all on function public.next_vault_reset_at(uuid, timestamptz) from anon;
revoke all on function public.next_vault_reset_at(uuid, timestamptz) from authenticated;

-- Preserve the complete Sprint 9 daily implementation as an internal function,
-- then place the Sprint 9.2 response contract around it. The clock-injectable
-- wrapper keeps rollover and nextResetAt on the exact same server instant.
alter function public.request_daily_mission_at(timestamptz)
  rename to request_daily_mission_at_sprint9;

revoke all on function public.request_daily_mission_at_sprint9(timestamptz) from public;
revoke all on function public.request_daily_mission_at_sprint9(timestamptz) from anon;
revoke all on function public.request_daily_mission_at_sprint9(timestamptz) from authenticated;

create or replace function public.request_daily_mission_at(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_result := public.request_daily_mission_at_sprint9(p_now);
  return v_result || jsonb_build_object(
    'nextResetAt', public.next_vault_reset_at(v_user_id, p_now)
  );
end;
$$;

revoke all on function public.request_daily_mission_at(timestamptz) from public;
revoke all on function public.request_daily_mission_at(timestamptz) from anon;
revoke all on function public.request_daily_mission_at(timestamptz) from authenticated;

create or replace function public.request_daily_mission()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return public.request_daily_mission_at(v_now);
end;
$$;

revoke all on function public.request_daily_mission() from public;
revoke all on function public.request_daily_mission() from anon;
grant execute on function public.request_daily_mission() to authenticated;

comment on function public.request_daily_mission()
is 'Sprint 9.2 zero-argument daily authority. Returns the server-derived logical mission and next timezone-aware reset instant.';

-- Replacement remains zero-argument and server-selected. This wrapper only
-- adds the display contract; it accepts no reset, date, timezone, mission, XP,
-- reward, replacement-count, or user-id input.
alter function public.request_daily_mission_replacement()
  rename to request_daily_mission_replacement_sprint9;

revoke all on function public.request_daily_mission_replacement_sprint9() from public;
revoke all on function public.request_daily_mission_replacement_sprint9() from anon;
revoke all on function public.request_daily_mission_replacement_sprint9() from authenticated;

create or replace function public.request_daily_mission_replacement()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
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

revoke all on function public.request_daily_mission_replacement() from public;
revoke all on function public.request_daily_mission_replacement() from anon;
grant execute on function public.request_daily_mission_replacement() to authenticated;

comment on function public.request_daily_mission_replacement()
is 'Sprint 9.2 zero-argument replacement authority with the server-derived nextResetAt display contract.';

-- Defense in depth: Sprint 7.1 and Sprint 9 authority boundaries remain active.
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert on public.mission_history from authenticated;
