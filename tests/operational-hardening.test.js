"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070024_sprint24_operational_hardening.sql");
const migration23 = read("supabase/migrations/202608070023_sprint23_side_mission_observability.sql");
const migration22 = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
const detector = migration.match(/create or replace function public\.detect_vault_operational_anomalies[\s\S]*?\n\$\$;/i)?.[0] || "";
const monitor = migration.match(/create or replace function public\.run_vault_operational_monitoring[\s\S]*?\n\$\$;/i)?.[0] || "";
const health = migration.match(/create or replace function public\.get_vault_operational_health[\s\S]*?\n\$\$;/i)?.[0] || "";
const retention = migration.match(/create or replace function public\.prune_vault_operational_data[\s\S]*?\n\$\$;/i)?.[0] || "";

const stripSqlLiteralsAndComments = (sql) => sql
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/'(?:''|[^'])*'/g, "''");

const assertBalancedParentheses = (sql, label) => {
  let depth = 0;
  for (const character of stripSqlLiteralsAndComments(sql)) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0, `${label}: premature closing parenthesis`);
  }
  assert.equal(depth, 0, `${label}: unterminated parenthesized expression`);
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("Migration 024 creates exactly three protected operational tables", () => {
  for (const table of ["vault_operational_monitoring_runs", "vault_operational_findings", "vault_operational_alerts"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
  }
});
test("monitoring runs persist structured health and count results", () => {
  assert.match(migration, /health_state text[\s\S]*violation_count integer[\s\S]*anomaly_count integer/);
  assert.match(migration, /category_counts jsonb[\s\S]*severity_counts jsonb/);
});
test("findings preserve structured affected references and details", () => {
  assert.match(migration, /affected_user_id uuid references auth\.users/);
  assert.match(migration, /daily_key date/);
  assert.match(migration, /mission_id uuid/);
  assert.match(migration, /details jsonb/);
});
test("alerts support only info warning critical and open resolved", () => {
  assert.match(migration, /severity in \('info', 'warning', 'critical'\)/);
  assert.match(migration, /status in \('open', 'resolved'\)/);
});
test("deterministic fingerprint is the alert primary key", () => {
  assert.match(migration, /create table public\.vault_operational_alerts \([\s\S]*fingerprint text primary key/);
  assert.match(monitor, /pg_catalog\.md5\(pg_catalog\.concat_ws\('\|'/);
});
test("per-run findings are also deterministically unique", () => {
  assert.match(migration, /unique \(run_id, fingerprint\)/);
});
test("detector reuses Sprint 23 invariant audit", () => {
  assert.match(detector, /from public\.audit_side_mission_invariants\(\) as audit/);
});
test("clean scan health is explicitly healthy", () => {
  assert.match(monitor, /when v_finding_count > 0 then 'degraded'[\s\S]*else 'healthy'/);
  assert.match(monitor, /'healthy', v_health = 'healthy'/);
});
test("invariant violations retain category and structured details", () => {
  assert.match(detector, /audit\.violation[\s\S]*audit\.user_id[\s\S]*audit\.daily_key[\s\S]*audit\.mission_id/);
  assert.match(detector, /audit\.details/);
});
test("Side reward snapshot anomaly is exact +10 +10 canonical skill", () => {
  assert.match(detector, /side-reward-snapshot-invalid/);
  assert.match(detector, /overallXPReward' is distinct from '10'/);
  assert.match(detector, /skillXPReward' is distinct from '10'/);
  assert.match(detector, /primarySkill' is distinct from state\.skill_key/);
});
test("impossible Side lifecycle order is detected", () => {
  assert.match(detector, /side-lifecycle-event-order-invalid/);
  assert.match(detector, /started_at < ordered\.promoted_at/);
  assert.match(detector, /completed_at < ordered\.started_at/);
  assert.match(detector, /completed_at is not null and ordered\.expired_at is not null/);
});
test("impossible account-day event volume is detected conservatively", () => {
  assert.match(detector, /side-event-volume-impossible/);
  assert.match(detector, /group by event\.user_id, event\.daily_key[\s\S]*having count\(\*\) > 4/);
});
test("Daily overall reward anomaly preserves fixed +25 rule", () => {
  assert.match(detector, /daily-completion-overall-reward-invalid/);
  assert.match(detector, /history\.mission_type = 'daily'[\s\S]*history\.xp_awarded <> 25/);
});
test("Daily skill reward anomaly preserves +15 and legacy zero attribution", () => {
  assert.match(detector, /daily-completion-skill-reward-invalid/);
  assert.match(detector, /history\.skill_xp_awarded not in \(0, 15\)/);
});
test("overall progression reconciliation includes authoritative initial 75 XP", () => {
  assert.match(detector, /overall-progression-history-divergence/);
  assert.match(detector, /progression\.total_xp <> 75 \+ coalesce\(history\.overall_xp, 0\)/);
});
test("skill progression reconciles canonical persisted and history totals", () => {
  assert.match(detector, /skill-progression-history-divergence/);
  assert.match(detector, /full join[\s\S]*mission\.skill_xp_awarded/);
  assert.match(detector, /persisted_skill_xp <> compared\.history_skill_xp/);
});
test("normal behavior is not classified critical by speculative rules", () => {
  assert.doesNotMatch(detector, /login_count|refresh_count|browser_retry|mission_duration|difficulty_multiplier/);
});
test("monitoring serializes concurrent executions with an advisory lock", () => {
  assert.match(monitor, /pg_advisory_xact_lock[\s\S]*kvnx-vault-operational-monitoring/);
});
test("repeated scans upsert one alert instead of inserting duplicates", () => {
  assert.match(monitor, /on conflict \(fingerprint\) do update set/);
  assert.match(monitor, /occurrence_count = public\.vault_operational_alerts\.occurrence_count \+ 1/);
});
test("conditions absent from the next complete scan resolve deterministically", () => {
  assert.match(monitor, /set status = 'resolved', resolved_at = v_started_at/);
  assert.match(monitor, /not exists \([\s\S]*finding\.run_id = v_run_id[\s\S]*finding\.fingerprint = alert\.fingerprint/);
});
test("monitoring returns pass state counts categories and detailed findings", () => {
  for (const field of ["healthy", "healthState", "violationCount", "anomalyCount", "categoryCounts", "severityCounts", "findings"]) {
    assert.match(monitor, new RegExp(`'${field}'`));
  }
});
test("monitoring cannot mutate authoritative gameplay or economy tables", () => {
  assert.doesNotMatch(monitor, /(?:insert into|update|delete from) public\.(?:progression_state|skill_progression|mission_history|daily_mission_state|side_mission_state|user_streak_state|user_achievements)/);
});
test("detector and health API are read-only", () => {
  assert.doesNotMatch([detector, health].join("\n"), /insert into|update public\.|delete from public\./);
});
test("health API summarizes latest run alerts categories and ledger volume", () => {
  assert.match(health, /lastMonitoringRun/);
  assert.match(health, /unresolvedAlerts/);
  assert.match(health, /recentAlertCategories/);
  assert.match(health, /sideMissionEventCount/);
});
test("health API exposes no user or mission identifiers", () => {
  assert.doesNotMatch(health, /affected_user_id|mission_id|daily_key/);
});
test("retention cutoff is server-time deterministic and bounded", () => {
  assert.match(retention, /pg_catalog\.clock_timestamp\(\)/);
  assert.match(retention, /p_retention_days < 30 or p_retention_days > 3650/);
  assert.match(retention, /p_batch_limit < 1 or p_batch_limit > 5000/);
});
test("retention serializes concurrent cleanup", () => {
  assert.match(retention, /pg_advisory_xact_lock[\s\S]*kvnx-vault-operational-retention/);
});
test("retention deletes only Sprint 24 operational runs and alerts", () => {
  assert.match(retention, /delete from public\.vault_operational_monitoring_runs/);
  assert.match(retention, /delete from public\.vault_operational_alerts/);
  assert.doesNotMatch(retention, /delete from public\.(?:mission_history|side_mission_state|daily_mission_state|progression_state|skill_progression|side_mission_event_ledger)/);
});
test("findings are removed only by run cascade", () => {
  assert.match(migration, /run_id uuid not null references public\.vault_operational_monitoring_runs\(run_id\)[\s\S]*on delete cascade/);
});
test("open alerts are never retention eligible", () => {
  assert.match(retention, /alert\.status = 'resolved'[\s\S]*alert\.last_detected_at < v_cutoff/);
});
test("retention explicitly reports zero authoritative removals", () => {
  for (const field of ["sideMissionEvents", "missionHistoryRecords", "missionStateRecords", "progressionRecords"]) {
    assert.match(retention, new RegExp(`'${field}', 0`));
  }
  assert.match(retention, /'sideMissionLedgerPreserved', true/);
});
test("Sprint 23 all-period event ledger remains preserved", () => {
  assert.doesNotMatch(retention, /delete from public\.side_mission_event_ledger/);
  assert.match(health, /preserved-for-sprint23-all-period-contract/);
});
test("all operational tables have RLS and no browser privileges", () => {
  for (const table of ["vault_operational_monitoring_runs", "vault_operational_findings", "vault_operational_alerts"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
});
test("all privileged functions are SECURITY DEFINER with empty search path", () => {
  for (const body of [detector, monitor, health, retention]) {
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
  }
});
test("no privileged operational function is granted to a browser role", () => {
  for (const signature of [
    "detect_vault_operational_anomalies\\(\\)",
    "run_vault_operational_monitoring\\(\\)",
    "get_vault_operational_health\\(\\)",
    "prune_vault_operational_data\\(integer, integer\\)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated`));
  }
  assert.doesNotMatch(migration, /grant execute on function public\.(?:detect_vault_operational_anomalies|run_vault_operational_monitoring|get_vault_operational_health|prune_vault_operational_data)/);
});
test("browser cannot forge operational identity classifications or rewards", () => {
  assert.doesNotMatch(monitor.match(/\(([^)]*)\)\s*returns jsonb/i)?.[1] || "", /user|severity|reward|xp|daily|mission|alert/i);
  assert.doesNotMatch(detector.match(/\(([^)]*)\)\s*returns table/i)?.[1] || "", /user|severity|reward|xp|daily|mission|alert/i);
});
test("monitoring is not attached to gameplay triggers or RPCs", () => {
  assert.doesNotMatch(migration, /create trigger/);
  assert.doesNotMatch(migration22, /run_vault_operational_monitoring|vault_operational_alerts/);
});
test("Sprint 22 fixed economies remain byte-for-byte unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(migration22).digest("hex"), "ad958272c69b4050779e5c028ed7fa6ad27b2765ba28a7fcd1705180052e7efc");
  assert.match(migration22, /v_total_xp := v_total_xp \+ 10/);
  assert.match(migration22, /v_skill_total := v_skill_total \+ 10/);
});
test("Sprint 23 event and observability semantics remain byte-for-byte unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(migration23).digest("hex"), "6e44d3b28f4ab2072864dedd66e1b4ce1301f81a165eca74207ef072c422b72a");
  assert.match(migration23, /get_side_mission_observability\(p_period text\)/);
});
test("Migration 024 function definitions are terminated and structurally balanced", () => {
  const definitions = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)[\s\S]*?\n\$\$;/gi)];
  assert.equal(definitions.length, 4);
  for (const definition of definitions) {
    const body = definition[0].match(/\bas \$\$([\s\S]*)\n\$\$;/i)?.[1];
    assert.ok(body, `${definition[1]} has a complete dollar-quoted body`);
    assertBalancedParentheses(body, definition[1]);
  }
});
test("migrations 001 through 023 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint24.sha256").trim().split("\n");
  assert.equal(baseline.length, 22);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 024 is uniquely and correctly named", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070024_/.test(name));
  assert.deepEqual(files, ["202608070024_sprint24_operational_hardening.sql"]);
});
test("Sprint 24 introduces no frontend authority or secrets", () => {
  const frontend = [read("js/user-repository.js"), read("js/application-service.js"), read("js/dashboard.js")].join("\n");
  assert.doesNotMatch(frontend, /vault_operational_|run_vault_operational_monitoring|prune_vault_operational_data/);
  assert.doesNotMatch([migration, frontend].join("\n"), /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
});
test("JavaScript syntax and HTML local references remain valid", () => {
  for (const file of fs.readdirSync(path.join(root, "js")).filter((name) => name.endsWith(".js"))) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js", file)]).status, 0, file);
  }
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
    const html = read(file);
    for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) {
      assert.equal(fs.existsSync(path.join(root, match[1])), true, `${file}: ${match[1]}`);
    }
  }
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
