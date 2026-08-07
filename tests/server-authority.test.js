"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const applicationFactory = require("../js/application-service.js");
const repositoryFactory = require("../js/user-repository.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/progression.js"), "utf8"), context);
const progressionEngine = context.window.KVNXProgression;

const dailySessionId = "browser:UTC:2026-08-07";
const onboarding = Object.freeze({ primaryFocus: "Programming", intensity: "Balanced", completed: true });
const missionA = Object.freeze({
  id: "programming-focused-session-a",
  focus: "Programming",
  title: "Complete a Coding Session",
  description: "Complete one focused coding session today.",
  estimatedDuration: "30 minutes",
  difficulty: "Balanced",
  xpReward: 25,
});
const missionB = Object.freeze({ ...missionA, id: "programming-focused-session-b" });

const createAuthorityStore = ({ state = "ready", totalXP = 75, definition = missionA } = {}) => {
  const store = {
    definition: { ...definition, xpReward: 25 },
    state,
    completionAwarded: state === "completed",
    replacementsUsed: 0,
    terminalAt: ["completed", "skipped", "expired"].includes(state)
      ? "2026-08-07T12:00:00.000Z"
      : null,
    terminalRecorded: ["completed", "skipped", "expired"].includes(state),
    totalXP,
    history: [],
    actionCalls: [],
    replacementCalls: [],
    signOuts: 0,
    clock: 0,
    queue: Promise.resolve(),
  };

  const snapshotResult = ({ accepted, reason = null, action, previousState, xpAwarded = 0, historyRecord = null }) => ({
    accepted,
    reason,
    event: action ? {
      missionId: store.definition.id,
      previousState,
      currentState: store.state,
      eventType: accepted ? `mission.${action === "complete" ? "completed" : `${action}ed`}` : "mission.transition-rejected",
      requestedAction: action,
      xpAwarded,
      timestamp: store.terminalAt || `2026-08-07T12:${String(store.clock).padStart(2, "0")}:00.000Z`,
    } : null,
    mission: {
      definition: { ...store.definition },
      lifecycle: {
        state: store.state,
        completionAwarded: store.completionAwarded,
        terminalAt: store.terminalAt,
        terminalRecorded: store.terminalRecorded,
      },
    },
    progression: { totalXP: store.totalXP },
    dailyStatus: {
      replacementsUsed: store.replacementsUsed,
      replacementsRemaining: 1 - store.replacementsUsed,
    },
    historyRecord,
  });

  const requestAction = ({ missionId, action }) => {
    const operation = store.queue.then(async () => {
      store.actionCalls.push({ missionId, action });
      store.clock += 1;
      const previousState = store.state;

      if (missionId !== store.definition.id) {
        return snapshotResult({ accepted: false, reason: "mission-mismatch", action, previousState });
      }
      if (!["start", "complete", "skip"].includes(action)) {
        return snapshotResult({ accepted: false, reason: "invalid-action", action, previousState });
      }
      if (["completed", "skipped", "expired"].includes(previousState)) {
        const reason = previousState === "completed"
          ? "already-completed"
          : previousState === "skipped" ? "already-skipped" : "mission-expired";
        return snapshotResult({ accepted: false, reason, action, previousState });
      }
      if (action === "start" && previousState !== "ready") {
        return snapshotResult({ accepted: false, reason: "invalid-transition", action, previousState });
      }

      let xpAwarded = 0;
      let historyRecord = null;
      if (action === "start") store.state = "active";
      if (action === "complete") {
        store.state = "completed";
        store.completionAwarded = true;
        xpAwarded = store.definition.xpReward;
        store.totalXP += xpAwarded;
      }
      if (action === "skip") store.state = "skipped";

      if (["completed", "skipped"].includes(store.state)) {
        store.terminalAt = `2026-08-07T12:${String(store.clock).padStart(2, "0")}:00.000Z`;
        store.terminalRecorded = true;
        historyRecord = {
          missionId: store.definition.id,
          title: store.definition.title,
          focus: store.definition.focus,
          finalState: store.state,
          xpAwarded,
          terminalAt: store.terminalAt,
        };
        if (!store.history.some((record) => record.missionId === historyRecord.missionId)) {
          store.history.push(historyRecord);
        }
      }

      return snapshotResult({ accepted: true, action, previousState, xpAwarded, historyRecord });
    });
    store.queue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const persistReplacement = async ({ replacementEvent, coordinatorSnapshot }) => {
    store.replacementCalls.push({ replacementEvent, coordinatorSnapshot });
    if (store.replacementsUsed >= 1) {
      return snapshotResult({ accepted: false, reason: "replacement-limit-reached" });
    }
    store.definition = { ...coordinatorSnapshot.currentMission.definition, xpReward: 25 };
    store.state = "ready";
    store.completionAwarded = false;
    store.replacementsUsed = 1;
    store.terminalAt = null;
    store.terminalRecorded = false;
    const result = snapshotResult({ accepted: true });
    return {
      ...result,
      missionId: store.definition.id,
      replacementsUsed: store.replacementsUsed,
    };
  };

  return { store, requestAction, persistReplacement, snapshotResult };
};

const createService = (authority, { authenticated = true } = {}) => {
  const { store } = authority;
  const repository = {
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => onboarding,
    loadProgression: async () => ({ totalXP: store.totalXP }),
    loadDailyMissionState: async () => ({
      dailySessionId,
      definition: { ...store.definition },
      lifecycle: { state: store.state, completionAwarded: store.completionAwarded },
      replacementsUsed: store.replacementsUsed,
      terminalAt: store.terminalAt,
      terminalRecorded: store.terminalRecorded,
    }),
    loadMissionHistory: async () => store.history.map((record) => ({ ...record })),
    requestMissionAction: async (intent) => {
      if (!authenticated) {
        const error = new Error("KVNX Vault could not access your saved data.");
        error.code = "session-expired";
        throw error;
      }
      return authority.requestAction(intent);
    },
    persistValidatedPrototypeReplacement: authority.persistReplacement,
  };

  return applicationFactory.createApplicationService({
    authService: { signOut: async () => { store.signOuts += 1; } },
    repository,
    missionEngine: { generateMission: async () => ({ ...missionB }) },
    lifecycleEngine,
    coordinatorEngine,
    progressionEngine,
    dailySessionId,
    transitionMode: "authoritative",
  });
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("ready → active is accepted by server authority", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  const result = await service.start();
  assert.equal(result.accepted, true, `${result.reason}: ${JSON.stringify(authority.store.actionCalls)}`);
  assert.equal(result.event.previousState, "ready");
  assert.equal(result.snapshot.coordinator.currentMission.lifecycle.state, "active");
});

test("ready → completed is accepted", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  assert.equal((await service.complete()).accepted, true);
  assert.equal(authority.store.state, "completed");
});

