-- KVNX Vault Sprint 24.1: legacy XP reconciliation hardening.
-- Apply after 202608070024_sprint24_operational_hardening.sql.
-- Migrations 001-024 remain immutable. This is not product Sprint 25.

-- This table is observational provenance only. It never awards, subtracts,
-- normalizes, or otherwise mutates progression, skills, missions, history,
-- achievements, streaks, or daily state. No account is inserted automatically:
-- legacy qualification requires an explicit database-owner attestation.
create table public.vault_xp_reconciliation_baselines (
  user_id uuid primary key references auth.users(id) on delete cascade,
  baseline_total_xp bigint not null check (baseline_total_xp >= 0),
  baseline_history_xp bigint not null check (baseline_history_xp >= 0),
  established_at timestamptz not null,
  provenance_status text not null check (provenance_status = 'legacy_snapshot'),
  attestation_reason text not null
    check (char_length(trim(attestation_reason)) between 10 and 500),
  established_by text not null
);

create index vault_xp_reconciliation_baselines_status_idx
  on public.vault_xp_reconciliation_baselines(provenance_status, established_at);

alter table public.vault_xp_reconciliation_baselines enable row level security;
revoke all on public.vault_xp_reconciliation_baselines from public, anon, authenticated;

comment on table public.vault_xp_reconciliation_baselines
is 'Administrator-attested legacy progression/history snapshot. Empty by default; observational and never an XP or gameplay authority.';

-- Only the database owner may explicitly attest that one investigated account
-- has incomplete historical provenance. The caller cannot submit XP, history,
-- dates, or a replacement baseline. Row locking serializes the snapshot with
-- every authoritative completion path, all of which lock progression first.
create or replace function public.establish_vault_legacy_xp_baseline(
  p_user_id uuid,
  p_attestation_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_total_xp bigint;
  v_history_xp bigint;
  v_established_at timestamptz := pg_catalog.clock_timestamp();
  v_baseline public.vault_xp_reconciliation_baselines%rowtype;
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_attestation_reason, ''))) not between 10 and 500 then
    raise exception 'A 10-500 character attestation reason is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kvnx-vault-legacy-xp-baseline:' || p_user_id::text, 0)
  );

  select progression.total_xp::bigint
  into v_total_xp
  from public.progression_state as progression
  where progression.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Progression state was not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(history.xp_awarded), 0)::bigint
  into v_history_xp
  from public.mission_history as history
  where history.user_id = p_user_id
    and history.final_state = 'completed';

  insert into public.vault_xp_reconciliation_baselines (
    user_id, baseline_total_xp, baseline_history_xp, established_at,
    provenance_status, attestation_reason, established_by
  ) values (
    p_user_id, v_total_xp, v_history_xp, v_established_at,
    'legacy_snapshot', trim(p_attestation_reason), session_user::text
  )
  on conflict (user_id) do nothing;

  select * into strict v_baseline
  from public.vault_xp_reconciliation_baselines as baseline
  where baseline.user_id = p_user_id;

  return jsonb_build_object(
    'userId', v_baseline.user_id,
    'baselineTotalXP', v_baseline.baseline_total_xp,
    'baselineHistoryXP', v_baseline.baseline_history_xp,
    'legacyUnattributedXP', v_baseline.baseline_total_xp - 75 - v_baseline.baseline_history_xp,
    'establishedAt', v_baseline.established_at,
    'provenance', v_baseline.provenance_status,
    'attestationReason', v_baseline.attestation_reason,
    'establishedBy', v_baseline.established_by
  );
end;
$$;

revoke all on function public.establish_vault_legacy_xp_baseline(uuid, text)
from public, anon, authenticated;

comment on function public.establish_vault_legacy_xp_baseline(uuid, text)
is 'Database-owner-only one-time legacy provenance attestation. Snapshots server-read XP/history; never changes gameplay state.';

