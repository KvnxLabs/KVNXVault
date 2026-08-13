"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070023_sprint23_side_mission_observability.sql");
const migration12 = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration21 = read("supabase/migrations/202608070021_sprint21_1_effective_clock_compatibility.sql");
const migration22 = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
const analytics22 = migration22.match(/create or replace function public\.get_vault_analytics[\s\S]*?grant execute on function public\.get_vault_analytics\(text\) to authenticated;/i)?.[0] || "";
const trigger = migration.match(/create or replace function public\.capture_side_mission_lifecycle_event[\s\S]*?\$\$;/i)?.[0] || "";
const observability = migration.match(/create or replace function public\.get_side_mission_observability[\s\S]*?\$\$;/i)?.[0] || "";
const audit = migration.match(/create or replace function public\.audit_side_mission_invariants[\s\S]*?\$\$;/i)?.[0] || "";

const stripSqlLiteralsAndComments = (sql) => sql
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/'(?:''|[^'])*'/g, "''");

const assertBalancedParentheses = (sql, label) => {
  const source = stripSqlLiteralsAndComments(sql);
  let depth = 0;
  for (const character of source) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0, `${label} closes a parenthesis before it opens`);
  }
  assert.equal(depth, 0, `${label} has an unterminated parenthesized expression`);
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("Migration 023 creates an authoritative lifecycle event ledger", () => {
  assert.match(migration, /create table public\.side_mission_event_ledger/);
  assert.match(migration, /event_type in \('promoted', 'started', 'completed', 'expired'\)/);
});
test("every Migration 023 function definition is dollar-terminated and structurally balanced", () => {
  const definitions = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)[\s\S]*?\n\$\$;/gi)];
  assert.equal(definitions.length, 3);
  for (const definition of definitions) {
    const body = definition[0].match(/\bas \$\$([\s\S]*)\n\$\$;/i)?.[1];
    assert.ok(body, `${definition[1]} has a complete dollar-quoted body`);
    assertBalancedParentheses(body, definition[1]);
  }
});
test("observability closes the outer JSON object before INTO and FROM", () => {
  assert.match(observability, /'recentActivity'[\s\S]*?\), '\[\]'::jsonb\)\)\s+into v_result\s+from lifecycle/i);
  assertBalancedParentheses(observability.match(/\bas \$\$([\s\S]*)\n\$\$;/i)?.[1] || "", "get_side_mission_observability");
});
test("event identity is unique per mission and lifecycle transition", () => {
  assert.match(migration, /unique \(mission_id, event_type\)/);
  assert.match(trigger, /on conflict \(mission_id, event_type\) do nothing/);
});
test("promotion is captured only from an authoritative state insert", () => {
  assert.match(trigger, /if tg_op = 'INSERT'[\s\S]*v_event_type := 'promoted'/);
  assert.match(migration, /after insert or update on public\.side_mission_state/);
});
test("start is captured only from the saved active transition", () => {
  assert.match(trigger, /old\.lifecycle_state is distinct from new\.lifecycle_state[\s\S]*when 'active'[\s\S]*new\.started_at/);
});
test("completion is captured once with exact +10 and +10", () => {
  assert.match(trigger, /when 'completed'[\s\S]*v_overall_xp := 10;[\s\S]*v_skill_xp := 10/);
  assert.match(migration, /event_type = 'completed' and overall_xp_awarded = 10 and skill_xp_awarded = 10/);
});
test("expiration is captured once from authoritative updated_at", () => {
  assert.match(trigger, /when 'expired'[\s\S]*v_occurred_at := new\.updated_at/);
  assert.match(migration, /unique \(mission_id, event_type\)/);
});
test("non-completion events can never claim a reward", () => {
  assert.match(migration, /event_type <> 'completed' and overall_xp_awarded = 0 and skill_xp_awarded = 0/);
});
test("browser rejection and retry telemetry cannot enter the ledger", () => {
  assert.doesNotMatch(migration, /rejected_event|client_event|telemetry_payload|p_event/);
  assert.match(migration, /revoke all on public\.side_mission_event_ledger from public, anon, authenticated/);
});
test("event timestamps and identity come only from persisted Side Mission state", () => {
  assert.match(trigger, /new\.user_id, new\.daily_key, new\.mission_id, new\.skill_key/);
  assert.doesNotMatch(trigger.match(/\(([^)]*)\)\s*returns trigger/i)?.[1] || "", /user|date|time|skill|reward/i);
});
test("live lifecycle events share the originating transaction", () => {
  assert.match(migration, /after insert or update on public\.side_mission_state/);
  assert.doesNotMatch(trigger, /dblink|http|net\.|commit|rollback/);
});
test("pre-Sprint-23 promotion and start are reconciled from persisted timestamps", () => {
  assert.match(migration, /'promoted', 0, 0, state\.created_at, 'migration_reconciliation'/);
  assert.match(migration, /'started', 0, 0, state\.started_at, 'migration_reconciliation'/);
});
test("historical completion is reconstructed only with exact verified history", () => {
  assert.match(migration, /state\.lifecycle_state = 'completed'[\s\S]*history\.mission_type = 'side'[\s\S]*history\.xp_awarded = 10[\s\S]*history\.skill_xp_awarded = 10/);
});
test("historical expiration is reconstructed only from authoritative expired state", () => {
  assert.match(migration, /'expired', 0, 0, state\.updated_at, 'migration_reconciliation'[\s\S]*state\.lifecycle_state = 'expired'/);
});
test("duplicate legacy completion causes an explicit migration failure", () => {
  assert.match(migration, /having count\(\*\) > 1[\s\S]*raise exception 'Duplicate rewarded Side Mission history/);
});
test("one rewarded Side Mission history row per owner logical day is indexed", () => {
  assert.match(migration, /create unique index mission_history_one_side_completion_per_day[\s\S]*\(user_id, daily_session_id\)[\s\S]*mission_type = 'side'/);
});
test("one rewarded history row per Side Mission instance is indexed", () => {
  assert.match(migration, /create unique index mission_history_one_side_completion_per_instance[\s\S]*\(user_id, mission_id\)/);
});
test("owner observability accepts only a bounded period", () => {
  assert.match(observability, /p_period text/);
  assert.match(observability, /v_period not in \('7d', '30d', 'all'\)/);
});
test("owner observability derives identity and logical day server-side", () => {
  assert.match(observability, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(observability, /current_vault_daily_key\(v_user_id, v_now\)/);
});
test("production and staging continue through the established effective clock", () => {
  assert.match(observability, /public\.dev_effective_vault_now\(\)/);
  assert.equal(crypto.createHash("sha256").update(migration21).digest("hex"), "15f51e1181e7f4489419d5823cc5e0c28325fb01748a4aa314bd6bac5e023062");
  assert.match(migration12, /dev_effective_vault_now/);
});
test("lifecycle metrics expose promoted started completed and expired counts", () => {
  for (const name of ["promoted", "started", "completed", "expired"]) {
    assert.match(observability, new RegExp(`event_type = '${name}'`));
  }
});
test("completion rate is a mathematically explicit promotion cohort rate", () => {
  assert.match(observability, /promotion_cohort as materialized/);
  assert.match(observability, /cohort\.completed::numeric \/ cohort\.promoted::numeric/);
});
test("economy totals derive from mission_history rather than event sums", () => {
  assert.match(observability, /filtered_history as materialized[\s\S]*public\.mission_history/);
  assert.match(observability, /sum\(xp_awarded\)[\s\S]*sum\(skill_xp_awarded\)/);
});
test("economy diagnostics include canonical XP by skill", () => {
  assert.match(observability, /join public\.skill_catalog as catalog on catalog\.skill_key = history\.skill_key/);
  assert.match(observability, /'xpBySkill'/);
});
test("recent lifecycle activity is bounded to twenty rows", () => {
  assert.match(observability, /'recentActivity'[\s\S]*limit 20/);
});
test("observability is read-only", () => {
  assert.doesNotMatch(observability, /insert into|update public|delete from|evaluate_vault_achievements/);
});
test("authenticated execution exposes only the caller's diagnostics", () => {
  assert.match(migration, /grant execute on function public\.get_side_mission_observability\(text\) to authenticated/);
  assert.match(observability, /event\.user_id = v_user_id/);
  assert.match(observability, /history\.user_id = v_user_id/);
});
test("administrator invariant audit is read-only and not browser executable", () => {
  assert.match(audit, /language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.audit_side_mission_invariants\(\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.audit_side_mission_invariants/);
});
test("every audit UNION branch returns the exact five-column invariant shape", () => {
  const body = audit.match(/\bas \$\$([\s\S]*)\n\$\$;/i)?.[1] || "";
  const branches = body.replace(/;\s*$/, "").split(/\s+union all\s+/i);
  assert.equal(branches.length, 9);
  for (const [index, branch] of branches.entries()) {
    assert.match(branch, /^\s*select\s+/i, `branch ${index + 1} is a SELECT`);
    const fromIndex = branch.search(/\sfrom\s+public\./i);
    assert.ok(fromIndex > 0, `branch ${index + 1} has an authoritative FROM`);
    const projection = stripSqlLiteralsAndComments(branch.slice(0, fromIndex));
    let depth = 0;
    let commas = 0;
    for (const character of projection) {
      if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
      else if (character === "," && depth === 0) commas += 1;
    }
    assert.equal(commas, 4, `branch ${index + 1} returns exactly five columns`);
  }
});
test("audit aggregate branch groups every non-aggregate source expression", () => {
  const duplicateBranch = audit.match(/select 'duplicate-side-history-day'[\s\S]*?having count\(\*\) > 1;/i)?.[0] || "";
  assert.match(duplicateBranch, /history\.user_id/);
  assert.match(duplicateBranch, /public\.parse_vault_daily_key\(history\.daily_session_id\)/);
  assert.match(duplicateBranch, /group by history\.user_id, history\.daily_session_id/);
  assert.match(duplicateBranch, /null::uuid/);
  assert.match(duplicateBranch, /jsonb_build_object\('count', count\(\*\)\)/);
});
test("audit verifies completed state against exact Side Mission history", () => {
  assert.match(audit, /completed-state-history-mismatch[\s\S]*history\.mission_type = 'side'[\s\S]*history\.xp_awarded = 10[\s\S]*history\.skill_xp_awarded = 10/);
});
test("audit detects orphan or mismatched Side Mission history", () => {
  assert.match(audit, /side-history-state-mismatch/);
  assert.match(audit, /state\.skill_key = history\.skill_key/);
});
test("audit detects missing authoritative completion events", () => {
  assert.match(audit, /completed-event-missing[\s\S]*event\.event_type = 'completed'/);
});
test("audit detects missing promotion start and expiration events", () => {
  assert.match(audit, /promoted-event-missing[\s\S]*event\.event_type = 'promoted'/);
  assert.match(audit, /started-event-missing[\s\S]*event\.event_type = 'started'/);
  assert.match(audit, /expired-event-missing[\s\S]*event\.event_type = 'expired'/);
});
test("audit detects event ownership day or canonical skill mismatch", () => {
  assert.match(audit, /event-state-identity-mismatch/);
  assert.match(audit, /event\.user_id <> state\.user_id[\s\S]*event\.daily_key <> state\.daily_key[\s\S]*event\.skill_key <> state\.skill_key/);
});
test("audit detects impossible rewarded non-completed state", () => {
  assert.match(audit, /rewarded-noncompleted-state/);
});
test("ledger has RLS and no browser table privileges", () => {
  assert.match(migration, /alter table public\.side_mission_event_ledger enable row level security/);
  assert.match(migration, /revoke all on public\.side_mission_event_ledger from public, anon, authenticated/);
});
test("internal trigger helper uses SECURITY DEFINER and empty search path", () => {
  assert.match(trigger, /security definer/);
  assert.match(trigger, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.capture_side_mission_lifecycle_event\(\)/);
});
test("diagnostics cannot mutate economy or lifecycle state", () => {
  assert.doesNotMatch([observability, audit].join("\n"), /update public\.(?:progression_state|skill_progression|side_mission_state)|insert into public\.mission_history/);
});
test("Sprint 22 exact +10 and +10 completion economy remains unchanged", () => {
  assert.match(migration22, /v_total_xp := v_total_xp \+ 10/);
  assert.match(migration22, /v_skill_total := v_skill_total \+ 10/);
  assert.equal(crypto.createHash("sha256").update(migration22).digest("hex"), "ad958272c69b4050779e5c028ed7fa6ad27b2765ba28a7fcd1705180052e7efc");
});
test("duplicate and concurrent reward safety remains in Sprint 22", () => {
  assert.match(migration22, /pg_advisory_xact_lock/);
  assert.match(migration22, /from public\.side_mission_state[\s\S]*for update/);
  assert.match(migration22, /'already-completed'/);
});
test("Side Mission streak exclusion remains exact", () => {
  assert.match(migration22, /new\.final_state <> 'completed' or new\.mission_type <> 'daily'/);
  assert.doesNotMatch(migration, /apply_vault_streak_day|update public\.user_streak_state/);
});
test("Daily Complete replacement and primary mission state remain isolated", () => {
  assert.doesNotMatch(migration, /daily_mission_state|daily_mission_choice_state|replacements_used|nextResetAt/);
});
test("Daily and Side Analytics counts remain distinct", () => {
  assert.match(analytics22, /dailyMissionsCompleted/);
  assert.match(analytics22, /sideMissionsCompleted/);
  assert.match(analytics22, /history\.mission_type = 'daily'/);
  assert.match(analytics22, /history\.mission_type = 'side'/);
});
test("achievement evaluation is neither replaced nor invoked by observability", () => {
  assert.doesNotMatch(migration, /create or replace function public\.evaluate_vault_achievements|public\.evaluate_vault_achievements\(/);
});
test("no development clock capability or development table is introduced", () => {
  assert.doesNotMatch(migration, /create (?:table|function) public\.dev_|dev_environment_config|dev_test_accounts|dev_test_state/);
});
test("no frontend or client-authoritative telemetry is added", () => {
  const frontend = [read("js/user-repository.js"), read("js/application-service.js"), read("js/dashboard.js")].join("\n");
  assert.doesNotMatch(frontend, /side_mission_event_ledger|get_side_mission_observability|audit_side_mission_invariants/);
  assert.doesNotMatch(migration, /p_user_id|p_daily_key|p_reward|p_skill_xp|p_lifecycle/);
});
test("migrations 001 through 022 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint23.sha256").trim().split("\n");
  assert.equal(baseline.length, 21);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 023 is uniquely and correctly named", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070023_/.test(name));
  assert.deepEqual(files, ["202608070023_sprint23_side_mission_observability.sql"]);
});
test("JavaScript syntax HTML references and secret boundaries remain valid", () => {
  for (const file of fs.readdirSync(path.join(root, "js")).filter((name) => name.endsWith(".js"))) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js", file)]).status, 0, file);
  }
  const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
  for (const file of htmlFiles) {
    const html = read(file);
    for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) {
      assert.equal(fs.existsSync(path.join(root, match[1])), true, `${file}: ${match[1]}`);
    }
  }
  assert.doesNotMatch([migration, ...fs.readdirSync(path.join(root, "js")).map((file) => read(`js/${file}`))].join("\n"), /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
