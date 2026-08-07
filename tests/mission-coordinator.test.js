"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");

const fixedClock = () => new Date("2026-08-07T12:00:00.000Z");

const createHarness = async () => {
  let generationCount = 0;
  let lifecycleCount = 0;

  const generateMission = async () => {
    generationCount += 1;
    return Object.freeze({
      id: `daily-mission-${generationCount}`,
      focus: "Programming",
      title: generationCount === 1 ? "Complete a Coding Session" : "Continue Your Coding Practice",
      description: "Complete one focused coding session today.",
      estimatedDuration: "30 minutes",
      difficulty: "Balanced",
      xpReward: 25,
    });
  };

  const createLifecycle = (definition, options) => {
    lifecycleCount += 1;
    return lifecycleEngine.createMissionLifecycle(definition, options);
  };

  const coordinator = await coordinatorEngine.createDailyMissionCoordinator(
    { primaryFocus: "Programming" },
    { generateMission, createLifecycle, clock: fixedClock },
  );

  return {
    coordinator,
    getGenerationCount: () => generationCount,
    getLifecycleCount: () => lifecycleCount,
  };
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("coordinator creates one mission and one lifecycle controller", async () => {
  const harness = await createHarness();
  const snapshot = harness.coordinator.getSnapshot();
  assert.equal(harness.getGenerationCount(), 1);
  assert.equal(harness.getLifecycleCount(), 1);
  assert.equal(snapshot.currentMission.definition.id, "daily-mission-1");
  assert.equal(snapshot.currentMission.lifecycle.state, "ready");
  assert.equal(snapshot.dailyStatus.hasCurrentMission, true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.currentMission), true);
  assert.equal(Object.isFrozen(snapshot.currentMission.definition), true);
  assert.equal(Object.isFrozen(snapshot.currentMission.lifecycle), true);
  assert.equal(Object.isFrozen(snapshot.history), true);
  assert.equal(Object.isFrozen(snapshot.dailyStatus), true);
});

test("only one daily mission exists at a time", async () => {
  const harness = await createHarness();
  const replacement = await harness.coordinator.requestReplacement();
  assert.equal(replacement.accepted, false);
  assert.equal(replacement.reason, "current-mission-not-terminal");
  assert.equal(harness.getGenerationCount(), 1);
});

test("start routes through lifecycle", async () => {
  const { coordinator } = await createHarness();
  const result = coordinator.start();
  assert.equal(result.accepted, true);
  assert.equal(result.event.eventType, "mission.started");
  assert.equal(result.snapshot.currentMission.lifecycle.state, "active");
});

test("completion routes through lifecycle and awards XP only once", async () => {
  const { coordinator } = await createHarness();
  const first = coordinator.complete();
  const duplicate = coordinator.complete();
  assert.equal(first.event.eventType, "mission.completed");
  assert.equal(first.event.xpAwarded, 25);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.event.xpAwarded, 0);
  assert.equal(first.event.xpAwarded + duplicate.event.xpAwarded, 25);
});

test("skipped and expired missions award zero XP", async () => {
  const skippedHarness = await createHarness();
  const expiredHarness = await createHarness();
  assert.equal(skippedHarness.coordinator.skip().event.xpAwarded, 0);
  assert.equal(expiredHarness.coordinator.expire().event.xpAwarded, 0);
});

test("terminal missions create immutable history records", async () => {
  for (const action of ["complete", "skip", "expire"]) {
    const { coordinator } = await createHarness();
    const result = coordinator[action]();
    const [record] = result.snapshot.history;
    assert.equal(result.snapshot.history.length, 1);
    assert.equal(record.finalState, result.event.currentState);
    assert.equal(record.xpAwarded, result.event.xpAwarded);
    assert.equal(record.terminalAt, "2026-08-07T12:00:00.000Z");
    assert.equal(Object.isFrozen(record), true);
  }
});

test("ready and active missions cannot be replaced", async () => {
  const readyHarness = await createHarness();
  const activeHarness = await createHarness();
  activeHarness.coordinator.start();
  const readyResult = await readyHarness.coordinator.requestReplacement();
  const activeResult = await activeHarness.coordinator.requestReplacement();
  assert.equal(readyResult.reason, "current-mission-not-terminal");
  assert.equal(activeResult.reason, "current-mission-not-terminal");
});

