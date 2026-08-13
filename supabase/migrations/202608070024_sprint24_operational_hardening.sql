-- KVNX Vault Sprint 24: operational hardening.
-- Apply after 202608070023_sprint23_side_mission_observability.sql.
-- Installed migrations 001-023 remain immutable. There is intentionally no 010.

-- Monitoring results are observational records only. They never participate
-- in mission, reward, progression, history, achievement, streak, or reset
-- transactions.
create table public.vault_operational_monitoring_runs (
  run_id uuid primary key default extensions.gen_random_uuid(),
  started_at timestamptz not null,
  completed_at timestamptz,
  health_state text not null default 'running'
    check (health_state in ('running', 'healthy', 'degraded', 'critical')),
  violation_count integer not null default 0 check (violation_count >= 0),
  anomaly_count integer not null default 0 check (anomaly_count >= 0),
  alerts_created integer not null default 0 check (alerts_created >= 0),
  alerts_refreshed integer not null default 0 check (alerts_refreshed >= 0),
  alerts_resolved integer not null default 0 check (alerts_resolved >= 0),
  category_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(category_counts) = 'object'),
  severity_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(severity_counts) = 'object'),
  constraint vault_monitoring_run_completion_consistent check (
    (health_state = 'running' and completed_at is null)
    or (health_state <> 'running' and completed_at is not null)
  )
);

create index vault_operational_monitoring_runs_completed_idx
  on public.vault_operational_monitoring_runs(completed_at desc)
  where completed_at is not null;

create table public.vault_operational_findings (
  finding_id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.vault_operational_monitoring_runs(run_id)
    on delete cascade,
  fingerprint text not null,
  alert_type text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  source text not null,
  affected_user_id uuid references auth.users(id) on delete set null,
  daily_key date,
  mission_id uuid,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  detected_at timestamptz not null,
  unique (run_id, fingerprint)
);

create index vault_operational_findings_run_idx
  on public.vault_operational_findings(run_id, severity, alert_type);

create table public.vault_operational_alerts (
  fingerprint text primary key,
  alert_type text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  source text not null,
  affected_user_id uuid references auth.users(id) on delete set null,
  daily_key date,
  mission_id uuid,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_detected_at timestamptz not null,
  last_detected_at timestamptz not null,
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  first_run_id uuid not null references public.vault_operational_monitoring_runs(run_id),
  last_run_id uuid not null references public.vault_operational_monitoring_runs(run_id),
  resolved_at timestamptz,
  constraint vault_operational_alert_resolution_consistent check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  ),
  constraint vault_operational_alert_time_order check (
    last_detected_at >= first_detected_at
  )
);

create index vault_operational_alerts_open_severity_idx
  on public.vault_operational_alerts(severity, last_detected_at desc)
  where status = 'open';

create index vault_operational_alerts_resolved_retention_idx
  on public.vault_operational_alerts(last_detected_at)
  where status = 'resolved';

alter table public.vault_operational_monitoring_runs enable row level security;
alter table public.vault_operational_findings enable row level security;
alter table public.vault_operational_alerts enable row level security;

revoke all on public.vault_operational_monitoring_runs from public, anon, authenticated;
revoke all on public.vault_operational_findings from public, anon, authenticated;
revoke all on public.vault_operational_alerts from public, anon, authenticated;

comment on table public.vault_operational_monitoring_runs
is 'Administrator-only observational execution summaries. Never a gameplay or economy authority.';
comment on table public.vault_operational_findings
is 'Administrator-only immutable findings for one monitoring run. Deleted only by bounded operational retention.';
comment on table public.vault_operational_alerts
is 'Administrator-only deterministic deduplicated operational alerts. Open/resolved state is observational only.';

-- Internal detector. It reuses Sprint 23 invariant output and adds only rules
-- proven by current constraints and fixed reward contracts. No branch writes.
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
    'overall-progression-history-divergence', 'critical', 'progression-reconciliation',
    progression.user_id, null::date, null::uuid,
    progression.user_id::text,
    jsonb_build_object(
      'persistedTotalXP', progression.total_xp,
      'expectedTotalXP', 75 + coalesce(history.overall_xp, 0),
      'initialXP', 75,
      'verifiedHistoryXP', coalesce(history.overall_xp, 0)
    )
  from public.progression_state as progression
  left join (
    select mission.user_id, sum(mission.xp_awarded)::integer as overall_xp
    from public.mission_history as mission
    where mission.final_state = 'completed'
    group by mission.user_id
  ) as history on history.user_id = progression.user_id
  where progression.total_xp <> 75 + coalesce(history.overall_xp, 0)

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
is 'Internal read-only deterministic anomaly detector. Reuses Sprint 23 invariants and fixed authoritative economy contracts.';

