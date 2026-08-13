-- KVNX Vault Sprint 22: server-authoritative Side Mission lifecycle.
-- Apply after 202608070021_sprint21_1_effective_clock_compatibility.sql.
-- Installed migrations 001-021 remain immutable. There is intentionally no 010.

-- Existing archive rows are authoritative Daily Mission records. The default
-- preserves every legacy insert contract while new Side completions are typed.
alter table public.mission_history
  add column mission_type text not null default 'daily',
  add constraint mission_history_mission_type_valid
    check (mission_type in ('daily', 'side'));

comment on column public.mission_history.mission_type
is 'Authoritative mission domain. Legacy and primary records are daily; Sprint 22 supplemental completions are side.';

-- Exactly one row per owner/logical day is both the Side Mission slot and the
-- account-wide rewarded-completion cap for v1.
create table public.side_mission_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_key date not null,
  mission_id uuid not null default extensions.gen_random_uuid(),
  source_offer_id uuid not null,
  skill_key text not null references public.skill_catalog(skill_key),
  template_key text not null references public.mission_catalog(template_key),
  mission_definition jsonb not null,
  lifecycle_state text not null default 'ready'
    check (lifecycle_state in ('ready', 'active', 'completed', 'expired')),
  reward_awarded boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, daily_key),
  unique (mission_id),
  unique (user_id, source_offer_id),
  constraint side_mission_definition_object check (
    jsonb_typeof(mission_definition) = 'object'
    and mission_definition ?& array[
      'title', 'description', 'estimatedDuration', 'primarySkill',
      'skillName', 'overallXPReward', 'skillXPReward'
    ]
  ),
  constraint side_mission_started_consistent check (
    (lifecycle_state = 'ready' and started_at is null)
    or (lifecycle_state in ('active', 'completed') and started_at is not null)
    or lifecycle_state = 'expired'
  ),
  constraint side_mission_completion_consistent check (
    (lifecycle_state = 'completed' and reward_awarded and completed_at is not null)
    or (lifecycle_state <> 'completed' and not reward_awarded and completed_at is null)
  )
);

create index side_mission_state_owner_created_idx
  on public.side_mission_state(user_id, daily_key desc);

create trigger side_mission_state_set_updated_at
before update on public.side_mission_state
for each row execute function public.set_updated_at();

alter table public.side_mission_state enable row level security;
revoke all on public.side_mission_state from public, anon, authenticated;

-- Internal public projection. Template identity never crosses this boundary.
create or replace function public.vault_side_mission_response(
  p_state public.side_mission_state,
  p_accepted boolean,
  p_reason text,
  p_overall_progression jsonb,
  p_updated_skill jsonb,
  p_new_achievements jsonb,
  p_history_record jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accepted', p_accepted,
    'reason', p_reason,
    'dailyKey', p_state.daily_key::text,
    'capacity', jsonb_build_object(
      'limit', 1,
      'slotAvailable', false,
      'rewardedUsed', case when p_state.reward_awarded then 1 else 0 end,
      'rewardedRemaining', case when p_state.reward_awarded then 0 else 1 end
    ),
    'sideMission', jsonb_build_object(
      'id', p_state.mission_id::text,
      'sourceOfferId', p_state.source_offer_id::text,
      'definition', (p_state.mission_definition - 'templateKey'),
      'lifecycle', jsonb_build_object(
        'state', p_state.lifecycle_state,
        'startedAt', p_state.started_at,
        'completedAt', p_state.completed_at,
        'rewardAwarded', p_state.reward_awarded
      )
    ),
    'overallProgression', p_overall_progression,
    'updatedSkill', p_updated_skill,
    'newAchievements', coalesce(p_new_achievements, '[]'::jsonb),
    'historyRecord', p_history_record
  );
$$;

