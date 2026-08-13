-- KVNX Vault Sprint 24.2: production baseline remediation.
-- Apply after the production-applied early Migration 025.
-- Migrations 001-025 remain historical. This is not product Sprint 25.

-- Upgrade either the unsafe early baseline schema or the reviewed final schema
-- to one explicit attestation model. Existing reviewed attestations are
-- preserved. No account receives trust merely because it existed at migration
-- time or was attached to the automatic sprint24_1 boundary.
alter table public.vault_xp_reconciliation_baselines
  add column if not exists attestation_reason text,
  add column if not exists established_by text,
  add column if not exists attestation_status text not null default 'invalid';

-- Rows created through the reviewed owner-only API already have both audit
-- fields. Preserve and qualify those rows before considering the unsafe early
-- production signature.
update public.vault_xp_reconciliation_baselines
set attestation_status = 'attested'
where char_length(trim(coalesce(attestation_reason, ''))) between 10 and 500
  and char_length(trim(coalesce(established_by, ''))) > 0;

-- The unsafe early Migration 025 can be identified without user ids or reward
-- amounts: it linked every snapshot to the sprint24_1 migration boundary at
-- exactly that boundary timestamp, labeled it legacy_snapshot, and had no
-- reason/principal columns. Delete only rows satisfying the complete signature.
do $remediation$
begin
  if pg_catalog.to_regclass('public.vault_xp_reconciliation_boundaries') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vault_xp_reconciliation_baselines'
        and column_name = 'boundary_key'
    ) then
    execute $sql$
      delete from public.vault_xp_reconciliation_baselines as baseline
      using public.vault_xp_reconciliation_boundaries as boundary
      where baseline.boundary_key = boundary.boundary_key
        and boundary.boundary_key = 'sprint24_1'
        and boundary.source = 'sprint24_1_migration'
        and boundary.initial_xp = 75
        and baseline.provenance_status = 'legacy_snapshot'
        and baseline.established_at = boundary.established_at
        and baseline.attestation_status = 'invalid'
        and baseline.attestation_reason is null
        and baseline.established_by is null
    $sql$;

    execute $sql$
      alter table public.vault_xp_reconciliation_baselines
      drop column boundary_key
    $sql$;
  end if;
end;
$remediation$;

-- Keep the early boundary row, when present, as immutable incident/migration
-- metadata. The corrected detector and attestation API never consult it.
do $boundary_metadata$
begin
  if pg_catalog.to_regclass('public.vault_xp_reconciliation_boundaries') is not null then
    execute $sql$
      comment on table public.vault_xp_reconciliation_boundaries is
      'Superseded Sprint 24.1 migration metadata. Does not confer legacy provenance or suppress anomaly detection.'
    $sql$;
    execute $sql$
      alter table public.vault_xp_reconciliation_boundaries enable row level security
    $sql$;
    execute $sql$
      revoke all on public.vault_xp_reconciliation_boundaries from public, anon, authenticated
    $sql$;
  end if;
end;
$boundary_metadata$;

alter table public.vault_xp_reconciliation_baselines
  drop constraint if exists vault_xp_reconciliation_baselines_attestation_status_check;
alter table public.vault_xp_reconciliation_baselines
  add constraint vault_xp_reconciliation_baselines_attestation_status_check
  check (attestation_status in ('attested', 'invalid'));

alter table public.vault_xp_reconciliation_baselines
  drop constraint if exists vault_xp_reconciliation_baselines_attestation_complete_check;
alter table public.vault_xp_reconciliation_baselines
  add constraint vault_xp_reconciliation_baselines_attestation_complete_check
  check (
    attestation_status <> 'attested'
    or (
      char_length(trim(coalesce(attestation_reason, ''))) between 10 and 500
      and char_length(trim(coalesce(established_by, ''))) > 0
    )
  );

alter table public.vault_xp_reconciliation_baselines enable row level security;
revoke all on public.vault_xp_reconciliation_baselines from public, anon, authenticated;

comment on table public.vault_xp_reconciliation_baselines
is 'Administrator-attested legacy progression/history snapshots. Automatic Sprint 24.1 rows were removed; invalid rows never suppress authoritative divergence.';

