"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const applicationFactory = require("../js/application-service.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");
const repositoryFactory = require("../js/user-repository.js");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const migration = read("supabase/migrations/202608070011_sprint11_achievements.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const dashboardHTML = read("dashboard.html");

const context = vm.createContext({ window: {} });
vm.runInContext(read("js/progression.js"), context);
const progressionEngine = context.window.KVNXProgression;

const unlockedAt = "2026-08-07T18:00:00.000Z";
const firstMission = Object.freeze({
  key: "FIRST_MISSION",
  name: "First Mission",
  description: "Complete your first mission.",
  icon: "◆",
  category: "Missions",
  hidden: false,
  displayOrder: 10,
  unlockedAt,
});
const catalog = Object.freeze([
  Object.freeze({ ...firstMission, unlockedAt: undefined }),
  Object.freeze({
    key: "LEVEL_5", name: "Level Five", description: "Reach overall Level 5.",
    icon: "Ⅴ", category: "Progression", hidden: true, displayOrder: 40,
  }),
  Object.freeze({
    key: "250_XP", name: "250 XP", description: "Build 250 total account XP.",
    icon: "250", category: "Progression", hidden: false, displayOrder: 70,
  }),
]);

const mission = Object.freeze({
  id: "server-mission-a",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
  primarySkill: "front_end_engineering",
});

const createService = ({ earned = [], newAchievements = [firstMission], totalXP = 75 } = {}) => {
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", completed: true }),
    requestDailyMission: async () => ({
      accepted: true,
      dailyKey: "2026-08-07",
      nextResetAt: "2026-08-08T04:00:00.000Z",
      mission: { definition: mission, lifecycle: { state: "ready", completionAwarded: false } },
      dailyStatus: { replacementsUsed: 0, replacementsRemaining: 1 },
    }),
    loadProgression: async () => ({ totalXP }),
    loadMissionHistory: async () => [],
    getSkillProgression: async () => [],
    getAchievementCatalog: async () => catalog,
    getUserAchievements: async () => earned,
    requestMissionAction: async ({ missionId, action }) => ({
      accepted: true,
      reason: null,
      event: {
        missionId, requestedAction: action, previousState: "ready", currentState: "completed",
        eventType: "mission.completed", xpAwarded: 25, primarySkill: "front_end_engineering",
        skillXPAwarded: 15, timestamp: unlockedAt,
      },
      mission: {
        definition: mission,
        lifecycle: { state: "completed", completionAwarded: true, terminalAt: unlockedAt, terminalRecorded: true },
      },
      progression: { totalXP: totalXP + 25 },
      overallProgression: { totalXP: totalXP + 25 },
      updatedSkill: {
        key: "front_end_engineering", name: "Front-End Engineering", totalXP: 15, todayGain: 15,
      },
      newAchievements,
      dailyStatus: { replacementsUsed: 0, replacementsRemaining: 1 },
      historyRecord: null,
    }),
  };

  return applicationFactory.createApplicationService({
    authService: { signOut: async () => {} },
    repository,
    missionEngine: { generateMission: async () => mission },
    lifecycleEngine,
    coordinatorEngine,
    progressionEngine,
    transitionMode: "authoritative",
  });
};

const createRepository = (responses, calls) => repositoryFactory.createUserRepository({
  authService: {
    getCurrentUser: async () => ({ id: "account-a" }),
    getClient: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: responses[args[0]], error: null };
      },
    }),
  },
});

const actionFunction = migration.match(
  /create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;/i,
)?.[0] || "";
const evaluator = migration.match(
  /create or replace function public\.evaluate_vault_achievements[\s\S]*?\$\$;/i,
)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("achievement catalog and user-owned unlock table are created", () => {
  assert.match(migration, /create table public\.achievement_catalog[\s\S]*display_order/i);
  assert.match(migration, /create table public\.user_achievements[\s\S]*primary key \(user_id, achievement_key\)/i);
  ["FIRST_MISSION", "FIRST_REPLACEMENT", "LEVEL_2", "LEVEL_5", "FIRST_SKILL", "100_XP", "250_XP", "500_XP", "1000_XP", "THREE_DAY_STREAK", "SEVEN_DAY_STREAK"]
    .forEach((key) => assert.match(migration, new RegExp(`'${key}'`)));
});