revoke all on function public.vault_side_mission_response(
  public.side_mission_state, boolean, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

create or replace function public.expire_stale_side_missions(
  p_user_id uuid,
  p_daily_key date,
  p_expired_at timestamptz
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.side_mission_state
  set lifecycle_state = 'expired', updated_at = p_expired_at
  where user_id = p_user_id
    and daily_key < p_daily_key
    and lifecycle_state in ('ready', 'active')
    and reward_awarded = false;
$$;

revoke all on function public.expire_stale_side_missions(uuid, date, timestamptz)
from public, anon, authenticated;

-- Restoration accepts no browser identity or time. It also expires old
-- incomplete slots so they can never earn in a later logical day.
create or replace function public.get_side_mission()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_state public.side_mission_state%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform public.expire_stale_side_missions(v_user_id, v_daily_key, v_now);

  select * into v_state
  from public.side_mission_state
  where user_id = v_user_id and daily_key = v_daily_key;

  if not found then
    return jsonb_build_object(
      'accepted', true,
      'reason', 'slot-available',
      'dailyKey', v_daily_key::text,
      'capacity', jsonb_build_object(
        'limit', 1, 'slotAvailable', true,
        'rewardedUsed', 0, 'rewardedRemaining', 1
      ),
      'sideMission', null,
      'overallProgression', null,
      'updatedSkill', null,
      'newAchievements', '[]'::jsonb,
      'historyRecord', null
    );
  end if;

  return public.vault_side_mission_response(
    v_state, true, 'restored', null, null, '[]'::jsonb, null
  );
end;
$$;

revoke all on function public.get_side_mission() from public, anon, authenticated;
grant execute on function public.get_side_mission() to authenticated;

-- Promotion accepts only the opaque Sprint 21 offer ID. PostgreSQL proves the
-- exact selected membership and reconstructs immutable content and +10/+10.
create or replace function public.promote_skill_path_offer_to_side_mission(
  p_offer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_offer_state public.skill_path_mission_offer_state%rowtype;
  v_offer jsonb;
  v_state public.side_mission_state%rowtype;
  v_skill_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_offer_id is null then
    raise exception 'Opaque planned offer identifier required' using errcode = '22023';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text || ':side-mission-slot', 0)
  );
  perform public.expire_stale_side_missions(v_user_id, v_daily_key, v_now);

  select * into v_state
  from public.side_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if found then
    return public.vault_side_mission_response(
      v_state,
      v_state.source_offer_id = p_offer_id,
      case when v_state.source_offer_id = p_offer_id then 'already-promoted' else 'daily-slot-unavailable' end,
      null, null, '[]'::jsonb, null
    );
  end if;

  select state.* into v_offer_state
  from public.skill_path_mission_offer_state as state
  join public.user_skill_paths as path
    on path.user_id = state.user_id and path.skill_key = state.skill_key
   and path.path_active = true
  join public.skill_catalog as skill
    on skill.skill_key = state.skill_key and skill.active = true
  where state.user_id = v_user_id
    and state.daily_key = v_daily_key
    and state.selected_offer_id = p_offer_id
    and exists (
      select 1 from jsonb_array_elements(state.offers) as offered(option)
      where offered.option ->> 'offerId' = p_offer_id::text
        and offered.option ->> 'skillKey' = state.skill_key
    )
  for update of state;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'planned-offer-invalid-or-inactive');
  end if;

  select offered.option into v_offer
  from jsonb_array_elements(v_offer_state.offers) as offered(option)
  where offered.option ->> 'offerId' = p_offer_id::text;

  select skill.display_name into v_skill_name
  from public.skill_catalog as skill
  join public.mission_catalog as catalog
    on catalog.primary_skill_key = skill.skill_key and catalog.active = true
  where skill.skill_key = v_offer_state.skill_key
    and skill.active = true
    and catalog.template_key = v_offer ->> 'templateKey';

  if not found or v_offer ->> 'skillName' <> v_skill_name then
    raise exception 'Invalid canonical planned offer snapshot' using errcode = '23514';
  end if;

  insert into public.side_mission_state (
    user_id, daily_key, source_offer_id, skill_key, template_key, mission_definition
  ) values (
    v_user_id,
    v_daily_key,
    p_offer_id,
    v_offer_state.skill_key,
    v_offer ->> 'templateKey',
    jsonb_build_object(
      'templateKey', v_offer ->> 'templateKey',
      'title', v_offer ->> 'title',
      'description', v_offer ->> 'description',
      'estimatedDuration', v_offer ->> 'estimatedDuration',
      'primarySkill', v_offer_state.skill_key,
      'skillName', v_skill_name,
      'overallXPReward', 10,
      'skillXPReward', 10
    )
  )
  returning * into strict v_state;

  return public.vault_side_mission_response(
    v_state, true, 'promoted', null, null, '[]'::jsonb, null
  );
end;
$$;

revoke all on function public.promote_skill_path_offer_to_side_mission(uuid)
from public, anon, authenticated;
grant execute on function public.promote_skill_path_offer_to_side_mission(uuid)
to authenticated;

