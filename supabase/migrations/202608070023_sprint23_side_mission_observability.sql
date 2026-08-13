-- KVNX Vault Sprint 23: Side Mission operational hardening and economy observability.
-- Apply after 202608070022_sprint22_side_mission_lifecycle.sql.
-- Installed migrations 001-022 remain immutable. There is intentionally no 010.

-- The ledger records only authoritative persisted lifecycle transitions. It is
-- not a client telemetry endpoint and it is not a second source of XP truth.
create table public.side_mission_event_ledger (
  event_id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_key date not null,
  mission_id uuid not null references public.side_mission_state(mission_id) on delete cascade,
  skill_key text not null references public.skill_catalog(skill_key),
  event_type text not null
    check (event_type in ('promoted', 'started', 'completed', 'expired')),
  overall_xp_awarded integer not null default 0 check (overall_xp_awarded >= 0),
  skill_xp_awarded integer not null default 0 check (skill_xp_awarded >= 0),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  recording_source text not null default 'live'
    check (recording_source in ('live', 'migration_reconciliation')),
  unique (mission_id, event_type),
  constraint side_mission_event_reward_exact check (
    (event_type = 'completed' and overall_xp_awarded = 10 and skill_xp_awarded = 10)
    or (event_type <> 'completed' and overall_xp_awarded = 0 and skill_xp_awarded = 0)
  )
);

create index side_mission_event_owner_day_idx
  on public.side_mission_event_ledger(user_id, daily_key desc, occurred_at desc);

create index side_mission_event_type_time_idx
  on public.side_mission_event_ledger(event_type, occurred_at desc);

alter table public.side_mission_event_ledger enable row level security;
revoke all on public.side_mission_event_ledger from public, anon, authenticated;

comment on table public.side_mission_event_ledger
is 'Append-only server-written Side Mission lifecycle audit ledger. XP totals remain authoritative in progression_state, skill_progression, and verified mission_history.';

-- Trigger capture observes the state table after its authoritative insert or
-- update. A later failure in promotion/start/completion rolls this event back
-- in the same transaction. UNIQUE(mission_id,event_type) makes retries and
-- repeated reconciliation idempotent.
create or replace function public.capture_side_mission_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_occurred_at timestamptz;
  v_overall_xp integer := 0;
  v_skill_xp integer := 0;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'promoted';
    v_occurred_at := new.created_at;
  elsif old.lifecycle_state is distinct from new.lifecycle_state then
    case new.lifecycle_state
      when 'active' then
        v_event_type := 'started';
        v_occurred_at := new.started_at;
      when 'completed' then
        v_event_type := 'completed';
        v_occurred_at := new.completed_at;
        v_overall_xp := 10;
        v_skill_xp := 10;
      when 'expired' then
        v_event_type := 'expired';
        v_occurred_at := new.updated_at;
      else
        return new;
    end case;
  else
    return new;
  end if;

  if v_occurred_at is null then
    raise exception 'Authoritative Side Mission event timestamp is required'
      using errcode = '23514';
  end if;

  insert into public.side_mission_event_ledger (
    user_id, daily_key, mission_id, skill_key, event_type,
    overall_xp_awarded, skill_xp_awarded, occurred_at, recording_source
  ) values (
    new.user_id, new.daily_key, new.mission_id, new.skill_key, v_event_type,
    v_overall_xp, v_skill_xp, v_occurred_at, 'live'
  )
  on conflict (mission_id, event_type) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_side_mission_lifecycle_event()
from public, anon, authenticated;

create trigger side_mission_capture_lifecycle_event
after insert or update on public.side_mission_state
for each row execute function public.capture_side_mission_lifecycle_event();

-- Reconcile trustworthy pre-Sprint-23 lifecycle state without inventing
-- operations. Completion is recorded only where the persisted completed state
-- and its exact +10/+10 Side Mission history row agree.
insert into public.side_mission_event_ledger (
  user_id, daily_key, mission_id, skill_key, event_type,
  overall_xp_awarded, skill_xp_awarded, occurred_at, recording_source
)
select state.user_id, state.daily_key, state.mission_id, state.skill_key,
       'promoted', 0, 0, state.created_at, 'migration_reconciliation'
from public.side_mission_state as state
on conflict (mission_id, event_type) do nothing;

