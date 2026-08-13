-- KVNX Vault Sprint 21: server-authoritative Skill Path mission offers.
-- Apply after 202608070019_sprint20_skill_paths.sql.
-- Installed migrations 001-019 remain immutable. There is intentionally no 010.

-- Path-only templates must not enter Sprint 19 onboarding-focus choice pools.
alter table public.mission_catalog
  drop constraint mission_catalog_focus_key_valid;

alter table public.mission_catalog
  add constraint mission_catalog_focus_key_valid
  check (focus_key in (
    'career', 'business', 'programming', 'fitness', 'health', 'learning',
    'creativity', 'finance', 'relationships', 'mindset', 'general', 'skill_path'
  ));

-- Migration 016 already has at least five eligible templates for nine skills.
-- These path-only rows complete canonical coverage without changing primary
-- Daily Mission Choice pools because no onboarding focus maps to skill_path.
insert into public.mission_catalog (
  template_key, focus_key, title, description, primary_skill_key, estimated_minutes
) values
  ('path-backend-api-contract', 'skill_path', 'Strengthen an API Contract', 'Review one API boundary and improve its validation, clarity, or failure behavior.', 'back_end_engineering', 30),
  ('path-backend-query', 'skill_path', 'Improve One Data Query', 'Inspect one database query and make a measured improvement to correctness or efficiency.', 'back_end_engineering', 30),
  ('path-backend-service', 'skill_path', 'Refine a Service Boundary', 'Choose one service responsibility and make its inputs, outputs, or ownership clearer.', 'back_end_engineering', 30),
  ('path-backend-test', 'skill_path', 'Test a Server Edge Case', 'Add one focused test for a server-side failure, boundary, or concurrency condition.', 'back_end_engineering', 25),
  ('path-backend-observability', 'skill_path', 'Improve Operational Visibility', 'Add or refine one useful log, metric, or diagnostic signal for a backend workflow.', 'back_end_engineering', 25),
  ('path-backend-reliability', 'skill_path', 'Harden One Backend Flow', 'Identify one reliability risk and complete a concrete improvement that reduces it.', 'back_end_engineering', 30),

  ('path-reading-focused', 'skill_path', 'Complete a Focused Reading Session', 'Read one meaningful section without distraction and capture its central idea.', 'reading', 25),
  ('path-reading-argument', 'skill_path', 'Trace the Core Argument', 'Identify the author’s main claim and the evidence used to support it.', 'reading', 25),
  ('path-reading-annotation', 'skill_path', 'Annotate What Matters', 'Mark the most useful passages from one reading session and explain why they matter.', 'reading', 20),
  ('path-reading-compare', 'skill_path', 'Compare Two Ideas', 'Connect two ideas from your reading and write the important similarity or tension.', 'reading', 25),
  ('path-reading-recall', 'skill_path', 'Recall Without the Page', 'Close the source and reconstruct the key points from your reading in your own words.', 'reading', 20),
  ('path-reading-apply', 'skill_path', 'Apply One Reading Insight', 'Choose one useful idea from your reading and define a concrete way to use it.', 'reading', 25),

  ('path-writing-clear-draft', 'skill_path', 'Write One Clear Draft', 'Complete a focused draft that communicates one central idea without unnecessary detail.', 'writing', 30),
  ('path-writing-revise', 'skill_path', 'Strengthen a Weak Passage', 'Revise one passage for clearer structure, sharper language, and stronger intent.', 'writing', 25),
  ('path-writing-outline', 'skill_path', 'Build a Strong Outline', 'Organize one writing objective into a deliberate sequence before drafting.', 'writing', 20),
  ('path-writing-edit', 'skill_path', 'Complete a Precision Edit', 'Edit one finished section for clarity, rhythm, correctness, and unnecessary words.', 'writing', 25),
  ('path-writing-explain', 'skill_path', 'Explain One Complex Idea', 'Write a concise explanation of one difficult idea for a reader new to the subject.', 'writing', 30),
  ('path-writing-finish', 'skill_path', 'Finish One Written Piece', 'Move one incomplete written work to a deliberate, reviewable finish.', 'writing', 30);

-- One row preserves the exact offers for one owner, logical day, and skill.
-- Selection is only planned state; it is not a mission lifecycle or reward row.
create table public.skill_path_mission_offer_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_key date not null,
  skill_key text not null references public.skill_catalog(skill_key),
  offers jsonb not null,
  selected_offer_id uuid,
  selected_template_key text references public.mission_catalog(template_key),
  created_at timestamptz not null default timezone('utc', now()),
  selected_at timestamptz,
  primary key (user_id, daily_key, skill_key),
  constraint skill_path_mission_offers_array check (
    jsonb_typeof(offers) = 'array' and jsonb_array_length(offers) between 0 and 3
  ),
  constraint skill_path_mission_offer_selection_consistent check (
    (selected_offer_id is null and selected_template_key is null and selected_at is null)
    or
    (selected_offer_id is not null and selected_template_key is not null and selected_at is not null)
  )
);