-- The slot is unambiguous, so start accepts no mission object or identifier.
create or replace function public.start_side_mission()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_state public.side_mission_state%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text || ':side-mission-slot', 0)
  );
  perform public.expire_stale_side_missions(v_user_id, v_daily_key, v_now);

  select * into v_state
  from public.side_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'side-mission-unavailable');
  end if;

  if v_state.lifecycle_state = 'ready' then
    update public.side_mission_state
    set lifecycle_state = 'active', started_at = v_now
    where user_id = v_user_id and daily_key = v_daily_key
    returning * into strict v_state;
    return public.vault_side_mission_response(
      v_state, true, 'started', null, null, '[]'::jsonb, null
    );
  elsif v_state.lifecycle_state = 'active' then
    return public.vault_side_mission_response(
      v_state, true, 'already-active', null, null, '[]'::jsonb, null
    );
  end if;

  return public.vault_side_mission_response(
    v_state, false,
    case when v_state.lifecycle_state = 'completed' then 'already-completed' else 'side-mission-expired' end,
    null, null, '[]'::jsonb, null
  );
end;
$$;

revoke all on function public.start_side_mission() from public, anon, authenticated;
grant execute on function public.start_side_mission() to authenticated;

-- Side completions must never enter the Daily Mission streak model.
create or replace function public.capture_vault_streak_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_key date;
begin
  if new.final_state <> 'completed' or new.mission_type <> 'daily' then
    return new;
  end if;

  v_daily_key := public.parse_vault_daily_key(new.daily_session_id);
  if v_daily_key is null then
    raise exception 'Completed Daily Mission is missing its authoritative logical day'
      using errcode = '22023';
  end if;

  perform public.apply_vault_streak_day(new.user_id, v_daily_key);
  return new;
end;
$$;

revoke all on function public.capture_vault_streak_completion()
from public, anon, authenticated;

-- Keep progression achievements authoritative while preventing FIRST_MISSION
-- from treating a Side Mission as a Daily Mission.
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
  ), 0) into v_current_streak;

  with eligible(achievement_key) as (
    select 'FIRST_MISSION'::text
    where exists (
      select 1 from public.mission_history
      where user_id = p_user_id
        and final_state = 'completed'
        and mission_type = 'daily'
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

-- Completion is the only reward path. Owner/day and row locks make retries,
-- tabs, devices, and different-path races converge on one account-wide slot.
create or replace function public.complete_side_mission()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_state public.side_mission_state%rowtype;
  v_total_xp integer;
  v_skill_total integer;
  v_skill_name text;
  v_updated_skill jsonb;
  v_new_achievements jsonb := '[]'::jsonb;
  v_history_id uuid;
  v_history_record jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text || ':side-mission-slot', 0)
  );
  perform public.expire_stale_side_missions(v_user_id, v_daily_key, v_now);

  select * into v_state
  from public.side_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'side-mission-unavailable');
  end if;
  if v_state.lifecycle_state <> 'active' then
    return public.vault_side_mission_response(
      v_state, false,
      case
        when v_state.lifecycle_state = 'ready' then 'side-mission-not-active'
        when v_state.lifecycle_state = 'completed' then 'already-completed'
        else 'side-mission-expired'
      end,
      null, null, '[]'::jsonb, null
    );
  end if;
  if v_state.reward_awarded then
    raise exception 'Side Mission reward invariant violated' using errcode = '23514';
  end if;
  if (v_state.mission_definition ->> 'overallXPReward')::integer <> 10
    or (v_state.mission_definition ->> 'skillXPReward')::integer <> 10
    or v_state.mission_definition ->> 'primarySkill' <> v_state.skill_key then
    raise exception 'Invalid authoritative Side Mission reward snapshot' using errcode = '23514';
  end if;

  select skill.display_name into v_skill_name
  from public.skill_catalog as skill
  join public.mission_catalog as catalog
    on catalog.template_key = v_state.template_key
   and catalog.primary_skill_key = skill.skill_key
   and catalog.active = true
  where skill.skill_key = v_state.skill_key and skill.active = true;
  if not found then
    return public.vault_side_mission_response(
      v_state, false, 'canonical-side-mission-inactive',
      null, null, '[]'::jsonb, null
    );
  end if;

  select total_xp into strict v_total_xp
  from public.progression_state
  where user_id = v_user_id
  for update;

  insert into public.skill_progression (user_id, skill_key, skill_xp)
  values (v_user_id, v_state.skill_key, 0)
  on conflict (user_id, skill_key) do nothing;

  select skill_xp into strict v_skill_total
  from public.skill_progression
  where user_id = v_user_id and skill_key = v_state.skill_key
  for update;

  v_total_xp := v_total_xp + 10;
  v_skill_total := v_skill_total + 10;

  update public.progression_state
  set total_xp = v_total_xp
  where user_id = v_user_id;

  update public.skill_progression
  set skill_xp = v_skill_total
  where user_id = v_user_id and skill_key = v_state.skill_key;

  update public.side_mission_state
  set lifecycle_state = 'completed', reward_awarded = true, completed_at = v_now
  where user_id = v_user_id and daily_key = v_daily_key
  returning * into strict v_state;

  insert into public.mission_history (
    user_id, daily_session_id, mission_id, title, focus, final_state,
    xp_awarded, terminal_at, skill_key, skill_xp_awarded,
    mission_description, original_state, template_key, mission_type
  ) values (
    v_user_id, v_daily_key::text, v_state.mission_id::text,
    v_state.mission_definition ->> 'title', 'skill_path', 'completed',
    10, v_now, v_state.skill_key, 10,
    v_state.mission_definition ->> 'description', 'active',
    v_state.template_key, 'side'
  )
  returning id into strict v_history_id;

  v_new_achievements := public.evaluate_vault_achievements(
    v_user_id, v_total_xp, false, v_now
  );

  v_updated_skill := jsonb_build_object(
    'key', v_state.skill_key,
    'name', v_skill_name,
    'totalXP', v_skill_total,
    'todayGain', coalesce((
      select sum(history.skill_xp_awarded)::integer
      from public.mission_history as history
      where history.user_id = v_user_id
        and history.skill_key = v_state.skill_key
        and history.daily_session_id = v_daily_key::text
        and history.final_state = 'completed'
    ), 0)
  );

  v_history_record := jsonb_build_object(
    'historyId', v_history_id::text,
    'missionType', 'side',
    'missionId', v_state.mission_id::text,
    'title', v_state.mission_definition ->> 'title',
    'category', 'Skill Path',
    'primarySkillKey', v_state.skill_key,
    'primarySkill', v_skill_name,
    'overallXPEarned', 10,
    'skillXPEarned', 10,
    'status', 'completed',
    'completedAt', v_now,
    'description', v_state.mission_definition ->> 'description',
    'originalMissionState', 'active',
    'achievements', v_new_achievements
  );

  return public.vault_side_mission_response(
    v_state,
    true,
    'completed',
    jsonb_build_object('totalXP', v_total_xp),
    v_updated_skill,
    v_new_achievements,
    v_history_record
  );