insert into public.side_mission_event_ledger (
  user_id, daily_key, mission_id, skill_key, event_type,
  overall_xp_awarded, skill_xp_awarded, occurred_at, recording_source
)
select state.user_id, state.daily_key, state.mission_id, state.skill_key,
       'started', 0, 0, state.started_at, 'migration_reconciliation'
from public.side_mission_state as state
where state.started_at is not null
on conflict (mission_id, event_type) do nothing;

insert into public.side_mission_event_ledger (
  user_id, daily_key, mission_id, skill_key, event_type,
  overall_xp_awarded, skill_xp_awarded, occurred_at, recording_source
)
select state.user_id, state.daily_key, state.mission_id, state.skill_key,
       'completed', 10, 10, state.completed_at, 'migration_reconciliation'
from public.side_mission_state as state
where state.lifecycle_state = 'completed'
  and state.reward_awarded = true
  and state.completed_at is not null
  and exists (
    select 1
    from public.mission_history as history
    where history.user_id = state.user_id
      and history.daily_session_id = state.daily_key::text
      and history.mission_id = state.mission_id::text
      and history.mission_type = 'side'
      and history.final_state = 'completed'
      and history.xp_awarded = 10
      and history.skill_key = state.skill_key
      and history.skill_xp_awarded = 10
  )
on conflict (mission_id, event_type) do nothing;

insert into public.side_mission_event_ledger (
  user_id, daily_key, mission_id, skill_key, event_type,
  overall_xp_awarded, skill_xp_awarded, occurred_at, recording_source
)
select state.user_id, state.daily_key, state.mission_id, state.skill_key,
       'expired', 0, 0, state.updated_at, 'migration_reconciliation'
from public.side_mission_state as state
where state.lifecycle_state = 'expired'
  and state.reward_awarded = false
on conflict (mission_id, event_type) do nothing;

