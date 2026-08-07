-- KVNX Vault Sprint 7: durable identity and user-owned state.
-- Run with the Supabase SQL Editor or CLI. Never place service-role keys here.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 40),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.onboarding_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  focus text[] not null default '{}',
  primary_focus text not null check (char_length(primary_focus) between 1 and 60),
  current_stage text not null check (char_length(current_stage) between 1 and 60),
  biggest_challenge text not null check (char_length(biggest_challenge) between 1 and 80),
  daily_commitment text not null check (char_length(daily_commitment) between 1 and 40),
  future_vision text not null default '' check (char_length(future_vision) <= 500),
  intensity text not null check (intensity in ('Balanced', 'Focused', 'Relentless')),
  completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (cardinality(focus) between 1 and 3)
);

create table public.progression_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp integer not null default 75 check (total_xp >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.daily_mission_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_session_id text not null check (char_length(daily_session_id) between 10 and 120),
  mission_definition jsonb not null,
  lifecycle_state text not null check (lifecycle_state in ('ready', 'active', 'completed', 'skipped', 'expired')),
  completion_awarded boolean not null default false,
  replacements_used smallint not null default 0 check (replacements_used between 0 and 1),
  terminal_at timestamptz,
  terminal_recorded boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (jsonb_typeof(mission_definition) = 'object'),
  check (mission_definition ?& array['id', 'focus', 'title', 'description', 'estimatedDuration', 'difficulty', 'xpReward']),
  check (not completion_awarded or lifecycle_state = 'completed'),
  check ((lifecycle_state in ('completed', 'skipped', 'expired')) = (terminal_at is not null)),
  check (not terminal_recorded or lifecycle_state in ('completed', 'skipped', 'expired'))
);

create table public.mission_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_session_id text not null check (char_length(daily_session_id) between 10 and 120),
  mission_id text not null check (char_length(mission_id) between 1 and 160),
  title text not null check (char_length(title) between 1 and 160),
  focus text not null check (char_length(focus) between 1 and 100),
  final_state text not null check (final_state in ('completed', 'skipped', 'expired')),
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  terminal_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, daily_session_id, mission_id, terminal_at),
  check ((final_state = 'completed') or xp_awarded = 0)
);

create index onboarding_profiles_user_id_idx on public.onboarding_profiles(user_id);
create index progression_state_user_id_idx on public.progression_state(user_id);
create index daily_mission_state_user_id_idx on public.daily_mission_state(user_id);
create index mission_history_user_id_terminal_at_idx on public.mission_history(user_id, terminal_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger onboarding_profiles_set_updated_at before update on public.onboarding_profiles
for each row execute function public.set_updated_at();
create trigger progression_state_set_updated_at before update on public.progression_state
for each row execute function public.set_updated_at();
create trigger daily_mission_state_set_updated_at before update on public.daily_mission_state
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, first_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Builder'), 40))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.onboarding_profiles enable row level security;
alter table public.progression_state enable row level security;
alter table public.daily_mission_state enable row level security;
alter table public.mission_history enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "onboarding_select_own" on public.onboarding_profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy "onboarding_insert_own" on public.onboarding_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "onboarding_update_own" on public.onboarding_profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "progression_select_own" on public.progression_state for select to authenticated
using ((select auth.uid()) = user_id);
create policy "progression_insert_own" on public.progression_state for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "progression_update_own" on public.progression_state for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "daily_mission_select_own" on public.daily_mission_state for select to authenticated
using ((select auth.uid()) = user_id);
create policy "daily_mission_insert_own" on public.daily_mission_state for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "daily_mission_update_own" on public.daily_mission_state for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "mission_history_select_own" on public.mission_history for select to authenticated
using ((select auth.uid()) = user_id);
create policy "mission_history_insert_own" on public.mission_history for insert to authenticated
with check ((select auth.uid()) = user_id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.onboarding_profiles to authenticated;
grant select, insert, update on public.progression_state to authenticated;
grant select, insert, update on public.daily_mission_state to authenticated;
grant select, insert on public.mission_history to authenticated;

-- Atomically persists one validated client-side lifecycle transition. Ownership
-- comes exclusively from auth.uid(); no user id is accepted as an argument.
create or replace function public.persist_vault_transition(
  p_daily_session_id text,
  p_mission_definition jsonb,
  p_lifecycle_state text,
  p_completion_awarded boolean,
  p_replacements_used smallint,
  p_terminal_at timestamptz,
  p_total_xp integer,
  p_history_record jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.daily_mission_state (
    user_id, daily_session_id, mission_definition, lifecycle_state,
    completion_awarded, replacements_used, terminal_at, terminal_recorded
  ) values (
    v_user_id, p_daily_session_id, p_mission_definition, p_lifecycle_state,
    p_completion_awarded, p_replacements_used, p_terminal_at, p_history_record is not null
  )
  on conflict (user_id) do update set
    daily_session_id = excluded.daily_session_id,
    mission_definition = excluded.mission_definition,
    lifecycle_state = excluded.lifecycle_state,
    completion_awarded = excluded.completion_awarded,
    replacements_used = excluded.replacements_used,
    terminal_at = excluded.terminal_at,
    terminal_recorded = excluded.terminal_recorded;

  insert into public.progression_state (user_id, total_xp)
  values (v_user_id, p_total_xp)
  on conflict (user_id) do update set total_xp = excluded.total_xp;

  if p_history_record is not null then
    insert into public.mission_history (
      user_id, daily_session_id, mission_id, title, focus,
      final_state, xp_awarded, terminal_at
    ) values (
      v_user_id,
      p_daily_session_id,
      p_history_record ->> 'missionId',
      p_history_record ->> 'title',
      p_history_record ->> 'focus',
      p_history_record ->> 'finalState',
      coalesce((p_history_record ->> 'xpAwarded')::integer, 0),
      (p_history_record ->> 'terminalAt')::timestamptz
    )
    on conflict (user_id, daily_session_id, mission_id, terminal_at) do nothing;
  end if;
end;
$$;

revoke all on function public.persist_vault_transition(text, jsonb, text, boolean, smallint, timestamptz, integer, jsonb) from public;
revoke all on function public.persist_vault_transition(text, jsonb, text, boolean, smallint, timestamptz, integer, jsonb) from anon;
grant execute on function public.persist_vault_transition(text, jsonb, text, boolean, smallint, timestamptz, integer, jsonb) to authenticated;