end;
$$;

revoke all on function public.complete_side_mission() from public, anon, authenticated;
grant execute on function public.complete_side_mission() to authenticated;

-- Vault History preserves daily and side identity without rewriting legacy rows.
drop function public.get_vault_history();

create function public.get_vault_history()
returns table (
  "historyId" uuid,
  "missionType" text,
  "missionId" text,
  title text,
  category text,
  "primarySkillKey" text,
  "primarySkill" text,
  "overallXPEarned" integer,
  "skillXPEarned" integer,
  status text,
  "completedAt" timestamptz,
  description text,
  "originalMissionState" text,
  achievements jsonb
)
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

  return query
  select
    history.id,
    history.mission_type,
    history.mission_id,
    history.title,
    history.focus,
    history.skill_key,
    skill.display_name,
    history.xp_awarded,
    history.skill_xp_awarded,
    history.final_state,
    history.terminal_at,
    history.mission_description,
    history.original_state,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', catalog.key,
        'name', catalog.name,
        'description', catalog.description,
        'icon', catalog.icon,
        'unlockedAt', earned.unlocked_at
      ) order by catalog.display_order)
      from public.user_achievements as earned
      join public.achievement_catalog as catalog
        on catalog.key = earned.achievement_key
      where earned.user_id = v_user_id
        and earned.unlocked_at = history.terminal_at
    ), '[]'::jsonb)
  from public.mission_history as history
  left join public.skill_catalog as skill
    on skill.skill_key = history.skill_key
  where history.user_id = v_user_id
    and history.final_state = 'completed'
  order by history.terminal_at desc, history.id desc;
end;
$$;

revoke all on function public.get_vault_history() from public, anon, authenticated;
grant execute on function public.get_vault_history() to authenticated;

