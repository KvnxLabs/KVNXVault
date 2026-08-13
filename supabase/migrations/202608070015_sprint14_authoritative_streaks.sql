-- KVNX Vault Sprint 14: server-authoritative consistency streaks.
-- Apply after 202608070014_sprint13_analytics_insights.sql.
-- Installed migrations 001-014 remain immutable. There is intentionally no 010.

create table public.user_streak_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= current_streak),
  last_completed_daily_key date,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_streak_state_zero_consistent check (
    (last_completed_daily_key is null and current_streak = 0 and longest_streak = 0)
    or (last_completed_daily_key is not null and current_streak >= 1 and longest_streak >= 1)
  )
);

alter table public.user_streak_state enable row level security;

create policy "user_streak_state_select_own"
on public.user_streak_state for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.user_streak_state from public, anon, authenticated;
grant select on public.user_streak_state to authenticated;

-- Internal mutation helper. The daily key comes only from a server-owned
-- mission_history row. Earlier or same-day keys cannot move a streak backward
-- or count a replacement twice.
create or replace function public.apply_vault_streak_day(
  p_user_id uuid,
  p_daily_key date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.user_streak_state%rowtype;
  v_next_current integer;
begin
  if p_user_id is null or p_daily_key is null then
    raise exception 'A trusted streak owner and daily key are required' using errcode = '22023';
  end if;

  insert into public.user_streak_state (
    user_id, current_streak, longest_streak, last_completed_daily_key
  ) values (p_user_id, 1, 1, p_daily_key)
  on conflict (user_id) do nothing;

  select * into strict v_state
  from public.user_streak_state
  where user_id = p_user_id
  for update;

  if p_daily_key <= v_state.last_completed_daily_key then
    v_next_current := v_state.current_streak;
  elsif p_daily_key = v_state.last_completed_daily_key + 1 then
    v_next_current := v_state.current_streak + 1;
  else
    v_next_current := 1;
  end if;

  if p_daily_key > v_state.last_completed_daily_key then
    update public.user_streak_state
    set current_streak = v_next_current,
        longest_streak = greatest(longest_streak, v_next_current),
        last_completed_daily_key = p_daily_key,
        updated_at = timezone('utc', now())
    where user_id = p_user_id
    returning * into strict v_state;
  end if;

  return jsonb_build_object(
    'currentStreak', v_state.current_streak,
    'longestStreak', v_state.longest_streak,
    'lastCompletedDailyKey', v_state.last_completed_daily_key
  );
end;
$$;

revoke all on function public.apply_vault_streak_day(uuid, date)
from public, anon, authenticated;

-- Defensive parser for historical session identifiers. It accepts only a
-- real ISO calendar date and returns null for every legacy/invalid shape.
create or replace function public.parse_vault_daily_key(p_value text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;

  return p_value::date;
exception when datetime_field_overflow or invalid_datetime_format then
  return null;
end;
$$;

revoke all on function public.parse_vault_daily_key(text)
from public, anon, authenticated;

-- The existing completion authority inserts mission_history only after an
-- accepted terminal transition. This trigger therefore shares the same atomic
-- transaction, locks, trusted owner, canonical daily session, and staging
-- effective clock. Skipped/expired history never changes streak state.
create or replace function public.capture_vault_streak_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_key date;
begin
  if new.final_state <> 'completed' then
    return new;
  end if;

  v_daily_key := public.parse_vault_daily_key(new.daily_session_id);
  if v_daily_key is null then
    raise exception 'Completed mission is missing its authoritative logical day'
      using errcode = '22023';
  end if;

  perform public.apply_vault_streak_day(new.user_id, v_daily_key);
  return new;
end;
$$;

revoke all on function public.capture_vault_streak_completion()
from public, anon, authenticated;

create trigger mission_history_capture_streak
after insert on public.mission_history
for each row execute function public.capture_vault_streak_completion();

-- Activate the two dormant Sprint 11 definitions without duplicating catalog
-- rows. The active completion function already calls this evaluator after the
-- history insert, so the trigger-updated streak is visible and every newly
-- inserted achievement remains in the existing newAchievements response.
create or replace function public.evaluate_vault_achievements(
  p_user_id uuid,
  p_total_xp integer,
  p_completed_replacement boolean,
  p_unlocked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_achievements jsonb;
  v_current_streak integer := 0;
begin
  select coalesce((
    select streak.current_streak
    from public.user_streak_state as streak
    where streak.user_id = p_user_id
  ), 0)
  into v_current_streak;

  with eligible(achievement_key) as (
    select 'FIRST_MISSION'::text
    where exists (
      select 1 from public.mission_history
      where user_id = p_user_id and final_state = 'completed'
    )
    union all select 'FIRST_REPLACEMENT' where p_completed_replacement
    union all select 'LEVEL_2' where p_total_xp >= 100
    union all select 'LEVEL_5' where p_total_xp >= 700
    union all select 'FIRST_SKILL' where exists (
      select 1 from public.skill_progression
      where user_id = p_user_id and skill_xp > 0
    )
    union all select '100_XP' where p_total_xp >= 100
    union all select '250_XP' where p_total_xp >= 250
    union all select '500_XP' where p_total_xp >= 500
    union all select '1000_XP' where p_total_xp >= 1000
    union all select 'THREE_DAY_STREAK' where v_current_streak >= 3
    union all select 'SEVEN_DAY_STREAK' where v_current_streak >= 7
  ), inserted as (
    insert into public.user_achievements (user_id, achievement_key, unlocked_at)
    select p_user_id, eligible.achievement_key, p_unlocked_at
    from eligible
    on conflict (user_id, achievement_key) do nothing
    returning achievement_key, unlocked_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', catalog.key,
    'name', catalog.name,
    'description', catalog.description,
    'icon', catalog.icon,
    'category', catalog.category,
    'hidden', catalog.hidden,
    'displayOrder', catalog.display_order,
    'unlockedAt', inserted.unlocked_at
  ) order by catalog.display_order), '[]'::jsonb)
  into v_new_achievements
  from inserted
  join public.achievement_catalog as catalog
    on catalog.key = inserted.achievement_key;

  return v_new_achievements;
end;
$$;

revoke all on function public.evaluate_vault_achievements(uuid, integer, boolean, timestamptz)
from public, anon, authenticated;

-- Reconstruct only from canonical server daily-session keys. Pre-Sprint-9
-- browser session identifiers are excluded because they cannot prove a logical
-- Vault day. Multiple completions on one key are collapsed before streak math.
with completed_days as (
  select distinct
    history.user_id,
    parsed.daily_key
  from public.mission_history as history
  cross join lateral (
    select public.parse_vault_daily_key(history.daily_session_id) as daily_key
  ) as parsed
  where history.final_state = 'completed'
    and parsed.daily_key is not null
), numbered_days as (
  select
    days.user_id,
    days.daily_key,
    days.daily_key - row_number() over (
      partition by days.user_id order by days.daily_key
    )::integer as streak_group
  from completed_days as days
), streak_groups as (
  select
    days.user_id,
    days.streak_group,
    min(days.daily_key) as first_day,
    max(days.daily_key) as last_day,
    count(*)::integer as streak_length
  from numbered_days as days
  group by days.user_id, days.streak_group
), streak_summary as (
  select
    groups.user_id,
    max(groups.streak_length)::integer as longest_streak,
    max(groups.last_day) as last_completed_daily_key
  from streak_groups as groups
  group by groups.user_id
), reconstructed as (
  select
    summary.user_id,
    current_group.streak_length as current_streak,
    summary.longest_streak,
    summary.last_completed_daily_key
  from streak_summary as summary
  join streak_groups as current_group
    on current_group.user_id = summary.user_id
   and current_group.last_day = summary.last_completed_daily_key
)
insert into public.user_streak_state (
  user_id, current_streak, longest_streak, last_completed_daily_key
)
select
  history.user_id,
  history.current_streak,
  history.longest_streak,
  history.last_completed_daily_key
from reconstructed as history
on conflict (user_id) do update
set current_streak = excluded.current_streak,
    longest_streak = excluded.longest_streak,
    last_completed_daily_key = excluded.last_completed_daily_key,
    updated_at = timezone('utc', now());

-- Existing users who provably reached a streak receive the already-defined
-- milestone at reconciliation time. This mirrors Sprint 11's historical
-- milestone policy without inventing an earlier unlock timestamp.
insert into public.user_achievements (user_id, achievement_key, unlocked_at)
select streak.user_id, milestone.achievement_key, timezone('utc', now())
from public.user_streak_state as streak
cross join lateral (
  select 'THREE_DAY_STREAK'::text as achievement_key where streak.longest_streak >= 3
  union all
  select 'SEVEN_DAY_STREAK'::text where streak.longest_streak >= 7
) as milestone
on conflict (user_id, achievement_key) do nothing;

-- Exact zero-argument authenticated restoration. The browser cannot provide an
-- owner, date, timezone, or streak value.
create or replace function public.get_vault_streak()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_state public.user_streak_state%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_state
  from public.user_streak_state
  where user_id = v_user_id;

  return jsonb_build_object(
    'currentStreak', coalesce(v_state.current_streak, 0),
    'longestStreak', coalesce(v_state.longest_streak, 0),
    'lastCompletedDailyKey', v_state.last_completed_daily_key
  );
end;
$$;

revoke all on function public.get_vault_streak() from public, anon;
grant execute on function public.get_vault_streak() to authenticated;

comment on function public.get_vault_streak()
is 'Sprint 14 zero-argument read of the authenticated user authoritative logical-day streak state.';

-- Preserve the complete active Sprint 11.1 completion authority, including its
-- gated effective clock, behind an internal name. The public wrapper accepts
-- the same mission id and action only, then appends the authoritative streak
-- snapshot after accepted completion. No lifecycle or reward logic is copied.
alter function public.request_vault_mission_action(text, text)
  rename to request_vault_mission_action_sprint13;

revoke all on function public.request_vault_mission_action_sprint13(text, text)
from public, anon, authenticated;

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
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_result := public.request_vault_mission_action_sprint13(p_mission_id, p_action);

  if coalesce((v_result ->> 'accepted')::boolean, false)
     and v_result #>> '{event,eventType}' = 'mission.completed' then
    return v_result || jsonb_build_object('streak', public.get_vault_streak());
  end if;

  return v_result;
end;
$$;

revoke all on function public.request_vault_mission_action(text, text) from public, anon;
grant execute on function public.request_vault_mission_action(text, text) to authenticated;

comment on function public.request_vault_mission_action(text, text)
is 'Sprint 14 mission-intent wrapper. Existing authority remains internal; accepted completion returns the atomic authoritative streak snapshot.';

-- Reassert all existing authority boundaries.
alter table public.user_streak_state enable row level security;
revoke insert, update, delete on public.user_streak_state from authenticated;
revoke insert, update, delete on public.user_achievements from authenticated;
revoke insert, update, delete on public.mission_history from authenticated;
