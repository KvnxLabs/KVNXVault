"use strict";

// Central progression engine. Level balancing lives only in this configuration.
window.KVNXProgression = (() => {
  const LEVEL_THRESHOLDS = Object.freeze([
    { level: 1, totalXP: 0 },
    { level: 2, totalXP: 100 },
    { level: 3, totalXP: 250 },
    { level: 4, totalXP: 450 },
    { level: 5, totalXP: 700 },
  ]);

  const normalizeXP = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
  };

  const getCurrentLevel = (progression) => {
    const totalXP = normalizeXP(progression?.totalXP);
    return LEVEL_THRESHOLDS.reduce(
      (currentLevel, threshold) => totalXP >= threshold.totalXP ? threshold.level : currentLevel,
      LEVEL_THRESHOLDS[0].level,
    );
  };

  const getCurrentXP = (progression) => normalizeXP(progression?.totalXP);

  const getLevelThreshold = (level) => LEVEL_THRESHOLDS.find((item) => item.level === level) || null;

  const getXPForNextLevel = (progression) => {
    const nextThreshold = getLevelThreshold(getCurrentLevel(progression) + 1);
    return nextThreshold ? nextThreshold.totalXP : null;
  };

  const canLevelUp = (progression) => getXPForNextLevel(progression) !== null;

  const getProgressPercentage = (progression) => {
    const currentLevel = getCurrentLevel(progression);
    const currentThreshold = getLevelThreshold(currentLevel);
    const nextLevelXP = getXPForNextLevel(progression);

    if (!currentThreshold || nextLevelXP === null) return 100;

    const earnedThisLevel = getCurrentXP(progression) - currentThreshold.totalXP;
    const levelRange = nextLevelXP - currentThreshold.totalXP;
    return Math.min(100, Math.max(0, (earnedThisLevel / levelRange) * 100));
  };

  const getSnapshot = (progression) => {
    const totalXP = getCurrentXP(progression);
    const currentLevel = getCurrentLevel(progression);
    const currentThreshold = getLevelThreshold(currentLevel);
    const nextLevelXP = getXPForNextLevel(progression);

    return Object.freeze({
      currentLevel,
      currentXP: totalXP,
      currentLevelXP: totalXP - currentThreshold.totalXP,
      nextLevel: nextLevelXP === null ? null : currentLevel + 1,
      xpForNextLevel: nextLevelXP,
      xpRemaining: nextLevelXP === null ? 0 : Math.max(0, nextLevelXP - totalXP),
      progressPercentage: Math.round(getProgressPercentage(progression)),
      isMaxLevel: nextLevelXP === null,
    });
  };

  const createProgression = (initialXP = 0) => Object.freeze({
    totalXP: normalizeXP(initialXP),
  });

  const addXP = (progression, amount) => {
    const previousSnapshot = getSnapshot(progression);
    const nextProgression = createProgression(getCurrentXP(progression) + normalizeXP(amount));
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
