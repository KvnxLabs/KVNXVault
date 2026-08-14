-- KVNX Vault Sprint 26: server-authoritative Mission Customization.
-- Apply after 202608070027_sprint24_3_monitoring_helper_compatibility.sql.
-- Historical migrations 001-027 remain immutable. There is intentionally no 010.

-- Mission direction is a preference, not progression or mission state. One
-- row may influence a future, not-yet-created Daily Mission choice set. It can
-- never rewrite an existing choice set or mission instance.
create table public.user_mission_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_focus_key text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint user_mission_preferences_focus_key_valid check (
    preferred_focus_key in (
      'career', 'business', 'programming', 'fitness', 'health', 'learning',
      'creativity', 'finance', 'relationships', 'mindset', 'general'
    )
  )
);

create trigger user_mission_preferences_set_updated_at
before update on public.user_mission_preferences
for each row execute function public.set_updated_at();

alter table public.user_mission_preferences enable row level security;

-- No policies are intentional. All reads and writes cross the narrow,
-- auth.uid()-derived RPC boundary below.
revoke all on public.user_mission_preferences from public, anon, authenticated;

create or replace function public.vault_mission_focus_label(p_focus_key text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_focus_key
    when 'career' then 'Career'
    when 'business' then 'Business'
    when 'programming' then 'Programming'
    when 'fitness' then 'Fitness'
    when 'health' then 'Health'
    when 'learning' then 'Learning'
    when 'creativity' then 'Creativity'
    when 'finance' then 'Finance'
    when 'relationships' then 'Relationships'
    when 'mindset' then 'Mindset'
    when 'general' then 'Personal Growth'
    else null
  end;
$$;

revoke all on function public.vault_mission_focus_label(text)
from public, anon, authenticated;

-- A retired preference cannot strand the Daily Mission engine. Only a focus
-- with an active template and active canonical skill is effective; otherwise
-- the existing onboarding normalization remains the safe fallback.
create or replace function public.vault_effective_mission_focus_key(
  p_user_id uuid,
  p_primary_focus text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preferred_focus_key text;
begin
  select preference.preferred_focus_key
  into v_preferred_focus_key
  from public.user_mission_preferences as preference
  where preference.user_id = p_user_id;

  if v_preferred_focus_key is not null and exists (
    select 1
    from public.mission_catalog as catalog
    join public.skill_catalog as skill
      on skill.skill_key = catalog.primary_skill_key
     and skill.active = true
    where catalog.focus_key = v_preferred_focus_key
      and catalog.active = true
  ) then
    return v_preferred_focus_key;
  end if;

  return public.vault_mission_focus_key(p_primary_focus);
end;
$$;

revoke all on function public.vault_effective_mission_focus_key(uuid, text)
from public, anon, authenticated;

-- Zero-argument owner restoration. It exposes focus labels and keys only,
-- never templates, rewards, selection metadata, or another user's identity.
create or replace function public.get_mission_customization()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_primary_focus text;
  v_onboarding_focus_key text;
  v_preferred_focus_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select onboarding.primary_focus
  into v_primary_focus
  from public.onboarding_profiles as onboarding
  where onboarding.user_id = v_user_id
    and onboarding.completed = true;

  if not found then
    raise exception 'Completed onboarding required' using errcode = '22023';
  end if;

  v_onboarding_focus_key := public.vault_mission_focus_key(v_primary_focus);

  select preference.preferred_focus_key
  into v_preferred_focus_key
  from public.user_mission_preferences as preference
  where preference.user_id = v_user_id;

  return jsonb_build_object(
    'accepted', true,
    'preferredFocusKey', v_preferred_focus_key,
    'preferredFocusName', public.vault_mission_focus_label(v_preferred_focus_key),
    'effectiveFocusKey', public.vault_effective_mission_focus_key(v_user_id, v_primary_focus),
    'onboardingFocusKey', v_onboarding_focus_key,
    'onboardingFocusName', public.vault_mission_focus_label(v_onboarding_focus_key),
    'effectiveTiming', 'next-uncreated-daily-choice',
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', available.focus_key,
        'name', public.vault_mission_focus_label(available.focus_key)
      ) order by available.display_order)
      from (
        select
          catalog.focus_key,
          min(case catalog.focus_key
            when 'career' then 10 when 'business' then 20
            when 'programming' then 30 when 'fitness' then 40
            when 'health' then 50 when 'learning' then 60
            when 'creativity' then 70 when 'finance' then 80
            when 'relationships' then 90 when 'mindset' then 100
            else 110 end) as display_order
        from public.mission_catalog as catalog
        join public.skill_catalog as skill
          on skill.skill_key = catalog.primary_skill_key
         and skill.active = true
        where catalog.active = true
        group by catalog.focus_key
      ) as available
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_mission_customization()
from public, anon, authenticated;
grant execute on function public.get_mission_customization() to authenticated;

-- The browser submits one allowlisted focus key. PostgreSQL independently
-- validates active catalog eligibility and writes preference state only.
create or replace function public.set_mission_customization(p_focus_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_focus_key text := lower(pg_catalog.btrim(coalesce(p_focus_key, '')));
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_focus_key not in (
    'career', 'business', 'programming', 'fitness', 'health', 'learning',
    'creativity', 'finance', 'relationships', 'mindset', 'general'
  ) or not exists (
    select 1
    from public.mission_catalog as catalog
    join public.skill_catalog as skill
      on skill.skill_key = catalog.primary_skill_key
     and skill.active = true
    where catalog.focus_key = v_focus_key
      and catalog.active = true
  ) then
    raise exception 'Canonical active mission focus required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':mission-customization', 0)
  );

  insert into public.user_mission_preferences (user_id, preferred_focus_key)
  values (v_user_id, v_focus_key)
  on conflict (user_id) do update
    set preferred_focus_key = excluded.preferred_focus_key;

  return public.get_mission_customization();
end;
$$;

revoke all on function public.set_mission_customization(text)
from public, anon, authenticated;
grant execute on function public.set_mission_customization(text) to authenticated;

comment on function public.set_mission_customization(text)
is 'Sprint 26 preference-only mutation. It creates no mission or choice set, awards no XP, and cannot alter current mission, history, capacity, lifecycle, streaks, or achievements.';

-- Preserve the Sprint 19 signature while selecting from the effective future
-- focus. The exact server-created choice array remains persisted once per day.
create or replace function public.build_vault_daily_mission_choices(
  p_onboarding public.onboarding_profiles,
  p_now timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_key date;
  v_focus_key text;
  v_focus text;
  v_difficulty text;
  v_choices jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_now is null then
    raise exception 'An authoritative server instant is required' using errcode = '22023';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, p_now);
  v_focus_key := public.vault_effective_mission_focus_key(
    v_user_id,
    p_onboarding.primary_focus
  );
  v_focus := public.vault_mission_focus_label(v_focus_key);
  v_difficulty := case lower(trim(p_onboarding.intensity))
    when 'focused' then 'Focused'
    when 'relentless' then 'Challenging'
    else 'Balanced'
  end;

  with usage_events as (
    select
      state.mission_definition ->> 'templateKey' as template_key,
      state.daily_key::timestamp as used_at
    from public.daily_mission_state as state
    where state.user_id = v_user_id
      and state.mission_definition ? 'templateKey'
    union all
    select history.template_key, history.terminal_at as used_at
    from public.mission_history as history
    where history.user_id = v_user_id
      and history.template_key is not null
  ), template_usage as (
    select events.template_key, max(events.used_at) as last_used_at
    from usage_events as events
    where events.template_key is not null
    group by events.template_key
  ), ranked as (
    select
      catalog.template_key,
      catalog.title,
      catalog.description,
      catalog.primary_skill_key,
      skill.display_name as primary_skill_name,
      catalog.estimated_minutes,
      row_number() over (order by
        case when usage.last_used_at is null then 0 else 1 end,
        usage.last_used_at asc nulls first,
        pg_catalog.hashtextextended(
          v_user_id::text || ':' || v_daily_key::text || ':' || catalog.template_key,
          0
        ),
        catalog.template_key
      ) as selection_rank
    from public.mission_catalog as catalog
    join public.skill_catalog as skill
      on skill.skill_key = catalog.primary_skill_key
     and skill.active = true
    left join template_usage as usage
      on usage.template_key = catalog.template_key
    where catalog.focus_key = v_focus_key
      and catalog.active = true
  ), selected as (
    select * from ranked where selection_rank <= 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'choiceId', extensions.gen_random_uuid()::text,
    'templateKey', selected.template_key,
    'focus', v_focus,
    'title', selected.title,
    'description', selected.description,
    'estimatedDuration', selected.estimated_minutes::text || ' minutes',
    'difficulty', v_difficulty,
    'xpReward', 25,
    'primarySkill', selected.primary_skill_key,
    'primarySkillName', selected.primary_skill_name
  ) order by selected.selection_rank), '[]'::jsonb)
  into v_choices
  from selected;

  return v_choices;