-- Fail loudly rather than silently repairing any pre-existing duplicate Side
-- completion. These indexes then harden both the account/day capacity and the
-- one-history-row-per-mission invariant beyond the transactional RPC checks.
do $migration$
begin
  if exists (
    select 1
    from public.mission_history as history
    where history.mission_type = 'side' and history.final_state = 'completed'
    group by history.user_id, history.daily_session_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate rewarded Side Mission history exists for an owner/logical day';
  end if;

  if exists (
    select 1
    from public.mission_history as history
    where history.mission_type = 'side' and history.final_state = 'completed'
    group by history.user_id, history.mission_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate rewarded Side Mission history exists for a mission instance';
  end if;
end;
$migration$;

create unique index mission_history_one_side_completion_per_day
  on public.mission_history(user_id, daily_session_id)
  where mission_type = 'side' and final_state = 'completed';

create unique index mission_history_one_side_completion_per_instance
  on public.mission_history(user_id, mission_id)
  where mission_type = 'side' and final_state = 'completed';

-- Read-only owner diagnostics. Lifecycle counts come from the event ledger;
-- economy totals come from verified Side Mission history, preserving a single
-- reward source of truth. Completion rate is a promotion-cohort rate: promoted
-- missions in the selected logical-day window that have a completion event.
create or replace function public.get_side_mission_observability(p_period text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_period text := lower(trim(coalesce(p_period, '')));
  v_now timestamptz := public.dev_effective_vault_now();
  v_today date;
  v_start_date date;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_period not in ('7d', '30d', 'all') then
    raise exception 'Unsupported Side Mission observability period' using errcode = '22023';
  end if;

  v_today := public.current_vault_daily_key(v_user_id, v_now);
  v_start_date := case v_period
    when '7d' then v_today - 6
    when '30d' then v_today - 29
    else null
  end;

  with filtered_events as materialized (
    select event.*
    from public.side_mission_event_ledger as event
    where event.user_id = v_user_id
      and (v_start_date is null or event.daily_key >= v_start_date)
      and event.daily_key <= v_today
  ), promotion_cohort as materialized (
    select event.mission_id
    from filtered_events as event
    where event.event_type = 'promoted'
  ), filtered_history as materialized (
    select history.*
    from public.mission_history as history
    cross join lateral (
      select public.parse_vault_daily_key(history.daily_session_id) as daily_key
    ) as parsed
    where history.user_id = v_user_id
      and history.mission_type = 'side'
      and history.final_state = 'completed'
      and parsed.daily_key is not null
      and (v_start_date is null or parsed.daily_key >= v_start_date)
      and parsed.daily_key <= v_today
  ), lifecycle as (
    select
      count(*) filter (where event_type = 'promoted')::integer as promoted,
      count(*) filter (where event_type = 'started')::integer as started,
      count(*) filter (where event_type = 'completed')::integer as completed,
      count(*) filter (where event_type = 'expired')::integer as expired
    from filtered_events
  ), cohort as (
    select count(*)::integer as promoted,
      count(*) filter (where exists (
        select 1 from public.side_mission_event_ledger as completed
        where completed.user_id = v_user_id
          and completed.mission_id = promotion_cohort.mission_id
          and completed.event_type = 'completed'
      ))::integer as completed
    from promotion_cohort
  ), economy as (
    select count(*)::integer as completions,
      coalesce(sum(xp_awarded), 0)::integer as overall_xp,
      coalesce(sum(skill_xp_awarded), 0)::integer as skill_xp
    from filtered_history
  ), skill_economy as (
    select history.skill_key, catalog.display_name,
      count(*)::integer as completions,
      coalesce(sum(history.skill_xp_awarded), 0)::integer as skill_xp
    from filtered_history as history
    join public.skill_catalog as catalog on catalog.skill_key = history.skill_key
    group by history.skill_key, catalog.display_name, catalog.sort_order
    order by skill_xp desc, catalog.sort_order asc, history.skill_key asc
  )
  select jsonb_build_object(
    'period', v_period,
    'generatedAt', v_now,
    'periodStart', v_start_date,
    'lifecycle', jsonb_build_object(
      'promoted', lifecycle.promoted,
      'started', lifecycle.started,
      'completed', lifecycle.completed,
      'expired', lifecycle.expired,
      'completionRate', case when cohort.promoted = 0 then null
        else round((cohort.completed::numeric / cohort.promoted::numeric) * 100, 1) end
    ),
    'economy', jsonb_build_object(
      'verifiedCompletions', economy.completions,
      'overallXPAwarded', economy.overall_xp,
      'skillXPAwarded', economy.skill_xp
    ),
    'xpBySkill', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skillKey', skill.skill_key,
        'skillName', skill.display_name,
        'completions', skill.completions,
        'skillXPAwarded', skill.skill_xp
      ) order by skill.skill_xp desc, skill.skill_key asc)
      from skill_economy as skill
    ), '[]'::jsonb),
    'recentActivity', coalesce((
      select jsonb_agg(activity.item order by activity.occurred_at desc, activity.event_id desc)
      from (
        select event.event_id, event.occurred_at, jsonb_build_object(
          'eventType', event.event_type,
          'dailyKey', event.daily_key,
          'skillKey', event.skill_key,
          'skillName', catalog.display_name,
          'overallXPAwarded', event.overall_xp_awarded,
          'skillXPAwarded', event.skill_xp_awarded,
          'occurredAt', event.occurred_at
        ) as item
        from filtered_events as event
        join public.skill_catalog as catalog on catalog.skill_key = event.skill_key
        order by event.occurred_at desc, event.event_id desc
        limit 20
      ) as activity
    ), '[]'::jsonb))
  into v_result
  from lifecycle cross join cohort cross join economy;

  return v_result;
end;
$$;

revoke all on function public.get_side_mission_observability(text)
from public, anon, authenticated;
grant execute on function public.get_side_mission_observability(text) to authenticated;

comment on function public.get_side_mission_observability(text)
is 'Read-only auth.uid()-owned Side Mission lifecycle and verified +10/+10 economy diagnostics for 7d, 30d, or all. Returns at most 20 recent events.';