-- One global advisory lock serializes scans. Findings are immutable per run;
-- alerts upsert on a deterministic fingerprint and absent open alerts resolve.
create or replace function public.run_vault_operational_monitoring()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz := pg_catalog.clock_timestamp();
  v_completed_at timestamptz;
  v_run_id uuid;
  v_finding_count integer := 0;
  v_violation_count integer := 0;
  v_created integer := 0;
  v_refreshed integer := 0;
  v_resolved integer := 0;
  v_health text;
  v_category_counts jsonb := '{}'::jsonb;
  v_severity_counts jsonb := '{}'::jsonb;
  v_findings jsonb := '[]'::jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kvnx-vault-operational-monitoring', 0)
  );

  insert into public.vault_operational_monitoring_runs(started_at)
  values (v_started_at)
  returning run_id into strict v_run_id;

  insert into public.vault_operational_findings (
    run_id, fingerprint, alert_type, severity, source,
    affected_user_id, daily_key, mission_id, details, detected_at
  )
  select v_run_id,
    pg_catalog.md5(pg_catalog.concat_ws('|', detected.source,
      detected.alert_type, detected.fingerprint_key)),
    detected.alert_type, detected.severity, detected.source,
    detected.affected_user_id, detected.daily_key, detected.mission_id,
    detected.details, v_started_at
  from public.detect_vault_operational_anomalies() as detected
  on conflict (run_id, fingerprint) do nothing;

  select count(*)::integer,
    count(*) filter (where source = 'side-mission-invariants')::integer,
    coalesce((
      select jsonb_object_agg(grouped.alert_type, grouped.count)
      from (
        select finding.alert_type, count(*)::integer as count
        from public.vault_operational_findings as finding
        where finding.run_id = v_run_id
        group by finding.alert_type
        order by finding.alert_type
      ) as grouped
    ), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(grouped.severity, grouped.count)
      from (
        select finding.severity, count(*)::integer as count
        from public.vault_operational_findings as finding
        where finding.run_id = v_run_id
        group by finding.severity
        order by finding.severity
      ) as grouped
    ), '{}'::jsonb)
  into v_finding_count, v_violation_count, v_category_counts, v_severity_counts
  from public.vault_operational_findings as finding
  where finding.run_id = v_run_id;

  select count(*)::integer into v_created
  from public.vault_operational_findings as finding
  where finding.run_id = v_run_id
    and not exists (
      select 1 from public.vault_operational_alerts as alert
      where alert.fingerprint = finding.fingerprint
    );

  v_refreshed := v_finding_count - v_created;

  insert into public.vault_operational_alerts (
    fingerprint, alert_type, severity, source, affected_user_id,
    daily_key, mission_id, details, status,
    first_detected_at, last_detected_at, occurrence_count,
    first_run_id, last_run_id, resolved_at
  )
  select finding.fingerprint, finding.alert_type, finding.severity,
    finding.source, finding.affected_user_id, finding.daily_key,
    finding.mission_id, finding.details, 'open',
    v_started_at, v_started_at, 1, v_run_id, v_run_id, null
  from public.vault_operational_findings as finding
  where finding.run_id = v_run_id
  on conflict (fingerprint) do update set
    alert_type = excluded.alert_type,
    severity = excluded.severity,
    source = excluded.source,
    affected_user_id = excluded.affected_user_id,
    daily_key = excluded.daily_key,
    mission_id = excluded.mission_id,
    details = excluded.details,
    status = 'open',
    last_detected_at = excluded.last_detected_at,
    occurrence_count = public.vault_operational_alerts.occurrence_count + 1,
    last_run_id = excluded.last_run_id,
    resolved_at = null;

  update public.vault_operational_alerts as alert
  set status = 'resolved', resolved_at = v_started_at
  where alert.status = 'open'
    and not exists (
      select 1
      from public.vault_operational_findings as finding
      where finding.run_id = v_run_id
        and finding.fingerprint = alert.fingerprint
    );
  get diagnostics v_resolved = row_count;

  v_health := case
    when coalesce((v_severity_counts ->> 'critical')::integer, 0) > 0 then 'critical'
    when v_finding_count > 0 then 'degraded'
    else 'healthy'
  end;
  v_completed_at := pg_catalog.clock_timestamp();

  update public.vault_operational_monitoring_runs
  set completed_at = v_completed_at,
      health_state = v_health,
      violation_count = v_violation_count,
      anomaly_count = v_finding_count,
      alerts_created = v_created,
      alerts_refreshed = v_refreshed,
      alerts_resolved = v_resolved,
      category_counts = v_category_counts,
      severity_counts = v_severity_counts
  where run_id = v_run_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'alertType', finding.alert_type,
    'severity', finding.severity,
    'source', finding.source,
    'affectedUserId', finding.affected_user_id,
    'dailyKey', finding.daily_key,
    'missionId', finding.mission_id,
    'details', finding.details
  ) order by finding.severity desc, finding.alert_type, finding.fingerprint), '[]'::jsonb)
  into v_findings
  from public.vault_operational_findings as finding
  where finding.run_id = v_run_id;

  return jsonb_build_object(
    'runId', v_run_id,
    'startedAt', v_started_at,
    'completedAt', v_completed_at,
    'healthy', v_health = 'healthy',
    'healthState', v_health,
    'violationCount', v_violation_count,
    'anomalyCount', v_finding_count,
    'alerts', jsonb_build_object(
      'created', v_created,
      'refreshed', v_refreshed,
      'resolved', v_resolved
    ),
    'categoryCounts', v_category_counts,
    'severityCounts', v_severity_counts,
    'findings', v_findings
  );
