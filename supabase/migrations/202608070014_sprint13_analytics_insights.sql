-- KVNX Vault Sprint 13: read-only Analytics & Insights.
-- Apply after 202608070013_sprint12_vault_history.sql.
-- Installed migrations 001-013 remain immutable. There is intentionally no 010.

-- A single narrow RPC aggregates the existing authoritative history and
-- achievement records. It creates no analytics event table and performs no
-- writes. The browser may choose only one of three bounded period identifiers;
-- ownership and period boundaries are resolved inside PostgreSQL.
create or replace function public.get_vault_analytics(p_period text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_period text := lower(trim(coalesce(p_period, '')));
  v_generated_at timestamptz := statement_timestamp();
  v_today date := (statement_timestamp() at time zone 'utc')::date;
  v_start_date date;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_period not in ('7d', '30d', 'all') then
    raise exception 'Unsupported analytics period' using errcode = '22023';
  end if;

  v_start_date := case v_period
    when '7d' then v_today - 6
    when '30d' then v_today - 29
    else null
  end;

  with filtered_history as materialized (
    select
      history.id,
      history.terminal_at,
      history.xp_awarded,
      history.skill_key,
      history.skill_xp_awarded
    from public.mission_history as history
    where history.user_id = v_user_id
      and history.final_state = 'completed'
      and (
        v_period = 'all'
        or (
          history.terminal_at >= (v_start_date::timestamp at time zone 'utc')
          and history.terminal_at < ((v_today + 1)::timestamp at time zone 'utc')
        )
      )
  ),
  daily_totals as (
    select
      (history.terminal_at at time zone 'utc')::date as activity_date,
      count(*)::integer as completed_count,
      coalesce(sum(history.xp_awarded), 0)::integer as xp_earned
    from filtered_history as history
    group by (history.terminal_at at time zone 'utc')::date
  ),
  requested_days as (
    select day::date as activity_date
    from generate_series(v_start_date, v_today, interval '1 day') as day
    where v_period <> 'all'
  ),
  activity_series as (
    select
      days.activity_date,
      coalesce(totals.completed_count, 0)::integer as completed_count,
      coalesce(totals.xp_earned, 0)::integer as xp_earned
    from requested_days as days
    left join daily_totals as totals using (activity_date)
    union all
    select totals.activity_date, totals.completed_count, totals.xp_earned
    from daily_totals as totals
    where v_period = 'all'
  ),
  skill_totals as (
    select
      history.skill_key,
      catalog.display_name,
      catalog.sort_order,
      coalesce(sum(history.skill_xp_awarded), 0)::integer as xp_earned
    from filtered_history as history
    join public.skill_catalog as catalog
      on catalog.skill_key = history.skill_key
    where history.skill_xp_awarded > 0
    group by history.skill_key, catalog.display_name, catalog.sort_order
  ),
  summary as (
    select
      count(*)::integer as missions_completed,
      coalesce(sum(history.xp_awarded), 0)::integer as overall_xp_earned,
      coalesce(sum(history.skill_xp_awarded), 0)::integer as skill_xp_earned,
      count(distinct (history.terminal_at at time zone 'utc')::date)::integer as active_days
    from filtered_history as history
  )
  select jsonb_build_object(
    'period', v_period,
    'generatedAt', v_generated_at,
    'periodStart', v_start_date,
    'summary', jsonb_build_object(
      'missionsCompleted', summary.missions_completed,
      'overallXPEarned', summary.overall_xp_earned,
      'skillXPEarned', summary.skill_xp_earned,
      'activeDays', summary.active_days,
      'achievementsUnlocked', (
        select count(*)::integer
        from public.user_achievements as earned
        where earned.user_id = v_user_id
          and (
            v_period = 'all'
            or (
              earned.unlocked_at >= (v_start_date::timestamp at time zone 'utc')
              and earned.unlocked_at < ((v_today + 1)::timestamp at time zone 'utc')
            )
          )
      )
    ),
    'mostDevelopedSkill', (
      select jsonb_build_object(
        'key', skill.skill_key,
        'name', skill.display_name,
        'xpEarned', skill.xp_earned
      )
      from skill_totals as skill
      order by skill.xp_earned desc, skill.sort_order asc, skill.skill_key asc
      limit 1
    ),
    'missionActivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', activity.activity_date,
        'completedCount', activity.completed_count
      ) order by activity.activity_date)
      from activity_series as activity
    ), '[]'::jsonb),
    'xpActivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', activity.activity_date,
        'xpEarned', activity.xp_earned
      ) order by activity.activity_date)
      from activity_series as activity
    ), '[]'::jsonb),
    'skillActivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', skill.skill_key,
        'name', skill.display_name,
        'xpEarned', skill.xp_earned
      ) order by skill.xp_earned desc, skill.sort_order asc, skill.skill_key asc)
      from skill_totals as skill
    ), '[]'::jsonb)
  )
  into v_result
  from summary;

  return v_result;
end;
$$;

revoke all on function public.get_vault_analytics(text) from public, anon;
grant execute on function public.get_vault_analytics(text) to authenticated;

comment on function public.get_vault_analytics(text)
is 'Sprint 13 read-only analytics aggregate. Accepts only 7d, 30d, or all; derives ownership from auth.uid(); and reads authoritative completed history and persisted achievement unlocks.';

-- Reassert the source-table boundaries. Analytics never grants a browser write.
alter table public.mission_history enable row level security;
alter table public.user_achievements enable row level security;
revoke insert, update, delete on public.mission_history from authenticated;
revoke insert, update, delete on public.user_achievements from authenticated;