-- Analytics counts all verified progression honestly and exposes daily/side
-- counts separately. No pre-Sprint-22 side history is fabricated.
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
    select history.id, history.terminal_at, history.xp_awarded,
           history.skill_key, history.skill_xp_awarded, history.mission_type
    from public.mission_history as history
    where history.user_id = v_user_id
      and history.final_state = 'completed'
      and (v_period = 'all' or (
        history.terminal_at >= (v_start_date::timestamp at time zone 'utc')
        and history.terminal_at < ((v_today + 1)::timestamp at time zone 'utc')
      ))
  ), daily_totals as (
    select (history.terminal_at at time zone 'utc')::date as activity_date,
      count(*)::integer as completed_count,
      count(*) filter (where history.mission_type = 'daily')::integer as daily_count,
      count(*) filter (where history.mission_type = 'side')::integer as side_count,
      coalesce(sum(history.xp_awarded), 0)::integer as xp_earned
    from filtered_history as history
    group by (history.terminal_at at time zone 'utc')::date
  ), requested_days as (
    select day::date as activity_date
    from generate_series(v_start_date, v_today, interval '1 day') as day
    where v_period <> 'all'
  ), activity_series as (
    select days.activity_date,
      coalesce(totals.completed_count, 0)::integer as completed_count,
      coalesce(totals.daily_count, 0)::integer as daily_count,
      coalesce(totals.side_count, 0)::integer as side_count,
      coalesce(totals.xp_earned, 0)::integer as xp_earned
    from requested_days as days
    left join daily_totals as totals using (activity_date)
    union all
    select totals.activity_date, totals.completed_count, totals.daily_count,
           totals.side_count, totals.xp_earned
    from daily_totals as totals where v_period = 'all'
  ), skill_totals as (
    select history.skill_key, catalog.display_name, catalog.sort_order,
      coalesce(sum(history.skill_xp_awarded), 0)::integer as xp_earned
    from filtered_history as history
    join public.skill_catalog as catalog on catalog.skill_key = history.skill_key
    where history.skill_xp_awarded > 0
    group by history.skill_key, catalog.display_name, catalog.sort_order
  ), summary as (
    select count(*)::integer as missions_completed,
      count(*) filter (where history.mission_type = 'daily')::integer as daily_missions_completed,
      count(*) filter (where history.mission_type = 'side')::integer as side_missions_completed,
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
      'dailyMissionsCompleted', summary.daily_missions_completed,
      'sideMissionsCompleted', summary.side_missions_completed,
      'overallXPEarned', summary.overall_xp_earned,
      'skillXPEarned', summary.skill_xp_earned,
      'activeDays', summary.active_days,
      'achievementsUnlocked', (
        select count(*)::integer from public.user_achievements as earned
        where earned.user_id = v_user_id and (v_period = 'all' or (
          earned.unlocked_at >= (v_start_date::timestamp at time zone 'utc')
          and earned.unlocked_at < ((v_today + 1)::timestamp at time zone 'utc')
        ))
      )
    ),
    'mostDevelopedSkill', (
      select jsonb_build_object('key', skill.skill_key, 'name', skill.display_name, 'xpEarned', skill.xp_earned)
      from skill_totals as skill
      order by skill.xp_earned desc, skill.sort_order asc, skill.skill_key asc limit 1
    ),
    'missionActivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', activity.activity_date,
        'completedCount', activity.completed_count,
        'dailyCompletedCount', activity.daily_count,
        'sideCompletedCount', activity.side_count
      ) order by activity.activity_date)
      from activity_series as activity
    ), '[]'::jsonb),
    'xpActivity', coalesce((
      select jsonb_agg(jsonb_build_object('date', activity.activity_date, 'xpEarned', activity.xp_earned)
        order by activity.activity_date)
      from activity_series as activity
    ), '[]'::jsonb),
    'skillActivity', coalesce((
      select jsonb_agg(jsonb_build_object('key', skill.skill_key, 'name', skill.display_name, 'xpEarned', skill.xp_earned)
        order by skill.xp_earned desc, skill.sort_order asc, skill.skill_key asc)
      from skill_totals as skill
    ), '[]'::jsonb)
  ) into v_result from summary;

  return v_result;
end;
$$;

revoke all on function public.get_vault_analytics(text) from public, anon, authenticated;
grant execute on function public.get_vault_analytics(text) to authenticated;

alter table public.side_mission_state enable row level security;
alter table public.mission_history enable row level security;
revoke all on public.side_mission_state from public, anon, authenticated;
revoke insert, update, delete on public.mission_history from authenticated;

comment on table public.side_mission_state
is 'Sprint 22 one account-wide Side Mission slot per authoritative logical day. Promotion, lifecycle, +10/+10 reward, and completion are server-owned.';
