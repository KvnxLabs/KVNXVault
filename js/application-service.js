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
    let missionHistory = [];
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

    const appendAuthoritativeHistory = (historyRecord) => {
      if (!historyRecord?.missionId) return;
      const duplicate = missionHistory.some((record) => (
        record.missionId === historyRecord.missionId
        && record.terminalAt === historyRecord.terminalAt
      ));
      if (!duplicate) missionHistory = [...missionHistory, Object.freeze({ ...historyRecord })];
    };

    const reconcileAuthoritativeResult = async (result) => {
      if (!result?.mission?.definition || !result?.mission?.lifecycle
        || !result?.progression || !result?.dailyStatus) {
        return null;
      }

      const previousSnapshot = progressionEngine.getSnapshot(progression);
      progression = progressionEngine.createProgression(result.progression.totalXP);
      const snapshot = progressionEngine.getSnapshot(progression);
      appendAuthoritativeHistory(result.historyRecord);

      terminalAt = result.mission.lifecycle.terminalAt || null;
      terminalRecorded = Boolean(result.mission.lifecycle.terminalRecorded);
      coordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
        createLifecycle: lifecycleEngine.createMissionLifecycle,
        generateMission: missionEngine.generateMission,
        restoreState: {
          currentMission: {
            definition: result.mission.definition,
            lifecycleState: result.mission.lifecycle.state,
          },
          currentMissionRecorded: terminalRecorded,
          history: missionHistory,
          replacementsUsed: result.dailyStatus.replacementsUsed,
        },
      });

      return Object.freeze({
        progression,
        snapshot,
        previousSnapshot,
        didLevelUp: snapshot.currentLevel > previousSnapshot.currentLevel,
        levelsGained: snapshot.currentLevel - previousSnapshot.currentLevel,
      });
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

    const persistPrototypeProgression = async (result, progressionResult) => {
      const event = result?.event;
      if (transitionMode !== "prototype"
        || persistenceBlocked
        || !result?.accepted
        || event?.eventType !== "mission.completed"
        || event?.currentState !== "completed"
        || event?.xpAwarded <= 0
        || !progressionResult?.snapshot
        || typeof repository.persistValidatedPrototypeProgression !== "function") {
        return;
      }

      try {
        const persisted = await repository.persistValidatedPrototypeProgression({
          missionId: event.missionId,
          lifecycleEvent: event,
          progressionSnapshot: progressionResult.snapshot,
        });
        if (Number(persisted?.totalXP) !== progressionResult.snapshot.currentXP) {
          const error = new Error("The saved progression did not match the validated snapshot.");
          error.code = "prototype-progression-mismatch";
          throw error;
        }
      } catch (error) {
        persistenceBlocked = true;
        error.code = error.code || "persistence-failed";
        throw error;
      }
    };

    const persistPrototypeReplacement = async (result) => {
      const event = result?.event;
      const snapshot = result?.snapshot;
      const definition = snapshot?.currentMission?.definition;
      const lifecycle = snapshot?.currentMission?.lifecycle;
      const replacementsUsed = snapshot?.dailyStatus?.replacementsUsed;

      if (!["prototype", "authoritative"].includes(transitionMode)
        || persistenceBlocked
        || !result?.accepted
        || event?.eventType !== "coordinator.mission-replaced"
        || event?.xpAwarded !== 0
        || !String(event?.previousMissionId || "").trim()
        || definition?.id !== event?.missionId
        || lifecycle?.state !== "ready"
        || lifecycle?.completionAwarded !== false
        || !Number.isInteger(replacementsUsed)
        || replacementsUsed !== 1
        || typeof repository.persistValidatedPrototypeReplacement !== "function") {
        return;
      }

      try {
        const persisted = await repository.persistValidatedPrototypeReplacement({
          replacementEvent: event,
          coordinatorSnapshot: snapshot,
        });
        if (persisted?.accepted === false && transitionMode === "authoritative") {
          if (persisted.mission) await reconcileAuthoritativeResult(persisted);
          return persisted;
        }
        if (persisted?.accepted !== true
          || persisted?.missionId !== definition.id
          || Number(persisted?.replacementsUsed) !== replacementsUsed) {
          const error = new Error("The saved replacement mission did not match the validated coordinator snapshot.");
          error.code = "prototype-replacement-mismatch";
          throw error;
        }
        if (transitionMode === "authoritative" && persisted.mission) {
          await reconcileAuthoritativeResult(persisted);
        }
        terminalAt = null;
        terminalRecorded = false;
        return persisted;
      } catch (error) {
        persistenceBlocked = true;
        error.code = error.code || "persistence-failed";
        throw error;
      }
    };

    const initialize = async () => {
      let [loadedProfile, loadedOnboarding, loadedProgression, loadedDailyMission, loadedHistory] = await Promise.all([
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

      if ((!loadedProgression || !loadedDailyMission)
        && typeof repository.initializeVaultSession === "function") {
        const seedCoordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
          createLifecycle: lifecycleEngine.createMissionLifecycle,
          generateMission: missionEngine.generateMission,
        });
        await repository.initializeVaultSession({
          dailySessionId,
          definition: seedCoordinator.getSnapshot().currentMission.definition,
        });
        [loadedProgression, loadedDailyMission, loadedHistory] = await Promise.all([
          repository.loadProgression(),
          repository.loadDailyMissionState(dailySessionId),
          repository.loadMissionHistory(),
        ]);
      }

      missionHistory = Array.isArray(loadedHistory) ? [...loadedHistory] : [];
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
        history: missionHistory,
        replacementsUsed: loadedDailyMission.replacementsUsed,
      } : null;

      coordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
        createLifecycle: lifecycleEngine.createMissionLifecycle,
        generateMission: missionEngine.generateMission,
        restoreState,
      });

      if (!loadedProgression || !loadedDailyMission) {
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
        if (action === "expire") {
          return Object.freeze({
            accepted: false,
            reason: "unsupported-action",
            event: null,
            snapshot: getPublicSnapshot(),
          });
        }
        const definition = coordinator.getSnapshot().currentMission.definition;
        const authoritativeResult = await repository.requestMissionAction({
          missionId: definition.id,
          action,
        });
        const progressionResult = await reconcileAuthoritativeResult(authoritativeResult);
        return Object.freeze({
          ...authoritativeResult,
          progressionResult,
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

      await persistPrototypeProgression(result, progressionResult);
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
        const result = await coordinator.requestReplacement();
        if (result.accepted) {
          const persisted = await persistPrototypeReplacement(result);
          if (persisted?.accepted === false) {
            return Object.freeze({ ...persisted, snapshot: getPublicSnapshot() });
          }
        }
        return Object.freeze({ ...result, snapshot: getPublicSnapshot() });
      }
      const result = await coordinator.requestReplacement();
      if (result.accepted) {
        await persistPrototypeReplacement(result);
        await persistCoordinatorResult(result);
      }
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
