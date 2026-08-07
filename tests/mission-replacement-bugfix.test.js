"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const applicationFactory = require("../js/application-service.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");
const replacementRequestController = require("../js/dashboard.js");

const createMissionEngine = () => {
  let uuidSequence = 0;
  const context = vm.createContext({
    window: {},
    crypto: {
      randomUUID: () => {
        uuidSequence += 1;
        return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/mission-generator.js"), "utf8"),
    context,
  );
  return context.window.KVNXMissionEngine;
};

const progressionContext = vm.createContext({ window: {} });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../js/progression.js"), "utf8"),
  progressionContext,
);
const progressionEngine = progressionContext.window.KVNXProgression;
const dailySessionId = "browser:UTC:2026-08-07";
const onboarding = Object.freeze({
  primaryFocus: "Programming",
  intensity: "Balanced",
  completed: true,
});

const createIntegratedHarness = async () => {
  const missionEngine = createMissionEngine();
  const firstDefinition = await missionEngine.generateMission(onboarding);
  const store = {
    progression: { totalXP: 75 },
    dailyMission: {
      dailySessionId,
      definition: firstDefinition,
      lifecycle: { state: "ready", completionAwarded: false },
      replacementsUsed: 0,
      terminalAt: null,
      terminalRecorded: false,
    },
    replacementCalls: 0,
    completionCalls: 0,
    signOuts: 0,
  };

  const createService = () => {
    const repository = {
      loadProfile: async () => ({ firstName: "Doug" }),
      loadOnboarding: async () => onboarding,
      loadProgression: async () => ({ ...store.progression }),
      loadDailyMissionState: async () => ({
        ...store.dailyMission,
        definition: { ...store.dailyMission.definition },
        lifecycle: { ...store.dailyMission.lifecycle },
      }),
      loadMissionHistory: async () => [],
      persistValidatedPrototypeProgression: async ({ lifecycleEvent, progressionSnapshot }) => {
        store.completionCalls += 1;
        store.progression = { totalXP: progressionSnapshot.currentXP };
        store.dailyMission = {
          ...store.dailyMission,
          lifecycle: { state: "completed", completionAwarded: true },
          terminalAt: lifecycleEvent.timestamp,
          terminalRecorded: false,
        };
        return { accepted: true, totalXP: store.progression.totalXP };
      },
      persistValidatedPrototypeReplacement: async ({ coordinatorSnapshot }) => {
        store.replacementCalls += 1;
        store.dailyMission = {
          ...store.dailyMission,
          definition: { ...coordinatorSnapshot.currentMission.definition },
          lifecycle: { state: "ready", completionAwarded: false },
          replacementsUsed: coordinatorSnapshot.dailyStatus.replacementsUsed,
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
      missionEngine,
      lifecycleEngine,
      coordinatorEngine,
      progressionEngine,
      dailySessionId,
      transitionMode: "prototype",
    });
  };

  const runThroughReplacement = async () => {
    const service = createService();
    await service.initialize();
    const missionAId = service.getSnapshot().coordinator.currentMission.definition.id;
    const firstCompletion = await service.complete();
    const replacement = await service.requestReplacement();
    const missionBId = replacement.snapshot.coordinator.currentMission.definition.id;
    const secondCompletion = await service.complete();
    return { service, missionAId, missionBId, firstCompletion, replacement, secondCompletion };
  };

  return { createService, firstDefinition, runThroughReplacement, store };
};

const createButton = () => ({
  disabled: false,
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("two generated programming missions receive different instance IDs", async () => {
  const engine = createMissionEngine();
  const first = await engine.generateMission(onboarding);
  const second = await engine.generateMission(onboarding);
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^programming-focused-session-/);
  assert.equal(first.title, second.title);
  assert.equal(first.focus, second.focus);
});

test("coordinator replacement ID differs from the previous mission ID", async () => {
  const engine = createMissionEngine();
  const coordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
    generateMission: engine.generateMission,
    createLifecycle: lifecycleEngine.createMissionLifecycle,
  });
  const previousMissionId = coordinator.getSnapshot().currentMission.definition.id;
  coordinator.complete();
  const replacement = await coordinator.requestReplacement();
  assert.equal(replacement.accepted, true);
  assert.equal(replacement.event.previousMissionId, previousMissionId);
  assert.notEqual(replacement.event.missionId, previousMissionId);
});

test("programming mission A completion persists 100 XP", async () => {
  const harness = await createIntegratedHarness();
  const service = harness.createService();
  await service.initialize();
  const completion = await service.complete();
  assert.equal(completion.snapshot.progression.currentXP, 100);
  assert.equal(harness.store.progression.totalXP, 100);
  assert.equal(harness.store.completionCalls, 1);
});

test("replacement mission B persists successfully with a new identity", async () => {
  const harness = await createIntegratedHarness();
  const sequence = await harness.runThroughReplacement();
  assert.equal(sequence.replacement.accepted, true);
  assert.notEqual(sequence.missionBId, sequence.missionAId);
  assert.equal(harness.store.dailyMission.definition.id, sequence.missionBId);
  assert.equal(harness.store.replacementCalls, 1);
});

test("mission B completion persists 125 XP", async () => {
  const harness = await createIntegratedHarness();
  const sequence = await harness.runThroughReplacement();
  assert.equal(sequence.secondCompletion.snapshot.progression.currentXP, 125);
  assert.equal(harness.store.progression.totalXP, 125);
  assert.equal(harness.store.completionCalls, 2);
});

test("refresh restores 125 XP and completed mission B", async () => {
  const harness = await createIntegratedHarness();
  const sequence = await harness.runThroughReplacement();
  const refreshed = harness.createService();
  const restored = await refreshed.initialize();
  assert.equal(restored.snapshot.progression.currentXP, 125);
  assert.equal(restored.snapshot.coordinator.currentMission.definition.id, sequence.missionBId);
  assert.equal(restored.snapshot.coordinator.currentMission.lifecycle.state, "completed");
});

test("logout and login restore 125 XP and completed mission B", async () => {
  const harness = await createIntegratedHarness();
  const sequence = await harness.runThroughReplacement();
  await sequence.service.signOut();
  const nextLogin = harness.createService();
  const restored = await nextLogin.initialize();
  assert.equal(harness.store.signOuts, 1);
  assert.equal(restored.snapshot.progression.currentXP, 125);
  assert.equal(restored.snapshot.coordinator.currentMission.definition.id, sequence.missionBId);
  assert.equal(restored.snapshot.coordinator.currentMission.lifecycle.completionAwarded, true);
});

test("replacement button is re-enabled after a failed retryable request", async () => {
  const button = createButton();
  let errors = 0;
  const controller = replacementRequestController.create({
    button,
    request: async () => { throw new Error("temporary failure"); },
    onError: () => { errors += 1; },
    canRetry: ({ error }) => Boolean(error),
  });
  const result = await controller.run();
  assert.equal(result.reason, "replacement-request-failed");
  assert.equal(errors, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], "false");
  assert.equal(controller.isInFlight(), false);
});

test("concurrent replacement requests cannot create duplicate replacements", async () => {
  const button = createButton();
  let release;
  let requests = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const controller = replacementRequestController.create({
    button,
    request: async () => { requests += 1; return pending; },
    canRetry: () => false,
  });
  const first = controller.run();
  const duplicate = await controller.run();
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "replacement-request-in-progress");
  assert.equal(requests, 1);
  release({ accepted: true });
  await first;
  assert.equal(requests, 1);
});

test("one-replacement limit remains enforced with unique mission IDs", async () => {
  const engine = createMissionEngine();
  const coordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
    generateMission: engine.generateMission,
    createLifecycle: lifecycleEngine.createMissionLifecycle,
  });
  coordinator.complete();
  assert.equal((await coordinator.requestReplacement()).accepted, true);
  coordinator.complete();
  const second = await coordinator.requestReplacement();
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "replacement-limit-reached");
  assert.equal(second.snapshot.dailyStatus.replacementsUsed, 1);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
