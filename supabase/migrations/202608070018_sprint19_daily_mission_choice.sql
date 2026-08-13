-- KVNX Vault Sprint 19: server-authoritative primary Daily Mission Choice.
-- Apply after 202608070017_sprint18_achievement_center.sql.
-- Installed migrations 001-017 remain immutable. There is intentionally no 010.

-- One row preserves the exact options offered to one authenticated owner for
-- one authoritative logical Vault day. Browser roles never read or mutate the
-- persistence directly; the two RPCs below expose only the bounded public
-- snapshot and accept only an opaque offered choice UUID.
create table public.daily_mission_choice_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_key date not null,
  focus_key text not null,
  choices jsonb not null,
  selected_choice_id uuid,
  selected_template_key text references public.mission_catalog(template_key),
  created_at timestamptz not null default timezone('utc', now()),
  selected_at timestamptz,
  primary key (user_id, daily_key),
  constraint daily_mission_choice_state_choices_array
    check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 1 and 3),
  constraint daily_mission_choice_state_selection_consistent
    check (
      (selected_choice_id is null and selected_template_key is null and selected_at is null)
      or
      (selected_choice_id is not null and selected_template_key is not null and selected_at is not null)
    )
);

create index daily_mission_choice_state_user_day_desc_idx
  on public.daily_mission_choice_state(user_id, daily_key desc);

alter table public.daily_mission_choice_state enable row level security;

-- No table policy is intentional. The authenticated browser consumes this
-- state only through owner-derived SECURITY DEFINER functions.
revoke all on public.daily_mission_choice_state from public, anon, authenticated;

-- Build up to three choices from the same saved-focus/catalog/history model as
-- Sprint 15. The exact server-created array is persisted once under the daily
-- advisory lock, so refresh, navigation, login restoration, and concurrent
-- requests cannot reroll it.
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
  v_focus text := nullif(trim(p_onboarding.primary_focus), '');
  v_focus_key text;
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
  v_focus_key := public.vault_mission_focus_key(v_focus);
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
    'focus', coalesce(v_focus, 'Personal Growth'),
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

comment on function public.build_vault_daily_mission_choices(
  public.onboarding_profiles, timestamptz
)
is 'Sprint 19 internal bounded choice selector. Uses auth.uid(), saved focus, authoritative logical day, active catalog, canonical skills, and recent authoritative usage.';

-- Remove templateKey before the choice snapshot crosses the browser boundary.
-- The opaque choiceId is the only value accepted back by selection authority.
create or replace function public.vault_daily_mission_choice_response(
  p_state public.daily_mission_choice_state,
  p_accepted boolean,
  p_reason text
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
    'choiceRequired', true,
    'choices', coalesce((
      select jsonb_agg(offered.option - 'templateKey' order by offered.position)
      from jsonb_array_elements(p_state.choices)
        with ordinality as offered(option, position)
    ), '[]'::jsonb),
    'dailyStatus', jsonb_build_object(
      'replacementsUsed', 0,
      'replacementsRemaining', 1
    )
  );
$$;

revoke all on function public.vault_daily_mission_choice_response(
  public.daily_mission_choice_state, boolean, text
) from public, anon, authenticated;