-- Replace only the detector definition. Sprint 24 monitoring runs, findings,
-- alert deduplication/resolution, health, and retention remain unchanged.
create or replace function public.detect_vault_operational_anomalies()
returns table (
  alert_type text,
  severity text,
  source text,
  affected_user_id uuid,
  daily_key date,
  mission_id uuid,
  fingerprint_key text,
  details jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    audit.violation,
    case
      when audit.violation in (
        'completed-state-history-mismatch',
        'side-history-state-mismatch',
        'event-state-identity-mismatch',
        'rewarded-noncompleted-state',
        'duplicate-side-history-day'
      ) then 'critical'
      else 'warning'
    end,
    'side-mission-invariants',
    audit.user_id,
    audit.daily_key,
    audit.mission_id,
    pg_catalog.concat_ws(':', audit.violation, audit.user_id::text,
      audit.daily_key::text, audit.mission_id::text),
    audit.details
  from public.audit_side_mission_invariants() as audit

  union all
  select
    'side-reward-snapshot-invalid', 'critical', 'side-mission-economy',
    state.user_id, state.daily_key, state.mission_id,
    state.mission_id::text,
    jsonb_build_object(
      'skillKey', state.skill_key,
      'definitionSkill', state.mission_definition ->> 'primarySkill',
      'overallXPReward', state.mission_definition -> 'overallXPReward',
      'skillXPReward', state.mission_definition -> 'skillXPReward'
    )
  from public.side_mission_state as state
  where state.mission_definition ->> 'overallXPReward' is distinct from '10'
     or state.mission_definition ->> 'skillXPReward' is distinct from '10'
     or state.mission_definition ->> 'primarySkill' is distinct from state.skill_key

  union all
  select
    'side-lifecycle-event-order-invalid', 'critical', 'side-mission-lifecycle',
    ordered.user_id, ordered.daily_key, ordered.mission_id,
    ordered.mission_id::text,
    jsonb_build_object(
      'promotedAt', ordered.promoted_at,
      'startedAt', ordered.started_at,
      'completedAt', ordered.completed_at,
      'expiredAt', ordered.expired_at
    )
  from (
    select state.user_id, state.daily_key, state.mission_id,
      min(event.occurred_at) filter (where event.event_type = 'promoted') as promoted_at,
      min(event.occurred_at) filter (where event.event_type = 'started') as started_at,
      min(event.occurred_at) filter (where event.event_type = 'completed') as completed_at,
      min(event.occurred_at) filter (where event.event_type = 'expired') as expired_at
    from public.side_mission_state as state
    left join public.side_mission_event_ledger as event
      on event.mission_id = state.mission_id
    group by state.user_id, state.daily_key, state.mission_id
  ) as ordered
  where (ordered.started_at is not null and ordered.promoted_at is not null
      and ordered.started_at < ordered.promoted_at)
     or (ordered.completed_at is not null and ordered.started_at is not null
      and ordered.completed_at < ordered.started_at)
     or (ordered.expired_at is not null and ordered.promoted_at is not null
      and ordered.expired_at < ordered.promoted_at)
     or (ordered.completed_at is not null and ordered.expired_at is not null)

  union all
  select
    'side-event-volume-impossible', 'critical', 'side-mission-observability',
    event.user_id, event.daily_key, null::uuid,
    pg_catalog.concat_ws(':', event.user_id::text, event.daily_key::text),
    jsonb_build_object('eventCount', count(*), 'maximum', 4)
  from public.side_mission_event_ledger as event
  group by event.user_id, event.daily_key
  having count(*) > 4

  union all
  select
    'daily-completion-overall-reward-invalid', 'critical', 'daily-mission-economy',
    history.user_id,
    public.parse_vault_daily_key(history.daily_session_id),
    case when history.mission_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then history.mission_id::uuid else null end,
    pg_catalog.concat_ws(':', history.user_id::text, history.daily_session_id,
      history.mission_id),
    jsonb_build_object('overallXPAwarded', history.xp_awarded, 'expected', 25)
  from public.mission_history as history
  where history.mission_type = 'daily'
    and history.final_state = 'completed'
    and history.xp_awarded <> 25

  union all
  select
    'daily-completion-skill-reward-invalid', 'critical', 'daily-mission-economy',
    history.user_id,
    public.parse_vault_daily_key(history.daily_session_id),
    case when history.mission_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then history.mission_id::uuid else null end,
    pg_catalog.concat_ws(':', history.user_id::text, history.daily_session_id,
      history.mission_id),
    jsonb_build_object('skillXPAwarded', history.skill_xp_awarded,
      'expected', 15, 'skillKey', history.skill_key)
  from public.mission_history as history
  where history.mission_type = 'daily'
    and history.final_state = 'completed'
    and history.skill_xp_awarded not in (0, 15)

  -- A pre-boundary difference remains visible, but incomplete prototype-era
  -- provenance is not proof of economy corruption.
  union all
  select
    'overall-progression-legacy-provenance-gap', 'warning',
    'progression-reconciliation', baseline.user_id, null::date, null::uuid,
    baseline.user_id::text,
    jsonb_build_object(
      'baselineTotalXP', baseline.baseline_total_xp,
      'initialXP', 75,
      'historyXPAtBoundary', baseline.baseline_history_xp,
      'legacyUnattributedXP', baseline.baseline_total_xp
        - 75 - baseline.baseline_history_xp,
      'boundaryEstablishedAt', baseline.established_at,
      'provenance', baseline.provenance_status,
      'attestationReason', baseline.attestation_reason,
      'classification', 'historical-provenance-incomplete'
    )
  from public.vault_xp_reconciliation_baselines as baseline
  where baseline.baseline_total_xp
    <> 75::bigint + baseline.baseline_history_xp

  -- Once the snapshot exists, every subsequent authoritative history delta
  -- must reconcile exactly to persisted progression.
  union all
  select
    'overall-progression-post-boundary-divergence', 'critical',
    'progression-reconciliation', progression.user_id, null::date, null::uuid,
    progression.user_id::text,
    jsonb_build_object(
      'persistedTotalXP', progression.total_xp,
      'expectedTotalXP', baseline.baseline_total_xp
        + history.current_history_xp - baseline.baseline_history_xp,
      'baselineTotalXP', baseline.baseline_total_xp,
      'historyXPAtBoundary', baseline.baseline_history_xp,
      'currentVerifiedHistoryXP', history.current_history_xp,
      'boundaryEstablishedAt', baseline.established_at,
      'classification', 'post-boundary-authoritative-divergence'
    )
  from public.progression_state as progression
  join public.vault_xp_reconciliation_baselines as baseline
    on baseline.user_id = progression.user_id
  cross join lateral (
    select coalesce(sum(record.xp_awarded), 0)::bigint as current_history_xp
    from public.mission_history as record
    where record.user_id = progression.user_id
      and record.final_state = 'completed'
  ) as history
  where progression.total_xp::bigint
    <> baseline.baseline_total_xp
      + history.current_history_xp - baseline.baseline_history_xp

  -- Every account without an explicit administrator attestation remains fully
  -- reconstructable for monitoring and must reconcile from the fixed 75 XP
  -- initial state. Existence before Migration 025 never grants legacy status.
  union all
  select
    'overall-progression-authoritative-divergence', 'critical',
    'progression-reconciliation', progression.user_id, null::date, null::uuid,
    progression.user_id::text,
    jsonb_build_object(
      'persistedTotalXP', progression.total_xp,
      'expectedTotalXP', 75::bigint + history.current_history_xp,
      'initialXP', 75,
      'currentVerifiedHistoryXP', history.current_history_xp,
      'classification', 'fully-authoritative-divergence'
    )
  from public.progression_state as progression
  cross join lateral (
    select coalesce(sum(record.xp_awarded), 0)::bigint as current_history_xp
    from public.mission_history as record
    where record.user_id = progression.user_id
      and record.final_state = 'completed'
  ) as history
  where not exists (
      select 1 from public.vault_xp_reconciliation_baselines as baseline
      where baseline.user_id = progression.user_id
    )
    and progression.total_xp::bigint
      <> 75::bigint + history.current_history_xp

  union all
  select
    'skill-progression-history-divergence', 'critical', 'progression-reconciliation',
    compared.user_id, null::date, null::uuid,
    pg_catalog.concat_ws(':', compared.user_id::text, compared.skill_key),
    jsonb_build_object(
      'skillKey', compared.skill_key,
      'persistedSkillXP', compared.persisted_skill_xp,
      'verifiedHistorySkillXP', compared.history_skill_xp
    )
  from (
    select coalesce(progression.user_id, history.user_id) as user_id,
      coalesce(progression.skill_key, history.skill_key) as skill_key,
      coalesce(progression.skill_xp, 0)::integer as persisted_skill_xp,
      coalesce(history.skill_xp, 0)::integer as history_skill_xp
    from public.skill_progression as progression
    full join (
      select mission.user_id, mission.skill_key,
        sum(mission.skill_xp_awarded)::integer as skill_xp
      from public.mission_history as mission
      where mission.final_state = 'completed'
        and mission.skill_key is not null
        and mission.skill_xp_awarded > 0
      group by mission.user_id, mission.skill_key
    ) as history
      on history.user_id = progression.user_id
     and history.skill_key = progression.skill_key
  ) as compared
  where compared.persisted_skill_xp <> compared.history_skill_xp;
$$;

revoke all on function public.detect_vault_operational_anomalies()
from public, anon, authenticated;

comment on function public.detect_vault_operational_anomalies()
is 'Internal read-only deterministic detector. Only explicitly administrator-attested legacy XP is warning-only; every unattested and post-baseline divergence remains critical.';

-- Final authority reassertion. Browser roles cannot read or alter provenance or
-- execute the privileged detector directly.
alter table public.vault_xp_reconciliation_baselines enable row level security;
revoke all on public.vault_xp_reconciliation_baselines from public, anon, authenticated;
revoke all on function public.establish_vault_legacy_xp_baseline(uuid, text)
from public, anon, authenticated;
revoke all on function public.detect_vault_operational_anomalies()
from public, anon, authenticated;
