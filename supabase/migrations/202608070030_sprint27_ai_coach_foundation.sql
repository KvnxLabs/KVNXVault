-- KVNX Vault Sprint 27: advisory AI Coach foundation.
-- Apply after 202608070029_sprint26_1_customization_option_filtering.sql.
-- Historical migrations 001-029 remain immutable. There is intentionally no 010.

-- The Coach context is a bounded, read-only projection built from authoritative
-- owner data. The browser supplies presentation intent only; it cannot supply
-- identity, progression, mission state, rewards, history, or operational data.
create or replace function public.get_vault_coach_context(
  p_mode text default 'overview'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_mode text := lower(pg_catalog.btrim(coalesce(p_mode, '')));
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_primary_focus text;
  v_onboarding_focus_key text;
  v_effective_focus_key text;
  v_daily public.daily_mission_state%rowtype;
  v_side public.side_mission_state%rowtype;
  v_choice_required boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_mode not in ('overview', 'next_step', 'skill_focus', 'consistency') then
    raise exception 'Supported Coach mode required' using errcode = '22023';
  end if;

  select onboarding.primary_focus
  into v_primary_focus
  from public.onboarding_profiles as onboarding
  where onboarding.user_id = v_user_id
    and onboarding.completed = true;

  if not found then
    raise exception 'Completed onboarding required' using errcode = '22023';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  v_onboarding_focus_key := public.vault_mission_focus_key(v_primary_focus);
  v_effective_focus_key := public.vault_effective_mission_focus_key(
    v_user_id,
    v_primary_focus
  );

  select state.*
  into v_daily
  from public.daily_mission_state as state
  where state.user_id = v_user_id
    and state.daily_key = v_daily_key;

  if not found then
    select exists (
      select 1
      from public.daily_mission_choice_state as choice
      where choice.user_id = v_user_id
        and choice.daily_key = v_daily_key
        and choice.selected_choice_id is null
    ) into v_choice_required;
  end if;

  select state.*
  into v_side
  from public.side_mission_state as state
  where state.user_id = v_user_id
    and state.daily_key = v_daily_key;

  return jsonb_build_object(
    'accepted', true,
    'contextVersion', 1,
    'mode', v_mode,
    'generatedAt', v_now,
    'progression', jsonb_build_object(
      'totalXP', coalesce((
        select progression.total_xp
        from public.progression_state as progression
        where progression.user_id = v_user_id
      ), 75)
    ),
    'skills', jsonb_build_object(
      'activeCount', (
        select count(*)::integer
        from public.skill_progression as progression
        where progression.user_id = v_user_id
          and progression.skill_xp > 0
      ),
      'totalSkillXP', coalesce((
        select sum(progression.skill_xp)::integer
        from public.skill_progression as progression
        where progression.user_id = v_user_id
      ), 0),
      'top', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', ranked.skill_key,
          'name', ranked.display_name,
          'totalXP', ranked.skill_xp
        ) order by ranked.skill_xp desc, ranked.sort_order, ranked.skill_key)
        from (
          select progression.skill_key, catalog.display_name,
            catalog.sort_order, progression.skill_xp
          from public.skill_progression as progression
          join public.skill_catalog as catalog
            on catalog.skill_key = progression.skill_key
          where progression.user_id = v_user_id
            and progression.skill_xp > 0
          order by progression.skill_xp desc, catalog.sort_order, progression.skill_key
          limit 5
        ) as ranked
      ), '[]'::jsonb)
    ),
    'dailyMission', case
      when v_daily.user_id is not null then jsonb_build_object(
        'availability', 'mission',
        'lifecycleState', v_daily.lifecycle_state,
        'title', left(coalesce(v_daily.mission_definition ->> 'title', ''), 160),
        'focusKey', public.vault_mission_focus_key(
          v_daily.mission_definition ->> 'focus'
        ),
        'focusName', public.vault_mission_focus_label(public.vault_mission_focus_key(
          v_daily.mission_definition ->> 'focus'
        )),
        'primarySkillName', coalesce((
          select catalog.display_name
          from public.skill_catalog as catalog
          where catalog.skill_key = v_daily.mission_definition ->> 'primarySkill'
        ), '')
      )
      when v_choice_required then jsonb_build_object(
        'availability', 'choice_required',
        'lifecycleState', null,
        'title', null,
        'focusKey', v_effective_focus_key,
        'focusName', public.vault_mission_focus_label(v_effective_focus_key),
        'primarySkillName', null
      )
      else jsonb_build_object(
        'availability', 'unavailable',
        'lifecycleState', null,
        'title', null,
        'focusKey', v_effective_focus_key,
        'focusName', public.vault_mission_focus_label(v_effective_focus_key),
        'primarySkillName', null
      )
    end,
    'customization', jsonb_build_object(
      'effectiveFocusKey', v_effective_focus_key,
      'effectiveFocusName', public.vault_mission_focus_label(v_effective_focus_key),
      'onboardingFocusKey', v_onboarding_focus_key,
      'onboardingFocusName', public.vault_mission_focus_label(v_onboarding_focus_key)
    ),
    'sideMission', case when v_side.user_id is null then null else jsonb_build_object(
      'lifecycleState', v_side.lifecycle_state,
      'title', left(coalesce(v_side.mission_definition ->> 'title', ''), 160),
      'skillName', coalesce((
        select catalog.display_name
        from public.skill_catalog as catalog
        where catalog.skill_key = v_side.skill_key
      ), '')
    ) end,
    'skillPaths', jsonb_build_object(
      'activeCount', (
        select count(*)::integer
        from public.user_skill_paths as path
        join public.skill_catalog as catalog
          on catalog.skill_key = path.skill_key
         and catalog.active = true
        where path.user_id = v_user_id
          and path.path_active = true
      ),
      'active', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', active.skill_key,
          'name', active.display_name
        ) order by active.sort_order, active.skill_key)
        from (
          select path.skill_key, catalog.display_name, catalog.sort_order
          from public.user_skill_paths as path
          join public.skill_catalog as catalog
            on catalog.skill_key = path.skill_key
           and catalog.active = true
          where path.user_id = v_user_id
            and path.path_active = true
          order by catalog.sort_order, path.skill_key
          limit 12
        ) as active
      ), '[]'::jsonb)
    ),
    'recent', jsonb_build_object(
      'completedCount', (
        select count(*)::integer
        from (
          select history.id
          from public.mission_history as history
          where history.user_id = v_user_id
            and history.final_state = 'completed'
          order by history.terminal_at desc, history.id desc
          limit 20
        ) as recent_history
      ),
      'dailyCompleted', (
        select count(*)::integer
        from (
          select history.mission_type
          from public.mission_history as history
          where history.user_id = v_user_id
            and history.final_state = 'completed'
          order by history.terminal_at desc, history.id desc
          limit 20
        ) as recent_history
        where recent_history.mission_type = 'daily'
      ),
      'sideCompleted', (
        select count(*)::integer
        from (
          select history.mission_type
          from public.mission_history as history
          where history.user_id = v_user_id
            and history.final_state = 'completed'
          order by history.terminal_at desc, history.id desc
          limit 20
        ) as recent_history
        where recent_history.mission_type = 'side'
      ),
      'skillDistribution', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', distribution.skill_key,
          'name', distribution.display_name,
          'skillXP', distribution.skill_xp
        ) order by distribution.skill_xp desc, distribution.sort_order, distribution.skill_key)
        from (
          select recent.skill_key, catalog.display_name, catalog.sort_order,
            sum(recent.skill_xp_awarded)::integer as skill_xp
          from (
            select history.skill_key, history.skill_xp_awarded
            from public.mission_history as history
            where history.user_id = v_user_id
              and history.final_state = 'completed'
              and history.skill_key is not null
              and history.skill_xp_awarded > 0
            order by history.terminal_at desc, history.id desc
            limit 20
          ) as recent
          join public.skill_catalog as catalog on catalog.skill_key = recent.skill_key
          group by recent.skill_key, catalog.display_name, catalog.sort_order
          order by sum(recent.skill_xp_awarded) desc, catalog.sort_order, recent.skill_key
          limit 5
        ) as distribution
      ), '[]'::jsonb)
    ),
    'streak', jsonb_build_object(
      'current', coalesce((
        select state.current_streak
        from public.user_streak_state as state
        where state.user_id = v_user_id
      ), 0),
      'longest', coalesce((
        select state.longest_streak
        from public.user_streak_state as state
        where state.user_id = v_user_id
      ), 0)
    ),
    'achievements', jsonb_build_object(
      'unlockedCount', (
        select count(*)::integer
        from public.user_achievements as achievement
        where achievement.user_id = v_user_id
      ),
      'totalCount', (select count(*)::integer from public.achievement_catalog)
    )
  );
end;
$$;

revoke all on function public.get_vault_coach_context(text)
from public, anon, authenticated;
grant execute on function public.get_vault_coach_context(text) to authenticated;

comment on function public.get_vault_coach_context(text)
is 'Sprint 27 authenticated, bounded, read-only advisory context. Returns no IDs, auth data, operational data, or mutation authority and performs no gameplay writes.';
