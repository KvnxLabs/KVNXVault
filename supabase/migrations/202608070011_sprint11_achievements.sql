-- KVNX Vault Sprint 11: server-authoritative achievements and milestones.
-- Apply after 202608070009_sprint10_1_uuid_function_hotfix.sql.
-- Migrations 001-009 remain immutable. There is intentionally no migration 010.

create table public.achievement_catalog (
  id bigint generated always as identity primary key,
  key text not null unique,
  name text not null,
  description text not null,
  icon text not null,
  category text not null,
  hidden boolean not null default false,
  display_order integer not null unique,
  constraint achievement_catalog_key_format check (key ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  constraint achievement_catalog_name_length check (char_length(name) between 1 and 80),
  constraint achievement_catalog_description_length check (char_length(description) between 1 and 240),
  constraint achievement_catalog_icon_length check (char_length(icon) between 1 and 16),
  constraint achievement_catalog_category_length check (char_length(category) between 1 and 40)
);

insert into public.achievement_catalog
  (key, name, description, icon, category, hidden, display_order)
values
  ('FIRST_MISSION', 'First Mission', 'Complete your first mission.', '◆', 'Missions', false, 10),
  ('FIRST_REPLACEMENT', 'Second Wind', 'Complete your first replacement mission.', '↻', 'Missions', false, 20),
  ('LEVEL_2', 'Level Two', 'Reach overall Level 2.', 'Ⅱ', 'Progression', false, 30),
  ('LEVEL_5', 'Level Five', 'Reach overall Level 5.', 'Ⅴ', 'Progression', true, 40),
  ('FIRST_SKILL', 'First Mastery', 'Earn XP in your first skill.', '◇', 'Skills', false, 50),
  ('100_XP', '100 XP', 'Build 100 total account XP.', '100', 'Progression', false, 60),
  ('250_XP', '250 XP', 'Build 250 total account XP.', '250', 'Progression', false, 70),
  ('500_XP', '500 XP', 'Build 500 total account XP.', '500', 'Progression', false, 80),
  ('1000_XP', '1,000 XP', 'Build 1,000 total account XP.', '1K', 'Progression', true, 90),
  ('THREE_DAY_STREAK', 'Three-Day Streak', 'Complete missions on three consecutive authoritative days.', '3D', 'Consistency', true, 100),
  ('SEVEN_DAY_STREAK', 'Seven-Day Streak', 'Complete missions on seven consecutive authoritative days.', '7D', 'Consistency', true, 110);

alter table public.achievement_catalog enable row level security;

revoke all on public.achievement_catalog from public;
revoke all on public.achievement_catalog from anon;
revoke all on public.achievement_catalog from authenticated;

create table public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_key text not null references public.achievement_catalog(key),
  unlocked_at timestamptz not null,
  primary key (user_id, achievement_key)
);

create index user_achievements_user_unlocked_idx
  on public.user_achievements(user_id, unlocked_at desc);

alter table public.user_achievements enable row level security;

create policy "user_achievements_select_own"
on public.user_achievements for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.user_achievements from public;
revoke all on public.user_achievements from anon;
revoke all on public.user_achievements from authenticated;
grant select on public.user_achievements to authenticated;

-- The complete catalog is presentation data only. Authentication is still
-- required, and direct catalog table access remains revoked.
create or replace function public.get_achievement_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', catalog.key,
      'name', catalog.name,
      'description', catalog.description,
      'icon', catalog.icon,
      'category', catalog.category,
      'hidden', catalog.hidden,
      'displayOrder', catalog.display_order
    ) order by catalog.display_order)
    from public.achievement_catalog as catalog
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_achievement_catalog() from public;
revoke all on function public.get_achievement_catalog() from anon;
grant execute on function public.get_achievement_catalog() to authenticated;

-- Zero-argument authenticated restoration. Only earned rows are returned,
-- newest first; ownership cannot be supplied by the browser.
create or replace function public.get_user_achievements()
returns jsonb
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', catalog.key,
      'name', catalog.name,
      'description', catalog.description,
      'icon', catalog.icon,
      'category', catalog.category,
      'hidden', catalog.hidden,
      'displayOrder', catalog.display_order,
      'unlockedAt', earned.unlocked_at
    ) order by earned.unlocked_at desc, catalog.display_order)
    from public.user_achievements as earned
    join public.achievement_catalog as catalog
      on catalog.key = earned.achievement_key
    where earned.user_id = v_user_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_user_achievements() from public;
revoke all on function public.get_user_achievements() from anon;
grant execute on function public.get_user_achievements() to authenticated;

-- Internal evaluator. It is called only from the locked mission-completion
-- transaction. ON CONFLICT makes each lifetime milestone idempotent.
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
begin
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
    -- Streak catalog entries intentionally have no eligibility branch until
    -- an authoritative consecutive-day streak model exists.
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

revoke all on function public.evaluate_vault_achievements(uuid, integer, boolean, timestamptz) from public;
revoke all on function public.evaluate_vault_achievements(uuid, integer, boolean, timestamptz) from anon;
revoke all on function public.evaluate_vault_achievements(uuid, integer, boolean, timestamptz) from authenticated;

-- Reconcile milestones already supported by authoritative pre-Sprint-11 data.
-- Historical systems did not record the exact instant an XP threshold was
-- crossed, so those existing milestones receive the server migration time.
do $$
declare
  v_account record;
  v_reconciled_at timestamptz := clock_timestamp();
begin
  for v_account in
    select progression.user_id,
           progression.total_xp,
           exists (
             select 1
             from public.mission_history as history
             where history.user_id = progression.user_id
             group by history.daily_session_id
             having count(*) > 1
                and bool_or(history.final_state = 'completed')
           ) as completed_replacement
    from public.progression_state as progression
  loop
    perform public.evaluate_vault_achievements(
      v_account.user_id,
      v_account.total_xp,
      v_account.completed_replacement,
      v_reconciled_at
    );
  end loop;
end;
$$;

-- Extend the active Sprint 10 authority. The browser contract remains exactly
-- mission id plus action; overall XP, skill XP, and achievements commit in one
-- transaction and only newly inserted achievements are returned.
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
  v_now timestamptz := clock_timestamp();
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

revoke all on function public.request_vault_mission_action(text, text) from public;
revoke all on function public.request_vault_mission_action(text, text) from anon;
grant execute on function public.request_vault_mission_action(text, text) to authenticated;

comment on function public.request_vault_mission_action(text, text)
is 'Sprint 11 server authority. Mission intent atomically commits canonical overall XP, skill XP, history, and newly eligible achievements.';

revoke insert, update, delete on public.user_achievements from authenticated;
revoke insert, update, delete on public.skill_progression from authenticated;
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert, update on public.mission_history from authenticated;