test("first completed mission unlocks FIRST_MISSION", () => {
  assert.match(evaluator, /select 'FIRST_MISSION'[\s\S]*from public\.mission_history[\s\S]*final_state = 'completed'/i);
  assert.ok(actionFunction.indexOf("insert into public.mission_history") < actionFunction.indexOf("public.evaluate_vault_achievements"));
});

test("completed replacement unlocks FIRST_REPLACEMENT", () => {
  assert.match(evaluator, /select 'FIRST_REPLACEMENT' where p_completed_replacement/i);
  assert.match(actionFunction, /v_daily_state\.replacements_used = 1/i);
});

test("100 XP unlock and Level 2 use the authoritative total", () => {
  assert.match(evaluator, /select '100_XP' where p_total_xp >= 100/i);
  assert.match(evaluator, /select 'LEVEL_2' where p_total_xp >= 100/i);
});

test("250 XP unlock uses the authoritative total", () => {
  assert.match(evaluator, /select '250_XP' where p_total_xp >= 250/i);
});

test("first persisted positive skill unlocks FIRST_SKILL", () => {
  assert.match(evaluator, /select 'FIRST_SKILL'[\s\S]*from public\.skill_progression[\s\S]*skill_xp > 0/i);
});

test("duplicate completion cannot evaluate or award achievements twice", () => {
  assert.match(actionFunction, /from public\.daily_mission_state[\s\S]*for update;/i);
  assert.match(actionFunction, /elsif v_previous_state = 'completed' then[\s\S]*v_reason := 'already-completed'/i);
  assert.match(actionFunction, /if v_xp_awarded > 0 then[\s\S]*evaluate_vault_achievements/i);
});

test("duplicate unlocks are prevented by primary key and conflict handling", () => {
  assert.match(migration, /primary key \(user_id, achievement_key\)/i);
  assert.match(evaluator, /on conflict \(user_id, achievement_key\) do nothing/i);
});

test("achievement evaluation is atomic with overall and skill XP", () => {
  assert.ok(actionFunction.indexOf("update public.progression_state") < actionFunction.indexOf("update public.skill_progression"));
  assert.ok(actionFunction.indexOf("update public.skill_progression") < actionFunction.indexOf("public.evaluate_vault_achievements"));
  assert.match(actionFunction, /'newAchievements', v_new_achievements/i);
});