-- Replace only the internal daily engine preserved by Sprint 9.2. Existing
-- rows still restore exactly as before. A missing row now creates/restores a
-- persisted choice set instead of immediately creating a mission.
create or replace function public.request_daily_mission_at_sprint9(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_daily_key date;
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

  -- Rollover remains identical: only stale real missions can expire or create
  -- lifecycle history. Unselected choice rows create no mission history.
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

  v_choices := public.build_vault_daily_mission_choices(v_onboarding, p_now);
  if jsonb_array_length(v_choices) = 0 then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'no-mission-choices',
      'dailyKey', v_daily_key::text
    );
  end if;

  -- Preserve the existing authoritative account baseline before UI restoration.
  -- This is initialization, not a choice reward or a progression mutation.
  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, 75)
  on conflict (user_id) do nothing;

  insert into public.daily_mission_choice_state (
    user_id, daily_key, focus_key, choices
  ) values (
    v_user_id,
    v_daily_key,
    public.vault_mission_focus_key(v_onboarding.primary_focus),
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
is 'Sprint 19 internal daily authority. Existing missions restore unchanged; otherwise a stable bounded owner/day choice set is returned.';

-- The browser supplies only one opaque offered UUID. All content, ownership,
-- logical time, membership, reward, skill, lifecycle, and mission identity are
-- independently restored from server-owned rows under the same daily lock.
create or replace function public.select_daily_mission_choice(p_choice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_state public.daily_mission_state%rowtype;
  v_choice_state public.daily_mission_choice_state%rowtype;
  v_offered jsonb;
  v_definition jsonb;
  v_template_key text;
  v_skill_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_choice_id is null then
    return jsonb_build_object('accepted', false, 'reason', 'invalid-choice');
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_daily_key::text, 0)
  );

  select * into v_choice_state
  from public.daily_mission_choice_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  select * into v_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  if found then
    if v_choice_state.selected_choice_id = p_choice_id then
      return public.vault_daily_mission_response(
        v_state, true, 'existing-selection', null
      ) || jsonb_build_object(
        'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
      );
    end if;
    return public.vault_daily_mission_response(
      v_state, false, 'mission-already-selected', null
    ) || jsonb_build_object(
      'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
    );
  end if;

  if v_choice_state.user_id is null then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'choice-set-not-found',
      'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
    );
  end if;
  if v_choice_state.selected_choice_id is not null then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'choice-already-consumed',
      'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
    );
  end if;

  select offered.option
  into v_offered
  from jsonb_array_elements(v_choice_state.choices) as offered(option)
  where offered.option ->> 'choiceId' = p_choice_id::text;

  if not found then
    return public.vault_daily_mission_choice_response(
      v_choice_state, false, 'choice-not-offered'
    ) || jsonb_build_object(
      'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
    );
  end if;

  v_template_key := nullif(trim(v_offered ->> 'templateKey'), '');
  v_skill_key := nullif(trim(v_offered ->> 'primarySkill'), '');
  if v_template_key is null
     or v_skill_key is null
     or nullif(trim(v_offered ->> 'title'), '') is null
     or nullif(trim(v_offered ->> 'description'), '') is null
     or nullif(trim(v_offered ->> 'estimatedDuration'), '') is null
     or nullif(trim(v_offered ->> 'difficulty'), '') is null
     or jsonb_typeof(v_offered -> 'xpReward') <> 'number'
     or (v_offered ->> 'xpReward')::integer <> 25
     or not exists (
       select 1 from public.mission_catalog as catalog
       where catalog.template_key = v_template_key and catalog.active = true
     )
     or not exists (
       select 1 from public.skill_catalog as skill
       where skill.skill_key = v_skill_key and skill.active = true
     ) then
    raise exception 'Invalid authoritative mission choice snapshot'
      using errcode = '22023';
  end if;

  v_definition := jsonb_build_object(
    'id', v_template_key || '-' || extensions.gen_random_uuid()::text,
    'templateKey', v_template_key,
    'focus', v_offered ->> 'focus',
    'title', v_offered ->> 'title',
    'description', v_offered ->> 'description',
    'estimatedDuration', v_offered ->> 'estimatedDuration',
    'difficulty', v_offered ->> 'difficulty',
    'xpReward', 25,
    'primarySkill', v_skill_key
  );

  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, 75)
  on conflict (user_id) do nothing;

  insert into public.daily_mission_state (
    user_id, daily_key, daily_session_id, mission_definition,
    lifecycle_state, completion_awarded, replacements_used,
    terminal_at, terminal_recorded
  ) values (
    v_user_id, v_daily_key, v_daily_key::text, v_definition,
    'ready', false, 0, null, false
  );

  update public.daily_mission_choice_state
  set selected_choice_id = p_choice_id,
      selected_template_key = v_template_key,
      selected_at = v_now
  where user_id = v_user_id and daily_key = v_daily_key;

  select * into strict v_state
  from public.daily_mission_state
  where user_id = v_user_id and daily_key = v_daily_key
  for update;

  return public.vault_daily_mission_response(v_state, true, 'selected', null)
    || jsonb_build_object(
      'nextResetAt', public.next_vault_reset_at(v_user_id, v_now)
    );
end;
$$;

revoke all on function public.select_daily_mission_choice(uuid) from public, anon;
grant execute on function public.select_daily_mission_choice(uuid) to authenticated;

comment on function public.select_daily_mission_choice(uuid)
is 'Sprint 19 minimal intent-only selection. Accepts one opaque offered UUID; derives owner, day, template snapshot, skill, reward, lifecycle, and mission UUID on the server.';

-- Reassert the complete browser boundary. Choice persistence and all existing
-- authoritative progression stores remain RPC-owned.
alter table public.daily_mission_choice_state enable row level security;
revoke all on public.daily_mission_choice_state from public, anon, authenticated;
revoke insert, update, delete on public.daily_mission_state from authenticated;
revoke insert, update, delete on public.mission_history from authenticated;
revoke insert, update, delete on public.progression_state from authenticated;
revoke insert, update, delete on public.skill_progression from authenticated;
revoke insert, update, delete on public.user_achievements from authenticated;
revoke insert, update, delete on public.user_streak_state from authenticated;