-- Database-administrator-only detection. It reports corruption; it performs no
-- repair and cannot mutate lifecycle, history, progression, skills, or rewards.
create or replace function public.audit_side_mission_invariants()
returns table (
  violation text,
  user_id uuid,
  daily_key date,
  mission_id uuid,
  details jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'completed-state-history-mismatch', state.user_id, state.daily_key,
    state.mission_id, jsonb_build_object('skillKey', state.skill_key)
  from public.side_mission_state as state
  where state.lifecycle_state = 'completed'
    and not exists (
      select 1 from public.mission_history as history
      where history.user_id = state.user_id
        and history.daily_session_id = state.daily_key::text
        and history.mission_id = state.mission_id::text
        and history.mission_type = 'side'
        and history.final_state = 'completed'
        and history.xp_awarded = 10
        and history.skill_key = state.skill_key
        and history.skill_xp_awarded = 10
    )
  union all
  select 'side-history-state-mismatch', history.user_id,
    public.parse_vault_daily_key(history.daily_session_id),
    case when history.mission_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then history.mission_id::uuid else null end,
    jsonb_build_object(
      'overallXP', history.xp_awarded,
      'skillXP', history.skill_xp_awarded,
      'skillKey', history.skill_key
    )
  from public.mission_history as history
  where history.mission_type = 'side'
    and history.final_state = 'completed'
    and not exists (
      select 1 from public.side_mission_state as state
      where state.user_id = history.user_id
        and state.daily_key::text = history.daily_session_id
        and state.mission_id::text = history.mission_id
        and state.lifecycle_state = 'completed'
        and state.reward_awarded = true
        and state.completed_at is not null
        and state.skill_key = history.skill_key
        and history.xp_awarded = 10
        and history.skill_xp_awarded = 10
    )
  union all
  select 'completed-event-missing', state.user_id, state.daily_key,
    state.mission_id, '{}'::jsonb
  from public.side_mission_state as state
  where state.lifecycle_state = 'completed'
    and not exists (
      select 1 from public.side_mission_event_ledger as event
      where event.mission_id = state.mission_id
        and event.event_type = 'completed'
        and event.overall_xp_awarded = 10
        and event.skill_xp_awarded = 10
        and event.skill_key = state.skill_key
    )
  union all
  select 'promoted-event-missing', state.user_id, state.daily_key,
    state.mission_id, '{}'::jsonb
  from public.side_mission_state as state
  where not exists (
    select 1 from public.side_mission_event_ledger as event
    where event.mission_id = state.mission_id and event.event_type = 'promoted'
  )
  union all
  select 'started-event-missing', state.user_id, state.daily_key,
    state.mission_id, '{}'::jsonb
  from public.side_mission_state as state
  where state.started_at is not null
    and not exists (
      select 1 from public.side_mission_event_ledger as event
      where event.mission_id = state.mission_id and event.event_type = 'started'
    )
  union all
  select 'expired-event-missing', state.user_id, state.daily_key,
    state.mission_id, '{}'::jsonb
  from public.side_mission_state as state
  where state.lifecycle_state = 'expired'
    and not exists (
      select 1 from public.side_mission_event_ledger as event
      where event.mission_id = state.mission_id and event.event_type = 'expired'
    )
  union all
  select 'event-state-identity-mismatch', state.user_id, state.daily_key,
    state.mission_id, jsonb_build_object('eventId', event.event_id)
  from public.side_mission_event_ledger as event
  join public.side_mission_state as state on state.mission_id = event.mission_id
  where event.user_id <> state.user_id
     or event.daily_key <> state.daily_key
     or event.skill_key <> state.skill_key
  union all
  select 'rewarded-noncompleted-state', state.user_id, state.daily_key,
    state.mission_id, jsonb_build_object('state', state.lifecycle_state)
  from public.side_mission_state as state
  where state.lifecycle_state <> 'completed' and state.reward_awarded = true
  union all
  select 'duplicate-side-history-day', history.user_id,
    public.parse_vault_daily_key(history.daily_session_id), null::uuid,
    jsonb_build_object('count', count(*))
  from public.mission_history as history
  where history.mission_type = 'side' and history.final_state = 'completed'
  group by history.user_id, history.daily_session_id
  having count(*) > 1;
$$;

revoke all on function public.audit_side_mission_invariants()
from public, anon, authenticated;

comment on function public.audit_side_mission_invariants()
is 'Database-administrator-only read-only Side Mission reconciliation report. Zero rows means the checked state/history/event invariants agree.';

-- Reassert every authoritative boundary after adding diagnostics.
alter table public.side_mission_state enable row level security;
alter table public.side_mission_event_ledger enable row level security;
alter table public.mission_history enable row level security;
revoke all on public.side_mission_state from public, anon, authenticated;
revoke all on public.side_mission_event_ledger from public, anon, authenticated;
revoke insert, update, delete on public.mission_history from authenticated;
