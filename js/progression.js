"use strict";

// Central progression engine. Overall and skill balancing live only in these
// configurations; callers provide totals but never duplicate level math.
window.KVNXProgression = (() => {
  const OVERALL_LEVEL_THRESHOLDS = Object.freeze([
    { level: 1, totalXP: 0 },
    { level: 2, totalXP: 100 },
    { level: 3, totalXP: 250 },
    { level: 4, totalXP: 450 },
    { level: 5, totalXP: 700 },
  ]);

  const SKILL_LEVEL_THRESHOLDS = Object.freeze([
    { level: 1, totalXP: 0 },
    { level: 2, totalXP: 100 },
    { level: 3, totalXP: 250 },
    { level: 4, totalXP: 450 },
    { level: 5, totalXP: 700 },
  ]);

  const PROGRESSION_CONFIGS = Object.freeze({
    overall: OVERALL_LEVEL_THRESHOLDS,
    skill: SKILL_LEVEL_THRESHOLDS,
  });

  const normalizeXP = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
  };

  const getThresholds = (progression) => PROGRESSION_CONFIGS[progression?.configuration]
    || PROGRESSION_CONFIGS.overall;

  const getCurrentLevel = (progression) => {
    const totalXP = normalizeXP(progression?.totalXP);
    const thresholds = getThresholds(progression);
    return thresholds.reduce(
      (currentLevel, threshold) => totalXP >= threshold.totalXP ? threshold.level : currentLevel,
      thresholds[0].level,
    );
  };

  const getCurrentXP = (progression) => normalizeXP(progression?.totalXP);

  const getLevelThreshold = (progression, level) => getThresholds(progression)
    .find((item) => item.level === level) || null;

  const getXPForNextLevel = (progression) => {
    const nextThreshold = getLevelThreshold(progression, getCurrentLevel(progression) + 1);
    return nextThreshold ? nextThreshold.totalXP : null;
  };

  const canLevelUp = (progression) => getXPForNextLevel(progression) !== null;

  const getProgressPercentage = (progression) => {
    const currentLevel = getCurrentLevel(progression);
    const currentThreshold = getLevelThreshold(progression, currentLevel);
    const nextLevelXP = getXPForNextLevel(progression);

    if (!currentThreshold || nextLevelXP === null) return 100;

    const earnedThisLevel = getCurrentXP(progression) - currentThreshold.totalXP;
    const levelRange = nextLevelXP - currentThreshold.totalXP;
    return Math.min(100, Math.max(0, (earnedThisLevel / levelRange) * 100));
  };

  const getSnapshot = (progression) => {
    const totalXP = getCurrentXP(progression);
    const currentLevel = getCurrentLevel(progression);
    const currentThreshold = getLevelThreshold(progression, currentLevel);
    const nextLevelXP = getXPForNextLevel(progression);

    return Object.freeze({
      currentLevel,
      currentXP: totalXP,
      configuration: progression?.configuration || "overall",
      currentLevelXP: totalXP - currentThreshold.totalXP,
      nextLevel: nextLevelXP === null ? null : currentLevel + 1,
      xpForNextLevel: nextLevelXP,
      xpRemaining: nextLevelXP === null ? 0 : Math.max(0, nextLevelXP - totalXP),
      progressPercentage: Math.round(getProgressPercentage(progression)),
      isMaxLevel: nextLevelXP === null,
    });
  };

  const createProgression = (initialXP = 0, configuration = "overall") => Object.freeze({
    totalXP: normalizeXP(initialXP),
    configuration: Object.hasOwn(PROGRESSION_CONFIGS, configuration) ? configuration : "overall",
  });

  const addXP = (progression, amount) => {
    const previousSnapshot = getSnapshot(progression);
    const nextProgression = createProgression(
      getCurrentXP(progression) + normalizeXP(amount),
      progression?.configuration || "overall",
    );
    const snapshot = getSnapshot(nextProgression);

    return Object.freeze({
      progression: nextProgression,
      snapshot,
      previousSnapshot,
      didLevelUp: snapshot.currentLevel > previousSnapshot.currentLevel,
      levelsGained: snapshot.currentLevel - previousSnapshot.currentLevel,
    });
  };

  return Object.freeze({
    PROGRESSION_CONFIGS,
    createProgression,
    addXP,
    getCurrentLevel,
    getCurrentXP,
    getXPForNextLevel,
    getProgressPercentage,
    canLevelUp,
    getSnapshot,
  });
})();
