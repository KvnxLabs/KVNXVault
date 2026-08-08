"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const loader = require("../js/dev-tools-loader.js");
const repositoryFactory = require("../js/dev-tools-repository.js");
const panel = require("../js/dev-tools.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const migration = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration008 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration009 = read("supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql");
const migration011 = read("supabase/migrations/202608070011_sprint11_achievements.sql");
const loaderSource = read("js/dev-tools-loader.js");
const repositorySource = read("js/dev-tools-repository.js");
const panelSource = read("js/dev-tools.js");
const configSource = read("js/config.js");

const functionBody = (source, name, signature = "") => source.match(
  new RegExp(`create or replace function public\\.${name}\\(${signature}\\)[\\s\\S]*?\\$\\$;`, "i"),
)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("dev panel is hidden and modules stay unloaded when frontend tooling is disabled", () => {
  assert.equal(loader.canActivateDevTools({
    devToolsEnabled: false,
    devToolsAllowedHosts: ["localhost"],
  }, "localhost"), false);
  assert.match(configSource, /devToolsEnabled: false/);
  assert.match(loaderSource, /if \(!root \|\| !documentRef \|\| !canActivateDevTools/);
});

test("dev RPCs reject execution while the server development flag is disabled", () => {
  assert.match(migration, /insert into public\.dev_environment_config[\s\S]*values \(true, false\)/i);
  assert.match(migration, /if not public\.dev_tools_authorized\(v_user_id\) then[\s\S]*Development tools are unavailable/i);
});

test("every development authority derives identity from auth.uid", () => {
  assert.match(migration, /create or replace function public\.dev_require_tools\(\)[\s\S]*v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /dev_test_accounts as account[\s\S]*account\.user_id = p_user_id/i);
  assert.match(migration, /dev_test_state as state[\s\S]*state\.user_id = v_user_id/i);
});

test("browser cannot submit another user id", async () => {
  const calls = [];
  const repository = repositoryFactory.createDevToolsRepository({
    authService: {
      getCurrentUser: async () => ({ id: "account-a" }),
      getClient: () => ({
        rpc: async (...args) => {
          calls.push(args);
          return { data: {
            testClockEnabled: true,
            simulatedNow: "2026-08-07T18:00:00Z",
            realDatabaseNow: "2026-08-07T18:00:00Z",
            nextResetAt: "2026-08-08T04:00:00Z",
          }, error: null };
        },
      }),
    },
  });
  await repository.advanceOneHour({ userId: "account-b" });
  assert.deepEqual(calls, [["dev_advance_one_hour"]]);
  assert.doesNotMatch(repositorySource, /p_user_id|userId/);
});

test("browser cannot submit or directly grant XP", () => {
  assert.doesNotMatch(repositorySource, /\b(?:xp|reward|totalXP|skillXP)\b/i);
  assert.doesNotMatch(migration, /create or replace function public\.dev_[^(]+\([^)]*(?:xp|reward)/i);
  assert.doesNotMatch(migration, /dev_(?:grant|set).*xp/i);
});

test("browser cannot submit or directly unlock achievements", () => {
  assert.doesNotMatch(repositorySource, /achievement|unlock/i);
  assert.doesNotMatch(migration, /create or replace function public\.dev_[^(]+\([^)]*achievement/i);
  assert.doesNotMatch(migration, /dev_(?:grant|unlock).*achievement/i);
});

test("advance one hour changes only the authenticated simulated clock", () => {
  const advance = functionBody(migration, "dev_advance_one_hour");
  assert.match(advance, /state\.simulated_now \+ interval '1 hour'/i);
  assert.match(advance, /where state\.user_id = v_user_id|on conflict \(user_id\)/i);
  assert.doesNotMatch(advance, /progression_state|mission_history|skill_progression|user_achievements/i);
});

test("advance next day crosses the authoritative timezone reset boundary", () => {
  const advance = functionBody(migration, "dev_advance_to_next_day");
  assert.match(advance, /public\.next_vault_reset_at\(v_user_id, v_now\) \+ interval '1 second'/i);
  assert.match(advance, /public\.dev_effective_vault_now\(\)/i);
});

test("new daily missions still come from the existing authoritative engine", () => {
  const daily = functionBody(migration, "request_daily_mission");
  assert.match(daily, /public\.request_daily_mission_at\(v_now\)/i);
  assert.doesNotMatch(daily, /build_vault_daily_mission|insert into public\.daily_mission_state/i);
  assert.doesNotMatch(repositorySource, /mission_definition|primarySkill|xpReward/i);
});

test("previous mission rollover rules remain in the immutable daily engine", () => {
  const dailyEngine = functionBody(migration009, "request_daily_mission_at_sprint9", "p_now timestamptz");
  assert.match(dailyEngine, /daily_key < v_daily_key[\s\S]*lifecycle_state in \('ready', 'active'\)/i);
  assert.match(dailyEngine, /'expired', 0, terminal_at/i);
  assert.doesNotMatch(migration, /create or replace function public\.request_daily_mission_at_sprint9/i);
});

test("mission completion still awards exactly 25 overall XP", () => {
  const action = functionBody(migration, "request_vault_mission_action", "[\\s\\S]*?");
  assert.match(action, /if v_reward <> 25 then/i);
  assert.match(action, /v_total_xp := v_total_xp \+ v_reward/i);
});

test("skill completion still awards exactly 15 mapped XP", () => {
  const action = functionBody(migration, "request_vault_mission_action", "[\\s\\S]*?");
  assert.match(action, /v_skill_reward := 15;/i);
  assert.match(action, /v_skill_total_xp := v_skill_total_xp \+ v_skill_reward/i);
  assert.match(migration008, /when 'programming' then 'front_end_engineering'/i);
});

test("achievements unlock only through the normal Sprint 11 evaluator", () => {
  const action = functionBody(migration, "request_vault_mission_action", "[\\s\\S]*?");
  assert.match(action, /public\.evaluate_vault_achievements\(/i);
  assert.doesNotMatch(migration, /insert into public\.user_achievements/i);
  assert.match(migration011, /on conflict \(user_id, achievement_key\) do nothing/i);
});

test("one replacement rule and server UUID source remain intact", () => {
  const replacement = functionBody(migration, "request_daily_mission_replacement_sprint9");
  assert.match(replacement, /if v_state\.replacements_used >= 1 then/i);
  assert.match(replacement, /'replacement-limit-reached'/i);
  assert.match(replacement, /extensions\.gen_random_uuid\(\)/i);
  assert.match(replacement, /replacements_used = 1/i);
});

test("production RPC signatures and installed migrations remain unchanged", () => {
  assert.match(migration, /function public\.request_daily_mission\(\)/i);
  assert.match(migration, /function public\.request_daily_mission_replacement\(\)/i);
  assert.match(migration, /function public\.request_vault_mission_action\(\s*p_mission_id text,\s*p_action text\s*\)/i);
  assert.doesNotMatch(migration, /request_vault_mission_action\([^)]*(?:now|time|user|xp|reward)/i);
  const normalizeClock = (source) => source
    .replace(/public\.dev_effective_vault_now\(\)/g, "clock_timestamp()")
    .replace(/\s+/g, " ")
    .trim();
  assert.equal(
    normalizeClock(functionBody(migration, "request_vault_mission_action", "[\\s\\S]*?")),
    normalizeClock(functionBody(migration011, "request_vault_mission_action", "[\\s\\S]*?")),
  );
  assert.equal(
    normalizeClock(functionBody(migration, "request_daily_mission_replacement_sprint9")),
    normalizeClock(functionBody(migration009, "request_daily_mission_replacement_sprint9")),
  );
  assert.equal(
    normalizeClock(functionBody(migration, "get_skill_progression")),
    normalizeClock(functionBody(migration008, "get_skill_progression")),
  );
  const expected = {
    "supabase/migrations/202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "supabase/migrations/202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
    "supabase/migrations/202608070005_sprint8_server_authority.sql": "370fc5fa159a8462599641859091ad4bc8a382e27553356a888fa863026cae41",
    "supabase/migrations/202608070006_sprint9_daily_mission_authority.sql": "a8967a586e72bf6685dd0903e6e811c12fddf2edc5eb04c727af790ba3975d4d",
    "supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql": "9ab697276e7d372b9275dd271d6b281568c10f167b62521b8570eb603411ef3e",
    "supabase/migrations/202608070008_sprint10_skill_progression.sql": "64dc03d5454f0b785e28966848b89639810a898d5fd4f511d50e209246c8e837",
    "supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql": "0d308478d8ee377311f3c6cc8f29c95fa5206f13df83b37cdbc13557bf592523",
    "supabase/migrations/202608070011_sprint11_achievements.sql": "1e5a3f6af1cfc54773de233e480e06eec8be7bb1e7c4e725bcfe4fa79decdffe",
  };
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

test("clearing the test clock restores real database-time behavior", () => {
  const clear = functionBody(migration, "dev_clear_test_clock");
  const effective = functionBody(migration, "dev_effective_vault_now");
  assert.match(clear, /delete from public\.dev_test_state[\s\S]*where user_id = v_user_id/i);
  assert.match(effective, /return coalesce\(v_simulated_now, clock_timestamp\(\)\)/i);
});

test("two test accounts receive isolated simulated clock rows", () => {
  assert.match(migration, /create table public\.dev_test_state[\s\S]*user_id uuid primary key/i);
  assert.match(migration, /insert into public\.dev_test_state[\s\S]*v_user_id/i);
  assert.doesNotMatch(migration, /update public\.dev_test_state\s+set[\s\S]*where\s+(?!user_id = v_user_id)/i);
});

test("a test account cannot read or mutate another account dev state", () => {
  assert.match(migration, /alter table public\.dev_test_state enable row level security/i);
  assert.match(migration, /revoke all on public\.dev_test_state from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*dev_test_state/i);
  assert.doesNotMatch(repositorySource, /\.from\("dev_test_state"\)/i);
});

test("known and future production domains cannot activate tooling by default", () => {
  ["kvnxlabs.com", "www.kvnxlabs.com", "kvnx-vault.vercel.app"].forEach((hostname) => {
    assert.equal(loader.canActivateDevTools({
      devToolsEnabled: true,
      devToolsAllowedHosts: [hostname],
    }, hostname), false);
  });
  assert.equal(loader.canActivateDevTools({
    devToolsEnabled: true,
    devToolsAllowedHosts: ["future-production.example"],
  }, "unlisted-production.example"), false);
});

test("frontend contains no service-role key or hidden progress authority", () => {
  const frontend = [loaderSource, repositorySource, panelSource, configSource].join("\n");
  assert.doesNotMatch(frontend, /service_role\s*[:=]|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(frontend, /grantXP|setXP|unlockAchievement|setSkill|mission_definition/i);
  assert.match(panelSource, /data-dev-action="advance-day"/i);
  assert.match(panel.formatTestTime("2026-08-07T23:15:00Z"), /2026/);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