end;
$$;

revoke all on function public.build_vault_daily_mission_choices(
  public.onboarding_profiles, timestamptz
) from public, anon, authenticated;

-- Existing missions and existing persisted choices return before preference
-- lookup can affect generation. Only a genuinely absent owner/day slot uses
-- the current saved preference.
create or replace function public.request_daily_mission_at_sprint9(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_key date;
  v_focus_key text;
  v_onboarding public.onboarding_profiles%rowtype;
  v_state public.daily_mission_state%rowtype;
  v_choice_state public.daily_mission_choice_state%rowtype;
  v_choices jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_now is null then
    raise exception 'An authoritative server instant is required' using errcode = '22023';
  end if;

  select * into v_onboarding
  from public.onboarding_profiles
  where user_id = v_user_id and completed = true;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'onboarding-incomplete');
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, p_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text, 0)
  );

  with expired as (
    update public.daily_mission_state
    set lifecycle_state = 'expired',
        completion_awarded = false,
        terminal_at = p_now,
        terminal_recorded = true
    where user_id = v_user_id
      and daily_key < v_daily_key
      and lifecycle_state in ('ready', 'active')
    returning *
  )
  insert into public.mission_history (
    user_id, daily_session_id, mission_id, title, focus,
    final_state, xp_awarded, terminal_at
  )
  select user_id, daily_session_id, mission_definition ->> 'id',
    mission_definition ->> 'title', mission_definition ->> 'focus',
    'expired', 0, terminal_at
  from expired
  on conflict (user_id, daily_session_id, mission_id, terminal_at) do nothing;

  select * into v_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if found then
    return public.vault_daily_mission_response(v_state, true, 'existing', null);
  end if;

  select * into v_choice_state
  from public.daily_mission_choice_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if found then
    return public.vault_daily_mission_choice_response(v_choice_state, true, 'choice-required');
  end if;

  v_focus_key := public.vault_effective_mission_focus_key(
    v_user_id,
    v_onboarding.primary_focus
  );
  v_choices := public.build_vault_daily_mission_choices(v_onboarding, p_now);
  if jsonb_array_length(v_choices) = 0 then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'no-mission-choices',
      'dailyKey', v_daily_key::text
    );
  end if;

  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, 75)
  on conflict (user_id) do nothing;

  insert into public.daily_mission_choice_state (
    user_id, daily_key, focus_key, choices
  ) values (
    v_user_id,
    v_daily_key,
    v_focus_key,
    v_choices
  )
  on conflict (user_id, daily_key) do nothing;

  select * into strict v_choice_state
  from public.daily_mission_choice_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  return public.vault_daily_mission_choice_response(v_choice_state, true, 'choice-created');
end;
$$;

revoke all on function public.request_daily_mission_at_sprint9(timestamptz)
from public, anon, authenticated;

comment on function public.request_daily_mission_at_sprint9(timestamptz)
is 'Sprint 26 daily authority. Existing mission/choice state restores unchanged; only a missing future choice set uses the saved allowlisted focus preference.';

-- Reassert the table boundary after all functions exist.
revoke insert, update, delete, truncate, references, trigger
on public.user_mission_preferences from authenticated;
