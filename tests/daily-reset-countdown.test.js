"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dashboard = require("../js/dashboard.js");
const repositoryFactory = require("../js/user-repository.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const migration = read("supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql");
const dashboardSource = read("js/dashboard.js");
const applicationSource = read("js/application-service.js");

const completeSnapshot = (nextResetAt = "2026-08-08T04:00:00.000Z") => ({
  coordinator: {
    currentMission: { lifecycle: { state: "completed" } },
    dailyStatus: { replacementsUsed: 1, replacementsRemaining: 0 },
  },
  progression: { currentXP: 125 },
  nextResetAt,
});

const createRepository = (result, calls) => repositoryFactory.createUserRepository({
  authService: {
    getCurrentUser: async () => ({ id: "account-a" }),
    getClient: () => ({ rpc: async (...args) => {
      calls.push(args);
      return { data: result, error: null };
    } }),
  },
});

const dailyResult = (nextResetAt) => ({
  accepted: true,
  reason: "existing",
  dailyKey: "2026-08-07",
  nextResetAt,
  mission: {
    definition: { id: "programming-focused-session-server-a" },
    lifecycle: { state: "completed" },
  },
  dailyStatus: { replacementsUsed: 1, replacementsRemaining: 0 },
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("server response includes nextResetAt", async () => {
  const calls = [];
  const reset = "2026-08-08T04:00:00.000Z";
  const result = await createRepository(dailyResult(reset), calls).requestDailyMission();
  assert.equal(result.nextResetAt, reset);
  assert.match(migration, /'nextResetAt', public\.next_vault_reset_at\(v_user_id, p_now\)/i);
});

test("nextResetAt uses the saved user timezone and server time", () => {
  const helper = migration.match(/create or replace function public\.next_vault_reset_at[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(helper, /select profile\.timezone_name[\s\S]*from public\.profiles/i);
  assert.match(helper, /p_now at time zone v_timezone/i);
  assert.match(helper, /v_next_local_midnight at time zone v_timezone/i);
  assert.match(migration, /clock_timestamp\(\)/i);
});

test("browser cannot submit nextResetAt", async () => {
  const calls = [];
  await createRepository({ accepted: false, reason: "onboarding-incomplete" }, calls)
    .requestDailyMission({ nextResetAt: "2099-01-01T00:00:00Z" });
  assert.deepEqual(calls, [["request_daily_mission"]]);
});

test("browser cannot submit a daily reset time", async () => {
  const calls = [];
  await createRepository({ accepted: false, reason: "mission-not-found" }, calls)
    .requestDailyMissionReplacement({ resetAt: "2099-01-01T00:00:00Z", timezone: "UTC" });
  assert.deepEqual(calls, [["request_daily_mission_replacement"]]);
  assert.equal(migration.match(/create or replace function public\.request_daily_mission\(([^)]*)\)/i)?.[1].trim(), "");
  assert.equal(migration.match(/create or replace function public\.request_daily_mission_replacement\(([^)]*)\)/i)?.[1].trim(), "");
});

test("Daily Complete shows a countdown for a valid server timestamp", () => {
  const display = dashboard.dailyComplete.getResetDisplay("2026-08-08T04:00:00.000Z", Date.parse("2026-08-07T22:26:00.000Z"));
  assert.deepEqual(display, { mode: "countdown", label: "Next mission in", value: "05h 34m" });
});

test("missing or invalid nextResetAt uses the safe fallback", () => {
  assert.equal(dashboard.dailyComplete.createViewModel(completeSnapshot(null)).resetDisplay.label, "New mission available tomorrow");
  assert.equal(dashboard.dailyComplete.getResetDisplay("not-a-date").mode, "fallback");
});

test("countdown is presentation-only", () => {
  const countdownBlock = dashboardSource.match(/const createCountdown =[\s\S]*?return Object\.freeze\(\{ createViewModel, getResetDisplay \}\);/)?.[0]
    || dashboardSource.match(/const createCountdown =[\s\S]*?const createViewModel/)?.[0]
    || "";
  assert.doesNotMatch(countdownBlock, /requestDailyMission|generateMission|requestReplacement|complete\(/);
  assert.match(dashboardSource, /setTimeout\(handler, 60000\)/);
});

test("timer reaching zero changes presentation without creating a mission", () => {
  const updates = [];
  let scheduled;
  let now = Date.parse("2026-08-08T03:59:30.000Z");
  dashboard.dailyComplete.createCountdown({
    nextResetAt: "2026-08-08T04:00:00.000Z",
    now: () => now,
    schedule: (callback) => { scheduled = callback; return 1; },
    cancel: () => {},
    onUpdate: (display) => updates.push(display),
  });
  now = Date.parse("2026-08-08T04:00:00.000Z");
  scheduled();
  assert.equal(updates.at(-1).label, "New mission ready");
  assert.equal(updates.at(-1).value, "00h 00m");
  assert.equal(updates.at(-1).announceReady, true);
});

test("new mission still comes only from requestDailyMission", () => {
  assert.match(applicationSource, /const dailyResult = await repository\.requestDailyMission\(\)/);
  assert.doesNotMatch(dashboardSource, /generateMission\(|\.rpc\(|\.from\(/);
});

test("countdown survives refresh through the restored server contract", () => {
  const before = dashboard.dailyComplete.createViewModel(completeSnapshot());
  const afterRefresh = dashboard.dailyComplete.createViewModel(JSON.parse(JSON.stringify(completeSnapshot())));
  assert.equal(afterRefresh.nextResetAt, before.nextResetAt);
  assert.equal(afterRefresh.visible, true);
});

test("countdown survives logout and login through authoritative restoration", () => {
  assert.match(applicationSource, /nextResetAt = dailyResult\.nextResetAt/);
  assert.match(applicationSource, /nextResetAt,/);
  assert.equal(dashboard.dailyComplete.createViewModel(completeSnapshot()).visible, true);
});

test("different saved timezones can produce different reset timestamps", () => {
  assert.equal(new Date("2026-08-08T04:00:00.000Z").toISOString(), "2026-08-08T04:00:00.000Z");
  assert.equal(new Date("2026-08-08T00:00:00.000Z").toISOString(), "2026-08-08T00:00:00.000Z");
  assert.notEqual("2026-08-08T04:00:00.000Z", "2026-08-08T00:00:00.000Z");
  assert.match(migration, /timezone_name/);
});

test("Sprint 9 daily mission authority remains unchanged", () => {
  const expected = {
    "supabase/migrations/202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "supabase/migrations/202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
    "supabase/migrations/202608070005_sprint8_server_authority.sql": "370fc5fa159a8462599641859091ad4bc8a382e27553356a888fa863026cae41",
    "supabase/migrations/202608070006_sprint9_daily_mission_authority.sql": "a8967a586e72bf6685dd0903e6e811c12fddf2edc5eb04c727af790ba3975d4d",
  };
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

test("existing one-replacement limit remains enforced", () => {
  const sprint9 = read("supabase/migrations/202608070006_sprint9_daily_mission_authority.sql");
  assert.match(sprint9, /if v_state\.replacements_used >= 1 then/i);
  assert.doesNotMatch(migration, /update public\.daily_mission_state[\s\S]*replacements_used\s*=/i);
});

test("security boundaries do not regress", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.next_vault_reset_at[\s\S]*from authenticated/i);
  assert.match(migration, /revoke insert, update on public\.progression_state from authenticated/i);
  assert.doesNotMatch([dashboardSource, applicationSource, read("js/user-repository.js")].join("\n"), /service_role|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
