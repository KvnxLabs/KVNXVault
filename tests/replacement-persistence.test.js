"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const applicationFactory = require("../js/application-service.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");
const repositoryFactory = require("../js/user-repository.js");

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/progression.js"), "utf8"), context);
const progressionEngine = context.window.KVNXProgression;

const dailySessionId = "browser:UTC:2026-08-07";
const firstDefinition = Object.freeze({
  id: "daily-programming-1",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
});
const replacementDefinition = Object.freeze({
  id: "daily-programming-2",
  focus: "Programming",
  title: "Review What You Built",
  description: "Review one completed coding session and note one improvement.",
  estimatedDuration: "15 minutes",
  difficulty: "Balanced",
  xpReward: 25,
});

const createStore = (lifecycle = { state: "active", completionAwarded: false }) => ({
  progression: { totalXP: 75 },
  dailyMission: {
    dailySessionId,
    definition: firstDefinition,
    lifecycle: { ...lifecycle },
    replacementsUsed: 0,
    terminalAt: lifecycle.state === "completed" ? "2026-08-07T12:00:00.000Z" : null,
    terminalRecorded: lifecycle.state === "completed",
  },
  completionCalls: [],
  replacementCalls: [],
  signOuts: 0,
});

const createService = (store) => {
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", intensity: "Balanced", completed: true }),
    loadProgression: async () => ({ ...store.progression }),
    loadDailyMissionState: async () => ({
      ...store.dailyMission,
      definition: { ...store.dailyMission.definition },
      lifecycle: { ...store.dailyMission.lifecycle },
    }),
    loadMissionHistory: async () => [],
    persistValidatedPrototypeProgression: async (value) => {
      store.completionCalls.push(value);
      store.progression = { totalXP: value.progressionSnapshot.currentXP };
      store.dailyMission = {
        ...store.dailyMission,
        lifecycle: { state: "completed", completionAwarded: true },
        terminalAt: value.lifecycleEvent.timestamp,
        terminalRecorded: false,
      };
      return { accepted: true, totalXP: store.progression.totalXP };
    },
    persistValidatedPrototypeReplacement: async (value) => {
      store.replacementCalls.push(value);
      const snapshot = value.coordinatorSnapshot;
      store.dailyMission = {
        ...store.dailyMission,
        definition: { ...snapshot.currentMission.definition },
        lifecycle: { state: "ready", completionAwarded: false },
        replacementsUsed: snapshot.dailyStatus.replacementsUsed,
        terminalAt: null,
        terminalRecorded: false,
      };
      return {
        accepted: true,
        missionId: store.dailyMission.definition.id,
        replacementsUsed: store.dailyMission.replacementsUsed,
      };
    },
  };

  return applicationFactory.createApplicationService({
    authService: { signOut: async () => { store.signOuts += 1; } },
    repository,
    missionEngine: { generateMission: async () => replacementDefinition },
    lifecycleEngine,
    coordinatorEngine,
    progressionEngine,
    dailySessionId,
    transitionMode: "prototype",
  });
};

const completeReplacementSequence = async (store) => {
  const service = createService(store);
  await service.initialize();
  const firstCompletion = await service.complete();
  const replacement = await service.requestReplacement();
  const replacementCompletion = await service.complete();
  return { service, firstCompletion, replacement, replacementCompletion };
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("replacement path persists 75 → 100 → replacement → 125 and restores after refresh and login", async () => {
  const store = createStore();
  const sequence = await completeReplacementSequence(store);

  assert.equal(sequence.firstCompletion.snapshot.progression.currentXP, 100);
  assert.equal(sequence.replacement.accepted, true);
  assert.equal(store.replacementCalls.length, 1);
  assert.equal(store.replacementCalls[0].replacementEvent.eventType, "coordinator.mission-replaced");
  assert.equal(store.dailyMission.definition.id, replacementDefinition.id);
  assert.equal(store.dailyMission.lifecycle.state, "completed");
  assert.equal(store.dailyMission.lifecycle.completionAwarded, true);
  assert.equal(store.dailyMission.replacementsUsed, 1);
  assert.equal(sequence.replacementCompletion.snapshot.progression.currentXP, 125);
  assert.equal(store.progression.totalXP, 125);

  const refreshedPage = createService(store);
  const refreshed = await refreshedPage.initialize();
  assert.equal(refreshed.snapshot.progression.currentXP, 125);
  assert.equal(refreshed.snapshot.coordinator.currentMission.definition.id, replacementDefinition.id);
  assert.equal(refreshed.snapshot.coordinator.currentMission.lifecycle.state, "completed");

  await refreshedPage.signOut();
  const nextLogin = createService(store);
  const restored = await nextLogin.initialize();
  assert.equal(store.signOuts, 1);
  assert.equal(restored.snapshot.progression.currentXP, 125);
  assert.equal(restored.snapshot.coordinator.currentMission.definition.id, replacementDefinition.id);
  assert.equal(restored.snapshot.coordinator.currentMission.lifecycle.state, "completed");
  assert.equal(restored.snapshot.coordinator.currentMission.lifecycle.completionAwarded, true);
});

test("rejected replacement leaves the saved mission unchanged", async () => {
  const store = createStore({ state: "ready", completionAwarded: false });
  const service = createService(store);
  await service.initialize();
  const before = JSON.stringify(store.dailyMission);

  const result = await service.requestReplacement();

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "current-mission-not-terminal");
  assert.equal(store.replacementCalls.length, 0);
  assert.equal(JSON.stringify(store.dailyMission), before);
  assert.equal(store.progression.totalXP, 75);
});

