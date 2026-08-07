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
const hash = (relativePath) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const migration = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const dashboardHTML = read("dashboard.html");

const context = vm.createContext({ window: {} });
vm.runInContext(read("js/progression.js"), context);
const progressionEngine = context.window.KVNXProgression;

const mission = Object.freeze({
  id: "programming-focused-session-server-a",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
  primarySkill: "front_end_engineering",
});

const createService = ({ totalXP = 75, skillXP = 0, todayGain = 0, lifecycleState = "ready" } = {}) => {
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", intensity: "Balanced", completed: true }),
    requestDailyMission: async () => ({
      accepted: true,
      reason: "existing",
      dailyKey: "2026-08-07",
      nextResetAt: "2026-08-08T04:00:00.000Z",
      mission: {
        definition: mission,
        lifecycle: {
          state: lifecycleState,
          completionAwarded: lifecycleState === "completed",
          terminalAt: lifecycleState === "completed" ? "2026-08-07T18:00:00.000Z" : null,
          terminalRecorded: lifecycleState === "completed",
        },
      },
      dailyStatus: { replacementsUsed: 0, replacementsRemaining: 1 },
    }),
    loadProgression: async () => ({ totalXP }),
    loadMissionHistory: async () => [],
    getSkillProgression: async () => skillXP > 0 ? [{
      key: "front_end_engineering",
      name: "Front-End Engineering",
      totalXP: skillXP,
      todayGain,
    }] : [],
    requestMissionAction: async ({ missionId, action }) => ({
      accepted: true,
      reason: null,
      event: {
        missionId,
        previousState: lifecycleState,
        currentState: "completed",
        eventType: "mission.completed",
        requestedAction: action,
        xpAwarded: 25,
        primarySkill: "front_end_engineering",
        skillXPAwarded: 15,
        timestamp: "2026-08-07T18:00:00.000Z",
      },
      mission: {
        definition: mission,
        lifecycle: {
          state: "completed",
          completionAwarded: true,
          terminalAt: "2026-08-07T18:00:00.000Z",
          terminalRecorded: true,
        },
      },
      progression: { totalXP: totalXP + 25 },
      overallProgression: { totalXP: totalXP + 25 },
      updatedSkill: {
        key: "front_end_engineering",
        name: "Front-End Engineering",
        totalXP: skillXP + 15,
        todayGain: todayGain + 15,
      },
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

const createRepository = (rpcResult, calls) => repositoryFactory.createUserRepository({
  authService: {
    getCurrentUser: async () => ({ id: "account-a" }),
    getClient: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: rpcResult, error: null };
      },
    }),
  },
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("skill row is created lazily under the authenticated owner", () => {
  assert.match(migration, /create table public\.skill_progression[\s\S]*primary key \(user_id, skill_key\)/i);
  assert.match(migration, /insert into public\.skill_progression \(user_id, skill_key, skill_xp\)[\s\S]*values \(v_user_id, v_skill_key, 0\)[\s\S]*on conflict \(user_id, skill_key\) do nothing/i);
});

test("skill XP is persisted atomically with overall XP", () => {
  const action = migration.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(action, /update public\.progression_state[\s\S]*set total_xp = v_total_xp/i);
  assert.match(action, /update public\.skill_progression[\s\S]*set skill_xp = v_skill_total_xp/i);
  assert.match(action, /update public\.daily_mission_state[\s\S]*lifecycle_state = v_current_state/i);
});

test("refresh restores skill progression", async () => {
  const restored = await createService({ totalXP: 100, skillXP: 15, todayGain: 15 }).initialize();
  assert.equal(restored.snapshot.skills[0].totalXP, 15);
  assert.equal(restored.snapshot.skills[0].name, "Front-End Engineering");
});

test("logout and login restore the same skill progression", async () => {
  const before = await createService({ totalXP: 125, skillXP: 30, todayGain: 30 }).initialize();
  const afterLogin = await createService({ totalXP: 125, skillXP: 30, todayGain: 30 }).initialize();
  assert.deepEqual(afterLogin.snapshot.skills, before.snapshot.skills);
});

test("overall XP award remains unchanged at 25", () => {
  assert.match(migration, /if v_reward <> 25 then/i);
  assert.match(migration, /v_total_xp := v_total_xp \+ v_reward/i);
  assert.match(migration, /v_skill_reward := 15/i);
});

test("skill XP is awarded once", () => {
  assert.match(migration, /elsif v_action = 'complete' and v_previous_state in \('ready', 'active'\)/i);
  assert.match(migration, /elsif v_previous_state = 'completed' then[\s\S]*v_reason := 'already-completed'/i);
});

test("duplicate completion cannot duplicate skill XP", () => {
  const updatePosition = migration.indexOf("update public.skill_progression");
  const acceptedBlock = migration.indexOf("if v_accepted then", migration.indexOf("create or replace function public.request_vault_mission_action"));
  assert.ok(updatePosition > acceptedBlock);
  assert.match(migration, /for update;[\s\S]*v_previous_state := v_daily_state\.lifecycle_state/i);
});

test("mission focus maps to the correct server skill", () => {
  assert.match(migration, /when 'programming' then 'front_end_engineering'/i);
  assert.match(migration, /when 'reading' then 'reading'/i);
  assert.match(migration, /when 'business' then 'business'/i);
  assert.match(migration, /when 'fitness' then 'fitness'/i);
  assert.match(migration, /'primarySkill', public\.vault_skill_key_for_focus\(p_onboarding\.primary_focus\)/i);
});

test("browser cannot submit skill XP", async () => {
  const calls = [];
  await createRepository({ accepted: false, reason: "already-completed" }, calls)
    .requestMissionAction({ missionId: mission.id, action: "complete", skillXP: 999999 });
  assert.deepEqual(calls, [["request_vault_mission_action", {
    p_mission_id: mission.id,
    p_action: "complete",
  }]]);
  assert.doesNotMatch(repositorySource, /p_skill_xp|p_skill_reward/i);
});

test("browser cannot submit skill level", async () => {
  const calls = [];
  await createRepository({ accepted: false, reason: "already-completed" }, calls)
    .requestMissionAction({ missionId: mission.id, action: "complete", skillLevel: 99 });
  assert.equal(Object.hasOwn(calls[0][1], "skillLevel"), false);
  assert.doesNotMatch(repositorySource, /p_skill_level/i);
});

test("skill restoration is a zero-argument authenticated read", async () => {
  const calls = [];
  const skills = await createRepository([{
    key: "reading",
    name: "Reading",
    totalXP: 45,
    todayGain: 15,
  }], calls).getSkillProgression({ userId: "attacker", skillXP: 999 });
  assert.deepEqual(calls, [["get_skill_progression"]]);
  assert.equal(skills[0].totalXP, 45);
  assert.equal(Object.isFrozen(skills), true);
  assert.equal(Object.isFrozen(skills[0]), true);
});

test("skill progression RLS is enabled and owner-scoped", () => {
  assert.match(migration, /alter table public\.skill_progression enable row level security/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(migration, /revoke insert, update, delete on public\.skill_progression from authenticated/i);
});

test("frontend contains no secret or service-role credential", () => {
  const frontend = ["dashboard.html", ...fs.readdirSync(path.join(root, "js")).map((file) => `js/${file}`)]
    .map(read).join("\n");
  assert.doesNotMatch(frontend, /service_role|postgres(?:ql)?:\/\/|SUPABASE_SERVICE/i);
});

test("concurrent completion serializes before skill mutation", () => {
  const action = migration.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;/i)?.[0] || "";
  assert.ok(action.indexOf("from public.daily_mission_state") < action.indexOf("from public.progression_state"));
  assert.ok(action.indexOf("from public.progression_state") < action.indexOf("from public.skill_progression"));
  assert.match(action, /from public\.daily_mission_state[\s\S]*for update/i);
});

test("dashboard renders authoritative skill snapshots", async () => {
  const service = createService({ totalXP: 75, skillXP: 0 });
  await service.initialize();
  const completion = await service.complete();
  const skill = completion.snapshot.skills[0];
  assert.equal(skill.totalXP, 15);
  assert.equal(skill.todayGain, 15);
  assert.equal(dashboard.skills.createViewModel([skill])[0].totalXPLabel, "15 XP");
});

test("existing Skills card replaces placeholder values with authoritative rendering", () => {
  assert.match(dashboardHTML, /data-skill-list/);
  assert.match(dashboardHTML, /data-skills-count/);
  assert.doesNotMatch(dashboardHTML, />L07<|Consistent progress this week|Next review in 2 days/);
  assert.match(dashboardSource, /renderSkills\(applicationSnapshot\.skills\)/);
  assert.match(dashboardSource, /role", "progressbar"/);
});

test("skill progress survives replacement", () => {
  const replacementBlock = applicationSource.match(/const requestReplacement = async \(\) =>[\s\S]*?return Object\.freeze\(\{ \.\.\.result, snapshot: getPublicSnapshot\(\) \}\);/i)?.[0] || "";
  assert.doesNotMatch(replacementBlock, /skillProgression\s*=/);
  assert.match(read("supabase/migrations/202608070006_sprint9_daily_mission_authority.sql"), /replacements_used = 1/i);
  assert.doesNotMatch(read("supabase/migrations/202608070006_sprint9_daily_mission_authority.sql"), /skill_progression/i);
});

test("skill progress survives a new daily mission", () => {
  assert.match(migration, /create table public\.skill_progression/i);
  assert.doesNotMatch(read("supabase/migrations/202608070006_sprint9_daily_mission_authority.sql"), /delete from public\.skill_progression|truncate public\.skill_progression/i);
  assert.match(applicationSource, /repository\.getSkillProgression\(\)/);
});

test("migrations 001 through 007 remain byte-for-byte unchanged", () => {
  const expected = {
    "supabase/migrations/202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "supabase/migrations/202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
    "supabase/migrations/202608070005_sprint8_server_authority.sql": "370fc5fa159a8462599641859091ad4bc8a382e27553356a888fa863026cae41",
    "supabase/migrations/202608070006_sprint9_daily_mission_authority.sql": "a8967a586e72bf6685dd0903e6e811c12fddf2edc5eb04c727af790ba3975d4d",
    "supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql": "9ab697276e7d372b9275dd271d6b281568c10f167b62521b8570eb603411ef3e",
  };
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
