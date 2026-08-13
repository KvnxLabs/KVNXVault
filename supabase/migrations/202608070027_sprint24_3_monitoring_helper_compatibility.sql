-- KVNX Vault Sprint 24.3: monitoring helper compatibility hotfix.
-- Apply after 202608070026_sprint24_2_baseline_remediation.sql.
-- Migrations 001-026 remain immutable. This is not product Sprint 25.

-- Migration 026 delegated Sprint 24's non-overall rules to the detector that
-- happened to exist before its rename. The early production Migration 025
-- version of that function referenced the now-removed baseline.boundary_key,
-- so the delegation failed at execution time. Define one self-contained final
-- detector: Sprint 24 non-overall rules plus Sprint 24.2 reconciliation rules.
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

  union all
  select
    'overall-progression-legacy-provenance-gap', 'warning',
    'progression-reconciliation', baseline.user_id, null::date, null::uuid,
    baseline.user_id::text,
    jsonb_build_object(
      'baselineTotalXP', baseline.baseline_total_xp,
      'initialXP', 75,
      'historyXPAtBoundary', baseline.baseline_history_xp,
      'legacyUnattributedXP', baseline.baseline_total_xp - 75 - baseline.baseline_history_xp,
      'boundaryEstablishedAt', baseline.established_at,
      'provenance', baseline.provenance_status,
      'attestationStatus', baseline.attestation_status,
      'attestationReason', baseline.attestation_reason,
      'classification', 'historical-provenance-incomplete'
    )
  from public.vault_xp_reconciliation_baselines as baseline
  where baseline.attestation_status = 'attested'
    and char_length(trim(coalesce(baseline.attestation_reason, ''))) between 10 and 500
    and char_length(trim(coalesce(baseline.established_by, ''))) > 0
    and baseline.baseline_total_xp <> 75::bigint + baseline.baseline_history_xp

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
   and baseline.attestation_status = 'attested'
   and char_length(trim(coalesce(baseline.attestation_reason, ''))) between 10 and 500
   and char_length(trim(coalesce(baseline.established_by, ''))) > 0
  cross join lateral (
    select coalesce(sum(record.xp_awarded), 0)::bigint as current_history_xp
    from public.mission_history as record
    where record.user_id = progression.user_id
      and record.final_state = 'completed'
  ) as history
  where progression.total_xp::bigint
    <> baseline.baseline_total_xp
      + history.current_history_xp - baseline.baseline_history_xp

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
      select 1
      from public.vault_xp_reconciliation_baselines as baseline
      where baseline.user_id = progression.user_id
        and baseline.attestation_status = 'attested'
        and char_length(trim(coalesce(baseline.attestation_reason, ''))) between 10 and 500
        and char_length(trim(coalesce(baseline.established_by, ''))) > 0
    )
    and progression.total_xp::bigint <> 75::bigint + history.current_history_xp

  union all
  select
    'overall-progression-provenance-invalid', 'warning',
    'progression-reconciliation', baseline.user_id, null::date, null::uuid,
    baseline.user_id::text,
    jsonb_build_object(
      'provenance', baseline.provenance_status,
      'attestationStatus', baseline.attestation_status,
      'hasReason', char_length(trim(coalesce(baseline.attestation_reason, ''))) between 10 and 500,
      'hasPrincipal', char_length(trim(coalesce(baseline.established_by, ''))) > 0,
      'classification', 'invalid-provenance-does-not-suppress-authoritative-reconciliation'
    )
  from public.vault_xp_reconciliation_baselines as baseline
  where baseline.attestation_status <> 'attested'
     or char_length(trim(coalesce(baseline.attestation_reason, ''))) not between 10 and 500
     or char_length(trim(coalesce(baseline.established_by, ''))) = 0

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
is 'Sprint 24.3 self-contained detector: Sprint 24 non-overall rules plus explicit-attestation Sprint 24.2 reconciliation; no legacy helper dependency.';

-- No callable function needs the fragile helper after the direct detector is
-- installed. Remove it instead of maintaining obsolete schema-bound SQL.
drop function if exists public.detect_vault_operational_anomalies_pre_sprint24_2();

-- Final authority reassertion. Monitoring and attestation remain database-
-- administrator-only; this migration changes no gameplay or alert state.
revoke all on function public.detect_vault_operational_anomalies()
from public, anon, authenticated;
revoke all on function public.run_vault_operational_monitoring()
from public, anon, authenticated;
revoke all on function public.establish_vault_legacy_xp_baseline(uuid, text)
from public, anon, authenticated;