create index skill_path_mission_offer_state_owner_day_idx
  on public.skill_path_mission_offer_state(user_id, daily_key desc, skill_key);

alter table public.skill_path_mission_offer_state enable row level security;
revoke all on public.skill_path_mission_offer_state from public, anon, authenticated;

create or replace function public.vault_skill_path_offer_response(
  p_state public.skill_path_mission_offer_state,
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
    'skillKey', p_state.skill_key,
    'skillName', catalog.display_name,
    'status', case when p_state.selected_offer_id is null then 'offered' else 'planned' end,
    'offers', coalesce((
      select jsonb_agg(offered.option - 'templateKey' order by offered.position)
      from jsonb_array_elements(p_state.offers)
        with ordinality as offered(option, position)
    ), '[]'::jsonb),
    'selectedOfferId', case when p_state.selected_offer_id is null then null else to_jsonb(p_state.selected_offer_id::text) end,
    'selectedAt', case when p_state.selected_at is null then null else to_jsonb(p_state.selected_at) end
  )
  from public.skill_catalog as catalog
  where catalog.skill_key = p_state.skill_key;
$$;

revoke all on function public.vault_skill_path_offer_response(
  public.skill_path_mission_offer_state, boolean, text
) from public, anon, authenticated;

create or replace function public.build_skill_path_mission_offers(
  p_skill_key text,
  p_daily_key date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_offers jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with usage_events as (
    select history.template_key, history.terminal_at as used_at
    from public.mission_history as history
    where history.user_id = v_user_id and history.template_key is not null
    union all
    select offered.option ->> 'templateKey', state.created_at
    from public.skill_path_mission_offer_state as state
    cross join lateral jsonb_array_elements(state.offers) as offered(option)
    where state.user_id = v_user_id and state.daily_key < p_daily_key
  ), template_usage as (
    select event.template_key, max(event.used_at) as last_used_at
    from usage_events as event
    where event.template_key is not null
    group by event.template_key
  ), ranked as (
    select
      catalog.template_key,
      catalog.title,
      catalog.description,
      catalog.estimated_minutes,
      skill.display_name as skill_name,
      row_number() over (order by
        case when usage.last_used_at is null then 0 else 1 end,
        usage.last_used_at asc nulls first,
        pg_catalog.hashtextextended(
          v_user_id::text || ':' || p_daily_key::text || ':' || p_skill_key || ':' || catalog.template_key,
          0
        ),
        catalog.template_key
      ) as offer_rank
    from public.mission_catalog as catalog
    join public.skill_catalog as skill
      on skill.skill_key = catalog.primary_skill_key and skill.active = true
    left join template_usage as usage on usage.template_key = catalog.template_key
    where catalog.primary_skill_key = p_skill_key and catalog.active = true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'offerId', extensions.gen_random_uuid()::text,
    'templateKey', ranked.template_key,
    'title', ranked.title,
    'description', ranked.description,
    'estimatedDuration', ranked.estimated_minutes::text || ' minutes',
    'skillKey', p_skill_key,
    'skillName', ranked.skill_name
  ) order by ranked.offer_rank), '[]'::jsonb)
  into v_offers
  from ranked
  where ranked.offer_rank <= 3;

  return v_offers;
end;
$$;

revoke all on function public.build_skill_path_mission_offers(text, date)
from public, anon, authenticated;

-- Zero-argument restoration returns only today’s states whose path remains
-- active. Paused paths never leak a cached usable offer set to the browser.
create or replace function public.get_skill_path_mission_offers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);

  return coalesce((
    select jsonb_agg(
      public.vault_skill_path_offer_response(state, true, 'restored')
      order by catalog.sort_order
    )
    from public.skill_path_mission_offer_state as state
    join public.user_skill_paths as path
      on path.user_id = state.user_id and path.skill_key = state.skill_key
     and path.path_active = true
    join public.skill_catalog as catalog
      on catalog.skill_key = state.skill_key and catalog.active = true
    where state.user_id = v_user_id and state.daily_key = v_daily_key
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_skill_path_mission_offers()
from public, anon, authenticated;
grant execute on function public.get_skill_path_mission_offers() to authenticated;

create or replace function public.request_skill_path_mission_offers(p_skill_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_skill_key text := lower(trim(coalesce(p_skill_key, '')));
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_state public.skill_path_mission_offer_state%rowtype;
  v_offers jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.skill_catalog as catalog
    where catalog.skill_key = v_skill_key and catalog.active = true
  ) then
    raise exception 'Canonical active skill required' using errcode = '22023';
  end if;

  -- Share Sprint 20's owner/skill lock so pause and offer creation cannot race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':skill-path:' || v_skill_key, 0)
  );

  if not exists (
    select 1 from public.user_skill_paths as path
    where path.user_id = v_user_id and path.skill_key = v_skill_key
      and path.path_active = true
  ) then
    raise exception 'Active Skill Path required' using errcode = '42501';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_user_id::text || ':' || v_daily_key::text || ':skill-path-offers:' || v_skill_key, 0
  ));

  select * into v_state
  from public.skill_path_mission_offer_state
  where user_id = v_user_id and daily_key = v_daily_key and skill_key = v_skill_key
  for update;

  if found then
    return public.vault_skill_path_offer_response(v_state, true, 'restored');
  end if;

  v_offers := public.build_skill_path_mission_offers(v_skill_key, v_daily_key);
  insert into public.skill_path_mission_offer_state (
    user_id, daily_key, skill_key, offers
  ) values (v_user_id, v_daily_key, v_skill_key, v_offers)
  on conflict (user_id, daily_key, skill_key) do nothing;

  select * into strict v_state
  from public.skill_path_mission_offer_state
  where user_id = v_user_id and daily_key = v_daily_key and skill_key = v_skill_key
  for update;

  return public.vault_skill_path_offer_response(
    v_state, true,
    case when jsonb_array_length(v_state.offers) = 0 then 'no-offers' else 'created' end
  );