test("one replacement remains the limit after the persisted replacement completes", async () => {
  const store = createStore();
  const { service } = await completeReplacementSequence(store);
  const savedMission = JSON.stringify(store.dailyMission);

  const secondReplacement = await service.requestReplacement();

  assert.equal(secondReplacement.accepted, false);
  assert.equal(secondReplacement.reason, "replacement-limit-reached");
  assert.equal(store.replacementCalls.length, 1);
  assert.equal(JSON.stringify(store.dailyMission), savedMission);
  assert.equal(store.progression.totalXP, 125);
});

test("replacement repository payload contains no XP mutation or user id", async () => {
  const calls = [];
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getClient: () => ({
        rpc: async (name, payload) => {
          calls.push({ name, payload });
          return { data: { accepted: true, missionId: replacementDefinition.id, replacementsUsed: 1 }, error: null };
        },
      }),
      getCurrentUser: async () => ({ id: "authenticated-user" }),
    },
  });
  const replacementEvent = Object.freeze({
    eventType: "coordinator.mission-replaced",
    previousMissionId: firstDefinition.id,
    missionId: replacementDefinition.id,
    timestamp: "2026-08-07T12:05:00.000Z",
    xpAwarded: 0,
  });
  const coordinatorSnapshot = Object.freeze({
    currentMission: Object.freeze({
      definition: replacementDefinition,
      lifecycle: Object.freeze({ state: "ready", completionAwarded: false }),
    }),
    dailyStatus: Object.freeze({ replacementsUsed: 1 }),
  });

  await repository.persistValidatedPrototypeReplacement({
    replacementEvent,
    coordinatorSnapshot,
    totalXP: 999999,
    userId: "attacker-controlled",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "persist_validated_prototype_replacement");
  assert.deepEqual(Object.keys(calls[0].payload).sort(), [
    "p_mission_definition",
    "p_previous_mission_id",
    "p_replacement_event",
    "p_replacements_used",
  ]);
  assert.equal("p_total_xp" in calls[0].payload, false);
  assert.equal("p_user_id" in calls[0].payload, false);
});

test("replacement boundary exposes no generic setter and SQL never updates progression", () => {
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getClient: () => ({}),
      getCurrentUser: async () => ({ id: "authenticated-user" }),
    },
  });
  const service = createService(createStore());
  assert.equal("saveDailyMissionState" in repository, false);
  assert.equal("setDailyMissionState" in repository, false);
  assert.equal("persistValidatedPrototypeReplacement" in service, false);

  const sql = fs.readFileSync(path.join(
    __dirname,
    "../supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql",
  ), "utf8");
  const signature = sql.match(/create or replace function public\.persist_validated_prototype_replacement\(([\s\S]*?)\)\s*returns/i)?.[1] || "";
  assert.doesNotMatch(signature, /xp|user_id/i);
  assert.doesNotMatch(sql, /update\s+public\.progression_state/i);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /lifecycle_state = 'ready'/i);
  assert.match(sql, /completion_awarded = false/i);
  assert.match(sql, /terminal_at = null/i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
