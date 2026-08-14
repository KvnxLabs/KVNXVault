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
      coachService = null,
    } = dependencies;

    const transitionMode = dependencies.transitionMode
      || (typeof repository.requestMissionAction === "function"
        ? "authoritative"
        : "legacy-test-adapter");
    if (!authService || !repository || !lifecycleEngine
      || !coordinatorEngine || !progressionEngine
      || (transitionMode !== "authoritative" && !missionEngine)) {
      throw new TypeError("Authentication, repository, lifecycle, coordinator, progression, and any required legacy mission dependencies are required.");
    }
    // Production never loads a browser mission generator. The coordinator
    // requires a function while restoring a server definition, but this guard
    // cannot generate content and would fail closed if that invariant changed.
    const generateMission = typeof missionEngine?.generateMission === "function"
      ? missionEngine.generateMission
      : async () => { throw new Error("Mission generation is server-authoritative."); };
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
    let skillCatalog = [];
    let skillPaths = [];
    let missionCustomization = Object.freeze({
      available: false,
      preferredFocusKey: null,
      preferredFocusName: null,
      effectiveFocusKey: null,
      onboardingFocusKey: null,
      onboardingFocusName: null,
      effectiveTiming: "next-uncreated-daily-choice",
      options: Object.freeze([]),
    });
    let skillPathMissionOffers = [];
    let sideMission = null;
    let sideMissionCapacity = Object.freeze({
      limit: 1,
      slotAvailable: true,
      rewardedUsed: 0,
      rewardedRemaining: 1,
    });
    let achievements = [];
    let streak = Object.freeze({ currentStreak: 0, longestStreak: 0, lastCompletedDailyKey: null });
    let analytics = null;
    const analyticsRequests = new Map();
    let coach = Object.freeze({ available: false, status: "unavailable", advice: null });
    let coachRequest = null;
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
    let dailyChoices = Object.freeze([]);

    const toPublicAchievement = (achievement) => {
      if (achievement?.hidden && !achievement?.unlocked) {
        return Object.freeze({
          key: null,
          name: "?????",
          description: "?????",
          icon: "?",
          category: null,
          hidden: true,
          displayOrder: achievement.displayOrder,
          unlockedAt: null,
          unlocked: false,
        });
      }
      return Object.freeze({ ...achievement });
    };

    const getPublicSnapshot = () => Object.freeze({
      profile,
      onboarding,
      progression: progressionEngine.getSnapshot(progression),
      skills: Object.freeze([...skillProgression]),
      skillCatalog: Object.freeze([...skillCatalog]),
      skillPaths: Object.freeze([...skillPaths]),
      missionCustomization,
      skillPathMissionOffers: Object.freeze([...skillPathMissionOffers]),
      sideMission,
      sideMissionCapacity,
      achievements: Object.freeze(achievements.map(toPublicAchievement)),
      streak,
      analytics,
      coach,
      history: Object.freeze([...vaultHistory]),
      historyPagination: Object.freeze({
        hasMore: historyHasMore,
        nextOffset: historyNextOffset,
        pageSize: historyPageSize,
      }),
      coordinator: coordinator ? coordinator.getSnapshot() : null,
      dailyChoice: Object.freeze({
        required: !coordinator && dailyChoices.length > 0,
        options: Object.freeze([...dailyChoices]),
      }),
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

    const restoreSkillPaths = (paths = []) => {
      skillPaths = Object.freeze(paths.map((path) => Object.freeze({ ...path })));
      return skillPaths;
    };

    const reconcileSkillPath = (updatedPath) => {
      if (!updatedPath?.key) return null;
      const nextPath = Object.freeze({ ...updatedPath });
      skillPaths = Object.freeze([
        nextPath,
        ...skillPaths.filter((path) => path.key !== nextPath.key),
      ]);
      return nextPath;
    };

    const restoreSkillPathMissionOffers = (states = []) => {
      skillPathMissionOffers = Object.freeze(states.map((state) => Object.freeze({
        ...state,
        offers: Object.freeze((state.offers || []).map((offer) => Object.freeze({ ...offer }))),
      })));
      return skillPathMissionOffers;
    };

    const reconcileSkillPathMissionOffers = (updatedState) => {
      if (!updatedState?.skillKey) return null;
      const nextState = Object.freeze({
        ...updatedState,
        offers: Object.freeze((updatedState.offers || []).map((offer) => Object.freeze({ ...offer }))),
      });
      skillPathMissionOffers = Object.freeze([
        nextState,
        ...skillPathMissionOffers.filter((state) => state.skillKey !== nextState.skillKey),
      ]);
      return nextState;
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

    const restoreSideMission = (result) => {
      sideMission = result?.sideMission || null;
      sideMissionCapacity = result?.capacity || sideMissionCapacity;
      return sideMission;
    };

    const reconcileSideMissionResult = (result) => {
      restoreSideMission(result);
      const previousSnapshot = progressionEngine.getSnapshot(progression);
      let progressionResult = null;
      if (result?.overallProgression) {
        progression = progressionEngine.createProgression(result.overallProgression.totalXP);
        const snapshot = progressionEngine.getSnapshot(progression);
        progressionResult = Object.freeze({
          progression,
          snapshot,
          previousSnapshot,
          didLevelUp: snapshot.currentLevel > previousSnapshot.currentLevel,
          levelsGained: snapshot.currentLevel - previousSnapshot.currentLevel,
        });
      }
      const skillProgressionResult = reconcileUpdatedSkill(result?.updatedSkill);
      const newAchievements = reconcileNewAchievements(result?.newAchievements);
      if (result?.historyRecord) appendAuthoritativeHistory(result.historyRecord);
      if (result?.reason === "completed") analytics = null;
      return Object.freeze({ progressionResult, skillProgressionResult, newAchievements });
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
      const byDisplayOrder = new Map(newAchievements.map((achievement) => [achievement.displayOrder, achievement]));
      achievements = Object.freeze(achievements.map((achievement) => {
        const earned = byKey.get(achievement.key) || (achievement.hidden
          ? byDisplayOrder.get(achievement.displayOrder)
          : null);
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
      if (result.streak) streak = result.streak;
      if (result.event?.eventType === "mission.completed") analytics = null;

      terminalAt = result.mission.lifecycle.terminalAt || null;
      terminalRecorded = Boolean(result.mission.lifecycle.terminalRecorded);
      dailyChoices = Object.freeze([]);
      coordinator = await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
        createLifecycle: lifecycleEngine.createMissionLifecycle,
        generateMission,
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
      let loadedSkillCatalog = [];
      let loadedSkillPaths = [];
      let loadedMissionCustomization = null;
      let loadedSkillPathMissionOffers = [];
      let loadedSideMission = null;
      let loadedAchievementCatalog = [];
      let loadedAchievements = [];
      let loadedStreak = null;
      let loadedCoachContext = null;

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
        const restoredMission = Boolean(dailyResult?.mission);
        const restoredChoices = dailyResult?.choiceRequired === true
          && Array.isArray(dailyResult.choices)
          && dailyResult.choices.length > 0;
        if (!dailyResult?.accepted || restoredMission === restoredChoices) {
          const error = new Error("The server could not restore today's mission state.");
          error.code = dailyResult?.reason || "daily-mission-request-rejected";
          throw error;
        }

        const [progressionResult, historyResult, skillResult, skillCatalogResult, skillPathsResult, skillPathMissionOffersResult, sideMissionResult, achievementCatalogResult, achievementResult, streakResult, missionCustomizationResult, coachContextResult] = await Promise.all([
          repository.loadProgression(),
          typeof repository.getVaultHistory === "function"
            ? repository.getVaultHistory()
            : repository.loadMissionHistory(),
          typeof repository.getSkillProgression === "function"
            ? repository.getSkillProgression()
            : Promise.resolve([]),
          typeof repository.getSkillCatalog === "function"
            ? repository.getSkillCatalog()
            : Promise.resolve([]),
          typeof repository.getSkillPaths === "function"
            ? repository.getSkillPaths()
            : Promise.resolve([]),
          typeof repository.getSkillPathMissionOffers === "function"
            ? repository.getSkillPathMissionOffers()
            : Promise.resolve([]),
          typeof repository.getSideMission === "function"
            ? repository.getSideMission()
            : Promise.resolve(null),
          typeof repository.getAchievementCatalog === "function"
            ? repository.getAchievementCatalog()
            : Promise.resolve([]),
          typeof repository.getUserAchievements === "function"
            ? repository.getUserAchievements()
            : Promise.resolve([]),
          typeof repository.getVaultStreak === "function"
            ? repository.getVaultStreak()
            : Promise.resolve(null),
          typeof repository.getMissionCustomization === "function"
            ? repository.getMissionCustomization().catch(() => null)
            : Promise.resolve(null),
          typeof repository.getVaultCoachContext === "function"
            ? repository.getVaultCoachContext("overview").catch(() => null)
            : Promise.resolve(null),
        ]);

        dailySessionId = dailyResult.dailyKey;
        nextResetAt = dailyResult.nextResetAt;
        loadedProgression = progressionResult;
        loadedHistory = historyResult;
        loadedSkills = skillResult;
        loadedSkillCatalog = skillCatalogResult;
        loadedSkillPaths = skillPathsResult;
        loadedSkillPathMissionOffers = skillPathMissionOffersResult;
        loadedSideMission = sideMissionResult;
        loadedAchievementCatalog = achievementCatalogResult;
        loadedAchievements = achievementResult;
        loadedStreak = streakResult;
        loadedMissionCustomization = missionCustomizationResult;
        loadedCoachContext = coachContextResult;
        dailyChoices = restoredChoices
          ? Object.freeze(dailyResult.choices.map((choice) => Object.freeze({ ...choice })))
          : Object.freeze([]);
        loadedDailyMission = restoredMission ? {
          dailySessionId: dailyResult.dailyKey,
          definition: dailyResult.mission.definition,
          lifecycle: dailyResult.mission.lifecycle,
          replacementsUsed: dailyResult.dailyStatus.replacementsUsed,
          terminalAt: dailyResult.mission.lifecycle.terminalAt || null,
          terminalRecorded: Boolean(dailyResult.mission.lifecycle.terminalRecorded),
        } : null;
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
          generateMission,
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
      skillCatalog = Object.freeze(
        (Array.isArray(loadedSkillCatalog) ? loadedSkillCatalog : [])
          .map((entry) => Object.freeze({ ...entry })),
      );
      restoreSkillPaths(Array.isArray(loadedSkillPaths) ? loadedSkillPaths : []);
      if (loadedMissionCustomization?.available === true) {
        missionCustomization = Object.freeze({
          ...loadedMissionCustomization,
          options: Object.freeze(
            loadedMissionCustomization.options.map((option) => Object.freeze({ ...option })),
          ),
        });
      }
      restoreSkillPathMissionOffers(
        Array.isArray(loadedSkillPathMissionOffers) ? loadedSkillPathMissionOffers : [],
      );
      if (loadedSideMission) restoreSideMission(loadedSideMission);
      restoreAchievements(
        Array.isArray(loadedAchievementCatalog) ? loadedAchievementCatalog : [],
        Array.isArray(loadedAchievements) ? loadedAchievements : [],
      );
      if (loadedStreak) streak = loadedStreak;
      if (loadedCoachContext && typeof coachService?.getAdvice === "function") {
        try {
          const advice = await coachService.getAdvice(loadedCoachContext);
          coach = Object.freeze({ available: true, status: "ready", advice });
        } catch {
          coach = Object.freeze({ available: false, status: "unavailable", advice: null });
        }
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
        history: missionHistory,
        replacementsUsed: loadedDailyMission.replacementsUsed,
      } : null;

      coordinator = restoreState || !hasAuthoritativeDailyMission
        ? await coordinatorEngine.createDailyMissionCoordinator(onboarding, {
          createLifecycle: lifecycleEngine.createMissionLifecycle,
          generateMission,
          restoreState,
        })
        : null;

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
        if (!coordinator) {
          return Object.freeze({
            accepted: false,
            reason: "daily-choice-required",
            event: null,
            snapshot: getPublicSnapshot(),
          });
        }
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
        if (!coordinator) {
          return Object.freeze({
            accepted: false,
            reason: "daily-choice-required",
            snapshot: getPublicSnapshot(),
          });
        }
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

    const selectDailyMission = async (choiceId) => {
      if (persistenceBlocked) {
        return Object.freeze({
          accepted: false,
          reason: "persistence-blocked",
          snapshot: getPublicSnapshot(),
        });
      }
      if (transitionMode !== "authoritative"
        || typeof repository.selectDailyMissionChoice !== "function") {
        return Object.freeze({
          accepted: false,
          reason: "daily-choice-unavailable",
          snapshot: getPublicSnapshot(),
        });
      }

      const result = await repository.selectDailyMissionChoice(choiceId);
      if (result?.mission) {
        await reconcileAuthoritativeResult({
          ...result,
          progression: result.progression
            || { totalXP: progressionEngine.getCurrentXP(progression) },
        });
      }
      return Object.freeze({ ...result, snapshot: getPublicSnapshot() });
    };

    const setSkillPathActive = async (skillKey, pathActive) => {
      if (persistenceBlocked) {
        return Object.freeze({
          accepted: false,
          reason: "persistence-blocked",
          snapshot: getPublicSnapshot(),
        });
      }
      const method = pathActive ? repository.activateSkillPath : repository.deactivateSkillPath;
      if (typeof method !== "function") {
        return Object.freeze({
          accepted: false,
          reason: "skill-path-unavailable",
          snapshot: getPublicSnapshot(),
        });
      }
      const path = await method.call(repository, skillKey);
      const reconciled = reconcileSkillPath(path);
      if (!pathActive) {
        skillPathMissionOffers = Object.freeze(
          skillPathMissionOffers.filter((state) => state.skillKey !== path.key),
        );
      }
      return Object.freeze({
        accepted: true,
        path: reconciled,
        snapshot: getPublicSnapshot(),
      });
    };

    const requestSkillPathMissionOffers = async (skillKey) => {
      if (persistenceBlocked || typeof repository.requestSkillPathMissionOffers !== "function") {
        return Object.freeze({
          accepted: false,
          reason: persistenceBlocked ? "persistence-blocked" : "skill-path-offers-unavailable",
          snapshot: getPublicSnapshot(),
        });
      }
      const state = await repository.requestSkillPathMissionOffers(skillKey);
      const reconciled = reconcileSkillPathMissionOffers(state);
      return Object.freeze({ ...state, offerState: reconciled, snapshot: getPublicSnapshot() });
    };

    const saveMissionCustomization = async (focusKey) => {
      if (persistenceBlocked || typeof repository.setMissionCustomization !== "function") {
        return Object.freeze({
          accepted: false,
          reason: persistenceBlocked ? "persistence-blocked" : "mission-customization-unavailable",
          snapshot: getPublicSnapshot(),
        });
      }
      const restored = await repository.setMissionCustomization(focusKey);
      missionCustomization = Object.freeze({
        ...restored,
        options: Object.freeze(restored.options.map((option) => Object.freeze({ ...option }))),
      });
      return Object.freeze({ accepted: true, customization: missionCustomization, snapshot: getPublicSnapshot() });
    };

    const selectSkillPathMissionOffer = async (offerId) => {
      if (persistenceBlocked || typeof repository.selectSkillPathMissionOffer !== "function") {
        return Object.freeze({
          accepted: false,
          reason: persistenceBlocked ? "persistence-blocked" : "skill-path-offers-unavailable",
          snapshot: getPublicSnapshot(),
        });
      }
      const result = await repository.selectSkillPathMissionOffer(offerId);
      const reconciled = result.skillKey && result.reason !== "path-inactive"
        ? reconcileSkillPathMissionOffers(result) : null;
      return Object.freeze({ ...result, offerState: reconciled, snapshot: getPublicSnapshot() });
    };

    const runSideMissionAction = async (methodName, argument) => {
      if (persistenceBlocked || typeof repository[methodName] !== "function") {
        return Object.freeze({
          accepted: false,
          reason: persistenceBlocked ? "persistence-blocked" : "side-mission-unavailable",
          snapshot: getPublicSnapshot(),
        });
      }
      const result = argument === undefined
        ? await repository[methodName]()
        : await repository[methodName](argument);
      const reconciliation = reconcileSideMissionResult(result);
      return Object.freeze({ ...result, ...reconciliation, snapshot: getPublicSnapshot() });
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

    const loadCoach = async (mode = "overview") => {
      if (typeof repository.getVaultCoachContext !== "function"
        || typeof coachService?.getAdvice !== "function") {
        coach = Object.freeze({ available: false, status: "unavailable", advice: null });
        return getPublicSnapshot();
      }
      if (coachRequest) return coachRequest;
      coachRequest = (async () => {
        try {
          const context = await repository.getVaultCoachContext(mode);
          const advice = await coachService.getAdvice(context);
          coach = Object.freeze({ available: true, status: "ready", advice });
        } catch {
          coach = Object.freeze({ available: false, status: "unavailable", advice: null });
        }
        return getPublicSnapshot();
      })();
      try {
        return await coachRequest;
      } finally {
        coachRequest = null;
      }
    };

    return Object.freeze({
      activateSkillPath: (skillKey) => setSkillPathActive(skillKey, true),
      complete: () => routeAction("complete"),
      deactivateSkillPath: (skillKey) => setSkillPathActive(skillKey, false),
      expire: () => routeAction("expire"),
      getSnapshot: getPublicSnapshot,
      initialize,
      loadAnalytics,
      loadCoach,
      loadMoreVaultHistory,
      promoteSideMission: (offerId) => runSideMissionAction("promoteSideMission", offerId),
      requestReplacement,
      requestSkillPathMissionOffers,
      saveMissionCustomization,
      selectDailyMission,
      selectSkillPathMissionOffer,
      signOut: () => authService.signOut(),
      skip: () => routeAction("skip"),
      startSideMission: () => runSideMissionAction("startSideMission"),
      start: () => routeAction("start"),
      completeSideMission: () => runSideMissionAction("completeSideMission"),
    });
  };

  return Object.freeze({
    DEFAULT_INITIAL_XP,
    createApplicationService,
    createBrowserDailySessionId,
  });
});