test("restoration RPC is zero-argument, owner-derived, and newest-first", () => {
  const restoration = migration.match(/create or replace function public\.get_user_achievements\(\)[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(restoration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(restoration, /where earned\.user_id = v_user_id/i);
  assert.match(restoration, /order by earned\.unlocked_at desc/i);
  assert.match(migration, /grant execute on function public\.get_user_achievements\(\) to authenticated/i);
});

test("repository restores frozen catalog and earned rows without ownership input", async () => {
  const calls = [];
  const repository = createRepository({
    get_achievement_catalog: catalog,
    get_user_achievements: [firstMission],
  }, calls);
  const [definitions, earned] = await Promise.all([
    repository.getAchievementCatalog({ userId: "attacker" }),
    repository.getUserAchievements({ userId: "attacker" }),
  ]);
  assert.deepEqual(calls, [["get_achievement_catalog"], ["get_user_achievements"]]);
  assert.equal(definitions.length, 3);
  assert.equal(earned[0].unlocked, true);
  assert.equal(Object.isFrozen(earned[0]), true);
});

test("application restoration includes immutable achievements", async () => {
  const initialized = await createService({ earned: [firstMission] }).initialize();
  assert.equal(initialized.snapshot.achievements[0].unlocked, true);
  assert.equal(initialized.snapshot.achievements[1].unlocked, false);
  assert.equal(Object.isFrozen(initialized.snapshot.achievements), true);
});

test("completion reconciles newAchievements immediately", async () => {
  const service = createService();
  await service.initialize();
  const completed = await service.complete();
  assert.equal(completed.newAchievements[0].key, "FIRST_MISSION");
  assert.equal(completed.snapshot.achievements[0].unlocked, true);
  assert.equal(completed.snapshot.achievements[0].unlockedAt, unlockedAt);
});

test("refresh restores achievements", async () => {
  const refreshed = await createService({ earned: [firstMission], newAchievements: [] }).initialize();
  assert.equal(refreshed.snapshot.achievements[0].key, "FIRST_MISSION");
  assert.equal(refreshed.snapshot.achievements[0].unlocked, true);
});

test("logout and login restore the same achievements", async () => {
  const before = await createService({ earned: [firstMission] }).initialize();
  const after = await createService({ earned: [firstMission] }).initialize();
  assert.deepEqual(after.snapshot.achievements, before.snapshot.achievements);
});

test("RLS, grants, and browser write revocations preserve server authority", () => {
  assert.match(migration, /alter table public\.user_achievements enable row level security/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(migration, /revoke insert, update, delete on public\.user_achievements from authenticated/i);
  assert.match(migration, /revoke all on function public\.evaluate_vault_achievements[\s\S]*from authenticated/i);
  assert.doesNotMatch(repositorySource, /insert\([^)]*user_achievements|from\("user_achievements"\).*\.(?:insert|update|upsert|delete)/i);
});

test("browser submits no achievement authority", () => {
  const request = repositorySource.match(/const requestMissionAction = async[\s\S]*?return mapMissionActionResult\(result\);/i)?.[0] || "";
  assert.match(request, /p_mission_id: normalizedMissionId[\s\S]*p_action: normalizedAction/i);
  assert.doesNotMatch(request, /achievement|unlockedAt|reward/i);
  assert.doesNotMatch(repositorySource, /p_achievement|p_unlocked_at|p_achievement_reward/i);
});

test("dashboard renders unlocked, hidden locked, and visible locked achievements", () => {
  const view = dashboard.achievements.createViewModel([
    { ...firstMission, unlocked: true },
    { ...catalog[1], unlocked: false },
    { ...catalog[2], unlocked: false },
  ]);
  assert.match(view[0].dateLabel, /Aug \d{1,2}, 2026/);
  assert.equal(view[1].name, "?????");
  assert.equal(view[1].description, "?????");
  assert.equal(view[2].name, "250 XP");
  assert.equal(view[2].statusLabel, "Locked");
  assert.match(dashboardHTML, /data-achievements-view[\s\S]*data-achievement-list/i);
});

test("notification renders every server-returned unlock and auto-dismisses", () => {
  assert.match(dashboardSource, /const showAchievementUnlocks = \(newAchievements\)/i);
  assert.match(dashboardSource, /newAchievements\.forEach/i);
  assert.match(dashboardSource, /achievementUnlockTimer = window\.setTimeout/i);
  assert.match(dashboardSource, /showAchievementUnlocks\(applicationResult\.newAchievements\)/i);
  assert.match(dashboardHTML, /data-achievement-unlock[\s\S]*aria-live="polite"/i);
});

test("overall XP and skill XP rules remain unchanged", () => {
  assert.match(actionFunction, /if v_reward <> 25 then/i);
  assert.match(actionFunction, /v_skill_reward := 15;/i);
  assert.match(actionFunction, /v_total_xp := v_total_xp \+ v_reward/i);
  assert.match(actionFunction, /v_skill_total_xp := v_skill_total_xp \+ v_skill_reward/i);
});

test("streaks are catalog-only and migrations 001 through 009 are immutable", () => {
  assert.match(migration, /Streak catalog entries intentionally have no eligibility branch/i);
  assert.doesNotMatch(evaluator, /select 'THREE_DAY_STREAK' where|select 'SEVEN_DAY_STREAK' where/i);
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
  };
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
  assert.match(applicationSource, /achievements: Object\.freeze\(achievements\.map\(toPublicAchievement\)\)/);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