test("active → completed is accepted", async () => {
  const authority = createAuthorityStore({ state: "active" });
  const service = createService(authority);
  await service.initialize();
  assert.equal((await service.complete()).event.previousState, "active");
});

test("ready → skipped is accepted", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  assert.equal((await service.skip()).snapshot.coordinator.currentMission.lifecycle.state, "skipped");
});

test("active → skipped is accepted", async () => {
  const authority = createAuthorityStore({ state: "active" });
  const service = createService(authority);
  await service.initialize();
  const result = await service.skip();
  assert.equal(result.accepted, true);
  assert.equal(result.event.previousState, "active");
});

test("completion awards the saved canonical mission reward", async () => {
  const authority = createAuthorityStore({ definition: { ...missionA, xpReward: 999999 } });
  const service = createService(authority);
  await service.initialize();
  const result = await service.complete({ xpReward: 999999, totalXP: 999999 });
  assert.equal(result.event.xpAwarded, 25);
  assert.equal(authority.store.totalXP, 100);
});

test("browser cannot include XP in the repository RPC request", async () => {
  const calls = [];
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "user-a" }),
      getClient: () => ({ rpc: async (name, payload) => {
        calls.push({ name, payload });
        return { data: { accepted: false, reason: "mission-not-found" }, error: null };
      } }),
    },
  });
  await repository.requestMissionAction({ missionId: missionA.id, action: "complete", totalXP: 999999 });
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ["p_action", "p_mission_id"]);
});

test("browser cannot include user id in the repository RPC request", async () => {
  let payload;
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "real-user" }),
      getClient: () => ({ rpc: async (_name, value) => {
        payload = value;
        return { data: { accepted: false, reason: "mission-not-found" }, error: null };
      } }),
    },
  });
  await repository.requestMissionAction({ missionId: missionA.id, action: "complete", userId: "attacker" });
  assert.equal("p_user_id" in payload, false);
  assert.equal("userId" in payload, false);
});

test("browser cannot include final lifecycle state in the RPC request", async () => {
  let payload;
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "real-user" }),
      getClient: () => ({ rpc: async (_name, value) => {
        payload = value;
        return { data: { accepted: false, reason: "mission-not-found" }, error: null };
      } }),
    },
  });
  await repository.requestMissionAction({ missionId: missionA.id, action: "complete", lifecycleState: "completed" });
  assert.equal(JSON.stringify(payload).includes("lifecycle"), false);
  assert.equal(JSON.stringify(payload).includes("completed"), false);
});

test("completed mission cannot complete again", async () => {
  const authority = createAuthorityStore({ state: "completed", totalXP: 100 });
  const service = createService(authority);
  await service.initialize();
  const result = await service.complete();
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "already-completed");
  assert.equal(authority.store.totalXP, 100);
});

test("duplicate completion awards XP exactly once", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  await service.complete();
  await service.complete();
  assert.equal(authority.store.totalXP, 100);
  assert.equal(authority.store.history.length, 1);
});

