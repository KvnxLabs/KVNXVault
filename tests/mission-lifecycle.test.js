"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const lifecycleEngine = require("../js/mission-lifecycle.js");

const definition = Object.freeze({
  id: "first-mission-programming",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today without switching tasks.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
});

const fixedClock = () => new Date("2026-08-07T12:00:00.000Z");
const createLifecycle = (initialState) => lifecycleEngine.createMissionLifecycle(
  definition,
  { initialState, clock: fixedClock },
);

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("ready → active", () => {
  const result = createLifecycle().start();
  assert.equal(result.accepted, true);
  assert.equal(result.event.previousState, "ready");
  assert.equal(result.event.currentState, "active");
  assert.equal(result.event.xpAwarded, 0);
});

test("active → completed", () => {
  const lifecycle = createLifecycle();
  lifecycle.start();
  const result = lifecycle.complete();
  assert.equal(result.accepted, true);
  assert.equal(result.event.currentState, "completed");
  assert.equal(result.event.xpAwarded, 25);
});

test("ready → completed", () => {
  const result = createLifecycle().complete();
  assert.equal(result.accepted, true);
  assert.equal(result.event.currentState, "completed");
  assert.equal(result.event.xpAwarded, 25);
});

test("ready → skipped", () => {
  const result = createLifecycle().skip();
  assert.equal(result.accepted, true);
  assert.equal(result.event.currentState, "skipped");
  assert.equal(result.event.xpAwarded, 0);
});

test("active → skipped", () => {
  const lifecycle = createLifecycle();
  lifecycle.start();
  const result = lifecycle.skip();
  assert.equal(result.accepted, true);
  assert.equal(result.event.currentState, "skipped");
  assert.equal(result.event.xpAwarded, 0);
});

test("completed cannot complete again", () => {
  const lifecycle = createLifecycle();
  lifecycle.complete();
  const duplicate = lifecycle.complete();
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.event.currentState, "completed");
  assert.equal(duplicate.event.xpAwarded, 0);
});

test("skipped cannot award XP", () => {
  const lifecycle = createLifecycle();
  lifecycle.skip();
  const result = lifecycle.complete();
  assert.equal(result.accepted, false);
  assert.equal(result.event.currentState, "skipped");
  assert.equal(result.event.xpAwarded, 0);
});

test("expired cannot award XP", () => {
  const lifecycle = createLifecycle();
  const expiration = lifecycle.expire();
  const result = lifecycle.complete();
  assert.equal(expiration.accepted, true);
  assert.equal(result.accepted, false);
  assert.equal(result.event.currentState, "expired");
  assert.equal(result.event.xpAwarded, 0);
});

test("duplicate completion cannot award XP twice", () => {
  const lifecycle = createLifecycle();
  const first = lifecycle.complete();
  const second = lifecycle.complete();
  assert.equal(first.event.xpAwarded + second.event.xpAwarded, 25);
});

test("validated completion event is the only progression input", () => {
  const context = vm.createContext({ window: {} });
  const progressionSource = fs.readFileSync(path.join(__dirname, "../js/progression.js"), "utf8");
  vm.runInContext(progressionSource, context);

  const lifecycle = createLifecycle();
  const completion = lifecycle.complete();
  const progression = context.window.KVNXProgression.createProgression(75);
  const progressionResult = context.window.KVNXProgression.addXP(
    progression,
    completion.event.xpAwarded,
  );

  assert.equal(completion.event.eventType, "mission.completed");
  assert.equal(progressionResult.snapshot.currentXP, 100);
  assert.equal(progressionResult.snapshot.currentLevel, 2);
});

let failures = 0;
tests.forEach(({ name, run }) => {
  try {
    run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
});

if (failures) process.exitCode = 1;
