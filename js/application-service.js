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

    const transitionMode = dependencies.transitionMode
      || (typeof repository.requestMissionAction === "function"
        ? "authoritative"
        : "legacy-test-adapter");
    const hasAuthoritativeDailyMission = transitionMode === "authoritative"
      && typeof repository.requestDailyMission === "function";
    let dailySessionId = hasAuthoritativeDailyMission
      ? null
      : dependencies.dailySessionId
        || createBrowserDailySessionId(dependencies.now, dependencies.timeZone);
    let profile;
    let onboarding;
    let progression;
    let skillProgression = [];
    let achievements = [];
    let analytics = null;
    const analyticsRequests = new Map();
    let coordinator;
    let missionHistory = [];
    let vaultHistory = [];
    let historyHasMore = false;
    let historyNextOffset = 0;
    let historyPageSize = 20;
    let persistenceBlocked = false;
    let terminalAt = null;
    let terminalRecorded = false;
    let nextResetAt = null;

    const getPublicSnapshot = () => Object.freeze({
      profile,
      onboarding,
      progression: progressionEngine.getSnapshot(progression),
      skills: Object.freeze([...skillProgression]),
      achievements: Object.freeze([...achievements]),
      analytics,
      history: Object.freeze([...vaultHistory]),
      historyPagination: Object.freeze({
        hasMore: historyHasMore,
        nextOffset: historyNextOffset,
        pageSize: historyPageSize,
      }),
      coordinator: coordinator.getSnapshot(),
      dailySessionId,
      nextResetAt,
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

    const freezeHistoryEntry = (historyRecord) => Object.freeze({
      ...historyRecord,
      achievements: Object.freeze(
        (Array.isArray(historyRecord?.achievements) ? historyRecord.achievements : [])
          .map((achievement) => Object.freeze({ ...achievement })),
      ),
    });

    const appendAuthoritativeHistory = (historyRecord) => {
      if (!historyRecord?.missionId) return;
      const duplicateMissionHistory = missionHistory.some((record) => (
        record.missionId === historyRecord.missionId
        && (record.terminalAt || record.completedAt) === (historyRecord.terminalAt || historyRecord.completedAt)
      ));
      const frozen = freezeHistoryEntry(historyRecord);
      if (!duplicateMissionHistory) missionHistory = [frozen, ...missionHistory];

      const status = historyRecord.status || historyRecord.finalState;
      const duplicateVaultHistory = vaultHistory.some((record) => (
        record.missionId === historyRecord.missionId
        && (record.terminalAt || record.completedAt) === (historyRecord.terminalAt || historyRecord.completedAt)
      ));
      if (status === "completed" && !duplicateVaultHistory) {
        vaultHistory = [frozen, ...vaultHistory];
        historyNextOffset += 1;
      }
    };

    const createSkillSnapshot = (skill) => {
      const derived = progressionEngine.getSnapshot(
        progressionEngine.createProgression(skill.totalXP, "skill"),
      );
      return Object.freeze({
        key: skill.key,
        name: skill.name,
        totalXP: skill.totalXP,
        todayGain: skill.todayGain || 0,
        level: derived.currentLevel,
        nextLevel: derived.nextLevel,
        xpForNextLevel: derived.xpForNextLevel,
        xpRemaining: derived.xpRemaining,
        progressPercentage: derived.progressPercentage,
        isMaxLevel: derived.isMaxLevel,
      });
    };

    const restoreSkillProgression = (skills = []) => {
      skillProgression = Object.freeze(
        skills.map(createSkillSnapshot),
      );
      return skillProgression;
    };

    const reconcileUpdatedSkill = (updatedSkill) => {
      if (!updatedSkill?.key) return null;
      const previousSkill = skillProgression.find((skill) => skill.key === updatedSkill.key) || null;
      const nextSkill = createSkillSnapshot(updatedSkill);
      skillProgression = Object.freeze([
        nextSkill,
        ...skillProgression.filter((skill) => skill.key !== updatedSkill.key),
      ].sort((left, right) => right.totalXP - left.totalXP || left.name.localeCompare(right.name)));
      return Object.freeze({
        snapshot: nextSkill,
        previousSnapshot: previousSkill,
        didLevelUp: Boolean(previousSkill && nextSkill.level > previousSkill.level),
      });
    };

    const restoreAchievements = (catalog = [], unlocked = []) => {
      const unlockedByKey = new Map(unlocked.map((achievement) => [achievement.key, achievement]));
      achievements = Object.freeze(catalog.map((definition) => {
        const earned = unlockedByKey.get(definition.key);
        return Object.freeze({
          ...definition,
          unlocked: Boolean(earned),
          unlockedAt: earned?.unlockedAt || null,
        });
      }).sort((left, right) => left.displayOrder - right.displayOrder));
      return achievements;
    };

    const reconcileNewAchievements = (newAchievements = []) => {
      if (!Array.isArray(newAchievements) || newAchievements.length === 0) return Object.freeze([]);
      const byKey = new Map(newAchievements.map((achievement) => [achievement.key, achievement]));
      achievements = Object.freeze(achievements.map((achievement) => {
        const earned = byKey.get(achievement.key);
        return earned ? Object.freeze({ ...achievement, ...earned, unlocked: true }) : achievement;
      }));
      return Object.freeze(newAchievements.map((achievement) => Object.freeze({ ...achievement })));
    };

    const reconcileAuthoritativeResult = async (result) => {
      if (!result?.mission?.definition || !result?.mission?.lifecycle
        || !result?.progression || !result?.dailyStatus) {
        return null;
      }

      const previousSnapshot = progressionEngine.getSnapshot(progression);
      if (typeof result.nextResetAt === "string") nextResetAt = result.nextResetAt;
      progression = progressionEngine.createProgression(result.progression.totalXP);
      const snapshot = progressionEngine.getSnapshot(progression);
      appendAuthoritativeHistory(result.historyRecord ? {
        ...result.historyRecord,
        historyId: result.historyRecord.historyId || null,
        category: result.historyRecord.category || result.historyRecord.focus,
        primarySkillKey: result.historyRecord.primarySkillKey || result.historyRecord.skillKey,
        primarySkill: result.updatedSkill?.name || null,
        overallXPEarned: Number(result.historyRecord.overallXPEarned ?? result.historyRecord.xpAwarded ?? 0),
        skillXPEarned: Number(result.historyRecord.skillXPEarned ?? result.historyRecord.skillXPAwarded ?? 0),
        status: result.historyRecord.status || result.historyRecord.finalState,
        completedAt: result.historyRecord.completedAt || result.historyRecord.terminalAt,
        description: result.mission.definition.description || null,
        originalMissionState: result.event?.previousState || null,
        achievements: Array.isArray(result.newAchievements) ? result.newAchievements : [],
      } : null);
      const skillProgressionResult = reconcileUpdatedSkill(result.updatedSkill);
      const newAchievements = reconcileNewAchievements(result.newAchievements);
      if (result.event?.eventType === "mission.completed") analytics = null;

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
        skillProgressionResult,
        newAchievements,
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
      let loadedProfile;
      let loadedOnboarding;
      let loadedProgression;
      let loadedDailyMission;
      let loadedHistory;
      let loadedSkills = [];
      let loadedAchievementCatalog = [];
      let loadedAchievements = [];

      if (hasAuthoritativeDailyMission) {
        [loadedProfile, loadedOnboarding] = await Promise.all([
          repository.loadProfile(),
          repository.loadOnboarding(),
        ]);

        profile = loadedProfile || Object.freeze({ firstName: "" });
        onboarding = loadedOnboarding;
        if (!onboarding?.completed) {
          return Object.freeze({ requiresOnboarding: true });
        }

        const dailyResult = await repository.requestDailyMission();
        if (!dailyResult?.accepted || !dailyResult?.mission) {
          const error = new Error("The server could not provide today's mission.");
          error.code = dailyResult?.reason || "daily-mission-request-rejected";
          throw error;
        }

        const [progressionResult, historyResult, skillResult, achievementCatalogResult, achievementResult] = await Promise.all([
          repository.loadProgression(),
          typeof repository.getVaultHistory === "function"
            ? repository.getVaultHistory()
            : repository.loadMissionHistory(),
          typeof repository.getSkillProgression === "function"
            ? repository.getSkillProgression()
            : Promise.resolve([]),
          typeof repository.getAchievementCatalog === "function"
            ? repository.getAchievementCatalog()
            : Promise.resolve([]),
          typeof repository.getUserAchievements === "function"
            ? repository.getUserAchievements()
            : Promise.resolve([]),
        ]);

        dailySessionId = dailyResult.dailyKey;
        nextResetAt = dailyResult.nextResetAt;
        loadedProgression = progressionResult;
        loadedHistory = historyResult;
        loadedSkills = skillResult;
        loadedAchievementCatalog = achievementCatalogResult;
        loadedAchievements = achievementResult;
        loadedDailyMission = {
          dailySessionId: dailyResult.dailyKey,
          definition: dailyResult.mission.definition,
          lifecycle: dailyResult.mission.lifecycle,
          replacementsUsed: dailyResult.dailyStatus.replacementsUsed,
          terminalAt: dailyResult.mission.lifecycle.terminalAt || null,
          terminalRecorded: Boolean(dailyResult.mission.lifecycle.terminalRecorded),
        };
      } else {
        [loadedProfile, loadedOnboarding, loadedProgression, loadedDailyMission, loadedHistory] = await Promise.all([
          repository.loadProfile(),
          repository.loadOnboarding(),
          repository.loadProgression(),
          repository.loadDailyMissionState(dailySessionId),
          repository.loadMissionHistory(),
        ]);
      }

      profile = loadedProfile || Object.freeze({ firstName: "" });
      onboarding = loadedOnboarding;
      if (!onboarding?.completed) {
        return Object.freeze({ requiresOnboarding: true });
      }

      if (!hasAuthoritativeDailyMission
        && (!loadedProgression || !loadedDailyMission)
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

      if (loadedHistory && Array.isArray(loadedHistory.entries)) {
        vaultHistory = loadedHistory.entries.map(freezeHistoryEntry);
        missionHistory = [...vaultHistory];
        historyHasMore = Boolean(loadedHistory.hasMore);
        historyNextOffset = Number(loadedHistory.nextOffset) || vaultHistory.length;
        historyPageSize = Number(loadedHistory.pageSize) || 20;
      } else {
        missionHistory = Array.isArray(loadedHistory)
          ? loadedHistory.map(freezeHistoryEntry)
          : [];
        vaultHistory = missionHistory.filter((entry) => (
          (entry.status || entry.finalState) === "completed"
        ));
        historyHasMore = false;
        historyNextOffset = vaultHistory.length;
      }
      restoreSkillProgression(Array.isArray(loadedSkills) ? loadedSkills : []);
      restoreAchievements(
        Array.isArray(loadedAchievementCatalog) ? loadedAchievementCatalog : [],
        Array.isArray(loadedAchievements) ? loadedAchievements : [],
      );
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

      if (!hasAuthoritativeDailyMission && (!loadedProgression || !loadedDailyMission)) {
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
          skillProgressionResult: progressionResult?.skillProgressionResult || null,
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
        if (typeof repository.requestDailyMissionReplacement === "function") {
          const persisted = await repository.requestDailyMissionReplacement();
          if (persisted?.mission) {
            await reconcileAuthoritativeResult({
              ...persisted,
              progression: persisted.progression
                || { totalXP: progressionEngine.getCurrentXP(progression) },
            });
          }
          return Object.freeze({ ...persisted, snapshot: getPublicSnapshot() });
        }

        // Sprint 8 compatibility only. The production repository exposes the
        // zero-argument server replacement RPC above, so browser generation is
        // never reached by the deployed Sprint 9 path.
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

    const loadMoreVaultHistory = async () => {
      if (!historyHasMore || typeof repository.getVaultHistory !== "function") {
        return getPublicSnapshot();
      }
      const page = await repository.getVaultHistory({
        offset: historyNextOffset,
        pageSize: historyPageSize,
      });
      const known = new Set(vaultHistory.map((entry) => (
        entry.historyId || `${entry.missionId}:${entry.completedAt || entry.terminalAt}`
      )));
      const additions = page.entries.filter((entry) => {
        const key = entry.historyId || `${entry.missionId}:${entry.completedAt || entry.terminalAt}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      }).map(freezeHistoryEntry);
      vaultHistory = Object.freeze([...vaultHistory, ...additions]);
      missionHistory = Object.freeze([...missionHistory, ...additions]);
      historyHasMore = Boolean(page.hasMore);
      historyNextOffset = Number(page.nextOffset) || historyNextOffset + additions.length;
      historyPageSize = Number(page.pageSize) || historyPageSize;
      return getPublicSnapshot();
    };

    const loadAnalytics = async (period = "7d") => {
      if (typeof repository.getVaultAnalytics !== "function") {
        const error = new Error("Analytics are not available.");
        error.code = "vault-analytics-unavailable";
        throw error;
      }
      const normalizedPeriod = String(period || "").trim().toLowerCase();
      if (analyticsRequests.has(normalizedPeriod)) {
        return analyticsRequests.get(normalizedPeriod);
      }

      const request = (async () => {
        const restored = await repository.getVaultAnalytics(normalizedPeriod);
        analytics = restored;
        return getPublicSnapshot();
      })();
      analyticsRequests.set(normalizedPeriod, request);
      try {
        return await request;
      } finally {
        analyticsRequests.delete(normalizedPeriod);
      }
    };

    return Object.freeze({
      complete: () => routeAction("complete"),
      expire: () => routeAction("expire"),
      getSnapshot: getPublicSnapshot,
      initialize,
      loadAnalytics,
      loadMoreVaultHistory,
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
