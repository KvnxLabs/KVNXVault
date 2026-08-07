-- KVNX Vault Sprint 10: server-authoritative skill progression.
-- Apply after 202608070007_sprint9_2_daily_reset_countdown.sql.
-- Migrations 001-007 remain immutable.

-- Fixed, server-managed catalog. New skills can be added as data without
-- changing the user-owned progression table or browser contracts.
create table public.skill_catalog (
  skill_key text primary key,
  display_name text not null unique,
  sort_order integer not null unique,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint skill_catalog_key_format check (skill_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

insert into public.skill_catalog (skill_key, display_name, sort_order) values
  ('front_end_engineering', 'Front-End Engineering', 10),
  ('back_end_engineering', 'Back-End Engineering', 20),
  ('product_design', 'Product Design', 30),
  ('leadership', 'Leadership', 40),
  ('communication', 'Communication', 50),
  ('problem_solving', 'Problem Solving', 60),
  ('learning', 'Learning', 70),
  ('reading', 'Reading', 80),
  ('writing', 'Writing', 90),
  ('fitness', 'Fitness', 100),
  ('business', 'Business', 110),
  ('discipline', 'Discipline', 120);

create trigger skill_catalog_set_updated_at
before update on public.skill_catalog
for each row execute function public.set_updated_at();

alter table public.skill_catalog enable row level security;

create policy "skill_catalog_select_authenticated"
on public.skill_catalog for select to authenticated using (true);

revoke all on public.skill_catalog from public;
revoke all on public.skill_catalog from anon;
revoke all on public.skill_catalog from authenticated;
grant select on public.skill_catalog to authenticated;

create table public.skill_progression (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_key text not null references public.skill_catalog(skill_key),
  skill_xp integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, skill_key),
  constraint skill_progression_xp_nonnegative check (skill_xp >= 0)
);

create index skill_progression_user_xp_idx
  on public.skill_progression(user_id, skill_xp desc);

create trigger skill_progression_set_updated_at
before update on public.skill_progression
for each row execute function public.set_updated_at();

alter table public.skill_progression enable row level security;

create policy "skill_progression_select_own"
on public.skill_progression for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.skill_progression from public;
revoke all on public.skill_progression from anon;
revoke all on public.skill_progression from authenticated;
grant select on public.skill_progression to authenticated;

-- Terminal history retains the skill award so today's gain can be restored
-- after refresh/login and remains correct after a replacement overwrites the
-- current daily mission definition.
alter table public.mission_history
  add column skill_key text references public.skill_catalog(skill_key),
  add column skill_xp_awarded integer not null default 0,
  add constraint mission_history_skill_xp_nonnegative
    check (skill_xp_awarded >= 0);

-- One mapping function owns mission-focus to skill identity. It is internal,
-- fixed for Sprint 10, and easy to extend alongside the catalog.
create or replace function public.vault_skill_key_for_focus(p_focus text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case lower(trim(coalesce(p_focus, '')))
    when 'programming' then 'front_end_engineering'
    when 'business' then 'business'
    when 'fitness' then 'fitness'
    when 'health' then 'fitness'
    when 'learning' then 'learning'
    when 'reading' then 'reading'
    when 'career' then 'leadership'
    when 'creativity' then 'product_design'
    when 'finance' then 'business'
    when 'relationships' then 'communication'
    when 'mindset' then 'discipline'
    else 'problem_solving'
  end;
$$;

revoke all on function public.vault_skill_key_for_focus(text) from public;
revoke all on function public.vault_skill_key_for_focus(text) from anon;
revoke all on function public.vault_skill_key_for_focus(text) from authenticated;

-- Preserve the complete Sprint 9 generator and wrap it with the new trusted
-- primarySkill field. The public browser never calls either helper directly.
alter function public.build_vault_daily_mission(public.onboarding_profiles, uuid)
  rename to build_vault_daily_mission_sprint9;

revoke all on function public.build_vault_daily_mission_sprint9(public.onboarding_profiles, uuid) from public;
revoke all on function public.build_vault_daily_mission_sprint9(public.onboarding_profiles, uuid) from anon;
revoke all on function public.build_vault_daily_mission_sprint9(public.onboarding_profiles, uuid) from authenticated;

create or replace function public.build_vault_daily_mission(
  p_onboarding public.onboarding_profiles,
  p_instance_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.build_vault_daily_mission_sprint9(p_onboarding, p_instance_id)
    || jsonb_build_object(
      'primarySkill', public.vault_skill_key_for_focus(p_onboarding.primary_focus)
    );
$$;

revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid) from public;
revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid) from anon;
revoke all on function public.build_vault_daily_mission(public.onboarding_profiles, uuid) from authenticated;

-- Existing current-day definitions receive a server-selected skill before the
-- new action authority starts reading it. No past skill XP is fabricated.
update public.daily_mission_state
set mission_definition = jsonb_set(
  mission_definition,
  '{primarySkill}',
  to_jsonb(public.vault_skill_key_for_focus(mission_definition ->> 'focus')),
  true
)
where not (mission_definition ? 'primarySkill')
   or not exists (
     select 1 from public.skill_catalog as catalog
     where catalog.skill_key = mission_definition ->> 'primarySkill'
       and catalog.active = true
   );

-- Narrow zero-argument restoration contract. Identity and today's boundary
-- are derived on the server; the browser receives immutable totals only.
create or replace function public.get_skill_progression()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_daily_key date;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', progression.skill_key,
      'name', catalog.display_name,
      'totalXP', progression.skill_xp,
      'todayGain', coalesce(today.skill_xp, 0)
    ) order by progression.skill_xp desc, catalog.sort_order)
    from public.skill_progression as progression
    join public.skill_catalog as catalog
      on catalog.skill_key = progression.skill_key
    left join lateral (
      select sum(history.skill_xp_awarded)::integer as skill_xp
      from public.mission_history as history
      where history.user_id = v_user_id
        and history.skill_key = progression.skill_key
        and (history.terminal_at at time zone coalesce((
          select profile.timezone_name
          from public.profiles as profile
          where profile.user_id = v_user_id
        ), 'UTC'))::date = v_daily_key
    ) as today on true
    where progression.user_id = v_user_id
      and catalog.active = true
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_skill_progression() from public;
revoke all on function public.get_skill_progression() from anon;
grant execute on function public.get_skill_progression() to authenticated;

comment on function public.get_skill_progression()
is 'Sprint 10 zero-argument skill restoration. Returns only the authenticated user skill totals and server-derived daily gains.';

-- Sprint 8 action authority is extended atomically: the browser still submits
-- only mission id and action. Completion awards canonical overall and skill XP
-- under the same locked transaction and returns the authoritative snapshots.
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

  -- Preserve the established global lock order. Skill state is locked only
  -- after the mission and overall progression rows.
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

    -- Sprint 10 canonical skill reward. It is never accepted from the client or
    -- trusted from the JSON mission definition.
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
is 'Sprint 10 server authority. Accepts mission intent only and atomically awards canonical overall plus primary-skill XP under auth.uid().';

-- Defense in depth: user-owned progression remains read-only to browsers.
revoke insert, update, delete on public.skill_progression from authenticated;
revoke insert, update on public.progression_state from authenticated;
revoke insert, update on public.daily_mission_state from authenticated;
revoke insert, update on public.mission_history from authenticated;
