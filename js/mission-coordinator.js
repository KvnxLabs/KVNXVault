"use strict";

// The coordinator owns the current daily mission, its lifecycle instance,
// terminal history, and the page-scoped replacement rule. It does not create
// mission content, calculate progression, or render interface elements.
(function initializeMissionCoordinator(root, factory) {
  const coordinator = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = coordinator;
  }

  if (root) root.KVNXMissionCoordinator = coordinator;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const TERMINAL_STATES = Object.freeze(["completed", "skipped", "expired"]);
  const MAX_REPLACEMENTS = 1;

  const freezeDefinition = (definition) => Object.freeze({ ...definition });
  const freezeHistory = (history) => Object.freeze(history.map((record) => Object.freeze({ ...record })));

  const createHistoryRecord = (definition, event) => Object.freeze({
    missionId: definition.id,
    title: definition.title,
    focus: definition.focus,
    finalState: event.currentState,
    xpAwarded: event.xpAwarded,
    terminalAt: event.timestamp,
  });

  const createDailyMissionCoordinator = async (onboardingAnswers = {}, dependencies = {}) => {
    const generateMission = dependencies.generateMission;
    const createLifecycle = dependencies.createLifecycle;

    if (typeof generateMission !== "function") {
      throw new TypeError("A mission generator function is required.");
    }

    if (typeof createLifecycle !== "function") {
      throw new TypeError("A mission lifecycle factory is required.");
    }

    const clock = typeof dependencies.clock === "function" ? dependencies.clock : () => new Date();
    const history = [];
    let replacementsUsed = 0;
    let currentDefinition;
    let currentLifecycle;
    let currentMissionRecorded = false;

    const buildMission = async () => {
      const definition = await generateMission(onboardingAnswers);
      if (!definition || !String(definition.id || "").trim()) {
        throw new TypeError("The mission generator must return a definition with an id.");
      }

      const nextDefinition = freezeDefinition(definition);
      const nextLifecycle = createLifecycle(nextDefinition, { clock });
      if (!nextLifecycle || typeof nextLifecycle.getSnapshot !== "function") {
        throw new TypeError("The mission lifecycle factory returned an invalid controller.");
      }

      return Object.freeze({ definition: nextDefinition, lifecycle: nextLifecycle });
    };

    const setCurrentMission = (mission) => {
      currentDefinition = mission.definition;
      currentLifecycle = mission.lifecycle;
      currentMissionRecorded = false;
    };

    const getSnapshot = () => {
      const lifecycle = currentLifecycle.getSnapshot();
      const isTerminal = TERMINAL_STATES.includes(lifecycle.state);
      const canRequestReplacement = isTerminal && replacementsUsed < MAX_REPLACEMENTS;

      return Object.freeze({
        currentMission: Object.freeze({
          definition: currentDefinition,
          lifecycle,
        }),
        history: freezeHistory(history),
        dailyStatus: Object.freeze({
          state: lifecycle.state,
          hasCurrentMission: true,
          canRequestReplacement,
          replacementsUsed,
          replacementsRemaining: MAX_REPLACEMENTS - replacementsUsed,
        }),
      });
    };

    const recordTerminalMission = (result) => {
      if (!result.accepted || !TERMINAL_STATES.includes(result.event.currentState)) return;
      if (currentMissionRecorded) return;
      history.push(createHistoryRecord(currentDefinition, result.event));
      currentMissionRecorded = true;
    };

    const routeLifecycleAction = (action) => {
      const lifecycleAction = currentLifecycle[action];
      if (typeof lifecycleAction !== "function") {
        throw new TypeError(`Unknown lifecycle action: ${action}`);
      }

      const lifecycleResult = lifecycleAction.call(currentLifecycle);
      recordTerminalMission(lifecycleResult);

      return Object.freeze({
        accepted: lifecycleResult.accepted,
        reason: lifecycleResult.reason,
        event: lifecycleResult.event,
        snapshot: getSnapshot(),
      });
    };

    const requestReplacement = async () => {
      const lifecycle = currentLifecycle.getSnapshot();

      if (!TERMINAL_STATES.includes(lifecycle.state)) {
        return Object.freeze({
          accepted: false,
          reason: "current-mission-not-terminal",
          event: null,
          snapshot: getSnapshot(),
        });
      }

      if (replacementsUsed >= MAX_REPLACEMENTS) {
        return Object.freeze({
          accepted: false,
          reason: "replacement-limit-reached",
          event: null,
          snapshot: getSnapshot(),
        });
      }

      const previousMissionId = currentDefinition.id;
      let replacementMission;
      try {
        replacementMission = await buildMission();
      } catch {
        return Object.freeze({
          accepted: false,
          reason: "replacement-generation-failed",
          event: null,
          snapshot: getSnapshot(),
        });
      }
      replacementsUsed += 1;
      setCurrentMission(replacementMission);

      return Object.freeze({
        accepted: true,
        reason: null,
        event: Object.freeze({
          eventType: "coordinator.mission-replaced",
          previousMissionId,
          missionId: currentDefinition.id,
          timestamp: (() => {
            const value = clock();
            const date = value instanceof Date ? value : new Date(value);
            return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
          })(),
          xpAwarded: 0,
        }),
        snapshot: getSnapshot(),
      });
    };

    setCurrentMission(await buildMission());

    return Object.freeze({
      getSnapshot,
      start: () => routeLifecycleAction("start"),
      complete: () => routeLifecycleAction("complete"),
      skip: () => routeLifecycleAction("skip"),
      expire: () => routeLifecycleAction("expire"),
      requestReplacement,
    });
  };

  return Object.freeze({
    MAX_REPLACEMENTS,
    TERMINAL_STATES,
    createDailyMissionCoordinator,
  });
});