test("completed mission can be replaced explicitly with a new lifecycle", async () => {
  const harness = await createHarness();
  harness.coordinator.complete();
  const replacement = await harness.coordinator.requestReplacement();
  assert.equal(replacement.accepted, true);
  assert.equal(harness.getGenerationCount(), 2);
  assert.equal(harness.getLifecycleCount(), 2);
  assert.equal(replacement.snapshot.currentMission.definition.id, "daily-mission-2");
  assert.equal(replacement.snapshot.currentMission.lifecycle.state, "ready");
  assert.equal(replacement.snapshot.dailyStatus.replacementsUsed, 1);
});

test("skipped and expired missions can be replaced only through explicit action", async () => {
  for (const [action, terminalState] of [["skip", "skipped"], ["expire", "expired"]]) {
    const harness = await createHarness();
    harness.coordinator[action]();
    const beforeReplacement = harness.coordinator.getSnapshot();
    assert.equal(beforeReplacement.currentMission.lifecycle.state, terminalState);
    assert.equal(harness.getGenerationCount(), 1);
    const replacement = await harness.coordinator.requestReplacement();
    assert.equal(replacement.accepted, true);
    assert.equal(harness.getGenerationCount(), 2);
    assert.equal(replacement.snapshot.currentMission.lifecycle.state, "ready");
  }
});

test("replacement limit is enforced", async () => {
  const { coordinator } = await createHarness();
  coordinator.complete();
  assert.equal((await coordinator.requestReplacement()).accepted, true);
  coordinator.skip();
  const secondReplacement = await coordinator.requestReplacement();
  assert.equal(secondReplacement.accepted, false);
  assert.equal(secondReplacement.reason, "replacement-limit-reached");
});

test("failed replacement preserves the terminal mission and allowance", async () => {
  let calls = 0;
  const generateMission = async () => {
    calls += 1;
    if (calls > 1) throw new Error("provider unavailable");
    return {
      id: "stable-mission",
      focus: "Programming",
      title: "Complete a Coding Session",
      description: "Complete one focused coding session today.",
      estimatedDuration: "30 minutes",
      difficulty: "Balanced",
      xpReward: 25,
    };
  };
  const coordinator = await coordinatorEngine.createDailyMissionCoordinator({}, {
    generateMission,
    createLifecycle: lifecycleEngine.createMissionLifecycle,
    clock: fixedClock,
  });
  coordinator.complete();
  const result = await coordinator.requestReplacement();
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "replacement-generation-failed");
  assert.equal(result.snapshot.currentMission.definition.id, "stable-mission");
  assert.equal(result.snapshot.currentMission.lifecycle.state, "completed");
  assert.equal(result.snapshot.dailyStatus.replacementsUsed, 0);
  assert.equal(result.snapshot.dailyStatus.replacementsRemaining, 1);
});

test("history preserves the previous terminal mission after replacement", async () => {
  const { coordinator } = await createHarness();
  coordinator.complete();
  const replacement = await coordinator.requestReplacement();
  assert.equal(replacement.snapshot.history.length, 1);
  assert.equal(replacement.snapshot.history[0].missionId, "daily-mission-1");
  assert.equal(replacement.snapshot.history[0].finalState, "completed");
});

test("progression receives only XP from an accepted lifecycle event", async () => {
  const context = vm.createContext({ window: {} });
  const progressionSource = fs.readFileSync(path.join(__dirname, "../js/progression.js"), "utf8");
  vm.runInContext(progressionSource, context);

  const { coordinator } = await createHarness();
  const completion = coordinator.complete();
  const duplicate = coordinator.complete();
  let progression = context.window.KVNXProgression.createProgression(75);

  if (completion.accepted) {
    progression = context.window.KVNXProgression.addXP(
      progression,
      completion.event.xpAwarded,
    ).progression;
  }
  if (duplicate.accepted) {
    progression = context.window.KVNXProgression.addXP(
      progression,
      duplicate.event.xpAwarded,
    ).progression;
  }

  const snapshot = context.window.KVNXProgression.getSnapshot(progression);
  assert.equal(snapshot.currentXP, 100);
  assert.equal(snapshot.currentLevel, 2);
});

(async () => {
  let failures = 0;

  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }

  if (failures) process.exitCode = 1;
})();
