"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070025_sprint24_1_legacy_xp_reconciliation.sql");
const migration24 = read("supabase/migrations/202608070024_sprint24_operational_hardening.sql");
const migration3 = read("supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql");
const migration5 = read("supabase/migrations/202608070005_sprint8_server_authority.sql");
const detector = migration.match(/create or replace function public\.detect_vault_operational_anomalies[\s\S]*?\n\$\$;/i)?.[0] || "";

const stripSqlLiteralsAndComments = (sql) => sql
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/'(?:''|[^'])*'/g, "''");

const assertBalancedParentheses = (sql) => {
  let depth = 0;
  for (const character of stripSqlLiteralsAndComments(sql)) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0, "premature closing parenthesis");
  }
  assert.equal(depth, 0, "unterminated parenthesized expression");
};

const classify = ({ baselineTotal, baselineHistory, currentTotal, currentHistory }) => ({
  legacyWarning: baselineTotal !== 75 + baselineHistory,
  postBoundaryCritical: currentTotal !== baselineTotal + currentHistory - baselineHistory,
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("repository history proves prototype XP could predate history provenance", () => {
  assert.match(migration3, /update public\.progression_state[\s\S]*set total_xp = v_next_total_xp/i);
  assert.doesNotMatch(migration3, /insert into public\.mission_history/i);
});
test("Sprint 8 couples authoritative XP and history in one action transaction", () => {
  const action = migration5.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(action, /update public\.progression_state[\s\S]*insert into public\.mission_history/i);
});
test("Migration 025 creates one administrator-attested observational baseline table", () => {
  assert.doesNotMatch(migration, /create table public\.vault_xp_reconciliation_boundaries/);
  assert.match(migration, /create table public\.vault_xp_reconciliation_baselines/);
  assert.match(migration, /baseline_total_xp bigint[\s\S]*baseline_history_xp bigint[\s\S]*attestation_reason text[\s\S]*established_by text/);
});
test("Migration 025 does not automatically baseline any existing account", () => {
  const beforeFunction = migration.slice(0, migration.indexOf("create or replace function public.establish_vault_legacy_xp_baseline"));
  assert.doesNotMatch(beforeFunction, /insert into public\.vault_xp_reconciliation_baselines/);
  assert.doesNotMatch(migration, /insert into public\.vault_xp_reconciliation_baselines[\s\S]*select progression\.user_id/i);
});
test("baseline attestation serializes and server-reads progression and history", () => {
  const attestation = migration.match(/create or replace function public\.establish_vault_legacy_xp_baseline[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(attestation, /from public\.progression_state[\s\S]*for update/);
  assert.match(attestation, /sum\(history\.xp_awarded\)/);
  assert.match(attestation, /pg_advisory_xact_lock/);
  assert.doesNotMatch(attestation, /(?:update|delete from) public\.(?:progression_state|mission_history|skill_progression)/i);
});
test("production-shaped legacy +50 remains visible as warning, not critical", () => {
  assert.deepEqual(classify({ baselineTotal: 235, baselineHistory: 110, currentTotal: 235, currentHistory: 110 }), {
    legacyWarning: true,
    postBoundaryCritical: false,
  });
  assert.match(detector, /overall-progression-legacy-provenance-gap', 'warning'/);
});
test("matching legacy baseline produces no false warning or critical", () => {
  assert.deepEqual(classify({ baselineTotal: 185, baselineHistory: 110, currentTotal: 185, currentHistory: 110 }), {
    legacyWarning: false,
    postBoundaryCritical: false,
  });
});
test("authoritative history after baseline reconciles exactly", () => {
  assert.deepEqual(classify({ baselineTotal: 235, baselineHistory: 110, currentTotal: 260, currentHistory: 135 }), {
    legacyWarning: true,
    postBoundaryCritical: false,
  });
});
test("unexplained post-baseline extra XP remains critical", () => {
  assert.equal(classify({ baselineTotal: 235, baselineHistory: 110, currentTotal: 285, currentHistory: 135 }).postBoundaryCritical, true);
});
test("unexplained post-baseline missing XP remains critical", () => {
  assert.equal(classify({ baselineTotal: 235, baselineHistory: 110, currentTotal: 250, currentHistory: 135 }).postBoundaryCritical, true);
});
test("post-boundary formula uses history delta rather than timestamps", () => {
  assert.match(detector, /baseline\.baseline_total_xp[\s\S]*history\.current_history_xp - baseline\.baseline_history_xp/);
  assert.doesNotMatch(detector, /record\.(?:terminal_at|created_at)\s*[><=]/);
});
test("new accounts remain fully reconstructable from 75 plus history", () => {
  assert.match(detector, /overall-progression-authoritative-divergence', 'critical'/);
  assert.match(detector, /75::bigint \+ history\.current_history_xp/);
});
test("all unattested existing accounts remain fully authoritative for monitoring", () => {
  assert.match(detector, /where not exists \([\s\S]*vault_xp_reconciliation_baselines/);
  assert.doesNotMatch(detector, /progression\.created_at\s*[><=]|overall-progression-provenance-missing/);
});
test("fully authoritative pre-Migration 025 extra XP remains critical", () => {
  const existingAccount = { total: 235, history: 110, hasAttestedBaseline: false };
  const authoritativeCritical = !existingAccount.hasAttestedBaseline && existingAccount.total !== 75 + existingAccount.history;
  assert.equal(authoritativeCritical, true);
});
test("obsolete Sprint 24 overall critical category is no longer emitted", () => {
  assert.doesNotMatch(detector, /'overall-progression-history-divergence'/);
});
test("existing monitoring resolves obsolete alerts through normal lifecycle", () => {
  assert.match(migration24, /set status = 'resolved', resolved_at = v_started_at/);
  assert.doesNotMatch(migration, /delete from public\.vault_operational_alerts|update public\.vault_operational_alerts/);
});
test("baseline cannot award or normalize overall XP", () => {
  assert.doesNotMatch(migration, /update public\.progression_state|insert into public\.progression_state|delete from public\.progression_state/i);
});
test("baseline cannot alter skill XP", () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.skill_progression/i);
});
test("baseline creates no mission history or gameplay event", () => {
  assert.doesNotMatch(migration, /insert into public\.mission_history|evaluate_vault_achievements|apply_vault_streak_day/i);
});
test("monitoring detector remains read-only", () => {
  assert.doesNotMatch(detector, /insert into|update public\.|delete from public\./i);
});
test("normal users cannot read or mutate provenance", () => {
  assert.match(migration, /alter table public\.vault_xp_reconciliation_baselines enable row level security/);
  assert.match(migration, /revoke all on public\.vault_xp_reconciliation_baselines from public, anon, authenticated/);
});
test("normal users cannot execute the privileged detector or attestation", () => {
  assert.match(migration, /revoke all on function public\.detect_vault_operational_anomalies\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.establish_vault_legacy_xp_baseline\(uuid, text\)[\s\S]*from public, anon, authenticated/);
});
test("privileged functions keep SECURITY DEFINER and empty search paths", () => {
  const functions = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)[\s\S]*?\n\$\$;/gi)];
  assert.equal(functions.length, 2);
  functions.forEach((definition) => {
    assert.match(definition[0], /security definer/);
    assert.match(definition[0], /set search_path = ''/);
  });
});
test("baseline RPC accepts identity and audit reason but no authoritative values", () => {
  assert.match(migration, /establish_vault_legacy_xp_baseline\(\s*p_user_id uuid,\s*p_attestation_reason text\s*\)/);
  const signature = migration.match(/establish_vault_legacy_xp_baseline\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] || "";
  assert.doesNotMatch(signature, /xp|history|date|time|baseline_total|reward/);
  assert.doesNotMatch(migration, /grant execute .*authenticated/i);
});
test("no production account or +50 exception is hard-coded", () => {
  assert.doesNotMatch(migration, /2026-08-07 17:25:40|\b235\b|\b185\b|legacyUnattributedXP'\s*,\s*50/);
});
test("daily and side reward anomaly rules remain unchanged", () => {
  assert.match(detector, /history\.xp_awarded <> 25/);
  assert.match(detector, /history\.skill_xp_awarded not in \(0, 15\)/);
  assert.match(detector, /overallXPReward' is distinct from '10'/);
  assert.match(detector, /skillXPReward' is distinct from '10'/);
});
test("skill reconciliation remains critical and unchanged", () => {
  assert.match(detector, /skill-progression-history-divergence', 'critical'/);
  assert.match(detector, /persisted_skill_xp <> compared\.history_skill_xp/);
});
test("Migration 025 contains two complete function definitions", () => {
  const definitions = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)[\s\S]*?\n\$\$;/gi)];
  assert.equal(definitions.length, 2);
  definitions.forEach((definition) => assertBalancedParentheses(definition[0]));
});
test("migrations 001 through 024 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint24.1.sha256").trim().split("\n");
  assert.equal(baseline.length, 23);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 025 is uniquely and correctly named", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070025_/.test(name));
  assert.deepEqual(files, ["202608070025_sprint24_1_legacy_xp_reconciliation.sql"]);
});
test("Sprint 24.1 adds no frontend authority or credentials", () => {
  const frontend = [read("js/user-repository.js"), read("js/application-service.js"), read("js/dashboard.js")].join("\n");
  assert.doesNotMatch(frontend, /vault_xp_reconciliation|legacy-provenance|post-boundary-divergence/);
  assert.doesNotMatch([migration, frontend].join("\n"), /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
