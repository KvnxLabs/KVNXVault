"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repositoryFactory = require("../js/user-repository.js");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202608070006_sprint9_daily_mission_authority.sql"), "utf8");
const applicationService = fs.readFileSync(path.join(root, "js/application-service.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "js/dashboard.js"), "utf8");
const frontend = fs.readdirSync(path.join(root, "js"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => fs.readFileSync(path.join(root, "js", name), "utf8"))
  .join("\n");

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("daily mission RPC is zero-argument", () => {
  const signature = migration.match(/create or replace function public\.request_daily_mission\(([^)]*)\)/i)?.[1] ?? "missing";
  assert.equal(signature.trim(), "");
});

test("daily authority derives identity from auth.uid", () => {
  const body = migration.match(/create or replace function public\.request_daily_mission_at[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(body, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(body, /if v_user_id is null then[\s\S]*42501/i);
  assert.doesNotMatch(body, /p_user_id/i);
});

test("repository daily request sends no user-owned state", async () => {
  const calls = [];
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "user-a" }),
      getClient: () => ({ rpc: async (...args) => {
        calls.push(args);
        return { data: { accepted: false, reason: "onboarding-incomplete" }, error: null };
      } }),
    },
  });
  await repository.requestDailyMission({ userId: "attacker", focus: "Finance", xpReward: 999, dailyKey: "2099-01-01" });
  assert.deepEqual(calls, [["request_daily_mission"]]);
});

test("database enforces one mission per user and daily key", () => {
  assert.match(migration, /primary key \(user_id, daily_key\)/i);
  assert.match(migration, /on conflict \(user_id, daily_key\) do nothing/i);
});

test("daily key comes from server time and saved timezone", () => {
  assert.match(migration, /clock_timestamp\(\)/i);
  assert.match(migration, /profile\.timezone_name/i);
  assert.match(migration, /\(p_now at time zone v_timezone\)::date/i);
  assert.doesNotMatch(migration.match(/public\.request_daily_mission\(([^)]*)\)/i)?.[1] || "", /date|timezone|key/i);
});

test("timezone field defaults safely and validates IANA names", () => {
  assert.match(migration, /timezone_name text not null default 'UTC'/i);
  assert.match(migration, /pg_catalog\.pg_timezone_names/i);
  assert.match(migration, /profiles_timezone_name_valid/i);
});

test("same-day creation is serialized and conflict-safe", () => {
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /hashtextextended\(v_user_id::text \|\| ':' \|\| v_daily_key::text/i);
  assert.match(migration, /select \* into strict v_state[\s\S]*where user_id = v_user_id and daily_key = v_daily_key/i);
});

test("mission generation reads trusted onboarding and uses server UUID", () => {
  assert.match(migration, /from public\.onboarding_profiles[\s\S]*where user_id = v_user_id and completed = true/i);
  assert.match(migration, /build_vault_daily_mission\(v_onboarding, (?:public\.)?gen_random_uuid\(\)\)/i);
  assert.match(migration, /'id', v_template_id \|\| '-' \|\| p_instance_id::text/i);
});

test("server owns canonical mission reward", () => {
  assert.match(migration, /'xpReward', 25/i);
  assert.match(migration, /if v_reward <> 25 then/i);
  assert.doesNotMatch(migration.match(/public\.request_daily_mission\(([^)]*)\)/i)?.[1] || "", /xp|reward/i);
});

test("rollover expires stale ready and active missions with zero XP history", () => {
  assert.match(migration, /daily_key < v_daily_key[\s\S]*lifecycle_state in \('ready', 'active'\)/i);
  assert.match(migration, /set lifecycle_state = 'expired'[\s\S]*completion_awarded = false/i);
  assert.match(migration, /'expired', 0, terminal_at[\s\S]*on conflict/i);
});

test("replacement RPC is zero-argument and server-selected", () => {
  const signature = migration.match(/create or replace function public\.request_daily_mission_replacement\(([^)]*)\)/i)?.[1] ?? "missing";
  const body = migration.match(/create or replace function public\.request_daily_mission_replacement[\s\S]*?\$\$;/i)?.[0] || "";
  assert.equal(signature.trim(), "");
  assert.match(body, /replacements_used >= 1/i);
  assert.match(body, /build_vault_daily_mission\(v_onboarding, (?:public\.)?gen_random_uuid\(\)\)/i);
  assert.doesNotMatch(body, /update public\.progression_state/i);
});

test("legacy client creation and replacement execution are revoked", () => {
  assert.match(migration, /revoke all on function public\.initialize_vault_session\(text, jsonb\) from authenticated/i);
  assert.match(migration, /revoke all on function public\.persist_validated_prototype_replacement[\s\S]*from authenticated/i);
  assert.match(migration, /revoke insert, update on public\.daily_mission_state from authenticated/i);
});

test("RLS remains enabled and migration never disables it", () => {
  const foundation = fs.readFileSync(path.join(root, "supabase/migrations/202608070001_sprint7_foundation.sql"), "utf8");
  assert.match(foundation, /alter table public\.daily_mission_state enable row level security/i);
  assert.doesNotMatch(migration, /disable row level security/i);
});

test("migrations 001 through 005 remain byte-for-byte unchanged", () => {
  const expected = {
    "202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
    "202608070005_sprint8_server_authority.sql": "370fc5fa159a8462599641859091ad4bc8a382e27553356a888fa863026cae41",
  };
  for (const [name, digest] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(root, "supabase/migrations", name));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), digest);
  }
});

test("production restoration requests the authoritative daily mission", () => {
  assert.match(applicationService, /hasAuthoritativeDailyMission[\s\S]*repository\.requestDailyMission\(\)/i);
  assert.match(applicationService, /dailySessionId = dailyResult\.dailyKey/i);
  assert.match(applicationService, /requestDailyMissionReplacement\(\)/i);
});

test("dashboard does not generate, date, or query daily missions", () => {
  assert.doesNotMatch(dashboard, /generateMission\(|createBrowserDailySessionId|\.from\(|\.rpc\(/i);
  assert.match(dashboard, /vaultApplication\.initialize\(\)/i);
});

test("Sprint 8 completion authority still targets current server day", () => {
  const body = migration.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(body, /current_vault_daily_key\(v_user_id, v_now\)/i);
  assert.match(body, /where user_id = v_user_id and daily_key = v_daily_key[\s\S]*for update/i);
  assert.match(body, /v_total_xp := v_total_xp \+ v_reward/i);
});

test("frontend contains no service-role key or database secret", () => {
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