test("concurrent completion attempts award XP exactly once", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  const results = await Promise.all([service.complete(), service.complete()]);
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.equal(authority.store.totalXP, 100);
  assert.equal(authority.store.history.length, 1);
});

test("skipped mission awards zero XP", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  const result = await service.skip();
  assert.equal(result.event.xpAwarded, 0);
  assert.equal(authority.store.totalXP, 75);
});

test("expired mission cannot award XP", async () => {
  const authority = createAuthorityStore({ state: "expired" });
  const service = createService(authority);
  await service.initialize();
  const result = await service.complete();
  assert.equal(result.reason, "mission-expired");
  assert.equal(authority.store.totalXP, 75);
});

test("terminal history is inserted exactly once", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  await service.complete();
  await service.complete();
  assert.equal(authority.store.history.length, 1);
  assert.equal(authority.store.history[0].xpAwarded, 25);
});

test("authoritative XP restores after refresh", async () => {
  const authority = createAuthorityStore();
  const firstPage = createService(authority);
  await firstPage.initialize();
  await firstPage.complete();
  const refreshed = await createService(authority).initialize();
  assert.equal(refreshed.snapshot.progression.currentXP, 100);
  assert.equal(refreshed.snapshot.coordinator.currentMission.lifecycle.state, "completed");
});

test("authoritative XP restores after logout and login", async () => {
  const authority = createAuthorityStore();
  const firstSession = createService(authority);
  await firstSession.initialize();
  await firstSession.complete();
  await firstSession.signOut();
  const nextSession = await createService(authority).initialize();
  assert.equal(authority.store.signOuts, 1);
  assert.equal(nextSession.snapshot.progression.currentXP, 100);
});

test("replacement mission remains compatible with authoritative actions", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  await service.complete();
  const replacement = await service.requestReplacement();
  assert.equal(replacement.accepted, true);
  assert.equal(replacement.snapshot.coordinator.currentMission.definition.id, missionB.id);
  assert.equal(authority.store.totalXP, 100);
});

test("Mission A completion → replacement → Mission B completion works", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  await service.complete();
  const replacement = await service.requestReplacement();
  assert.equal(replacement.accepted, true, replacement.reason);
  assert.equal(authority.store.definition.id, missionB.id);
  const result = await service.complete();
  assert.equal(result.accepted, true, `${result.reason}: ${JSON.stringify(authority.store.actionCalls)}`);
  assert.equal(authority.store.totalXP, 125);
  assert.equal(authority.store.history.length, 2);
});

test("100 → replacement → 125 survives refresh and logout/login", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  await service.complete();
  await service.requestReplacement();
  await service.complete();
  const refreshed = await createService(authority).initialize();
  assert.equal(refreshed.snapshot.progression.currentXP, 125);
  await service.signOut();
  const nextLogin = await createService(authority).initialize();
  assert.equal(nextLogin.snapshot.progression.currentXP, 125);
  assert.equal(nextLogin.snapshot.coordinator.currentMission.definition.id, missionB.id);
  assert.equal(nextLogin.snapshot.coordinator.currentMission.lifecycle.state, "completed");
});

test("invalid mission id is rejected without mutation", async () => {
  const authority = createAuthorityStore();
  const result = await authority.requestAction({ missionId: "not-the-current-mission", action: "complete" });
  assert.equal(result.reason, "mission-mismatch");
  assert.equal(authority.store.totalXP, 75);
  assert.equal(authority.store.state, "ready");
});

test("unauthenticated mission action is rejected", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority, { authenticated: false });
  await service.initialize();
  await assert.rejects(service.complete(), (error) => error.code === "session-expired");
  assert.equal(authority.store.totalXP, 75);
});

test("server snapshot wins over stale local lifecycle state", async () => {
  const authority = createAuthorityStore({ state: "ready" });
  const service = createService(authority);
  await service.initialize();
  authority.store.state = "active";
  const result = await service.complete();
  assert.equal(result.event.previousState, "active");
  assert.equal(result.snapshot.coordinator.currentMission.lifecycle.state, "completed");
  assert.equal(result.snapshot.progression.currentXP, 100);
});

test("unsupported client-controlled expiration is rejected", async () => {
  const authority = createAuthorityStore();
  const service = createService(authority);
  await service.initialize();
  const result = await service.expire();
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unsupported-action");
  assert.equal(authority.store.actionCalls.length, 0);
});

test("database failures are mapped without exposing raw SQL detail", async () => {
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "user-a" }),
      getClient: () => ({ rpc: async () => ({
        data: null,
        error: new Error("sensitive SQL relation detail"),
      }) }),
    },
  });
  await assert.rejects(
    repository.requestMissionAction({ missionId: missionA.id, action: "complete" }),
    (error) => error.code === "mission-action-request-failed"
      && !error.message.includes("sensitive SQL"),
  );
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
