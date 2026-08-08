-- KVNX Vault Sprint 12: authoritative Vault History & Legacy.
-- Apply after Sprint 11 migration 011. It is also compatible with staging
-- databases that additionally installed the staging-only migration 012.
-- All installed migrations remain immutable.

-- Preserve archival details that cannot be reconstructed after the single
-- current daily_mission_state row advances to another mission.
alter table public.mission_history
  add column mission_description text,
  add column original_state text,
  add constraint mission_history_original_state_valid
    check (original_state is null or original_state in ('ready', 'active'));

comment on column public.mission_history.mission_description
is 'Authoritative mission description captured from daily_mission_state at terminal history insertion. Null on older rows when the original definition is no longer available.';

comment on column public.mission_history.original_state
is 'Authoritative lifecycle state immediately before completion or skip. Null on older rows that cannot be reconstructed safely.';

-- The existing (user_id, terminal_at desc) index from migration 001 already
-- supports newest-first owner retrieval. No duplicate index is added.

create or replace function public.capture_vault_history_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text;
  v_original_state text;
begin
  select
    state.mission_definition ->> 'description',
    state.lifecycle_state
  into v_description, v_original_state
  from public.daily_mission_state as state
  where state.user_id = new.user_id
    and state.mission_definition ->> 'id' = new.mission_id;

  if new.mission_description is null then
    new.mission_description := nullif(trim(v_description), '');
  end if;

  if new.original_state is null and v_original_state in ('ready', 'active') then
    new.original_state := v_original_state;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_vault_history_details() from public, anon, authenticated;

create trigger mission_history_capture_archive_details
before insert on public.mission_history
for each row execute function public.capture_vault_history_details();

-- Safely restore descriptions only for historical rows whose mission is still
-- the authenticated account's saved current definition. Original pre-terminal
-- state is deliberately not backfilled because it cannot be proven afterward.
update public.mission_history as history
set mission_description = nullif(trim(state.mission_definition ->> 'description'), '')
from public.daily_mission_state as state
where history.user_id = state.user_id
  and history.mission_id = state.mission_definition ->> 'id'
  and history.mission_description is null;

-- Exact zero-argument, owner-derived, read-only restoration contract. The
-- function returns a relation so PostgREST/Supabase range windows can paginate
-- it without accepting an ownership argument. The client requests page_size+1
-- rows and uses the extra row only to determine whether another page exists.
create or replace function public.get_vault_history()
returns table (
  "historyId" uuid,
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

revoke all on function public.get_vault_history() from public, anon;
grant execute on function public.get_vault_history() to authenticated;

comment on function public.get_vault_history()
is 'Sprint 12 read-only permanent Vault archive. Exact zero-argument auth.uid()-owned result, newest first, range-pageable, and sourced only from authoritative mission history.';

-- Reassert the existing authority boundary after the schema extension.
alter table public.mission_history enable row level security;
revoke insert, update, delete on public.mission_history from authenticated;
