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
const definition = Object.freeze({
  id: "daily-programming",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
});

const createStore = () => ({
  progression: { totalXP: 75 },
  dailyMission: {
    dailySessionId,
    definition,
    lifecycle: { state: "active", completionAwarded: false },
    replacementsUsed: 0,
    terminalAt: null,
    terminalRecorded: false,
  },
  persistenceCalls: [],
  signOuts: 0,
});

const createService = (store) => {
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", intensity: "Balanced", completed: true }),
    loadProgression: async () => ({ ...store.progression }),
    loadDailyMissionState: async () => ({
      ...store.dailyMission,
      lifecycle: { ...store.dailyMission.lifecycle },
    }),
    loadMissionHistory: async () => [],
    persistValidatedPrototypeProgression: async (value) => {
      store.persistenceCalls.push(value);
      store.progression = { totalXP: value.progressionSnapshot.currentXP };
      store.dailyMission = {
        ...store.dailyMission,
        lifecycle: { state: "completed", completionAwarded: true },
        terminalAt: value.lifecycleEvent.timestamp,
      };
      return { accepted: true, totalXP: store.progression.totalXP };
    },
  };

  return applicationFactory.createApplicationService({
    authService: { signOut: async () => { store.signOuts += 1; } },
    repository,
    missionEngine: { generateMission: async () => definition },
    lifecycleEngine,
    coordinatorEngine,
    progressionEngine,
    dailySessionId,
    transitionMode: "prototype",
  });
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("mission completion persists the validated progression snapshot", async () => {
  const store = createStore();
  const service = createService(store);
  await service.initialize();

  const result = await service.complete();

  assert.equal(result.accepted, true);
  assert.equal(result.snapshot.progression.currentXP, 100);
  assert.equal(store.progression.totalXP, 100);
  assert.equal(store.persistenceCalls.length, 1);
  assert.equal(store.persistenceCalls[0].lifecycleEvent.eventType, "mission.completed");
  assert.equal(store.persistenceCalls[0].progressionSnapshot, result.progressionResult.snapshot);
});

test("refresh restores the persisted progression through the application service", async () => {
  const store = createStore();
  const firstPage = createService(store);
  await firstPage.initialize();
  await firstPage.complete();

  const refreshedPage = createService(store);
  const restored = await refreshedPage.initialize();

  assert.equal(restored.snapshot.progression.currentXP, 100);
  assert.equal(restored.snapshot.progression.currentLevel, 2);
  assert.equal(restored.snapshot.coordinator.currentMission.lifecycle.state, "completed");
  const duplicate = await refreshedPage.complete();
  assert.equal(duplicate.accepted, false);
  assert.equal(store.persistenceCalls.length, 1);
});

test("logout and login restore the persisted progression", async () => {
  const store = createStore();
  const signedInSession = createService(store);
  await signedInSession.initialize();
  await signedInSession.complete();
  await signedInSession.signOut();

  const nextSignedInSession = createService(store);
  const restored = await nextSignedInSession.initialize();

  assert.equal(store.signOuts, 1);
  assert.equal(restored.snapshot.progression.currentXP, 100);
  assert.equal(restored.snapshot.coordinator.currentMission.lifecycle.completionAwarded, true);
});

test("preferred UI-facing API still exposes no arbitrary progression setter", () => {
  const store = createStore();
  const service = createService(store);
  assert.equal("saveProgression" in service, false);
  assert.equal("setProgression" in service, false);
  assert.equal("persistValidatedPrototypeProgression" in service, false);
});

test("repository persistence requires the validated event and engine snapshot contract", async () => {
  const calls = [];
  const client = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return { data: { accepted: true, totalXP: 100 }, error: null };
    },
  };
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getClient: () => client,
      getCurrentUser: async () => ({ id: "authenticated-user" }),
    },
  });
  const lifecycleEvent = Object.freeze({
    missionId: definition.id,
    eventType: "mission.completed",
    currentState: "completed",
    xpAwarded: 25,
    timestamp: "2026-08-07T12:00:00.000Z",
  });
  const progressionSnapshot = progressionEngine.getSnapshot(
    progressionEngine.createProgression(100),
  );

  await assert.rejects(
    repository.persistValidatedPrototypeProgression({ missionId: definition.id, totalXP: 999999 }),
    TypeError,
  );
  await repository.persistValidatedPrototypeProgression({
    missionId: definition.id,
    lifecycleEvent,
    progressionSnapshot,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "persist_validated_prototype_progression");
  assert.deepEqual(Object.keys(calls[0].payload).sort(), [
    "p_lifecycle_event",
    "p_mission_id",
    "p_progression_snapshot",
  ]);
  assert.equal("p_total_xp" in calls[0].payload, false);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
