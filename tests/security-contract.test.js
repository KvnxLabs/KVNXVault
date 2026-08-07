"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const repositoryFactory = require("../js/user-repository.js");
const applicationFactory = require("../js/application-service.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/progression.js"), "utf8"), context);
const progressionEngine = context.window.KVNXProgression;

const definition = Object.freeze({
  id: "daily-programming",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
});

const captured = [];
const client = {
  from: () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: null }),
  }),
  rpc: async (name, payload) => {
    captured.push({ name, payload });
    return { data: { accepted: false, reason: "server-authority-pending-sprint-8" }, error: null };
  },
};
const authService = {
  getClient: () => client,
  getCurrentUser: async () => ({ id: "authenticated-user" }),
};

(async () => {
  const repository = repositoryFactory.createUserRepository({ authService });
  assert.equal("saveProgression" in repository, false);
  assert.equal("saveDailyMissionState" in repository, false);
  assert.equal(typeof repository.requestMissionAction, "function");
  console.log("✓ preferred repository API exposes no arbitrary progression or mission-state setter");

  await repository.requestMissionAction({ missionId: definition.id, action: "complete" });
  const request = captured.find(({ name }) => name === "request_vault_mission_action");
  assert.deepEqual(Object.keys(request.payload).sort(), ["p_action", "p_mission_id"]);
  assert.equal(JSON.stringify(request.payload).includes("999999"), false);
  console.log("✓ durable mission request sends intent without XP or reward values");

  const prototypeRepository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", intensity: "Balanced", completed: true }),
    loadProgression: async () => ({ totalXP: 75 }),
    loadDailyMissionState: async () => ({
      dailySessionId: "browser:UTC:2026-08-07",
      definition,
      lifecycle: { state: "active", completionAwarded: false },
      replacementsUsed: 0,
      terminalAt: null,
      terminalRecorded: false,
    }),
    loadMissionHistory: async () => [],
  };
  const service = applicationFactory.createApplicationService({
    authService: { signOut: async () => {} },
    repository: prototypeRepository,
    missionEngine: { generateMission: async () => definition },
    lifecycleEngine,
    coordinatorEngine,
    progressionEngine,
    dailySessionId: "browser:UTC:2026-08-07",
    transitionMode: "prototype",
  });
  await service.initialize();
  const completed = await service.complete({ totalXP: 999999 });
  const duplicate = await service.complete({ totalXP: 999999 });
  assert.equal(completed.snapshot.progression.currentXP, 100);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.snapshot.progression.currentXP, 100);
  console.log("✓ prototype completion awards configured XP once and ignores arbitrary UI totals");

  const frontendFiles = fs.readdirSync(path.join(__dirname, "../js"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(__dirname, "../js", name), "utf8"))
    .join("\n");
  assert.equal(/SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]/i.test(frontendFiles), false);
  console.log("✓ frontend contains no Supabase service-role credential");

  const authDocs = fs.readFileSync(path.join(__dirname, "../docs/AUTHENTICATION.md"), "utf8");
  assert.match(authDocs, /Site URL\*\* to `https:\/\/kvnx-vault\.vercel\.app`/);
  assert.match(authDocs, /https:\/\/kvnx-vault\.vercel\.app\/login\.html/);
  assert.match(authDocs, /`kvnxlabs\.com` is the KVNX Labs company site/);
  console.log("✓ deployment guidance separates the Vault app from the company domain");

  const correctionSql = fs.readFileSync(path.join(
    __dirname,
    "../supabase/migrations/202608070002_sprint7_1_security_correction.sql",
  ), "utf8");
  assert.match(correctionSql, /revoke insert, update on public\.progression_state from authenticated/i);
  assert.match(correctionSql, /revoke all on function public\.persist_vault_transition[\s\S]*from authenticated/i);
  const intentSignature = correctionSql.match(/create or replace function public\.request_vault_mission_action\(([\s\S]*?)\)\s*returns/i)?.[1] || "";
  assert.doesNotMatch(intentSignature, /xp|reward|lifecycle|user_id/i);
  console.log("✓ correction migration revokes client XP writes and exposes an intent-only RPC signature");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
