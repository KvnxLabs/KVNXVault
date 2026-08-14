"use strict";

// All Supabase table and RPC knowledge lives here. Consumers work with KVNX
// domain objects rather than rows or query builders.
(function initializeUserRepository(root, factory) {
  const repositoryFactory = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = repositoryFactory;
  }

  if (root) root.KVNXUserRepository = repositoryFactory;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const createRepositoryError = (code, cause) => {
    const error = new Error("KVNX Vault could not access your saved data.");
    error.code = code;
    error.cause = cause;
    return error;
  };

  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  const ANALYTICS_PERIODS = Object.freeze(["7d", "30d", "all"]);
  const COACH_MODES = Object.freeze(["overview", "next_step", "skill_focus", "consistency"]);
  const SKILL_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
  const MISSION_FOCUS_KEYS = Object.freeze([
    "career", "business", "programming", "fitness", "health", "learning",
    "creativity", "finance", "relationships", "mindset", "general",
  ]);

  const mapMissionCustomization = (result) => {
    const responseKeys = new Set([
      "accepted", "preferredFocusKey", "preferredFocusName", "effectiveFocusKey",
      "onboardingFocusKey", "onboardingFocusName", "effectiveTiming", "options",
    ]);
    const optionKeys = new Set(["key", "name"]);
    if (!result || typeof result !== "object" || result.accepted !== true
      || Object.keys(result).some((key) => !responseKeys.has(key))) {
      throw createRepositoryError("mission-customization-response-invalid");
    }
    const preferredFocusKey = result.preferredFocusKey == null
      ? null : String(result.preferredFocusKey);
    const preferredFocusName = result.preferredFocusName == null
      ? null : String(result.preferredFocusName);
    const effectiveFocusKey = String(result.effectiveFocusKey || "");
    const onboardingFocusKey = String(result.onboardingFocusKey || "");
    const onboardingFocusName = String(result.onboardingFocusName || "");
    const effectiveTiming = String(result.effectiveTiming || "");
    const rawOptions = Array.isArray(result.options) ? result.options : [];
    const options = rawOptions.map((option) => ({
      key: String(option?.key || ""),
      name: String(option?.name || ""),
    }));
    if ((preferredFocusKey !== null && !MISSION_FOCUS_KEYS.includes(preferredFocusKey))
      || (preferredFocusKey === null) !== (preferredFocusName === null)
      || !MISSION_FOCUS_KEYS.includes(effectiveFocusKey)
      || !MISSION_FOCUS_KEYS.includes(onboardingFocusKey)
      || !onboardingFocusName
      || effectiveTiming !== "next-uncreated-daily-choice"
      || options.length < 1 || options.length > MISSION_FOCUS_KEYS.length
      || rawOptions.some((option) => !option || typeof option !== "object"
        || Object.keys(option).some((key) => !optionKeys.has(key)))
      || options.some((option) => !MISSION_FOCUS_KEYS.includes(option.key) || !option.name)
      || new Set(options.map((option) => option.key)).size !== options.length
      || !options.some((option) => option.key === effectiveFocusKey)) {
      throw createRepositoryError("mission-customization-response-invalid");
    }
    return deepFreeze({
      available: true,
      preferredFocusKey,
      preferredFocusName,
      effectiveFocusKey,
      onboardingFocusKey,
      onboardingFocusName,
      effectiveTiming,
      options,
    });
  };

  const mapCoachContext = (result, requestedMode) => {
    const topKeys = new Set([
      "accepted", "contextVersion", "mode", "generatedAt", "progression", "skills",
      "dailyMission", "customization", "sideMission", "skillPaths", "recent", "streak",
      "achievements",
    ]);
    const hasExactKeys = (value, keys) => value && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length === keys.size
      && Object.keys(value).every((key) => keys.has(key));
    const nonnegativeInteger = (value) => Number.isInteger(value) && value >= 0;
    const skillKeys = new Set(["key", "name", "totalXP"]);
    const pathKeys = new Set(["key", "name"]);
    const distributionKeys = new Set(["key", "name", "skillXP"]);
    const progressionKeys = new Set(["totalXP"]);
    const skillsKeys = new Set(["activeCount", "totalSkillXP", "top"]);
    const dailyKeys = new Set([
      "availability", "lifecycleState", "title", "focusKey", "focusName", "primarySkillName",
    ]);
    const customizationKeys = new Set([
      "effectiveFocusKey", "effectiveFocusName", "onboardingFocusKey", "onboardingFocusName",
    ]);
    const sideKeys = new Set(["lifecycleState", "title", "skillName"]);
    const pathsKeys = new Set(["activeCount", "active"]);
    const recentKeys = new Set([
      "completedCount", "dailyCompleted", "sideCompleted", "skillDistribution",
    ]);
    const streakKeys = new Set(["current", "longest"]);
    const achievementKeys = new Set(["unlockedCount", "totalCount"]);

    if (!hasExactKeys(result, topKeys) || result.accepted !== true
      || result.contextVersion !== 1 || result.mode !== requestedMode
      || !Number.isFinite(Date.parse(result.generatedAt))
      || !hasExactKeys(result.progression, progressionKeys)
      || !hasExactKeys(result.skills, skillsKeys)
      || !hasExactKeys(result.dailyMission, dailyKeys)
      || !hasExactKeys(result.customization, customizationKeys)
      || (result.sideMission !== null && !hasExactKeys(result.sideMission, sideKeys))
      || !hasExactKeys(result.skillPaths, pathsKeys)
      || !hasExactKeys(result.recent, recentKeys)
      || !hasExactKeys(result.streak, streakKeys)
      || !hasExactKeys(result.achievements, achievementKeys)) {
      throw createRepositoryError("coach-context-response-invalid");
    }

    const top = Array.isArray(result.skills.top) ? result.skills.top : null;
    const activePaths = Array.isArray(result.skillPaths.active) ? result.skillPaths.active : null;
    const skillDistribution = Array.isArray(result.recent.skillDistribution)
      ? result.recent.skillDistribution : null;
    const daily = result.dailyMission;
    const side = result.sideMission;
    const focusKeys = [
      result.customization.effectiveFocusKey,
      result.customization.onboardingFocusKey,
      daily.focusKey,
    ];

    if (!nonnegativeInteger(result.progression.totalXP)
      || !nonnegativeInteger(result.skills.activeCount)
      || !nonnegativeInteger(result.skills.totalSkillXP)
      || !top || top.length > 5
      || top.some((skill) => !hasExactKeys(skill, skillKeys)
        || !SKILL_KEY_PATTERN.test(skill.key) || !String(skill.name || "").trim()
        || !nonnegativeInteger(skill.totalXP) || skill.totalXP <= 0)
      || !["mission", "choice_required", "unavailable"].includes(daily.availability)
      || focusKeys.some((key) => !MISSION_FOCUS_KEYS.includes(key))
      || !String(daily.focusName || "").trim()
      || !String(result.customization.effectiveFocusName || "").trim()
      || !String(result.customization.onboardingFocusName || "").trim()
      || (daily.availability === "mission" && (
        !["ready", "active", "completed", "skipped", "expired"].includes(daily.lifecycleState)
        || !String(daily.title || "").trim() || !String(daily.primarySkillName || "").trim()
      ))
      || (daily.availability !== "mission" && (
        daily.lifecycleState !== null || daily.title !== null || daily.primarySkillName !== null
      ))
      || (side && (!["ready", "active", "completed", "expired"].includes(side.lifecycleState)
        || !String(side.title || "").trim() || !String(side.skillName || "").trim()))
      || !nonnegativeInteger(result.skillPaths.activeCount)
      || !activePaths || activePaths.length > 12
      || activePaths.some((path) => !hasExactKeys(path, pathKeys)
        || !SKILL_KEY_PATTERN.test(path.key) || !String(path.name || "").trim())
      || !nonnegativeInteger(result.recent.completedCount)
      || !nonnegativeInteger(result.recent.dailyCompleted)
      || !nonnegativeInteger(result.recent.sideCompleted)
      || result.recent.completedCount !== result.recent.dailyCompleted + result.recent.sideCompleted
      || result.recent.completedCount > 20
      || !skillDistribution || skillDistribution.length > 5
      || skillDistribution.some((skill) => !hasExactKeys(skill, distributionKeys)
        || !SKILL_KEY_PATTERN.test(skill.key) || !String(skill.name || "").trim()
        || !nonnegativeInteger(skill.skillXP) || skill.skillXP <= 0)
      || !nonnegativeInteger(result.streak.current)
      || !nonnegativeInteger(result.streak.longest)
      || result.streak.longest < result.streak.current
      || !nonnegativeInteger(result.achievements.unlockedCount)
      || !nonnegativeInteger(result.achievements.totalCount)
      || result.achievements.unlockedCount > result.achievements.totalCount) {
      throw createRepositoryError("coach-context-response-invalid");
    }

    return deepFreeze({
      ...result,
      generatedAt: new Date(Date.parse(result.generatedAt)).toISOString(),
      skills: { ...result.skills, top: top.map((skill) => ({ ...skill })) },
      skillPaths: { ...result.skillPaths, active: activePaths.map((path) => ({ ...path })) },
      recent: {
        ...result.recent,
        skillDistribution: skillDistribution.map((skill) => ({ ...skill })),
      },
      dailyMission: { ...daily },
      customization: { ...result.customization },
      sideMission: side ? { ...side } : null,
      progression: { ...result.progression },
      streak: { ...result.streak },
      achievements: { ...result.achievements },
    });
  };

  const isISOCalendarDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp)
      && new Date(timestamp).toISOString().slice(0, 10) === value;
  };

  const isUUID = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));

  const mapSkillPath = (result) => {
    if (!result || typeof result !== "object") {
      throw createRepositoryError("skill-path-response-invalid");
    }
    const key = String(result.key || "");
    const name = String(result.name || "");
    const pathActive = result.pathActive;
    const catalogActive = result.catalogActive;
    const normalizeTimestamp = (value) => {
      if (value === null || value === undefined) return null;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    };
    const activatedAt = normalizeTimestamp(result.activatedAt);
    const deactivatedAt = normalizeTimestamp(result.deactivatedAt);
    const updatedAt = normalizeTimestamp(result.updatedAt);

    if (!SKILL_KEY_PATTERN.test(key) || !name
      || typeof pathActive !== "boolean" || typeof catalogActive !== "boolean"
      || !updatedAt
      || (result.activatedAt != null && !activatedAt)
      || (result.deactivatedAt != null && !deactivatedAt)
      || (pathActive && (!activatedAt || deactivatedAt))
      || (!pathActive && !deactivatedAt)) {
      throw createRepositoryError("skill-path-response-invalid");
    }
    return Object.freeze({
      key,
      name,
      pathActive,
      catalogActive,
      activatedAt,
      deactivatedAt,
      updatedAt,
    });
  };

  const mapSkillPathMissionOffers = (result) => {
    const responseKeys = new Set([
      "accepted", "reason", "dailyKey", "skillKey", "skillName", "status",
      "offers", "selectedOfferId", "selectedAt",
    ]);
    const offerKeys = new Set([
      "offerId", "title", "description", "estimatedDuration", "skillKey", "skillName",
    ]);
    if (!result || typeof result !== "object" || typeof result.accepted !== "boolean") {
      throw createRepositoryError("skill-path-offers-response-invalid");
    }
    if (Object.keys(result).some((key) => !responseKeys.has(key))) {
      throw createRepositoryError("skill-path-offers-response-invalid");
    }
    if (result.accepted === false && result.reason === "offer-not-found-or-stale"
      && result.dailyKey === undefined && result.offers === undefined) {
      return deepFreeze({ accepted: false, reason: "offer-not-found-or-stale" });
    }
    const dailyKey = String(result.dailyKey || "");
    const skillKey = String(result.skillKey || "");
    const skillName = String(result.skillName || "");
    const status = String(result.status || "");
    const reason = String(result.reason || "");
    const rawOffers = Array.isArray(result.offers) ? result.offers : null;
    const offers = rawOffers ? rawOffers.map((offer) => ({
      offerId: String(offer?.offerId || "").toLowerCase(),
      title: String(offer?.title || ""),
      description: String(offer?.description || ""),
      estimatedDuration: String(offer?.estimatedDuration || ""),
      skillKey: String(offer?.skillKey || ""),
      skillName: String(offer?.skillName || ""),
    })) : null;
    const selectedOfferId = result.selectedOfferId == null
      ? null : String(result.selectedOfferId).toLowerCase();
    const selectedAt = result.selectedAt == null
      ? null : Number.isFinite(Date.parse(result.selectedAt))
        ? new Date(Date.parse(result.selectedAt)).toISOString() : null;

    if (!reason || !isISOCalendarDate(dailyKey) || !SKILL_KEY_PATTERN.test(skillKey)
      || !skillName || !["offered", "planned"].includes(status)
      || !offers || offers.length > 3
      || rawOffers.some((offer) => !offer || typeof offer !== "object"
        || Object.keys(offer).some((key) => !offerKeys.has(key)))
      || offers.some((offer) => !isUUID(offer.offerId) || !offer.title
        || !offer.description || !offer.estimatedDuration
        || offer.skillKey !== skillKey || offer.skillName !== skillName)
      || new Set(offers.map((offer) => offer.offerId)).size !== offers.length
      || (status === "offered" && (selectedOfferId !== null || selectedAt !== null))
      || (status === "planned" && (!isUUID(selectedOfferId) || !selectedAt
        || !offers.some((offer) => offer.offerId === selectedOfferId)))) {
      throw createRepositoryError("skill-path-offers-response-invalid");
    }
    return deepFreeze({
      accepted: result.accepted,
      reason,
      dailyKey,
      skillKey,
      skillName,
      status,
      offers,
      selectedOfferId,
      selectedAt,
    });
  };

  const mapSideMissionResult = (result) => {
    const responseKeys = new Set([
      "accepted", "reason", "dailyKey", "capacity", "sideMission",
      "overallProgression", "updatedSkill", "newAchievements", "historyRecord",
    ]);
    const capacityKeys = new Set(["limit", "slotAvailable", "rewardedUsed", "rewardedRemaining"]);
    const missionKeys = new Set(["id", "sourceOfferId", "definition", "lifecycle"]);
    const definitionKeys = new Set([
      "title", "description", "estimatedDuration", "primarySkill", "skillName",
      "overallXPReward", "skillXPReward",
    ]);
    const lifecycleKeys = new Set(["state", "startedAt", "completedAt", "rewardAwarded"]);
    if (!result || typeof result !== "object" || typeof result.accepted !== "boolean"
      || typeof result.reason !== "string" || !result.reason
      || Object.keys(result).some((key) => !responseKeys.has(key))) {
      throw createRepositoryError("side-mission-response-invalid");
    }
    if (result.sideMission === undefined && result.dailyKey === undefined
      && result.capacity === undefined && result.accepted === false) {
      return deepFreeze({ accepted: false, reason: result.reason });
    }

    const dailyKey = String(result.dailyKey || "");
    const capacity = result.capacity && typeof result.capacity === "object" ? {
      limit: Number(result.capacity.limit),
      slotAvailable: result.capacity.slotAvailable,
      rewardedUsed: Number(result.capacity.rewardedUsed),
      rewardedRemaining: Number(result.capacity.rewardedRemaining),
    } : null;
    const rawMission = result.sideMission;
    const rawDefinition = rawMission?.definition;
    const rawLifecycle = rawMission?.lifecycle;
    let sideMission = null;
    if (rawMission !== null) {
      sideMission = {
        id: String(rawMission?.id || "").toLowerCase(),
        sourceOfferId: String(rawMission?.sourceOfferId || "").toLowerCase(),
        definition: {
          title: String(rawDefinition?.title || ""),
          description: String(rawDefinition?.description || ""),
          estimatedDuration: String(rawDefinition?.estimatedDuration || ""),
          primarySkill: String(rawDefinition?.primarySkill || ""),
          skillName: String(rawDefinition?.skillName || ""),
          overallXPReward: Number(rawDefinition?.overallXPReward),
          skillXPReward: Number(rawDefinition?.skillXPReward),
        },
        lifecycle: {
          state: String(rawLifecycle?.state || ""),
          startedAt: rawLifecycle?.startedAt == null ? null : String(rawLifecycle.startedAt),
          completedAt: rawLifecycle?.completedAt == null ? null : String(rawLifecycle.completedAt),
          rewardAwarded: rawLifecycle?.rewardAwarded,
        },
      };
    }

    const progression = result.overallProgression == null ? null : {
      totalXP: Number(result.overallProgression.totalXP),
    };
    const updatedSkill = result.updatedSkill == null ? null : {
      key: String(result.updatedSkill.key || ""),
      name: String(result.updatedSkill.name || ""),
      totalXP: Number(result.updatedSkill.totalXP),
      todayGain: Number(result.updatedSkill.todayGain || 0),
    };
    const achievementKeys = new Set([
      "key", "name", "description", "icon", "category", "hidden", "displayOrder", "unlockedAt",
    ]);
    const newAchievements = Array.isArray(result.newAchievements)
      ? result.newAchievements.map((achievement) => ({
        key: String(achievement?.key || ""),
        name: String(achievement?.name || ""),
        description: String(achievement?.description || ""),
        icon: String(achievement?.icon || ""),
        category: String(achievement?.category || ""),
        hidden: Boolean(achievement?.hidden),
        displayOrder: Number(achievement?.displayOrder),
        unlockedAt: String(achievement?.unlockedAt || ""),
      })) : null;
    const historyKeys = new Set([
      "historyId", "missionType", "missionId", "title", "category", "primarySkillKey",
      "primarySkill", "overallXPEarned", "skillXPEarned", "status", "completedAt",
      "description", "originalMissionState", "achievements",
    ]);
    const historyRecord = result.historyRecord == null ? null : { ...result.historyRecord };

    if (!isISOCalendarDate(dailyKey) || !capacity
      || Object.keys(result.capacity).some((key) => !capacityKeys.has(key))
      || capacity.limit !== 1 || typeof capacity.slotAvailable !== "boolean"
      || ![0, 1].includes(capacity.rewardedUsed)
      || ![0, 1].includes(capacity.rewardedRemaining)
      || capacity.rewardedUsed + capacity.rewardedRemaining !== 1
      || !newAchievements
      || (sideMission === null && !capacity.slotAvailable)
      || (sideMission !== null && (
        Object.keys(rawMission).some((key) => !missionKeys.has(key))
        || !rawDefinition || typeof rawDefinition !== "object"
        || Object.keys(rawDefinition).some((key) => !definitionKeys.has(key))
        || !rawLifecycle || typeof rawLifecycle !== "object"
        || Object.keys(rawLifecycle).some((key) => !lifecycleKeys.has(key))
        ||
        !isUUID(sideMission.id) || !isUUID(sideMission.sourceOfferId)
        || !sideMission.definition.title || !sideMission.definition.description
        || !sideMission.definition.estimatedDuration
        || !SKILL_KEY_PATTERN.test(sideMission.definition.primarySkill)
        || !sideMission.definition.skillName
        || sideMission.definition.overallXPReward !== 10
        || sideMission.definition.skillXPReward !== 10
        || !["ready", "active", "completed", "expired"].includes(sideMission.lifecycle.state)
        || typeof sideMission.lifecycle.rewardAwarded !== "boolean"
        || (sideMission.lifecycle.startedAt !== null
          && !Number.isFinite(Date.parse(sideMission.lifecycle.startedAt)))
        || (sideMission.lifecycle.completedAt !== null
          && !Number.isFinite(Date.parse(sideMission.lifecycle.completedAt)))
        || (sideMission.lifecycle.state === "ready" && sideMission.lifecycle.startedAt !== null)
        || (["active", "completed"].includes(sideMission.lifecycle.state)
          && sideMission.lifecycle.startedAt === null)
        || (sideMission.lifecycle.state === "completed") !== sideMission.lifecycle.rewardAwarded
        || (sideMission.lifecycle.state === "completed") !== (sideMission.lifecycle.completedAt !== null)
        || capacity.slotAvailable
        || capacity.rewardedUsed !== (sideMission.lifecycle.rewardAwarded ? 1 : 0)
      ))
      || (progression && (!Number.isInteger(progression.totalXP) || progression.totalXP < 0))
      || (progression && Object.keys(result.overallProgression).some((key) => key !== "totalXP"))
      || (updatedSkill && (!SKILL_KEY_PATTERN.test(updatedSkill.key) || !updatedSkill.name
        || !Number.isInteger(updatedSkill.totalXP) || updatedSkill.totalXP < 0
        || !Number.isInteger(updatedSkill.todayGain) || updatedSkill.todayGain < 0))
      || (updatedSkill && Object.keys(result.updatedSkill)
        .some((key) => !["key", "name", "totalXP", "todayGain"].includes(key)))
      || (newAchievements && (result.newAchievements.some((achievement) => !achievement
        || typeof achievement !== "object"
        || Object.keys(achievement).some((key) => !achievementKeys.has(key)))
        || newAchievements.some((achievement) => !achievement.key || !achievement.name
          || !achievement.description || !achievement.icon || !achievement.category
          || !Number.isInteger(achievement.displayOrder)
          || !Number.isFinite(Date.parse(achievement.unlockedAt)))))
      || (historyRecord && (historyRecord.missionType !== "side"
        || Object.keys(historyRecord).some((key) => !historyKeys.has(key))
        || !isUUID(historyRecord.historyId) || !isUUID(historyRecord.missionId)
        || !historyRecord.title || !historyRecord.category
        || !SKILL_KEY_PATTERN.test(String(historyRecord.primarySkillKey || ""))
        || !historyRecord.primarySkill || historyRecord.status !== "completed"
        || !Number.isFinite(Date.parse(historyRecord.completedAt))
        || Number(historyRecord.overallXPEarned) !== 10
        || Number(historyRecord.skillXPEarned) !== 10))) {
      throw createRepositoryError("side-mission-response-invalid");
    }

    return deepFreeze({
      accepted: result.accepted,
      reason: result.reason,
      dailyKey,
      capacity,
      sideMission,
      overallProgression: progression,
      updatedSkill,
      newAchievements,
      historyRecord,
    });
  };

  const mapVaultStreak = (result) => {
    if (!result || typeof result !== "object") {
      throw createRepositoryError("vault-streak-response-invalid");
    }
    const currentStreak = Number(result.currentStreak);
    const longestStreak = Number(result.longestStreak);
    const lastCompletedDailyKey = result.lastCompletedDailyKey === null
      || result.lastCompletedDailyKey === undefined
      ? null
      : String(result.lastCompletedDailyKey);
    if (!Number.isInteger(currentStreak) || currentStreak < 0
      || !Number.isInteger(longestStreak) || longestStreak < currentStreak
      || (lastCompletedDailyKey !== null && !isISOCalendarDate(lastCompletedDailyKey))
      || (currentStreak === 0 && (longestStreak !== 0 || lastCompletedDailyKey !== null))
      || (currentStreak > 0 && lastCompletedDailyKey === null)) {
      throw createRepositoryError("vault-streak-response-invalid");
    }
    return Object.freeze({ currentStreak, longestStreak, lastCompletedDailyKey });
  };

  const mapVaultAnalytics = (result, requestedPeriod) => {
    if (!result || typeof result !== "object" || result.period !== requestedPeriod
      || !Number.isFinite(Date.parse(result.generatedAt))
      || !result.summary || typeof result.summary !== "object"
      || !Array.isArray(result.missionActivity)
      || !Array.isArray(result.xpActivity)
      || !Array.isArray(result.skillActivity)) {
      throw createRepositoryError("vault-analytics-response-invalid");
    }

    const toNonnegativeInteger = (value) => {
      const number = Number(value);
      return Number.isInteger(number) && number >= 0 ? number : NaN;
    };
    const summary = {
      missionsCompleted: toNonnegativeInteger(result.summary.missionsCompleted),
      dailyMissionsCompleted: toNonnegativeInteger(
        result.summary.dailyMissionsCompleted ?? result.summary.missionsCompleted,
      ),
      sideMissionsCompleted: toNonnegativeInteger(result.summary.sideMissionsCompleted ?? 0),
      overallXPEarned: toNonnegativeInteger(result.summary.overallXPEarned),
      skillXPEarned: toNonnegativeInteger(result.summary.skillXPEarned),
      activeDays: toNonnegativeInteger(result.summary.activeDays),
      achievementsUnlocked: toNonnegativeInteger(result.summary.achievementsUnlocked),
    };
    const missionActivity = result.missionActivity.map((entry) => ({
      date: String(entry?.date || ""),
      completedCount: toNonnegativeInteger(entry?.completedCount),
      dailyCompletedCount: toNonnegativeInteger(entry?.dailyCompletedCount ?? entry?.completedCount),
      sideCompletedCount: toNonnegativeInteger(entry?.sideCompletedCount ?? 0),
    }));
    const xpActivity = result.xpActivity.map((entry) => ({
      date: String(entry?.date || ""),
      xpEarned: toNonnegativeInteger(entry?.xpEarned),
    }));
    const skillActivity = result.skillActivity.map((entry) => ({
      key: String(entry?.key || ""),
      name: String(entry?.name || ""),
      xpEarned: toNonnegativeInteger(entry?.xpEarned),
    }));
    const mostDevelopedSkill = result.mostDevelopedSkill ? {
      key: String(result.mostDevelopedSkill.key || ""),
      name: String(result.mostDevelopedSkill.name || ""),
      xpEarned: toNonnegativeInteger(result.mostDevelopedSkill.xpEarned),
    } : null;
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

    if (Object.values(summary).some((value) => !Number.isInteger(value))
      || missionActivity.some((entry) => !validDate(entry.date)
        || !Number.isInteger(entry.completedCount)
        || !Number.isInteger(entry.dailyCompletedCount)
        || !Number.isInteger(entry.sideCompletedCount)
        || entry.dailyCompletedCount + entry.sideCompletedCount !== entry.completedCount)
      || xpActivity.some((entry) => !validDate(entry.date)
        || !Number.isInteger(entry.xpEarned))
      || skillActivity.some((entry) => !entry.key || !entry.name
        || !Number.isInteger(entry.xpEarned))
      || (mostDevelopedSkill && (!mostDevelopedSkill.key || !mostDevelopedSkill.name
        || !Number.isInteger(mostDevelopedSkill.xpEarned)))) {
      throw createRepositoryError("vault-analytics-response-invalid");
    }

    return deepFreeze({
      period: requestedPeriod,
      generatedAt: new Date(result.generatedAt).toISOString(),
      periodStart: result.periodStart ? String(result.periodStart) : null,
      summary,
      mostDevelopedSkill,
      missionActivity,
      xpActivity,
      skillActivity,
    });
  };

  const mapMissionActionResult = (result) => {
    if (!result || typeof result !== "object" || typeof result.accepted !== "boolean") {
      throw createRepositoryError("mission-action-response-invalid");
    }

    const mapped = {
      accepted: result.accepted,
      reason: result.reason || null,
      nextResetAt: typeof result.nextResetAt === "string" ? result.nextResetAt : null,
      event: result.event ? { ...result.event } : null,
      mission: result.mission ? {
        definition: { ...(result.mission.definition || {}) },
        lifecycle: { ...(result.mission.lifecycle || {}) },
      } : null,
      progression: (result.overallProgression || result.progression) ? {
        totalXP: Number((result.overallProgression || result.progression).totalXP),
      } : null,
      overallProgression: (result.overallProgression || result.progression) ? {
        totalXP: Number((result.overallProgression || result.progression).totalXP),
      } : null,
      updatedSkill: result.updatedSkill ? {
        key: String(result.updatedSkill.key || ""),
        name: String(result.updatedSkill.name || ""),
        totalXP: Number(result.updatedSkill.totalXP),
        todayGain: Number(result.updatedSkill.todayGain || 0),
      } : null,
      newAchievements: Array.isArray(result.newAchievements)
        ? result.newAchievements.map((achievement) => ({
          key: String(achievement?.key || ""),
          name: String(achievement?.name || ""),
          description: String(achievement?.description || ""),
          icon: String(achievement?.icon || ""),
          category: String(achievement?.category || ""),
          hidden: Boolean(achievement?.hidden),
          displayOrder: Number(achievement?.displayOrder),
          unlockedAt: String(achievement?.unlockedAt || ""),
        }))
        : [],
      streak: result.streak ? mapVaultStreak(result.streak) : null,
      dailyStatus: result.dailyStatus ? { ...result.dailyStatus } : null,
      historyRecord: result.historyRecord ? { ...result.historyRecord } : null,
    };

    if (mapped.progression && !Number.isInteger(mapped.progression.totalXP)) {
      throw createRepositoryError("mission-action-response-invalid");
    }
    if (mapped.updatedSkill && (!mapped.updatedSkill.key
      || !mapped.updatedSkill.name
      || !Number.isInteger(mapped.updatedSkill.totalXP)
      || !Number.isInteger(mapped.updatedSkill.todayGain))) {
      throw createRepositoryError("mission-action-response-invalid");
    }
    if (mapped.newAchievements.some((achievement) => !achievement.key
      || !achievement.name || !achievement.description || !achievement.icon
      || !achievement.category || !Number.isInteger(achievement.displayOrder)
      || !Number.isFinite(Date.parse(achievement.unlockedAt)))) {
      throw createRepositoryError("mission-action-response-invalid");
    }

    return deepFreeze(mapped);
  };

  const mapDailyMissionResult = (result) => {
    if (!result || typeof result !== "object" || typeof result.accepted !== "boolean") {
      throw createRepositoryError("daily-mission-response-invalid");
    }

    const choices = Array.isArray(result.choices) ? result.choices.map((choice) => ({
      choiceId: String(choice?.choiceId || ""),
      title: String(choice?.title || ""),
      description: String(choice?.description || ""),
      estimatedDuration: String(choice?.estimatedDuration || ""),
      difficulty: String(choice?.difficulty || ""),
      xpReward: Number(choice?.xpReward),
      primarySkill: String(choice?.primarySkill || ""),
      primarySkillName: String(choice?.primarySkillName || ""),
    })) : [];
    const choiceRequired = result.choiceRequired === true;
    const mapped = {
      accepted: result.accepted,
      reason: result.reason || null,
      dailyKey: result.dailyKey || null,
      nextResetAt: typeof result.nextResetAt === "string" ? result.nextResetAt : null,
      choiceRequired,
      choices,
      mission: result.mission ? {
        definition: { ...(result.mission.definition || {}) },
        lifecycle: { ...(result.mission.lifecycle || {}) },
      } : null,
      dailyStatus: result.dailyStatus ? { ...result.dailyStatus } : null,
      progression: result.progression ? {
        totalXP: Number(result.progression.totalXP),
      } : null,
    };

    const validMission = Boolean(mapped.mission?.definition?.id
      && mapped.mission?.lifecycle?.state && mapped.dailyStatus);
    const validChoices = choiceRequired
      && choices.length >= 1 && choices.length <= 3
      && choices.every((choice) => isUUID(choice.choiceId)
        && choice.title && choice.description && choice.estimatedDuration
        && choice.difficulty && choice.primarySkill && choice.primarySkillName
        && choice.xpReward === 25);
    if (mapped.accepted && (!isISOCalendarDate(String(mapped.dailyKey || ""))
      || (validMission === validChoices)
      || (choiceRequired && mapped.mission)
      || (!choiceRequired && choices.length > 0))) {
      throw createRepositoryError("daily-mission-response-invalid");
    }
    if (mapped.progression && !Number.isInteger(mapped.progression.totalXP)) {
      throw createRepositoryError("daily-mission-response-invalid");
    }

    return deepFreeze(mapped);
  };

  const createUserRepository = ({ authService, client } = {}) => {
    if (!authService || typeof authService.getCurrentUser !== "function") {
      throw new TypeError("An authentication service is required.");
    }

    const database = client || authService.getClient();

    const getAuthenticatedUser = async () => {
      let user;
      try {
        user = await authService.getCurrentUser();
      } catch (error) {
        throw createRepositoryError("session-unavailable", error);
      }
      if (!user) throw createRepositoryError("session-expired");
      return user;
    };

    const unwrap = async (operation, code) => {
      const { data, error } = await operation;
      if (error) throw createRepositoryError(code, error);
      return data;
    };

    const mapProfile = (row) => row ? Object.freeze({
      firstName: row.first_name || "",
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }) : null;

    const mapOnboarding = (row) => row ? Object.freeze({
      focus: Array.isArray(row.focus) ? [...row.focus] : [],
      primaryFocus: row.primary_focus || "",
      stage: row.current_stage || "",
      challenge: row.biggest_challenge || "",
      commitment: row.daily_commitment || "",
      vision: row.future_vision || "",
      intensity: row.intensity || "",
      completed: Boolean(row.completed),
    }) : null;

    const mapDailyMission = (row) => row ? Object.freeze({
      dailySessionId: row.daily_session_id,
      definition: Object.freeze({ ...row.mission_definition }),
      lifecycle: Object.freeze({
        state: row.lifecycle_state,
        completionAwarded: Boolean(row.completion_awarded),
      }),
      replacementsUsed: row.replacements_used,
      terminalAt: row.terminal_at,
      terminalRecorded: Boolean(row.terminal_recorded),
    }) : null;

    const mapHistory = (row) => Object.freeze({
      missionId: row.mission_id,
      title: row.title,
      focus: row.focus,
      finalState: row.final_state,
      xpAwarded: row.xp_awarded,
      skillKey: row.skill_key || null,
      skillXPAwarded: Number(row.skill_xp_awarded || 0),
      terminalAt: row.terminal_at,
    });

    const mapVaultHistoryAchievement = (achievement) => Object.freeze({
      key: String(achievement?.key || ""),
      name: String(achievement?.name || ""),
      description: String(achievement?.description || ""),
      icon: String(achievement?.icon || ""),
      unlockedAt: String(achievement?.unlockedAt || ""),
    });

    const mapVaultHistoryEntry = (row) => Object.freeze({
      historyId: String(row?.historyId || ""),
      missionId: String(row?.missionId || ""),
      missionType: String(row?.missionType || "daily"),
      title: String(row?.title || ""),
      category: String(row?.category || ""),
      primarySkillKey: row?.primarySkillKey ? String(row.primarySkillKey) : null,
      primarySkill: row?.primarySkill ? String(row.primarySkill) : null,
      overallXPEarned: Number(row?.overallXPEarned || 0),
      skillXPEarned: Number(row?.skillXPEarned || 0),
      status: String(row?.status || ""),
      completedAt: String(row?.completedAt || ""),
      description: row?.description ? String(row.description) : null,
      originalMissionState: row?.originalMissionState
        ? String(row.originalMissionState)
        : null,
      achievements: Object.freeze(
        (Array.isArray(row?.achievements) ? row.achievements : [])
          .map(mapVaultHistoryAchievement),
      ),
    });

    const mapSkill = (skill) => Object.freeze({
      key: String(skill?.key || ""),
      name: String(skill?.name || ""),
      totalXP: Number(skill?.totalXP),
      todayGain: Number(skill?.todayGain || 0),
    });

    const mapSkillCatalogEntry = (row) => Object.freeze({
      key: String(row?.skill_key || ""),
      name: String(row?.display_name || ""),
      sortOrder: Number(row?.sort_order),
    });

    const mapAchievement = (achievement, unlocked = false) => Object.freeze({
      key: String(achievement?.key || ""),
      name: String(achievement?.name || ""),
      description: String(achievement?.description || ""),
      icon: String(achievement?.icon || ""),
      category: String(achievement?.category || ""),
      hidden: Boolean(achievement?.hidden),
      displayOrder: Number(achievement?.displayOrder),
      unlockedAt: unlocked ? String(achievement?.unlockedAt || "") : null,
      unlocked,
    });

    const loadProfile = async () => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("profiles").select("user_id, first_name, created_at, updated_at")
          .eq("user_id", user.id).maybeSingle(),
        "profile-load-failed",
      );
      return mapProfile(row);
    };

    const saveProfile = async ({ firstName } = {}) => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("profiles").upsert({
          user_id: user.id,
          first_name: String(firstName || "").trim(),
        }, { onConflict: "user_id" }).select("user_id, first_name, created_at, updated_at").single(),
        "profile-save-failed",
      );
      return mapProfile(row);
    };

    const loadOnboarding = async () => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("onboarding_profiles").select("*")
          .eq("user_id", user.id).maybeSingle(),
        "onboarding-load-failed",
      );
      return mapOnboarding(row);
    };

    const saveOnboarding = async (answers = {}) => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("onboarding_profiles").upsert({
          user_id: user.id,
          focus: Array.isArray(answers.focus) ? answers.focus : [],
          primary_focus: answers.primaryFocus || "",
          current_stage: answers.stage || "",
          biggest_challenge: answers.challenge || "",
          daily_commitment: answers.commitment || "",
          future_vision: answers.vision || "",
          intensity: answers.intensity || "",
          completed: Boolean(answers.completed),
        }, { onConflict: "user_id" }).select("*").single(),
        "onboarding-save-failed",
      );
      return mapOnboarding(row);
    };

    const loadProgression = async () => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("progression_state").select("total_xp")
          .eq("user_id", user.id).maybeSingle(),
        "progression-load-failed",
      );
      return row ? Object.freeze({ totalXP: row.total_xp }) : null;
    };

    // Sprint 10 restoration is a zero-argument read. PostgreSQL derives the
    // authenticated owner and today's timezone-aware boundary.
    const getSkillProgression = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_skill_progression"),
        "skill-progression-load-failed",
      );
      if (!Array.isArray(result)) {
        throw createRepositoryError("skill-progression-response-invalid");
      }
      const skills = result.map(mapSkill);
      if (skills.some((skill) => !skill.key || !skill.name
        || !Number.isInteger(skill.totalXP) || skill.totalXP < 0
        || !Number.isInteger(skill.todayGain) || skill.todayGain < 0)) {
        throw createRepositoryError("skill-progression-response-invalid");
      }
      return Object.freeze(skills);
    };

    // Mission Center presentation resolves the mission's server-owned skill
    // key through the existing read-only canonical catalog. This read cannot
    // select a mission or mutate catalog, progression, or rewards.
    const getSkillCatalog = async () => {
      await getAuthenticatedUser();
      const rows = await unwrap(
        database.from("skill_catalog")
          .select("skill_key, display_name, sort_order")
          .eq("active", true)
          .order("sort_order", { ascending: true }),
        "skill-catalog-load-failed",
      );
      if (!Array.isArray(rows)) throw createRepositoryError("skill-catalog-response-invalid");
      const catalog = rows.map(mapSkillCatalogEntry);
      if (catalog.some((entry) => !entry.key || !entry.name
        || !Number.isInteger(entry.sortOrder))) {
        throw createRepositoryError("skill-catalog-response-invalid");
      }
      return Object.freeze(catalog);
    };

    // Sprint 20 path restoration is owner-derived and zero-argument. Path
    // preference is independent from the authoritative lifetime XP snapshot.
    const getSkillPaths = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_skill_paths"),
        "skill-paths-load-failed",
      );
      if (!Array.isArray(result)) {
        throw createRepositoryError("skill-paths-response-invalid");
      }
      const paths = result.map(mapSkillPath);
      if (new Set(paths.map((path) => path.key)).size !== paths.length) {
        throw createRepositoryError("skill-paths-response-invalid");
      }
      return Object.freeze(paths);
    };

    const requestSkillPathState = async (skillKey, pathActive) => {
      await getAuthenticatedUser();
      const normalizedSkillKey = String(skillKey || "").trim().toLowerCase();
      if (!SKILL_KEY_PATTERN.test(normalizedSkillKey)) {
        throw new TypeError("A canonical skill key is required.");
      }
      const rpcName = pathActive ? "activate_skill_path" : "deactivate_skill_path";
      const result = await unwrap(
        database.rpc(rpcName, { p_skill_key: normalizedSkillKey }),
        pathActive ? "skill-path-activation-failed" : "skill-path-deactivation-failed",
      );
      const mapped = mapSkillPath(result);
      if (mapped.key !== normalizedSkillKey || mapped.pathActive !== pathActive) {
        throw createRepositoryError("skill-path-response-invalid");
      }
      return mapped;
    };

    const activateSkillPath = (skillKey) => requestSkillPathState(skillKey, true);
    const deactivateSkillPath = (skillKey) => requestSkillPathState(skillKey, false);

    const getMissionCustomization = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_mission_customization"),
        "mission-customization-load-failed",
      );
      return mapMissionCustomization(result);
    };

    const setMissionCustomization = async (focusKey) => {
      await getAuthenticatedUser();
      const normalizedFocusKey = String(focusKey || "").trim().toLowerCase();
      if (!MISSION_FOCUS_KEYS.includes(normalizedFocusKey)) {
        throw new TypeError("A canonical mission focus is required.");
      }
      const result = await unwrap(
        database.rpc("set_mission_customization", { p_focus_key: normalizedFocusKey }),
        "mission-customization-save-failed",
      );
      const mapped = mapMissionCustomization(result);
      if (mapped.preferredFocusKey !== normalizedFocusKey) {
        throw createRepositoryError("mission-customization-response-invalid");
      }
      return mapped;
    };

    // Sprint 21 restoration accepts no browser identity, skill, date, or day.
    const getSkillPathMissionOffers = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_skill_path_mission_offers"),
        "skill-path-offers-load-failed",
      );
      if (!Array.isArray(result)) {
        throw createRepositoryError("skill-path-offers-response-invalid");
      }
      const states = result.map(mapSkillPathMissionOffers);
      if (new Set(states.map((state) => state.skillKey)).size !== states.length) {
        throw createRepositoryError("skill-path-offers-response-invalid");
      }
      return Object.freeze(states);
    };

    // Request input is one canonical key; PostgreSQL independently proves the
    // authenticated owner, active path, catalog eligibility, and logical day.
    const requestSkillPathMissionOffers = async (skillKey) => {
      await getAuthenticatedUser();
      const normalizedSkillKey = String(skillKey || "").trim().toLowerCase();
      if (!SKILL_KEY_PATTERN.test(normalizedSkillKey)) {
        throw new TypeError("A canonical skill key is required.");
      }
      const result = await unwrap(
        database.rpc("request_skill_path_mission_offers", {
          p_skill_key: normalizedSkillKey,
        }),
        "skill-path-offers-request-failed",
      );
      const mapped = mapSkillPathMissionOffers(result);
      if (mapped.skillKey !== normalizedSkillKey) {
        throw createRepositoryError("skill-path-offers-response-invalid");
      }
      return mapped;
    };

    // Selection submits only the opaque ID from a persisted server offer set.
    const selectSkillPathMissionOffer = async (offerId) => {
      await getAuthenticatedUser();
      const normalizedOfferId = String(offerId || "").trim().toLowerCase();
      if (!isUUID(normalizedOfferId)) {
        throw new TypeError("An authoritative Skill Path offer id is required.");
      }
      const result = await unwrap(
        database.rpc("select_skill_path_mission_offer", {
          p_offer_id: normalizedOfferId,
        }),
        "skill-path-offer-selection-failed",
      );
      return mapSkillPathMissionOffers(result);
    };

    const getSideMission = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_side_mission"),
        "side-mission-load-failed",
      );
      return mapSideMissionResult(result);
    };

    const promoteSideMission = async (offerId) => {
      await getAuthenticatedUser();
      const normalizedOfferId = String(offerId || "").trim().toLowerCase();
      if (!isUUID(normalizedOfferId)) {
        throw new TypeError("An authoritative planned offer id is required.");
      }
      const result = await unwrap(
        database.rpc("promote_skill_path_offer_to_side_mission", {
          p_offer_id: normalizedOfferId,
        }),
        "side-mission-promotion-failed",
      );
      return mapSideMissionResult(result);
    };

    const startSideMission = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("start_side_mission"),
        "side-mission-start-failed",
      );
      return mapSideMissionResult(result);
    };

    const completeSideMission = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("complete_side_mission"),
        "side-mission-completion-failed",
      );
      return mapSideMissionResult(result);
    };

    // Sprint 11 restoration remains read-only. Both RPCs derive identity and
    // ownership inside PostgreSQL and accept no browser-supplied arguments.
    const getAchievementCatalog = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_achievement_catalog"),
        "achievement-catalog-load-failed",
      );
      if (!Array.isArray(result)) {
        throw createRepositoryError("achievement-catalog-response-invalid");
      }
      const achievements = result.map((achievement) => mapAchievement(achievement, false));
      if (achievements.some((achievement) => {
        const confidential = achievement.hidden && !achievement.key;
        return (!confidential && (!achievement.key || !achievement.name
          || !achievement.description || !achievement.icon || !achievement.category))
          || (confidential && (achievement.name !== "?????"
            || achievement.description !== "?????" || achievement.icon !== "?"
            || achievement.category !== ""))
          || !Number.isInteger(achievement.displayOrder);
      })) {
        throw createRepositoryError("achievement-catalog-response-invalid");
      }
      return Object.freeze(achievements);
    };

    const getUserAchievements = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_user_achievements"),
        "achievements-load-failed",
      );
      if (!Array.isArray(result)) {
        throw createRepositoryError("achievements-response-invalid");
      }
      const achievements = result.map((achievement) => mapAchievement(achievement, true));
      if (achievements.some((achievement) => !achievement.key
        || !achievement.name || !achievement.description || !achievement.icon
        || !achievement.category || !Number.isInteger(achievement.displayOrder)
        || !Number.isFinite(Date.parse(achievement.unlockedAt)))) {
        throw createRepositoryError("achievements-response-invalid");
      }
      return Object.freeze(achievements);
    };

    const loadDailyMissionState = async (dailySessionId) => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("daily_mission_state").select("*")
          .eq("user_id", user.id)
          .eq("daily_session_id", dailySessionId)
          .maybeSingle(),
        "mission-state-load-failed",
      );
      return mapDailyMission(row);
    };

    const loadMissionHistory = async (limit = 100) => {
      const user = await getAuthenticatedUser();
      const rows = await unwrap(
        database.from("mission_history").select("mission_id, title, focus, final_state, xp_awarded, skill_key, skill_xp_awarded, terminal_at")
          .eq("user_id", user.id)
          .order("terminal_at", { ascending: false })
          .limit(Math.min(100, Math.max(1, Number(limit) || 100))),
        "mission-history-load-failed",
      );
      return Object.freeze((rows || []).map(mapHistory));
    };

    // Sprint 12 permanent archive restoration. The RPC accepts exactly zero
    // arguments and derives ownership from auth.uid(). PostgREST applies the
    // range window to the ordered set returned by PostgreSQL; one extra row is
    // requested only to determine whether another page exists.
    const getVaultHistory = async ({ offset = 0, pageSize = 20 } = {}) => {
      await getAuthenticatedUser();
      const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));
      const normalizedPageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 20)));
      const rows = await unwrap(
        database.rpc("get_vault_history")
          .range(normalizedOffset, normalizedOffset + normalizedPageSize),
        "vault-history-load-failed",
      );
      if (!Array.isArray(rows)) throw createRepositoryError("vault-history-response-invalid");

      const hasMore = rows.length > normalizedPageSize;
      const entries = rows.slice(0, normalizedPageSize).map(mapVaultHistoryEntry);
      if (entries.some((entry) => !entry.historyId || !entry.missionId || !entry.title
        || !["daily", "side"].includes(entry.missionType)
        || !entry.category || entry.status !== "completed"
        || !Number.isInteger(entry.overallXPEarned) || entry.overallXPEarned < 0
        || !Number.isInteger(entry.skillXPEarned) || entry.skillXPEarned < 0
        || !Number.isFinite(Date.parse(entry.completedAt))
        || entry.achievements.some((achievement) => !achievement.key || !achievement.name
          || !achievement.description || !achievement.icon
          || !Number.isFinite(Date.parse(achievement.unlockedAt))))) {
        throw createRepositoryError("vault-history-response-invalid");
      }

      return deepFreeze({
        entries,
        hasMore,
        nextOffset: normalizedOffset + entries.length,
        pageSize: normalizedPageSize,
      });
    };

    // Sprint 13 analytics is one authenticated, read-only aggregate request.
    // The browser supplies only a server-validated period identifier; it never
    // supplies ownership, dates, counts, XP, skills, or achievement totals.
    const getVaultAnalytics = async (period = "7d") => {
      await getAuthenticatedUser();
      const normalizedPeriod = String(period || "").trim().toLowerCase();
      if (!ANALYTICS_PERIODS.includes(normalizedPeriod)) {
        throw new TypeError("A supported analytics period is required.");
      }
      const result = await unwrap(
        database.rpc("get_vault_analytics", { p_period: normalizedPeriod }),
        "vault-analytics-load-failed",
      );
      return mapVaultAnalytics(result, normalizedPeriod);
    };

    // Sprint 27 Coach restoration submits presentation intent only. PostgreSQL
    // derives owner identity and every advisory context value from authoritative
    // state; no gameplay snapshot or user identifier is accepted here.
    const getVaultCoachContext = async (mode = "overview") => {
      await getAuthenticatedUser();
      const normalizedMode = String(mode || "").trim().toLowerCase();
      if (!COACH_MODES.includes(normalizedMode)) {
        throw new TypeError("A supported Coach mode is required.");
      }
      const result = await unwrap(
        database.rpc("get_vault_coach_context", { p_mode: normalizedMode }),
        "coach-context-load-failed",
      );
      return mapCoachContext(result, normalizedMode);
    };

    // Sprint 14 restoration is exact zero-argument. PostgreSQL derives the
    // owner and returns only server-maintained logical-day streak state.
    const getVaultStreak = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("get_vault_streak"),
        "vault-streak-load-failed",
      );
      return mapVaultStreak(result);
    };

    // Creates missing baseline rows without accepting an XP total. The database
    // owns the initial XP value. Mission rewards are not trusted by this call.
    const initializeVaultSession = async ({ dailySessionId, definition } = {}) => {
      await getAuthenticatedUser();
      return unwrap(database.rpc("initialize_vault_session", {
        p_daily_session_id: dailySessionId,
        p_mission_definition: definition,
      }), "vault-session-initialize-failed");
    };

    // Production mutation contract: the browser submits intent only. Sprint 8
    // validates and mutates mission, progression, and history state inside one
    // trusted database transaction, then returns the authoritative snapshot.
    const requestMissionAction = async ({ missionId, action } = {}) => {
      await getAuthenticatedUser();
      const normalizedMissionId = String(missionId || "").trim();
      const normalizedAction = String(action || "").trim().toLowerCase();
      if (!normalizedMissionId) throw new TypeError("A mission id is required.");
      if (!["start", "complete", "skip"].includes(normalizedAction)) {
        throw new TypeError("A supported mission action is required.");
      }
      const result = await unwrap(database.rpc("request_vault_mission_action", {
        p_mission_id: normalizedMissionId,
        p_action: normalizedAction,
      }), "mission-action-request-failed");
      return mapMissionActionResult(result);
    };

    // Sprint 9 daily authority. This intentionally invokes a zero-argument
    // RPC: identity, timezone, daily key, onboarding inputs, template, reward,
    // lifecycle state, and mission instance id are all selected by PostgreSQL.
    const requestDailyMission = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("request_daily_mission"),
        "daily-mission-request-failed",
      );
      return mapDailyMissionResult(result);
    };

    // Sprint 19 choice selection accepts exactly one opaque UUID from the
    // server-returned choice set. No mission object, template, reward, skill,
    // owner, logical day, date, or timezone crosses this mutation boundary.
    const selectDailyMissionChoice = async (choiceId) => {
      await getAuthenticatedUser();
      const normalizedChoiceId = String(choiceId || "").trim().toLowerCase();
      if (!isUUID(normalizedChoiceId)) {
        throw new TypeError("An authoritative mission choice id is required.");
      }
      const result = await unwrap(
        database.rpc("select_daily_mission_choice", {
          p_choice_id: normalizedChoiceId,
        }),
        "daily-mission-selection-failed",
      );
      return mapDailyMissionResult(result);
    };

    // Sprint 9 replacement authority is also intent-only. The server locates
    // today's terminal mission and chooses/persists its one allowed successor.
    const requestDailyMissionReplacement = async () => {
      await getAuthenticatedUser();
      const result = await unwrap(
        database.rpc("request_daily_mission_replacement"),
        "daily-mission-replacement-failed",
      );
      return mapDailyMissionResult(result);
    };

    // TRANSITIONAL SPRINT 7.2 ADAPTER.
    // This accepts only a completed lifecycle event and the immutable snapshot
    // returned by progression.js. The database recomputes the permitted next
    // total from its current row and saved mission reward before updating it.
    // Sprint 8 production execution is revoked in migration 005. This remains
    // only for historical prototype tests and rollback inspection.
    const persistValidatedPrototypeProgression = async ({
      missionId,
      lifecycleEvent,
      progressionSnapshot,
    } = {}) => {
      await getAuthenticatedUser();
      const normalizedMissionId = String(missionId || "").trim();
      if (!normalizedMissionId
        || lifecycleEvent?.missionId !== normalizedMissionId
        || lifecycleEvent?.eventType !== "mission.completed"
        || lifecycleEvent?.currentState !== "completed"
        || !(Number(lifecycleEvent?.xpAwarded) > 0)
        || !Number.isInteger(progressionSnapshot?.currentXP)
        || progressionSnapshot.currentXP < 0) {
        throw new TypeError("A validated prototype completion snapshot is required.");
      }

      const result = await unwrap(database.rpc("persist_validated_prototype_progression", {
        p_lifecycle_event: lifecycleEvent,
        p_mission_id: normalizedMissionId,
        p_progression_snapshot: progressionSnapshot,
      }), "prototype-progression-save-failed");
      return Object.freeze({ ...(result || {}) });
    };

    // TRANSITIONAL SPRINT 7.2 REPLACEMENT ADAPTER.
    // This accepts only a coordinator-approved replacement event and snapshot.
    // It cannot write XP and is not a generic mission-state setter. The SQL
    // function revalidates the saved terminal mission and replacement limit.
    const persistValidatedPrototypeReplacement = async ({
      replacementEvent,
      coordinatorSnapshot,
    } = {}) => {
      await getAuthenticatedUser();
      const definition = coordinatorSnapshot?.currentMission?.definition;
      const lifecycle = coordinatorSnapshot?.currentMission?.lifecycle;
      const replacementsUsed = coordinatorSnapshot?.dailyStatus?.replacementsUsed;
      const previousMissionId = String(replacementEvent?.previousMissionId || "").trim();
      const missionId = String(replacementEvent?.missionId || "").trim();

      if (replacementEvent?.eventType !== "coordinator.mission-replaced"
        || replacementEvent?.xpAwarded !== 0
        || !previousMissionId
        || !missionId
        || missionId === previousMissionId
        || definition?.id !== missionId
        || lifecycle?.state !== "ready"
        || lifecycle?.completionAwarded !== false
        || !Number.isInteger(replacementsUsed)
        || replacementsUsed !== 1) {
        throw new TypeError("A validated prototype replacement snapshot is required.");
      }

      const result = await unwrap(database.rpc("persist_validated_prototype_replacement", {
        p_mission_definition: definition,
        p_previous_mission_id: previousMissionId,
        p_replacement_event: replacementEvent,
        p_replacements_used: replacementsUsed,
      }), "prototype-replacement-save-failed");
      return deepFreeze({ ...(result || {}) });
    };

    // DEPRECATED TEST-COMPATIBILITY ADAPTER (Sprint 7 only).
    // The Sprint 7.1 migration revokes authenticated execution of this RPC, so
    // it cannot persist browser-calculated XP in a corrected database. Keep
    // only until the original Sprint 7 contract tests are retired in Sprint 8.
    const persistMissionTransition = async ({ dailyMission, totalXP, historyRecord = null }) => {
      await getAuthenticatedUser();
      return unwrap(database.rpc("persist_vault_transition", {
        p_completion_awarded: dailyMission.lifecycle.completionAwarded,
        p_daily_session_id: dailyMission.dailySessionId,
        p_history_record: historyRecord,
        p_lifecycle_state: dailyMission.lifecycle.state,
        p_mission_definition: dailyMission.definition,
        p_replacements_used: dailyMission.replacementsUsed,
        p_terminal_at: dailyMission.terminalAt || null,
        p_total_xp: totalXP,
      }), "deprecated-mission-transition-rejected");
    };

    return Object.freeze({
      activateSkillPath,
      deactivateSkillPath,
      completeSideMission,
      getAchievementCatalog,
      getMissionCustomization,
      getSkillCatalog,
      getSideMission,
      getSkillPathMissionOffers,
      getSkillPaths,
      getSkillProgression,
      getUserAchievements,
      getVaultAnalytics,
      getVaultCoachContext,
      getVaultHistory,
      getVaultStreak,
      initializeVaultSession,
      loadDailyMissionState,
      loadMissionHistory,
      loadOnboarding,
      loadProfile,
      loadProgression,
      persistMissionTransition,
      persistValidatedPrototypeReplacement,
      persistValidatedPrototypeProgression,
      requestDailyMission,
      requestDailyMissionReplacement,
      requestMissionAction,
      requestSkillPathMissionOffers,
      promoteSideMission,
      selectDailyMissionChoice,
      selectSkillPathMissionOffer,
      setMissionCustomization,
      startSideMission,
      saveOnboarding,
      saveProfile,
    });
  };

  return Object.freeze({ createUserRepository });
});