end;
$$;

revoke all on function public.request_skill_path_mission_offers(text)
from public, anon, authenticated;
grant execute on function public.request_skill_path_mission_offers(text) to authenticated;

-- Selection accepts only one opaque UUID. It records planned intent and never
-- creates a mission, reward, history entry, streak day, or achievement event.
create or replace function public.select_skill_path_mission_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := public.dev_effective_vault_now();
  v_daily_key date;
  v_skill_key text;
  v_state public.skill_path_mission_offer_state%rowtype;
  v_offer jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_offer_id is null then
    raise exception 'Opaque offer identifier required' using errcode = '22023';
  end if;

  v_daily_key := public.current_vault_daily_key(v_user_id, v_now);

  -- Resolve only the owner/current-day skill, then acquire the exact Sprint 20
  -- path lock before taking the offer row lock. The membership query is
  -- repeated after locking so no browser identity or stale state is trusted.
  select state.skill_key into v_skill_key
  from public.skill_path_mission_offer_state as state
  where state.user_id = v_user_id and state.daily_key = v_daily_key
    and exists (
      select 1 from jsonb_array_elements(state.offers) as offered(option)
      where offered.option ->> 'offerId' = p_offer_id::text
    );

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'offer-not-found-or-stale');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':skill-path:' || v_skill_key, 0)
  );

  select state.* into v_state
  from public.skill_path_mission_offer_state as state
  where state.user_id = v_user_id and state.daily_key = v_daily_key
    and state.skill_key = v_skill_key
    and exists (
      select 1 from jsonb_array_elements(state.offers) as offered(option)
      where offered.option ->> 'offerId' = p_offer_id::text
    )
  for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'offer-not-found-or-stale');
  end if;

  if not exists (
    select 1 from public.user_skill_paths as path
    join public.skill_catalog as catalog on catalog.skill_key = path.skill_key
    where path.user_id = v_user_id and path.skill_key = v_state.skill_key
      and path.path_active = true and catalog.active = true
  ) then
    return public.vault_skill_path_offer_response(v_state, false, 'path-inactive');
  end if;

  if v_state.selected_offer_id is not null then
    return public.vault_skill_path_offer_response(
      v_state,
      v_state.selected_offer_id = p_offer_id,
      case when v_state.selected_offer_id = p_offer_id then 'already-planned' else 'offer-already-selected' end
    );
  end if;

  select offered.option into v_offer
  from jsonb_array_elements(v_state.offers) as offered(option)
  where offered.option ->> 'offerId' = p_offer_id::text;

  if v_offer is null
    or v_offer ->> 'skillKey' <> v_state.skill_key
    or not exists (
      select 1 from public.mission_catalog as catalog
      where catalog.template_key = v_offer ->> 'templateKey'
        and catalog.primary_skill_key = v_state.skill_key and catalog.active = true
    ) then
    raise exception 'Invalid authoritative Skill Path offer snapshot'
      using errcode = '23514';
  end if;

  update public.skill_path_mission_offer_state
  set selected_offer_id = p_offer_id,
      selected_template_key = v_offer ->> 'templateKey',
      selected_at = v_now
  where user_id = v_user_id and daily_key = v_daily_key and skill_key = v_state.skill_key
  returning * into strict v_state;

  return public.vault_skill_path_offer_response(v_state, true, 'planned');
end;
$$;

revoke all on function public.select_skill_path_mission_offer(uuid)
from public, anon, authenticated;
grant execute on function public.select_skill_path_mission_offer(uuid) to authenticated;

alter table public.skill_path_mission_offer_state enable row level security;
revoke all on public.skill_path_mission_offer_state from public, anon, authenticated;

comment on table public.skill_path_mission_offer_state
is 'Sprint 21 stable owner/day/skill offer and planned-selection state. It is not a mission lifecycle, completion, history, or reward source.';
