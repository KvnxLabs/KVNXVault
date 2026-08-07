"use strict";

// Durable orchestration lives outside every domain engine and outside the UI.
(function initializeApplicationService(root, factory) {
  const applicationFactory = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = applicationFactory;
  }

  if (root) root.KVNXApplicationService = applicationFactory;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULT_INITIAL_XP = 75;

  const createBrowserDailySessionId = (now = new Date(), timeZone) => {
    const resolvedTimeZone = timeZone
      || Intl.DateTimeFormat().resolvedOptions().timeZone
      || "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: resolvedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

    return `browser:${resolvedTimeZone}:${parts.year}-${parts.month}-${parts.day}`;
  };

  const createApplicationService = (dependencies = {}) => {
    const {
      authService,
      repository,
      missionEngine,
      lifecycleEngine,
      coordinatorEngine,
      progressionEngine,
    } = dependencies;

    if (!authService || !repository || !missionEngine || !lifecycleEngine
      || !coordinatorEngine || !progressionEngine) {
      throw new TypeError("Authentication, repository, mission, lifecycle, coordinator, and progression dependencies are required.");
    }

    const dailySessionId = dependencies.dailySessionId
      || createBrowserDailySessionId(dependencies.now, dependencies.timeZone);
    let profile;
    let onboarding;
    let progression;
    let coordinator;
    let persistenceBlocked = false;
    let terminalAt = null;
    let terminalRecorded = false;
    const transitionMode = dependencies.transitionMode
      || (typeof repository.requestMissionAction === "function"
        ? "authoritative"
        : "legacy-test-adapter");

    const getPublicSnapshot = () => Object.freeze({
      profile,
      onboarding,
      progression: progressionEngine.getSnapshot(progression),
      coordinator: coordinator.getSnapshot(),
      dailySessionId,
      persistenceBlocked,
    });

    const toDailyMissionState = (snapshot) => Object.freeze({
      dailySessionId,
      definition: snapshot.currentMission.definition,
      lifecycle: Object.freeze({
        state: snapshot.currentMission.lifecycle.state,
        completionAwarded: snapshot.currentMission.lifecycle.completionAwarded,
      }),
      replacementsUsed: snapshot.dailyStatus.replacementsUsed,
      terminalAt,
      terminalRecorded,
    });

    const findHistoryRecord = (snapshot, event) => {
      if (!event || !snapshot.history?.length) return null;
      return snapshot.history.find((record) => (
        record.missionId === event.missionId
        && record.terminalAt === event.timestamp
      )) || null;
    };

    const persistCoordinatorResult = async (result) => {
      if (!result.accepted || persistenceBlocked || transitionMode !== "legacy-test-adapter") return;

      const event = result.event;
      const isTerminal = ["completed", "skipped", "expired"].includes(event?.currentState);
      if (isTerminal) {
        terminalAt = event.timestamp;
        terminalRecorded = true;
      }
      if (event?.eventType === "coordinator.mission-replaced") {
        terminalAt = null;
        terminalRecorded = false;
      }

      const historyRecord = findHistoryRecord(result.snapshot, event);

      try {
        await repository.persistMissionTransition({
          dailyMission: toDailyMissionState(result.snapshot),
          totalXP: progressionEngine.getCurrentXP(progression),
          historyRecord,
        });
      } catch (error) {
        persistenceBlocked = true;
        error.code = error.code || "persistence-failed";
        throw error;
      }
    };

    const initialize = async () => {
      const [loadedProfile, loadedOnboarding, loadedProgression, loadedDailyMission, history] = await Promise.all([
        repository.loadProfile(),
        repository.loadOnboarding(),
        repository.loadProgression(),
        repository.loadDailyMissionState(dailySessionId),
        repository.loadMissionHistory(),
      ]);

      profile = loadedProfile || Object.freeze({ firstName: "" });
      onboarding = loadedOnboarding;
      if (!onboarding?.completed) {
        return Object.freeze({ requiresOnboarding: true });
      }

      progression = progressionEngine.createProgression(
        loadedProgression?.totalXP ?? DEFAULT_INITIAL_XP,
      );
      terminalAt = loadedDailyMission?.terminalAt || null;
      terminalRecorded = Boolean(loadedDailyMission?.terminalRecorded);

      const restoreState = loadedDailyMission ? {
        currentMission: {
          definition: loadedDailyMission.definition,
          lifecycleState: loadedDailyMission.lifecycle.state,
        },
        currentMissionRecorded: terminalRecorded,
        history,
        replacementsUsed: loadedDailyMission.replacementsUsed,
      } : null;

      coordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
        createLifecycle: lifecycleEngine.createMissionLifecycle,
        generateMission: missionEngine.generateMission,
        restoreState,
      });

      if ((!loadedProgression || !loadedDailyMission)
        && typeof repository.initializeVaultSession === "function") {
        await repository.initializeVaultSession({
          dailySessionId,
          definition: coordinator.getSnapshot().currentMission.definition,
        });
      } else {
        // Compatibility for the unchanged Sprint 7 test harness only. The real
        // repository no longer exposes either client-authoritative write API.
        if (!loadedProgression && typeof repository.saveProgression === "function") {
          await repository.saveProgression({ totalXP: DEFAULT_INITIAL_XP });
        }
        if (!loadedDailyMission && typeof repository.saveDailyMissionState === "function") {
          await repository.saveDailyMissionState(toDailyMissionState(coordinator.getSnapshot()));
        }
      }

      return Object.freeze({
        requiresOnboarding: false,
        snapshot: getPublicSnapshot(),
      });
    };

    const routeAction = async (action) => {
      if (persistenceBlocked) {
        return Object.freeze({ accepted: false, reason: "persistence-blocked", snapshot: getPublicSnapshot() });
      }

      if (transitionMode === "authoritative") {
        const definition = coordinator.getSnapshot().currentMission.definition;
        const authoritativeResult = await repository.requestMissionAction({
          missionId: definition.id,
          action,
        });
        return Object.freeze({
          ...authoritativeResult,
          snapshot: getPublicSnapshot(),
        });
      }

      const result = coordinator[action]();
      if (!result.accepted) {
        return Object.freeze({ ...result, snapshot: getPublicSnapshot() });
      }

      let progressionResult = null;
      if (result.event.xpAwarded > 0) {
        progressionResult = progressionEngine.addXP(progression, result.event.xpAwarded);
        progression = progressionResult.progression;
      }

      await persistCoordinatorResult(result);
      return Object.freeze({
        accepted: true,
        event: result.event,
        progressionResult,
        snapshot: getPublicSnapshot(),
      });
    };

    const requestReplacement = async () => {
      if (persistenceBlocked) {
        return Object.freeze({ accepted: false, reason: "persistence-blocked", snapshot: getPublicSnapshot() });
      }
      if (transitionMode === "authoritative") {
        return Object.freeze({
          accepted: false,
          reason: "server-authority-pending-sprint-8",
          snapshot: getPublicSnapshot(),
        });
      }
      const result = await coordinator.requestReplacement();
      if (result.accepted) await persistCoordinatorResult(result);
      return Object.freeze({ ...result, snapshot: getPublicSnapshot() });
    };

    return Object.freeze({
      complete: () => routeAction("complete"),
      expire: () => routeAction("expire"),
      getSnapshot: getPublicSnapshot,
      initialize,
      requestReplacement,
      signOut: () => authService.signOut(),
      skip: () => routeAction("skip"),
      start: () => routeAction("start"),
    });
  };

  return Object.freeze({
    DEFAULT_INITIAL_XP,
    createApplicationService,
    createBrowserDailySessionId,
  });
});