-- Replace any early/final Sprint 24.1 attestation definition. The caller may
-- provide only an investigated owner and audit reason. PostgreSQL locks and
-- reads progression, computes completed-history XP, records the session
-- principal, and creates at most one immutable attested baseline.
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

  select * into v_baseline
  from public.vault_xp_reconciliation_baselines as baseline
  where baseline.user_id = p_user_id;

  if found and v_baseline.attestation_status <> 'attested' then
    raise exception 'Invalid provenance row requires separate administrator review'
      using errcode = '55000';
  end if;

  if not found then
    select coalesce(sum(history.xp_awarded), 0)::bigint
    into v_history_xp
    from public.mission_history as history
    where history.user_id = p_user_id
      and history.final_state = 'completed';

    insert into public.vault_xp_reconciliation_baselines (
      user_id, baseline_total_xp, baseline_history_xp, established_at,
      provenance_status, attestation_reason, established_by,
      attestation_status
    ) values (
      p_user_id, v_total_xp, v_history_xp, v_established_at,
      'legacy_snapshot', trim(p_attestation_reason), session_user::text,
      'attested'
    );

    select * into strict v_baseline
    from public.vault_xp_reconciliation_baselines as baseline
    where baseline.user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'userId', v_baseline.user_id,
    'baselineTotalXP', v_baseline.baseline_total_xp,
    'baselineHistoryXP', v_baseline.baseline_history_xp,
    'legacyUnattributedXP', v_baseline.baseline_total_xp - 75 - v_baseline.baseline_history_xp,
    'establishedAt', v_baseline.established_at,
    'provenance', v_baseline.provenance_status,
    'attestationStatus', v_baseline.attestation_status,
    'attestationReason', v_baseline.attestation_reason,
    'establishedBy', v_baseline.established_by
  );
end;
$$;

revoke all on function public.establish_vault_legacy_xp_baseline(uuid, text)
from public, anon, authenticated;

comment on function public.establish_vault_legacy_xp_baseline(uuid, text)
is 'Database-owner-only one-time legacy provenance attestation. Accepts no XP/history/time; never changes gameplay state.';

-- Preserve every non-overall Sprint 24 anomaly rule byte-for-behavior by
-- retaining the prior detector as a revoked internal helper. The new detector
-- discards only obsolete overall-progression classifications and applies the
-- remediated attestation rules below.
alter function public.detect_vault_operational_anomalies()
rename to detect_vault_operational_anomalies_pre_sprint24_2;

revoke all on function public.detect_vault_operational_anomalies_pre_sprint24_2()
from public, anon, authenticated;

comment on function public.detect_vault_operational_anomalies_pre_sprint24_2()
is 'Revoked Sprint 24.1 detector retained only as the non-overall-rule source for Sprint 24.2.';

create function public.detect_vault_operational_anomalies()
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
  select previous.alert_type, previous.severity, previous.source,
    previous.affected_user_id, previous.daily_key, previous.mission_id,
    previous.fingerprint_key, previous.details
  from public.detect_vault_operational_anomalies_pre_sprint24_2() as previous
  where previous.alert_type not like 'overall-progression-%'

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
     or char_length(trim(coalesce(baseline.established_by, ''))) = 0;
$$;

revoke all on function public.detect_vault_operational_anomalies()
from public, anon, authenticated;

comment on function public.detect_vault_operational_anomalies()
is 'Sprint 24.2 detector. Only explicit complete attestations suppress lifetime reconstruction; invalid/automatic provenance cannot.';

-- Final authority reassertion.
alter table public.vault_xp_reconciliation_baselines enable row level security;
revoke all on public.vault_xp_reconciliation_baselines from public, anon, authenticated;
revoke all on function public.establish_vault_legacy_xp_baseline(uuid, text)
from public, anon, authenticated;
revoke all on function public.detect_vault_operational_anomalies_pre_sprint24_2()
from public, anon, authenticated;
revoke all on function public.detect_vault_operational_anomalies()
from public, anon, authenticated;
