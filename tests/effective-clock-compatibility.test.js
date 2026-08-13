"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070021_sprint21_1_effective_clock_compatibility.sql");
const migration12 = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration15 = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
const migration16 = read("supabase/migrations/202608070016_sprint15_mission_catalog.sql");
const migration18 = read("supabase/migrations/202608070018_sprint19_daily_mission_choice.sql");
const migration19 = read("supabase/migrations/202608070019_sprint20_skill_paths.sql");
const migration20 = read("supabase/migrations/202608070020_sprint21_skill_path_mission_offers.sql");
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("production without Migration 012 conditionally receives the fallback", () => {
  assert.match(migration, /if pg_catalog\.to_regprocedure\('public\.dev_effective_vault_now\(\)'\) is null then/i);
  assert.match(migration, /create function public\.dev_effective_vault_now\(\)/i);
});

test("fallback is exactly zero argument and returns timestamptz", () => {
  assert.match(migration, /create function public\.dev_effective_vault_now\(\)\s+returns timestamptz/i);
  assert.doesNotMatch(migration, /dev_effective_vault_now\([^)]*(?:date|time|uuid|text)/i);
});

test("fallback returns only real database clock semantics", () => {
  const body = migration.match(/as \$body\$([\s\S]*?)\$body\$/i)?.[1] || "";
  assert.match(body, /^\s*select pg_catalog\.clock_timestamp\(\);\s*$/i);
  assert.doesNotMatch(body, /current_timestamp|statement_timestamp|transaction_timestamp|now\(\)/i);
});

test("fallback accepts no browser-controlled time, owner, or environment input", () => {
  assert.doesNotMatch(migration, /auth\.uid|p_(?:user|date|time|daily|timezone|offset|environment)|current_setting/i);
});

test("existing staging helper is never overwritten", () => {
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\.dev_effective_vault_now/i);
  assert.match(migration, /to_regprocedure[\s\S]*is null[\s\S]*create function public\.dev_effective_vault_now/);
});

test("Migration 012 simulated clock implementation remains intact", () => {
  assert.equal(crypto.createHash("sha256").update(migration12).digest("hex"), "05610d22966480eccd16160b6fae8342120477bf464f7d9ae2afa205e8a9ec7b");
  assert.match(migration12, /public\.dev_tools_authorized\(v_user_id\)[\s\S]*public\.dev_test_state[\s\S]*coalesce\(v_simulated_now, clock_timestamp\(\)\)/i);
});

test("production fallback creates no developer tables or configuration", () => {
  assert.doesNotMatch(migration, /dev_environment_config|dev_test_accounts|dev_test_state|create table/i);
});

test("fallback enables no public, anonymous, or authenticated clock execution", () => {
  assert.match(migration, /revoke all on function public\.dev_effective_vault_now\(\) from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*dev_effective_vault_now/i);
});

test("fallback is a safe internal SECURITY DEFINER function", () => {
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /language sql\s+volatile/i);
});

test("Sprint 15 mission builder dependency resolves through the helper", () => {
  assert.match(migration16, /create or replace function public\.build_vault_daily_mission[\s\S]*v_now timestamptz := public\.dev_effective_vault_now\(\)/i);
});

test("Sprint 19 Daily Mission Choice dependency resolves through the helper", () => {
  assert.match(migration18, /create or replace function public\.select_daily_mission_choice[\s\S]*v_now timestamptz := public\.dev_effective_vault_now\(\)/i);
});

test("all three Sprint 21 offer dependencies resolve through the helper", () => {
  for (const functionName of [
    "get_skill_path_mission_offers",
    "request_skill_path_mission_offers",
    "select_skill_path_mission_offer",
  ]) {
    assert.match(migration20, new RegExp(`create or replace function public\\.${functionName}[\\s\\S]*?v_now timestamptz := public\\.dev_effective_vault_now\\(\\)`, "i"));
  }
  assert.equal((migration20.match(/public\.dev_effective_vault_now\(\)/g) || []).length, 3);
});

test("primary completion rewards remain exactly 25 overall and 15 skill XP", () => {
  const achievements = read("supabase/migrations/202608070011_sprint11_achievements.sql");
  assert.match(achievements, /if v_reward <> 25 then/i);
  assert.match(achievements, /v_skill_reward := 15/i);
});

test("streak and achievement authority remain unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(migration15).digest("hex"), "c91879fb8c23577e91a27d635e4c5c7845ff9e94d9e9ed2d6f21412799b8d763");
  assert.doesNotMatch(migration, /user_streak_state|user_achievements|achievement_catalog/i);
});

test("Skill Paths and Migration 020 remain unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(migration19).digest("hex"), "717d0a79a7d0cc25aaf79f86484fb50223208d26a60193cc0f845e2473179971");
  assert.equal(crypto.createHash("sha256").update(migration20).digest("hex"), "9418ce464d8a5e6538e22c3a35177175eda2a4259ae38b144ae691a5cff32935");
});

test("Migration 021 is database-only and frontend files contain no compatibility implementation", () => {
  const frontend = ["dashboard.html", "js/application-service.js", "js/dashboard.js", "js/user-repository.js"]
    .map(read).join("\n");
  assert.doesNotMatch(frontend, /dev_effective_vault_now|clock_timestamp/i);
});

test("migrations 001 through 020 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint21.1.sha256").trim().split("\n");
  assert.equal(baseline.length, 19);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("Migration 021 is the only Sprint 21.1 migration", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.includes("sprint21_1"));
  assert.deepEqual(files, ["202608070021_sprint21_1_effective_clock_compatibility.sql"]);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
