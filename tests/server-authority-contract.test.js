"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migrationPath = path.join(root, "supabase/migrations/202608070005_sprint8_server_authority.sql");
const sql = fs.readFileSync(migrationPath, "utf8");
const applicationService = fs.readFileSync(path.join(root, "js/application-service.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "js/dashboard.js"), "utf8");
const repository = fs.readFileSync(path.join(root, "js/user-repository.js"), "utf8");

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("Sprint 8 RPC signature accepts only mission id and action", () => {
  const signature = sql.match(/create or replace function public\.request_vault_mission_action\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] || "";
  assert.match(signature, /p_mission_id\s+text/i);
  assert.match(signature, /p_action\s+text/i);
  assert.doesNotMatch(signature, /xp|reward|user_id|lifecycle|history/i);
});

test("trusted functions derive identity from auth.uid and reject missing identity", () => {
  const actionBody = sql.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;\n\nrevoke all/i)?.[0] || "";
  assert.match(actionBody, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(actionBody, /if v_user_id is null then[\s\S]*errcode = '42501'/i);
  assert.doesNotMatch(actionBody, /p_user_id/i);
});

test("daily mission and progression rows are locked in a consistent order", () => {
  const dailyLock = sql.indexOf("from public.daily_mission_state", sql.indexOf("public.request_vault_mission_action"));
  const progressionLock = sql.indexOf("from public.progression_state", dailyLock);
  assert.ok(dailyLock > 0);
  assert.ok(progressionLock > dailyLock);
  assert.match(sql.slice(dailyLock, progressionLock + 100), /daily_mission_state[\s\S]*for update[\s\S]*progression_state[\s\S]*for update/i);
});

test("authoritative lifecycle transition matrix is enforced in SQL", () => {
  assert.match(sql, /v_action = 'start' and v_previous_state = 'ready'/i);
  assert.match(sql, /v_action = 'complete' and v_previous_state in \('ready', 'active'\)/i);
  assert.match(sql, /v_action = 'skip' and v_previous_state in \('ready', 'active'\)/i);
  assert.match(sql, /v_previous_state = 'completed'[\s\S]*'already-completed'/i);
  assert.match(sql, /v_previous_state = 'expired'[\s\S]*'mission-expired'/i);
});

test("database canonicalizes and awards only the saved 25 XP reward", () => {
  assert.match(sql, /jsonb_set\(p_mission_definition, '\{xpReward\}', '25'::jsonb, true\)/i);
  assert.match(sql, /v_reward := \(v_daily_state\.mission_definition ->> 'xpReward'\)::integer/i);
  assert.match(sql, /v_total_xp := v_total_xp \+ v_reward/i);
  assert.doesNotMatch(sql.match(/public\.request_vault_mission_action\(([\s\S]*?)\)\s*returns/i)?.[1] || "", /p_total_xp|p_xp_reward/i);
});

test("mission, progression, and terminal history mutate inside one function", () => {
  const body = sql.slice(sql.indexOf("create or replace function public.request_vault_mission_action"));
  assert.match(body, /update public\.progression_state/i);
  assert.match(body, /insert into public\.mission_history/i);
  assert.match(body, /update public\.daily_mission_state/i);
  assert.match(body, /security definer[\s\S]*set search_path = ''/i);
});

test("terminal history is server-built and duplicate-safe", () => {
  assert.match(sql, /insert into public\.mission_history[\s\S]*v_xp_awarded[\s\S]*on conflict \(user_id, daily_session_id, mission_id, terminal_at\) do nothing/i);
  assert.match(sql, /v_history_record := jsonb_build_object/i);
  assert.doesNotMatch(sql.match(/public\.request_vault_mission_action\(([\s\S]*?)\)\s*returns/i)?.[1] || "", /history/i);
});

test("direct authoritative table writes and prototype completion execution remain revoked", () => {
  assert.match(sql, /revoke insert, update on public\.progression_state from authenticated/i);
  assert.match(sql, /revoke insert, update on public\.daily_mission_state from authenticated/i);
  assert.match(sql, /revoke insert on public\.mission_history from authenticated/i);
  assert.match(sql, /revoke all on function public\.persist_validated_prototype_progression[\s\S]*from authenticated/i);
});

test("RLS remains enabled on every user-owned product table", () => {
  const foundation = fs.readFileSync(path.join(root, "supabase/migrations/202608070001_sprint7_foundation.sql"), "utf8");
  for (const table of ["profiles", "onboarding_profiles", "progression_state", "daily_mission_state", "mission_history"]) {
    assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.doesNotMatch(sql, /disable row level security/i);
});

test("installed migrations 001 through 004 remain byte-for-byte unchanged", () => {
  const expected = {
    "202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
  };
  for (const [name, digest] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(root, "supabase/migrations", name));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), digest);
  }
});

test("production dashboard uses authoritative mode and no raw Supabase query", () => {
  assert.match(dashboard, /transitionMode:\s*"authoritative"/);
  assert.doesNotMatch(dashboard, /\.from\(|\.rpc\(|supabase/i);
  assert.match(applicationService, /repository\.requestMissionAction\(\{/i);
  assert.doesNotMatch(dashboard, /persistValidatedPrototypeProgression/i);
});

test("repository action payload and response contract remain narrow and immutable", () => {
  const requestBody = repository.match(/const requestMissionAction = async[\s\S]*?\n    };/)?.[0] || "";
  assert.match(requestBody, /p_mission_id:\s*normalizedMissionId/i);
  assert.match(requestBody, /p_action:\s*normalizedAction/i);
  assert.doesNotMatch(requestBody, /p_total_xp|p_user_id|p_lifecycle|p_history/i);
  assert.match(repository, /return deepFreeze\(mapped\)/i);
  for (const key of ["accepted", "reason", "event", "mission", "progression", "dailyStatus", "historyRecord"]) {
    assert.match(repository, new RegExp(`${key}:`));
  }
});

test("frontend contains no service-role key or private credential", () => {
  const frontend = fs.readdirSync(path.join(root, "js"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(root, "js", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
