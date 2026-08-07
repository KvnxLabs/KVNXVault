"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

const createHarness = ({ state = "active", completionAwarded = false, totalXP = 75 } = {}) => {
  const persisted = [];
  let signedOut = false;
  const terminal = ["completed", "skipped", "expired"].includes(state);
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", intensity: "Balanced", completed: true }),
    loadProgression: async () => ({ totalXP }),
    loadDailyMissionState: async () => ({
      dailySessionId: "browser:UTC:2026-08-07",
      definition,
      lifecycle: { state, completionAwarded },
      replacementsUsed: 0,
      terminalAt: terminal ? "2026-08-07T12:00:00.000Z" : null,
      terminalRecorded: terminal,
    }),
    loadMissionHistory: async () => terminal ? [{
      missionId: definition.id,
      title: definition.title,
      focus: definition.focus,
      finalState: state,
      xpAwarded: completionAwarded ? 25 : 0,
      terminalAt: "2026-08-07T12:00:00.000Z",
    }] : [],
    saveProgression: async () => {},
    saveDailyMissionState: async () => {},
    persistMissionTransition: async (value) => persisted.push(value),
  };
  const authService = { signOut: async () => { signedOut = true; } };
  const service = applicationFactory.createApplicationService({
    authService,
    repository,
    missionEngine: { generateMission: async () => definition },
    lifecycleEngine,
    coordinatorEngine,
    progressionEngine,
    dailySessionId: "browser:UTC:2026-08-07",
  });
  return { service, persisted, wasSignedOut: () => signedOut };
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("restores authoritative XP through the progression engine", async () => {
  const { service } = createHarness({ totalXP: 250 });
  const result = await service.initialize();
  assert.equal(result.snapshot.progression.currentXP, 250);
  assert.equal(result.snapshot.progression.currentLevel, 3);
});

test("restores the current mission and lifecycle state", async () => {
  const { service } = createHarness({ state: "active" });
  const result = await service.initialize();
  assert.equal(result.snapshot.coordinator.currentMission.definition.id, definition.id);
  assert.equal(result.snapshot.coordinator.currentMission.lifecycle.state, "active");
});

test("duplicate completion remains blocked after restoration", async () => {
  const { service, persisted } = createHarness({ state: "completed", completionAwarded: true, totalXP: 100 });
  await service.initialize();
  const duplicate = await service.complete();
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.event.xpAwarded, 0);
  assert.equal(duplicate.snapshot.progression.currentXP, 100);
  assert.equal(persisted.length, 0);
});

test("validated completion persists mission, XP, and history together", async () => {
  const { service, persisted } = createHarness({ state: "active", totalXP: 75 });
  await service.initialize();
  const completion = await service.complete();
  assert.equal(completion.accepted, true);
  assert.equal(completion.snapshot.progression.currentXP, 100);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].dailyMission.lifecycle.state, "completed");
  assert.equal(persisted[0].totalXP, 100);
  assert.equal(persisted[0].historyRecord.finalState, "completed");
});

test("sign-out is delegated to the authentication boundary", async () => {
  const harness = createHarness();
  await harness.service.initialize();
  await harness.service.signOut();
  assert.equal(harness.wasSignedOut(), true);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