end;
$$;

revoke all on function public.run_vault_operational_monitoring()
from public, anon, authenticated;

comment on function public.run_vault_operational_monitoring()
is 'Database-administrator-only deterministic operational scan and deduplicated alert refresh. Observational; never mutates gameplay state.';

-- Administrator health summary. Detailed user references remain in protected
-- findings/alerts and in the explicit scan result, not this broad summary.
create or replace function public.get_vault_operational_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select run.*
    from public.vault_operational_monitoring_runs as run
    where run.completed_at is not null
    order by run.completed_at desc, run.run_id desc
    limit 1
  ), alert_summary as (
    select count(*) filter (where status = 'open')::integer as unresolved,
      count(*) filter (where status = 'open' and severity = 'critical')::integer as critical,
      count(*) filter (where status = 'open' and severity = 'warning')::integer as warning,
      count(*) filter (where status = 'open' and severity = 'info')::integer as info
    from public.vault_operational_alerts
  ), ledger_summary as (
    select count(*)::bigint as event_count,
      min(occurred_at) as oldest_event_at,
      max(occurred_at) as newest_event_at
    from public.side_mission_event_ledger
  )
  select jsonb_build_object(
    'healthy', coalesce(latest.health_state = 'healthy', false)
      and alert_summary.unresolved = 0,
    'lastMonitoringRun', case when latest.run_id is null then null else jsonb_build_object(
      'runId', latest.run_id,
      'startedAt', latest.started_at,
      'completedAt', latest.completed_at,
      'healthState', latest.health_state,
      'violationCount', latest.violation_count,
      'anomalyCount', latest.anomaly_count,
      'categoryCounts', latest.category_counts,
      'severityCounts', latest.severity_counts
    ) end,
    'unresolvedAlerts', jsonb_build_object(
      'total', alert_summary.unresolved,
      'critical', alert_summary.critical,
      'warning', alert_summary.warning,
      'info', alert_summary.info
    ),
    'recentAlertCategories', coalesce((
      select jsonb_agg(recent.item order by recent.last_detected_at desc, recent.alert_type)
      from (
        select alert.alert_type, max(alert.last_detected_at) as last_detected_at,
          jsonb_build_object(
            'alertType', alert.alert_type,
            'severity', max(alert.severity),
            'openCount', count(*) filter (where alert.status = 'open')
          ) as item
        from public.vault_operational_alerts as alert
        group by alert.alert_type
        order by max(alert.last_detected_at) desc, alert.alert_type
        limit 10
      ) as recent
    ), '[]'::jsonb),
    'observability', jsonb_build_object(
      'sideMissionEventCount', ledger_summary.event_count,
      'oldestSideMissionEventAt', ledger_summary.oldest_event_at,
      'newestSideMissionEventAt', ledger_summary.newest_event_at,
      'oldestCompletedMonitoringRunAt', (
        select min(run.completed_at)
        from public.vault_operational_monitoring_runs as run
        where run.completed_at is not null
      ),
      'defaultRetentionDays', 180,
      'sideMissionLedgerRetention', 'preserved-for-sprint23-all-period-contract'
    )
  )
  from alert_summary cross join ledger_summary
  left join latest on true;
