"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath)))
  .digest("hex");

const migration = read("supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql");
const dailyFunction = migration.match(
  /create or replace function public\.request_daily_mission_at_sprint9[\s\S]*?\$\$;/i,
)?.[0] || "";
const replacementFunction = migration.match(
  /create or replace function public\.request_daily_mission_replacement_sprint9[\s\S]*?\$\$;/i,
)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("active hotfix definitions contain no public.gen_random_uuid reference", () => {
  assert.doesNotMatch(migration, /public\.gen_random_uuid\s*\(/i);
  assert.doesNotMatch(dailyFunction, /public\.gen_random_uuid\s*\(/i);
  assert.doesNotMatch(replacementFunction, /public\.gen_random_uuid\s*\(/i);

  // Migration 006 remains immutable historical input. Migration 009 replaces
  // both affected active definitions, so pg_proc no longer retains that call.
  assert.equal((dailyFunction.match(/extensions\.gen_random_uuid\s*\(\)/gi) || []).length, 1);
  assert.equal((replacementFunction.match(/extensions\.gen_random_uuid\s*\(\)/gi) || []).length, 1);
});

test("authoritative daily generation uses a server-created UUID", () => {
  assert.match(dailyFunction, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(
    dailyFunction,
    /v_definition := public\.build_vault_daily_mission\(\s*v_onboarding,\s*extensions\.gen_random_uuid\(\)\s*\)/i,
  );
  assert.match(dailyFunction, /on conflict \(user_id, daily_key\) do nothing/i);
});

test("authoritative replacement generates a distinct new UUID invocation", () => {
  assert.match(
    replacementFunction,
    /mission_definition = public\.build_vault_daily_mission\(\s*v_onboarding,\s*extensions\.gen_random_uuid\(\)\s*\)/i,
  );
  assert.match(replacementFunction, /replacements_used = 1/i);
  assert.equal((dailyFunction.match(/extensions\.gen_random_uuid\s*\(\)/gi) || []).length, 1);
  assert.equal((replacementFunction.match(/extensions\.gen_random_uuid\s*\(\)/gi) || []).length, 1);
});

test("daily creation remains server-authoritative", () => {
  assert.match(dailyFunction, /security definer[\s\S]*set search_path = ''/i);
  assert.match(dailyFunction, /public\.current_vault_daily_key\(v_user_id, v_now\)/i);
  assert.match(dailyFunction, /from public\.onboarding_profiles[\s\S]*where user_id = v_user_id and completed = true/i);
  assert.match(dailyFunction, /'ready', false, 0, null, false/i);
});

test("replacement authority and limit are unchanged", () => {
  assert.match(replacementFunction, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(replacementFunction, /if v_state\.replacements_used >= 1 then/i);
  assert.match(replacementFunction, /'replacement-limit-reached'/i);
  assert.doesNotMatch(replacementFunction, /update public\.progression_state/i);
});

test("Sprint 10 skill progression remains unchanged", () => {
  assert.equal(
    hash("supabase/migrations/202608070008_sprint10_skill_progression.sql"),
    "64dc03d5454f0b785e28966848b89639810a898d5fd4f511d50e209246c8e837",
  );
  assert.doesNotMatch(migration, /(?:create|alter|update|insert into)\s+(?:table\s+)?public\.skill_/i);
  assert.doesNotMatch(migration, /request_vault_mission_action|get_skill_progression/i);
});

test("frontend receives no new UUID-generation authority", () => {
  const unchangedProductionFiles = {
    "js/application-service.js": "11c0109e187e09967ed6c3c5beae4f7e7ff397e50146027f3e2e56be61f954e0",
    "js/dashboard.js": "60b69b0821bf22645748785a62c8ab5861ecd561f95bf6bae3c75aba706b314f",
    "js/mission-generator.js": "46159c7e01aa9990f8b4374b5d1f81355e4dc1baf0d6c476bd9390dd98b4a282",
    "js/user-repository.js": "70a39141a787b739243a713d464313ecb687e15360d4b189c987c3a82f0b7885",
    "dashboard.html": "483c783ca85af0cc385df8c32412b1167e531d3257e8cc0a0315c578a6530331",
  };

  Object.entries(unchangedProductionFiles)
    .forEach(([file, digest]) => assert.equal(hash(file), digest, file));

  const productionBoundary = [
    read("js/application-service.js"),
    read("js/dashboard.js"),
    read("js/user-repository.js"),
  ].join("\n");
  assert.doesNotMatch(productionBoundary, /gen_random_uuid|randomUUID\s*\(|uuidv4\s*\(|p_instance_id/i);
  assert.doesNotMatch(productionBoundary, /service_role|postgres(?:ql)?:\/\//i);
});

test("migrations 001 through 008 remain byte-for-byte unchanged", () => {
  const expected = {
    "supabase/migrations/202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "supabase/migrations/202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
    "supabase/migrations/202608070005_sprint8_server_authority.sql": "370fc5fa159a8462599641859091ad4bc8a382e27553356a888fa863026cae41",
    "supabase/migrations/202608070006_sprint9_daily_mission_authority.sql": "a8967a586e72bf6685dd0903e6e811c12fddf2edc5eb04c727af790ba3975d4d",
    "supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql": "9ab697276e7d372b9275dd271d6b281568c10f167b62521b8570eb603411ef3e",
    "supabase/migrations/202608070008_sprint10_skill_progression.sql": "64dc03d5454f0b785e28966848b89639810a898d5fd4f511d50e209246c8e837",
  };

  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  if (failures) process.exitCode = 1;
})();
