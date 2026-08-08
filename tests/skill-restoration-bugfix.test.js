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
const migration008 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration009 = read("supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");

const context = vm.createContext({ window: {} });
vm.runInContext(read("js/progression.js"), context);
const progressionEngine = context.window.KVNXProgression;

const mission = Object.freeze({
  id: "programming-server-instance",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
  primarySkill: "front_end_engineering",
});

const createRepository = ({ rpcData, rpcError = null, calls = [] }) => repositoryFactory.createUserRepository({
  authService: {
    getCurrentUser: async () => ({ id: "account-a" }),
    getClient: () => ({
      rpc: async (...args) => {
        calls.push(args);
        return { data: rpcData, error: rpcError };
      },
    }),
  },
});

const createService = ({ persistedSkillXP = 0, todayGain = 0, totalXP = 125 } = {}) => {
  let currentSkillXP = persistedSkillXP;
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", completed: true }),
    requestDailyMission: async () => ({
      accepted: true,
      dailyKey: "2026-08-07",
      nextResetAt: "2026-08-08T04:00:00.000Z",
      mission: {
        definition: mission,
        lifecycle: { state: "ready", completionAwarded: false, terminalAt: null, terminalRecorded: false },
      },
      dailyStatus: { replacementsUsed: 0, replacementsRemaining: 1 },
    }),
    loadProgression: async () => ({ totalXP }),
    loadMissionHistory: async () => [],
    getSkillProgression: async () => currentSkillXP > 0 ? [{
      key: "front_end_engineering",
      name: "Front-End Engineering",
      totalXP: currentSkillXP,
      todayGain: currentSkillXP === persistedSkillXP ? todayGain : todayGain + 15,
    }] : [],
    requestMissionAction: async ({ missionId, action }) => {
      currentSkillXP += 15;
      return {
        accepted: true,
        reason: null,
        event: {
          missionId,
          previousState: "ready",
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
          totalXP: currentSkillXP,
          todayGain: todayGain + 15,
        },
        dailyStatus: { replacementsUsed: 0, replacementsRemaining: 1 },
        historyRecord: null,
      };
    },
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

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("mission completion still writes skill_progression atomically", () => {
  const action = migration008.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(action, /update public\.progression_state[\s\S]*update public\.skill_progression[\s\S]*update public\.daily_mission_state/i);
});

test("Programming remains mapped to Front-End Engineering", () => {
  assert.match(migration008, /when 'programming' then 'front_end_engineering'/i);
  assert.match(migration008, /'front_end_engineering', 'Front-End Engineering'/i);
});

test("canonical skill reward remains exactly 15 XP", () => {
  assert.match(migration008, /v_skill_reward := 15;/i);
  assert.doesNotMatch(repositorySource, /p_skill_(?:xp|reward|level)/i);
});

test("get_skill_progression returns authenticated persisted rows", () => {
  const restoration = migration008.match(/create or replace function public\.get_skill_progression\(\)[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(restoration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(restoration, /from public\.skill_progression as progression[\s\S]*where progression\.user_id = v_user_id/i);
  assert.match(restoration, /'key'[\s\S]*'name'[\s\S]*'totalXP'/i);
});

test("authenticated role can execute the zero-argument restoration RPC", () => {
  assert.match(migration008, /grant execute on function public\.get_skill_progression\(\) to authenticated/i);
  assert.match(repositorySource, /database\.rpc\("get_skill_progression"\)/);
});

test("direct browser skill writes remain revoked and RLS remains enabled", () => {
  assert.match(migration008, /alter table public\.skill_progression enable row level security/i);
  assert.match(migration008, /revoke insert, update, delete on public\.skill_progression from authenticated/i);
});

test("duplicate and concurrent completion still award skill XP once", () => {
  const action = migration008.match(/create or replace function public\.request_vault_mission_action[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(action, /from public\.daily_mission_state[\s\S]*for update;/i);
  assert.match(action, /elsif v_previous_state = 'completed' then[\s\S]*v_reason := 'already-completed'/i);
  assert.ok(action.indexOf("for update;") < action.indexOf("v_skill_total_xp := v_skill_total_xp + v_skill_reward"));
});

test("repository restores the real Supabase JSON-array shape without discarding rows", async () => {
  const calls = [];
  const skills = await createRepository({
    rpcData: [{ key: "front_end_engineering", name: "Front-End Engineering", totalXP: 15, todayGain: 15 }],
    calls,
  }).getSkillProgression();
  assert.deepEqual(calls, [["get_skill_progression"]]);
  assert.deepEqual(skills, [{ key: "front_end_engineering", name: "Front-End Engineering", totalXP: 15, todayGain: 15 }]);
  assert.equal(Object.isFrozen(skills), true);
  assert.equal(Object.isFrozen(skills[0]), true);
});

test("failed skill restoration does not silently become an empty skill list", async () => {
  const repository = createRepository({ rpcData: null, rpcError: { code: "PGRST500" } });
  await assert.rejects(repository.getSkillProgression(), (error) => (
    error.code === "skill-progression-load-failed"
    && error.message === "KVNX Vault could not access your saved data."
  ));
});

test("application restoration includes authoritative skills", async () => {
  const initialized = await createService({ persistedSkillXP: 15, todayGain: 15 }).initialize();
  assert.equal(initialized.snapshot.skills.length, 1);
  assert.equal(initialized.snapshot.skills[0].totalXP, 15);
  assert.equal(initialized.snapshot.skills[0].level, 1);
  assert.equal(initialized.snapshot.skills[0].progressPercentage, 15);
});

test("completion reconciles updatedSkill into the immutable snapshot immediately", async () => {
  const service = createService();
  await service.initialize();
  const completion = await service.complete();
  assert.equal(completion.snapshot.skills[0].name, "Front-End Engineering");
  assert.equal(completion.snapshot.skills[0].totalXP, 15);
  assert.equal(Object.isFrozen(completion.snapshot.skills), true);
});

test("accepted completion redraws Skills Overview and the authoritative award", () => {
  const acceptedBranch = dashboardSource.match(/const revealDelay[\s\S]*?\}, revealDelay\);/)?.[0] || "";
  assert.match(acceptedBranch, /renderSkills\(applicationResult\.snapshot\.skills\)/);
  assert.match(acceptedBranch, /showProgressAward\(applicationResult\)/);
});

test("dashboard renders persisted positive XP and reserves empty state for zero rows", () => {
  const view = dashboard.skills.createViewModel([{
    key: "front_end_engineering",
    name: "Front-End Engineering",
    totalXP: 15,
    todayGain: 15,
    level: 1,
    progressPercentage: 15,
  }]);
  assert.equal(view.length, 1);
  assert.equal(view[0].totalXPLabel, "15 XP");
  assert.equal(view[0].levelText, "Level 1");
  assert.equal(dashboard.skills.createViewModel([]).length, 0);
  assert.match(dashboardSource, /skillsEmpty\.hidden = viewModel\.length > 0/);
});

test("refresh restores the Programming skill after completion", async () => {
  const refreshed = await createService({ persistedSkillXP: 15, todayGain: 15, totalXP: 150 }).initialize();
  assert.equal(refreshed.snapshot.skills[0].totalXP, 15);
  assert.equal(refreshed.snapshot.progression.currentXP, 150);
});

test("logout and login restore the same skill UI snapshot", async () => {
  const before = await createService({ persistedSkillXP: 30, todayGain: 15, totalXP: 175 }).initialize();
  const after = await createService({ persistedSkillXP: 30, todayGain: 15, totalXP: 175 }).initialize();
  assert.deepEqual(after.snapshot.skills, before.snapshot.skills);
  assert.deepEqual(dashboard.skills.createViewModel(after.snapshot.skills), dashboard.skills.createViewModel(before.snapshot.skills));
});

test("overall XP behavior remains unchanged", async () => {
  const service = createService({ totalXP: 125 });
  await service.initialize();
  const completion = await service.complete();
  assert.equal(completion.event.xpAwarded, 25);
  assert.equal(completion.snapshot.progression.currentXP, 150);
});

test("migration 009 remains compatible and migrations 001 through 009 are immutable", () => {
  assert.doesNotMatch(migration009, /create or replace function public\.(?:request_vault_mission_action|get_skill_progression)/i);
  assert.doesNotMatch(migration009, /(?:insert into|update|delete from) public\.skill_progression/i);
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
  assert.doesNotMatch(repositorySource, /service_role|p_skill_(?:xp|reward|level)/i);
  assert.match(applicationSource, /skills: Object\.freeze\(\[\.\.\.skillProgression\]\)/);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
