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

const onboarding = Object.freeze({
  primaryFocus: "Programming",
  intensity: "Balanced",
  completed: true,
});

const createDailyAuthority = () => {
  const store = {
    dailyKey: "2026-08-07",
    days: new Map(),
    totalXP: 75,
    history: [],
    sequence: 0,
    signOuts: 0,
    clientGenerationCalls: 0,
    queue: Promise.resolve(),
  };

  const missionSnapshot = (row, reason, accepted = true) => ({
    accepted,
    reason,
    dailyKey: row.dailyKey,
    mission: {
      definition: { ...row.definition },
      lifecycle: {
        state: row.state,
        completionAwarded: row.completionAwarded,
        terminalAt: row.terminalAt,
        terminalRecorded: row.terminalRecorded,
      },
    },
    dailyStatus: {
      replacementsUsed: row.replacementsUsed,
      replacementsRemaining: 1 - row.replacementsUsed,
    },
  });

  const createDefinition = () => {
    store.sequence += 1;
    return {
      id: `programming-focused-session-server-${store.sequence}`,
      focus: onboarding.primaryFocus,
      title: "Complete a Coding Session",
      description: "Complete one focused coding session today without switching tasks.",
      estimatedDuration: "30 minutes",
      difficulty: "Balanced",
      xpReward: 25,
    };
  };

  const requestDailyMission = () => {
    const operation = store.queue.then(async () => {
      for (const row of store.days.values()) {
        if (row.dailyKey < store.dailyKey && ["ready", "active"].includes(row.state)) {
          row.state = "expired";
          row.completionAwarded = false;
          row.terminalAt = `${store.dailyKey}T00:00:00.000Z`;
          row.terminalRecorded = true;
          if (!store.history.some((record) => record.missionId === row.definition.id)) {
            store.history.push({
              missionId: row.definition.id,
              title: row.definition.title,
              focus: row.definition.focus,
              finalState: "expired",
              xpAwarded: 0,
              terminalAt: row.terminalAt,
            });
          }
        }
      }

      let row = store.days.get(store.dailyKey);
      const reason = row ? "existing" : "created";
      if (!row) {
        row = {
          dailyKey: store.dailyKey,
          definition: createDefinition(),
          state: "ready",
          completionAwarded: false,
          replacementsUsed: 0,
          terminalAt: null,
          terminalRecorded: false,
        };
        store.days.set(store.dailyKey, row);
      }
      return missionSnapshot(row, reason);
    });
    store.queue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const requestAction = async ({ missionId, action }) => {
    const row = store.days.get(store.dailyKey);
    const previousState = row.state;
    let accepted = false;
    let reason = null;
    let xpAwarded = 0;

    if (missionId !== row.definition.id) reason = "mission-mismatch";
    else if (action === "complete" && ["ready", "active"].includes(row.state)) {
      accepted = true;
      row.state = "completed";
      row.completionAwarded = true;
      row.terminalAt = `${store.dailyKey}T12:00:00.000Z`;
      row.terminalRecorded = true;
      xpAwarded = 25;
      store.totalXP += 25;
      store.history.push({
        missionId: row.definition.id,
        title: row.definition.title,
        focus: row.definition.focus,
        finalState: "completed",
        xpAwarded,
        terminalAt: row.terminalAt,
      });
    } else if (action === "start" && row.state === "ready") {
      accepted = true;
      row.state = "active";
    } else if (action === "skip" && ["ready", "active"].includes(row.state)) {
      accepted = true;
      row.state = "skipped";
      row.terminalAt = `${store.dailyKey}T12:00:00.000Z`;
      row.terminalRecorded = true;
    } else reason = row.state === "expired" ? "mission-expired" : `already-${row.state}`;

    return {
      ...missionSnapshot(row, reason, accepted),
      event: {
        missionId: row.definition.id,
        previousState,
        currentState: row.state,
        eventType: accepted ? `mission.${action === "complete" ? "completed" : `${action}ed`}` : "mission.transition-rejected",
        requestedAction: action,
        xpAwarded,
        timestamp: row.terminalAt || `${store.dailyKey}T12:00:00.000Z`,
      },
      progression: { totalXP: store.totalXP },
      historyRecord: xpAwarded ? store.history.at(-1) : null,
    };
  };

  const requestReplacement = async () => {
    const row = store.days.get(store.dailyKey);
    if (!["completed", "skipped", "expired"].includes(row.state)) {
      return { ...missionSnapshot(row, "current-mission-not-terminal", false), progression: { totalXP: store.totalXP } };
    }
    if (row.replacementsUsed >= 1) {
      return { ...missionSnapshot(row, "replacement-limit-reached", false), progression: { totalXP: store.totalXP } };
    }
    row.definition = createDefinition();
    row.state = "ready";
    row.completionAwarded = false;
    row.replacementsUsed = 1;
    row.terminalAt = null;
    row.terminalRecorded = false;
    return { ...missionSnapshot(row, "replaced", true), progression: { totalXP: store.totalXP } };
  };

  return { store, requestAction, requestDailyMission, requestReplacement };
};

const createService = (authority) => applicationFactory.createApplicationService({
  authService: { signOut: async () => { authority.store.signOuts += 1; } },
  repository: {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => onboarding,
    loadProgression: async () => ({ totalXP: authority.store.totalXP }),
    loadMissionHistory: async () => authority.store.history.map((record) => ({ ...record })),
    loadDailyMissionState: async () => { throw new Error("Production restoration must not query a browser-selected daily key."); },
    requestDailyMission: authority.requestDailyMission,
    requestDailyMissionReplacement: authority.requestReplacement,
    requestMissionAction: authority.requestAction,
  },
  missionEngine: {
    generateMission: async () => {
      authority.store.clientGenerationCalls += 1;
      throw new Error("Client mission generator must not run in Sprint 9 production restoration.");
    },
  },
  lifecycleEngine,
  coordinatorEngine,
  progressionEngine,
  transitionMode: "authoritative",
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("first request creates exactly one authoritative mission", async () => {
  const authority = createDailyAuthority();
  const result = await authority.requestDailyMission();
  assert.equal(result.reason, "created");
  assert.equal(authority.store.days.size, 1);
});

test("second same-day request returns the same mission", async () => {
  const authority = createDailyAuthority();
  const first = await authority.requestDailyMission();
  const second = await authority.requestDailyMission();
  assert.equal(second.reason, "existing");
  assert.equal(second.mission.definition.id, first.mission.definition.id);
});

test("refresh restores the same authoritative mission", async () => {
  const authority = createDailyAuthority();
  const first = await createService(authority).initialize();
  const refreshed = await createService(authority).initialize();
  assert.equal(refreshed.snapshot.coordinator.currentMission.definition.id, first.snapshot.coordinator.currentMission.definition.id);
});

test("logout and login restore the same authoritative mission", async () => {
  const authority = createDailyAuthority();
  const service = createService(authority);
  const first = await service.initialize();
  await service.signOut();
  const next = await createService(authority).initialize();
  assert.equal(authority.store.signOuts, 1);
  assert.equal(next.snapshot.coordinator.currentMission.definition.id, first.snapshot.coordinator.currentMission.definition.id);
});

test("simultaneous requests converge on one mission instance", async () => {
  const authority = createDailyAuthority();
  const results = await Promise.all([authority.requestDailyMission(), authority.requestDailyMission()]);
  assert.equal(new Set(results.map((result) => result.mission.definition.id)).size, 1);
  assert.equal(authority.store.days.size, 1);
});

test("next authoritative day creates a different instance", async () => {
  const authority = createDailyAuthority();
  const first = await authority.requestDailyMission();
  authority.store.dailyKey = "2026-08-08";
  const next = await authority.requestDailyMission();
  assert.notEqual(next.mission.definition.id, first.mission.definition.id);
  assert.equal(authority.store.days.size, 2);
});

test("rollover expires a previous ready mission", async () => {
  const authority = createDailyAuthority();
  await authority.requestDailyMission();
  authority.store.dailyKey = "2026-08-08";
  await authority.requestDailyMission();
  assert.equal(authority.store.days.get("2026-08-07").state, "expired");
});

test("rollover expires a previous active mission", async () => {
  const authority = createDailyAuthority();
  const first = await authority.requestDailyMission();
  await authority.requestAction({ missionId: first.mission.definition.id, action: "start" });
  authority.store.dailyKey = "2026-08-08";
  await authority.requestDailyMission();
  assert.equal(authority.store.days.get("2026-08-07").state, "expired");
});

test("rollover expiration records zero XP", async () => {
  const authority = createDailyAuthority();
  await authority.requestDailyMission();
  authority.store.dailyKey = "2026-08-08";
  await authority.requestDailyMission();
  assert.equal(authority.store.totalXP, 75);
  assert.equal(authority.store.history[0].xpAwarded, 0);
});

test("daily generation reads the saved onboarding focus", async () => {
  const authority = createDailyAuthority();
  const result = await authority.requestDailyMission();
  assert.equal(result.mission.definition.focus, "Programming");
  assert.match(result.mission.definition.id, /^programming-focused-session-server-/);
});

test("production restoration never calls the client mission generator", async () => {
  const authority = createDailyAuthority();
  await createService(authority).initialize();
  assert.equal(authority.store.clientGenerationCalls, 0);
});

test("authoritative completion still awards exactly 25 XP", async () => {
  const authority = createDailyAuthority();
  const service = createService(authority);
  await service.initialize();
  const completed = await service.complete();
  assert.equal(completed.event.xpAwarded, 25);
  assert.equal(completed.snapshot.progression.currentXP, 100);
});

test("server-selected replacement remains limited to one", async () => {
  const authority = createDailyAuthority();
  const service = createService(authority);
  await service.initialize();
  await service.complete();
  const replacement = await service.requestReplacement({ mission: { id: "attacker" }, xpReward: 999 });
  assert.equal(replacement.accepted, true);
  assert.match(replacement.snapshot.coordinator.currentMission.definition.id, /^programming-focused-session-server-/);
  await service.complete();
  const second = await service.requestReplacement();
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "replacement-limit-reached");
  assert.equal(authority.store.totalXP, 125);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