$$;

revoke all on function public.get_vault_operational_health()
from public, anon, authenticated;

comment on function public.get_vault_operational_health()
is 'Database-administrator-only read-only health summary. Exposes no browser or gameplay mutation authority.';

-- Bounded cleanup deletes only Sprint 24 operational records. It cannot target
-- mission history, state, progression, skill progression, or Sprint 23 events.
create or replace function public.prune_vault_operational_data(
  p_retention_days integer default 180,
  p_batch_limit integer default 1000
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_executed_at timestamptz := pg_catalog.clock_timestamp();
  v_cutoff timestamptz;
  v_runs integer := 0;
  v_findings integer := 0;
  v_alerts integer := 0;
begin
  if p_retention_days is null or p_retention_days < 30 or p_retention_days > 3650 then
    raise exception 'Operational retention days must be between 30 and 3650'
      using errcode = '22023';
  end if;
  if p_batch_limit is null or p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'Operational retention batch limit must be between 1 and 5000'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kvnx-vault-operational-retention', 0)
  );
  v_cutoff := v_executed_at - pg_catalog.make_interval(days => p_retention_days);

  -- Remove only resolved alert summaries first. This releases their run
  -- references so the same bounded invocation can remove eligible old runs.
  with eligible as (
    select alert.fingerprint
    from public.vault_operational_alerts as alert
    where alert.status = 'resolved'
      and alert.last_detected_at < v_cutoff
    order by alert.last_detected_at, alert.fingerprint
    limit p_batch_limit
  ), deleted as (
    delete from public.vault_operational_alerts as alert
    using eligible
    where alert.fingerprint = eligible.fingerprint
    returning alert.fingerprint
  )
  select count(*)::integer into v_alerts from deleted;

  select count(*)::integer into v_findings
  from public.vault_operational_findings as finding
  where finding.run_id in (
    select run.run_id
    from public.vault_operational_monitoring_runs as run
    where run.completed_at < v_cutoff
      and not exists (
        select 1 from public.vault_operational_alerts as alert
        where (alert.first_run_id = run.run_id or alert.last_run_id = run.run_id)
      )
    order by run.completed_at, run.run_id
    limit p_batch_limit
  );

  with eligible as (
    select run.run_id
    from public.vault_operational_monitoring_runs as run
    where run.completed_at < v_cutoff
      and not exists (
        select 1 from public.vault_operational_alerts as alert
        where (alert.first_run_id = run.run_id or alert.last_run_id = run.run_id)
      )
    order by run.completed_at, run.run_id
    limit p_batch_limit
  ), deleted as (
    delete from public.vault_operational_monitoring_runs as run
    using eligible
    where run.run_id = eligible.run_id
    returning run.run_id
  )
  select count(*)::integer into v_runs from deleted;

  return jsonb_build_object(
    'executedAt', v_executed_at,
    'cutoff', v_cutoff,
    'retentionDays', p_retention_days,
    'batchLimit', p_batch_limit,
    'removed', jsonb_build_object(
      'monitoringRuns', v_runs,
      'monitoringFindings', v_findings,
      'resolvedAlerts', v_alerts,
      'sideMissionEvents', 0,
      'missionHistoryRecords', 0,
      'missionStateRecords', 0,
      'progressionRecords', 0
    ),
    'sideMissionLedgerPreserved', true
  );
end;
$$;

revoke all on function public.prune_vault_operational_data(integer, integer)
from public, anon, authenticated;

comment on function public.prune_vault_operational_data(integer, integer)
is 'Database-administrator-only bounded cleanup of old Sprint 24 monitoring runs/findings and resolved alerts. Never deletes authoritative or Sprint 23 ledger data.';

-- Final authority reassertion. No browser role can read or mutate operational
-- records or execute privileged monitoring, health, detector, or retention APIs.
alter table public.vault_operational_monitoring_runs enable row level security;
alter table public.vault_operational_findings enable row level security;
alter table public.vault_operational_alerts enable row level security;
revoke all on public.vault_operational_monitoring_runs from public, anon, authenticated;
revoke all on public.vault_operational_findings from public, anon, authenticated;
revoke all on public.vault_operational_alerts from public, anon, authenticated;
