"use strict";

const KVNXReplacementRequestController = (() => {
  const create = ({ button, request, onAccepted, onRejected, onError, canRetry }) => {
    if (!button || typeof request !== "function" || typeof canRetry !== "function") {
      throw new TypeError("A replacement button, request, and retry check are required.");
    }

    let inFlight = false;

    const run = async () => {
      if (inFlight) {
        return Object.freeze({ accepted: false, reason: "replacement-request-in-progress" });
      }

      inFlight = true;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      let result;
      let requestError;

      try {
        result = await request();
        if (result?.accepted) await onAccepted?.(result);
        else await onRejected?.(result);
        return result;
      } catch (error) {
        requestError = error;
        await onError?.(error);
        return Object.freeze({ accepted: false, reason: "replacement-request-failed" });
      } finally {
        inFlight = false;
        button.setAttribute("aria-busy", "false");
        button.disabled = !canRetry({ result, error: requestError });
      }
    };

    return Object.freeze({
      isInFlight: () => inFlight,
      run,
    });
  };

  return Object.freeze({ create });
})();

const KVNXDailyCompleteExperience = (() => {
  const FALLBACK_LABEL = "New mission available tomorrow";

  const getResetDisplay = (nextResetAt, now = Date.now()) => {
    const resetTime = typeof nextResetAt === "string" ? Date.parse(nextResetAt) : NaN;
    if (!Number.isFinite(resetTime)) {
      return Object.freeze({ mode: "fallback", label: FALLBACK_LABEL, value: null });
    }

    const remainingMilliseconds = Math.max(0, resetTime - Number(now));
    if (remainingMilliseconds === 0) {
      return Object.freeze({ mode: "ready", label: "New mission ready", value: "00h 00m" });
    }

    const remainingMinutes = Math.ceil(remainingMilliseconds / 60000);
    const hours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    return Object.freeze({
      mode: "countdown",
      label: "Next mission in",
      value: `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`,
    });
  };

  const createCountdown = ({ nextResetAt, onUpdate, now = () => Date.now(), schedule, cancel } = {}) => {
    if (typeof onUpdate !== "function") throw new TypeError("A countdown update handler is required.");
    const scheduleTick = schedule || ((handler) => setTimeout(handler, 60000));
    const cancelTick = cancel || ((timerId) => clearTimeout(timerId));
    let timerId = null;
    let stopped = false;
    let readyAnnounced = false;

    const tick = () => {
      if (stopped) return;
      const display = getResetDisplay(nextResetAt, now());
      const announceReady = display.mode === "ready" && !readyAnnounced;
      if (announceReady) readyAnnounced = true;
      onUpdate(Object.freeze({ ...display, announceReady }));
      timerId = display.mode === "countdown" ? scheduleTick(tick) : null;
    };

    tick();

    return Object.freeze({
      stop: () => {
        stopped = true;
        if (timerId !== null) cancelTick(timerId);
        timerId = null;
      },
    });
  };

  const createViewModel = ({ coordinator, progression, nextResetAt } = {}) => {
    const lifecycle = coordinator?.currentMission?.lifecycle;
    const dailyStatus = coordinator?.dailyStatus;
    const currentXP = progression?.currentXP;
    const visible = lifecycle?.state === "completed"
      && dailyStatus?.replacementsRemaining === 0;

    return Object.freeze({
      visible,
      currentXP: Number.isFinite(currentXP) ? currentXP : null,
      xpLabel: Number.isFinite(currentXP)
        ? `${currentXP.toLocaleString("en-US")} XP`
        : "XP unavailable",
      nextResetAt: typeof nextResetAt === "string" ? nextResetAt : null,
      resetDisplay: getResetDisplay(nextResetAt),
      nextMissionLabel: FALLBACK_LABEL,
    });
  };

  return Object.freeze({ FALLBACK_LABEL, createCountdown, createViewModel, getResetDisplay });
})();

const KVNXSkillsExperience = (() => {
  const getInitials = (name) => String(name || "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "SK";

  const createViewModel = (skills = []) => Object.freeze(
    (Array.isArray(skills) ? skills : []).map((skill) => Object.freeze({
      key: skill.key,
      name: skill.name,
      initials: getInitials(skill.name),
      levelLabel: `L${String(skill.level).padStart(2, "0")}`,
      levelText: `Level ${skill.level}`,
      totalXPLabel: `${Number(skill.totalXP).toLocaleString("en-US")} XP`,
      todayGainLabel: `Today +${Number(skill.todayGain || 0).toLocaleString("en-US")}`,
      progressPercentage: Math.min(100, Math.max(0, Number(skill.progressPercentage) || 0)),
    })),
  );

  return Object.freeze({ createViewModel });
})();

// Sprint 20 adds a separate authoritative development-path preference to the
// Sprint 17 read-only catalog/progression/history merge. Positive XP still
// controls progression disclosure; path activation never fabricates mastery.
const KVNXSkillCenterExperience = (() => {
  const FILTERS = Object.freeze(["all", "active", "developing", "not-started"]);
  const SORTS = Object.freeze(["highest-level", "most-xp", "name"]);

  const compareIdentity = (left, right) => (left.sortOrder - right.sortOrder)
    || left.name.localeCompare(right.name, "en-US");

  const formatDate = (timestamp) => {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed)
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
        .format(new Date(parsed))
      : "Date unavailable";
  };

  const createViewModel = (snapshot, progressionEngine, options = {}) => {
    if (typeof progressionEngine?.createProgression !== "function"
      || typeof progressionEngine?.getSnapshot !== "function") {
      throw new TypeError("The configured progression engine is required.");
    }

    const catalog = Array.isArray(snapshot?.skillCatalog) ? snapshot.skillCatalog : [];
    const progression = Array.isArray(snapshot?.skills) ? snapshot.skills : [];
    const skillPaths = Array.isArray(snapshot?.skillPaths) ? snapshot.skillPaths : [];
    const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
    const progressionByKey = new Map(progression.map((skill) => [String(skill.key), skill]));
    const pathsByKey = new Map(skillPaths.map((path) => [String(path.key), path]));

    const allSkills = catalog.map((catalogSkill, index) => {
      const key = String(catalogSkill.key || "");
      const persisted = progressionByKey.get(key);
      const path = pathsByKey.get(key);
      const totalXPValue = Number(persisted?.totalXP || 0);
      const totalXP = Number.isFinite(totalXPValue) ? Math.max(0, Math.floor(totalXPValue)) : 0;
      const derived = progressionEngine.getSnapshot(
        progressionEngine.createProgression(totalXP, "skill"),
      );
      const recentGains = history
        .filter((entry) => entry?.status === "completed"
          && entry?.primarySkillKey === key
          && Number(entry?.skillXPEarned) > 0
          && Number.isFinite(Date.parse(entry?.completedAt)))
        .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
        .slice(0, 5)
        .map((entry) => Object.freeze({
          historyId: String(entry.historyId || ""),
          title: String(entry.title || "Verified mission"),
          completedAt: new Date(Date.parse(entry.completedAt)).toISOString(),
          dateLabel: formatDate(entry.completedAt),
          skillXPEarned: Number(entry.skillXPEarned),
        }));

      return Object.freeze({
        key,
        name: String(catalogSkill.name || persisted?.name || "Unnamed skill"),
        sortOrder: Number.isFinite(Number(catalogSkill.sortOrder))
          ? Number(catalogSkill.sortOrder)
          : index,
        totalXP,
        active: totalXP > 0,
        developmentPathActive: path?.pathActive === true,
        expandable: totalXP > 0,
        stateLabel: totalXP > 0 ? "Progress recorded" : "Not Started",
        pathStateLabel: path?.pathActive === true ? "Developing" : "Path inactive",
        level: derived.currentLevel,
        nextLevel: derived.nextLevel,
        currentLevelXP: derived.currentLevelXP,
        currentLevelTarget: derived.isMaxLevel
          ? derived.currentLevelXP
          : derived.xpForNextLevel - (totalXP - derived.currentLevelXP),
        xpForNextLevel: derived.xpForNextLevel,
        xpRemaining: derived.xpRemaining,
        progressPercentage: derived.progressPercentage,
        isMaxLevel: derived.isMaxLevel,
        recentGains: Object.freeze(recentGains),
      });
    });

    const identitySorted = [...allSkills].sort(compareIdentity);
    const activeSkills = identitySorted.filter((skill) => skill.active);
    const highestSkill = [...activeSkills].sort((left, right) => (right.totalXP - left.totalXP)
      || compareIdentity(left, right))[0] || null;
    const recentHistoryEntry = history
      .filter((entry) => entry?.status === "completed"
        && Number(entry?.skillXPEarned) > 0
        && Number.isFinite(Date.parse(entry?.completedAt))
        && identitySorted.some((skill) => skill.key === entry.primarySkillKey))
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))[0] || null;
    const recentlyDeveloped = recentHistoryEntry
      ? identitySorted.find((skill) => skill.key === recentHistoryEntry.primarySkillKey) || null
      : null;

    const filter = FILTERS.includes(options.filter) ? options.filter : "all";
    const sort = SORTS.includes(options.sort) ? options.sort : "highest-level";
    const filtered = identitySorted.filter((skill) => filter === "all"
      || (filter === "active" && skill.active)
      || (filter === "developing" && skill.developmentPathActive)
      || (filter === "not-started" && !skill.active));
    filtered.sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, "en-US") || compareIdentity(left, right);
      if (sort === "most-xp") return (right.totalXP - left.totalXP) || compareIdentity(left, right);
      return (right.level - left.level) || (right.totalXP - left.totalXP) || compareIdentity(left, right);
    });

    return Object.freeze({
      empty: activeSkills.length === 0,
      activeCount: activeSkills.length,
      developmentPathCount: identitySorted.filter((skill) => skill.developmentPathActive).length,
      totalSkillXP: identitySorted.reduce((total, skill) => total + skill.totalXP, 0),
      highestSkill,
      recentlyDeveloped,
      filter,
      sort,
      skills: Object.freeze(filtered),
      activeSkills: Object.freeze(filtered.filter((skill) => skill.active)),
      notStartedSkills: Object.freeze(filtered.filter((skill) => !skill.active)),
    });
  };

  return Object.freeze({ FILTERS, SORTS, createViewModel });
})();

const KVNXAchievementsExperience = (() => {
  const REQUIREMENTS = Object.freeze({
    FIRST_MISSION: Object.freeze({ label: "Complete your first verified mission." }),
    FIRST_REPLACEMENT: Object.freeze({ label: "Complete a verified replacement mission." }),
    LEVEL_2: Object.freeze({ label: "Reach overall Level 2.", kind: "xp", target: 100 }),
    FIRST_SKILL: Object.freeze({ label: "Develop your first skill.", kind: "skill" }),
    "100_XP": Object.freeze({ label: "Reach 100 total XP.", kind: "xp", target: 100 }),
    "250_XP": Object.freeze({ label: "Reach 250 total XP.", kind: "xp", target: 250 }),
    "500_XP": Object.freeze({ label: "Reach 500 total XP.", kind: "xp", target: 500 }),
  });

  const formatDate = (timestamp) => {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed)
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
        .format(new Date(parsed))
      : null;
  };

  const formatDays = (value) => `${value} ${value === 1 ? "day" : "days"}`;

  const createViewModel = (achievements = []) => Object.freeze(
    (Array.isArray(achievements) ? achievements : []).map((achievement) => {
      const unlocked = achievement?.unlocked === true;
      const hiddenLocked = !unlocked && achievement?.hidden === true;
      const unlockedTime = unlocked ? Date.parse(achievement.unlockedAt) : NaN;
      return Object.freeze({
        key: achievement.key,
        icon: hiddenLocked ? "?" : achievement.icon,
        name: hiddenLocked ? "?????" : achievement.name,
        description: hiddenLocked ? "?????" : achievement.description,
        unlocked,
        unlockedAt: Number.isFinite(unlockedTime) ? new Date(unlockedTime).toISOString() : null,
        dateLabel: Number.isFinite(unlockedTime)
          ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
            .format(new Date(unlockedTime))
          : null,
        statusLabel: unlocked ? "Unlocked" : "Locked",
      });
    }),
  );

  const createProgress = (achievement, snapshot) => {
    if (!achievement.unlocked && achievement.hidden) return null;
    const requirement = REQUIREMENTS[achievement.key];
    if (!requirement?.kind) return null;
    if (requirement.kind === "skill") {
      const developed = (snapshot.skills || []).some((skill) => Number(skill?.totalXP) > 0);
      return developed
        ? Object.freeze({ value: 1, target: 1, percentage: 100, label: "1 / 1 skill developed" })
        : null;
    }
    const authoritativeXP = Math.max(0, Number(snapshot.progression?.currentXP) || 0);
    const value = Math.min(authoritativeXP, requirement.target);
    return Object.freeze({
      value,
      target: requirement.target,
      percentage: Math.min(100, Math.round((value / requirement.target) * 100)),
      label: `${value.toLocaleString("en-US")} / ${requirement.target.toLocaleString("en-US")} XP`,
    });
  };

  const createCenterViewModel = (snapshot, options = {}) => {
    const achievements = Array.isArray(snapshot?.achievements) ? snapshot.achievements : [];
    const filter = ["all", "unlocked", "locked"].includes(options.filter) ? options.filter : "all";
    const cards = achievements.map((achievement, index) => {
      const unlocked = achievement?.unlocked === true;
      const hiddenLocked = !unlocked && achievement?.hidden === true;
      if (hiddenLocked) {
        return Object.freeze({
          confidential: true,
          key: null,
          icon: "?",
          name: "?????",
          description: "?????",
          category: null,
          unlocked: false,
          unlockedAt: null,
          dateLabel: null,
          statusLabel: "Hidden milestone",
          requirement: null,
          progress: null,
          displayOrder: Number(achievement.displayOrder) || index,
        });
      }

      const parsedTime = unlocked ? Date.parse(achievement.unlockedAt) : NaN;
      const requirement = REQUIREMENTS[achievement.key];
      const verifiedContext = unlocked && achievement.category === "Consistency"
        ? `Current streak: ${formatDays(Number(snapshot.streak?.currentStreak || 0))} · Longest streak: ${formatDays(Number(snapshot.streak?.longestStreak || 0))}`
        : null;
      return Object.freeze({
        confidential: false,
        key: String(achievement.key || ""),
        icon: String(achievement.icon || "◆"),
        name: String(achievement.name || "Achievement"),
        description: String(achievement.description || ""),
        category: String(achievement.category || ""),
        unlocked,
        unlockedAt: Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : null,
        dateLabel: Number.isFinite(parsedTime) ? formatDate(achievement.unlockedAt) : null,
        statusLabel: unlocked ? "Unlocked" : "Locked",
        requirement: unlocked
          ? String(achievement.description || "")
          : requirement?.label || String(achievement.description || ""),
        progress: createProgress(achievement, snapshot),
        verifiedContext,
        displayOrder: Number(achievement.displayOrder) || index,
      });
    });

    const unlockedCards = cards.filter((achievement) => achievement.unlocked)
      .sort((left, right) => Date.parse(right.unlockedAt) - Date.parse(left.unlockedAt)
        || left.displayOrder - right.displayOrder);
    const lockedCards = cards.filter((achievement) => !achievement.unlocked)
      .sort((left, right) => left.displayOrder - right.displayOrder);
    const filtered = filter === "unlocked" ? unlockedCards : filter === "locked" ? lockedCards : cards;
    const mostRecent = unlockedCards[0] || null;

    return Object.freeze({
      filter,
      empty: unlockedCards.length === 0,
      unlockedCount: unlockedCards.length,
      totalCount: cards.length,
      completionPercentage: cards.length > 0 ? Math.round((unlockedCards.length / cards.length) * 100) : 0,
      mostRecent,
      achievements: Object.freeze(filtered),
      unlocked: Object.freeze(filter === "locked" ? [] : unlockedCards),
      locked: Object.freeze(filter === "unlocked" ? [] : lockedCards),
    });
  };

  return Object.freeze({ REQUIREMENTS, createCenterViewModel, createViewModel });
})();

const KVNXVaultHistoryExperience = (() => {
  const GROUP_ORDER = Object.freeze([
    "Today",
    "Yesterday",
    "Earlier This Week",
    "Earlier This Month",
    "Older",
  ]);

  const startOfDay = (value) => {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  const getGroupLabel = (completedAt, now = new Date()) => {
    const completedDay = startOfDay(completedAt);
    const today = startOfDay(now);
    const difference = Math.round((today - completedDay) / 86400000);
    if (difference === 0) return "Today";
    if (difference === 1) return "Yesterday";

    const weekStart = new Date(today);
    const day = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
    if (completedDay >= weekStart && completedDay < today) return "Earlier This Week";
    if (completedDay.getFullYear() === today.getFullYear()
      && completedDay.getMonth() === today.getMonth()) return "Earlier This Month";
    return "Older";
  };

  const createViewModel = (entries = [], filters = {}, now = new Date()) => {
    const search = String(filters.search || "").trim().toLowerCase();
    const skill = String(filters.skill || "all");
    const category = String(filters.category || "all");
    const achievements = String(filters.achievements || "all");
    const sort = filters.sort === "oldest" ? "oldest" : "newest";

    const filtered = (Array.isArray(entries) ? entries : []).filter((entry) => {
      if (entry.status !== "completed" && entry.finalState !== "completed") return false;
      if (skill !== "all" && entry.primarySkillKey !== skill) return false;
      if (category !== "all" && entry.category !== category) return false;
      if (achievements === "earned" && !entry.achievements?.length) return false;
      if (!search) return true;
      return [entry.title, entry.category, entry.primarySkill]
        .some((value) => String(value || "").toLowerCase().includes(search));
    }).sort((left, right) => {
      const difference = Date.parse(left.completedAt || left.terminalAt)
        - Date.parse(right.completedAt || right.terminalAt);
      return sort === "oldest" ? difference : -difference;
    }).map((entry) => {
      const completedAt = entry.completedAt || entry.terminalAt;
      const timestamp = Date.parse(completedAt);
      return Object.freeze({
        ...entry,
        completedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : completedAt,
        dateLabel: Number.isFinite(timestamp)
          ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
            .format(new Date(timestamp))
          : "Date unavailable",
        timestampLabel: Number.isFinite(timestamp)
          ? new Intl.DateTimeFormat("en-US", {
            month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
          }).format(new Date(timestamp))
          : "Timestamp unavailable",
        group: getGroupLabel(completedAt, now),
        statusLabel: "Completed",
      });
    });

    const groups = GROUP_ORDER.map((label) => Object.freeze({
      label,
      entries: Object.freeze(filtered.filter((entry) => entry.group === label)),
    })).filter((group) => group.entries.length > 0);

    return Object.freeze({ entries: Object.freeze(filtered), groups: Object.freeze(groups) });
  };

  return Object.freeze({ GROUP_ORDER, createViewModel, getGroupLabel });
})();

const KVNXAnalyticsExperience = (() => {
  const PERIOD_LABELS = Object.freeze({ "7d": "7 Days", "30d": "30 Days", all: "All Time" });

  const formatDate = (date, period) => {
    const value = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(value.getTime())) return date;
    return new Intl.DateTimeFormat("en-US", period === "all"
      ? { timeZone: "UTC", month: "short", day: "numeric", year: "2-digit" }
      : { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(value);
  };

  const createSeries = (entries, valueKey, period) => {
    const values = entries.map((entry) => Number(entry[valueKey]) || 0);
    const maximum = Math.max(1, ...values);
    return Object.freeze(entries.map((entry, index) => {
      const value = values[index];
      return Object.freeze({
        date: entry.date,
        dateLabel: formatDate(entry.date, period),
        value,
        height: value === 0 ? 2 : Math.max(8, Math.round((value / maximum) * 100)),
      });
    }));
  };

  const createViewModel = (analytics) => {
    const period = analytics?.period || "7d";
    const periodLabel = PERIOD_LABELS[period] || period;
    const summary = analytics?.summary || {};
    const missionsCompleted = Number(summary.missionsCompleted) || 0;
    const activeDays = Number(summary.activeDays) || 0;
    const overallXPEarned = Number(summary.overallXPEarned) || 0;
    const mostDevelopedSkill = analytics?.mostDevelopedSkill || null;
    const skillMaximum = Math.max(1, ...(analytics?.skillActivity || [])
      .map((skill) => Number(skill.xpEarned) || 0));

    return Object.freeze({
      period,
      periodLabel,
      empty: missionsCompleted === 0,
      generatedAt: analytics?.generatedAt || null,
      missionsCompleted,
      dailyMissionsCompleted: Number(summary.dailyMissionsCompleted) || 0,
      sideMissionsCompleted: Number(summary.sideMissionsCompleted) || 0,
      overallXPEarned,
      skillXPEarned: Number(summary.skillXPEarned) || 0,
      activeDays,
      achievementsUnlocked: Number(summary.achievementsUnlocked) || 0,
      mostDevelopedSkill: mostDevelopedSkill ? Object.freeze({
        ...mostDevelopedSkill,
        xpLabel: `${Number(mostDevelopedSkill.xpEarned).toLocaleString("en-US")} XP earned`,
      }) : null,
      activeDaysLabel: period === "7d"
        ? `${activeDays} of the last 7 days`
        : period === "30d"
          ? `${activeDays} of the last 30 days`
          : `${activeDays} across all recorded history`,
      missionChartLabel: `${missionsCompleted} completed ${missionsCompleted === 1 ? "mission" : "missions"} across ${activeDays} active ${activeDays === 1 ? "day" : "days"} for ${periodLabel}.`,
      xpChartLabel: `${overallXPEarned} XP earned from completed missions for ${periodLabel}.`,
      missionActivity: createSeries(analytics?.missionActivity || [], "completedCount", period),
      xpActivity: createSeries(analytics?.xpActivity || [], "xpEarned", period),
      skillActivity: Object.freeze((analytics?.skillActivity || []).map((skill) => Object.freeze({
        ...skill,
        contribution: Math.max(0, Math.round(((Number(skill.xpEarned) || 0) / skillMaximum) * 100)),
      }))),
    });
  };

  return Object.freeze({ PERIOD_LABELS, createViewModel });
})();

// Sprint 16 Mission Center is a presentation-only projection of the immutable
// application snapshot. It never creates, selects, transitions, or rewards a
// mission; those operations remain behind Application Service and PostgreSQL.
const KVNXMissionCenterExperience = (() => {
  const STATE_LABELS = Object.freeze({
    ready: "Ready",
    active: "Active",
    completed: "Completed",
    skipped: "Skipped",
    expired: "Expired",
  });

  const formatDays = (value) => `${value} ${value === 1 ? "day" : "days"}`;

  const createViewModel = (snapshot) => {
    const mission = snapshot?.coordinator?.currentMission;
    const definition = mission?.definition;
    const lifecycle = mission?.lifecycle;
    const dailyStatus = snapshot?.coordinator?.dailyStatus;
    if (!definition || !lifecycle || !dailyStatus) {
      return Object.freeze({ available: false, recentMissions: Object.freeze([]) });
    }

    const state = String(lifecycle.state || "").toLowerCase();
    const skillKey = String(definition.primarySkill || "");
    const catalogSkill = (snapshot.skillCatalog || []).find((skill) => skill.key === skillKey);
    const progressedSkill = (snapshot.skills || []).find((skill) => skill.key === skillKey);
    const skillName = catalogSkill?.name || progressedSkill?.name || "Canonical skill unavailable";
    const replacementsRemaining = Number(dailyStatus.replacementsRemaining);
    const recentMissions = (Array.isArray(snapshot.history) ? snapshot.history : [])
      .filter((entry) => entry?.status === "completed")
      .slice(0, 5)
      .map((entry) => Object.freeze({ ...entry }));
    const dailyComplete = state === "completed" && replacementsRemaining === 0;
    const currentXP = Number(snapshot.progression?.currentXP);
    const currentStreak = Number(snapshot.streak?.currentStreak || 0);

    return Object.freeze({
      available: true,
      id: String(definition.id || ""),
      title: String(definition.title || ""),
      description: String(definition.description || ""),
      duration: String(definition.estimatedDuration || ""),
      difficulty: String(definition.difficulty || ""),
      xpReward: Number(definition.xpReward),
      skillKey,
      skillName,
      state,
      stateLabel: STATE_LABELS[state] || "Unavailable",
      canStart: lifecycle.canStart === true,
      canComplete: lifecycle.canComplete === true,
      canSkip: lifecycle.canSkip === true,
      isTerminal: lifecycle.isTerminal === true,
      canRequestReplacement: dailyStatus.canRequestReplacement === true,
      replacementsRemaining: Number.isInteger(replacementsRemaining) ? replacementsRemaining : 0,
      replacementLabel: replacementsRemaining > 0 ? "Available" : "Used",
      dailyComplete,
      currentXPLabel: Number.isFinite(currentXP) ? `${currentXP.toLocaleString("en-US")} XP` : "Unavailable",
      currentStreakLabel: formatDays(Number.isInteger(currentStreak) && currentStreak >= 0 ? currentStreak : 0),
      nextResetAt: typeof snapshot.nextResetAt === "string" ? snapshot.nextResetAt : null,
      recentMissions: Object.freeze(recentMissions),
    });
  };

  return Object.freeze({ STATE_LABELS, createViewModel });
})();

// Sprint 19 choice presentation consumes only the immutable server-returned
// option snapshot. It never constructs candidates or submits mission content.
const KVNXDailyMissionChoiceExperience = (() => {
  const createViewModel = (snapshot) => {
    const required = snapshot?.dailyChoice?.required === true;
    const options = required && Array.isArray(snapshot?.dailyChoice?.options)
      ? snapshot.dailyChoice.options
      : [];
    return Object.freeze({
      required: required && options.length > 0,
      options: Object.freeze(options.map((option) => Object.freeze({
        choiceId: String(option.choiceId || ""),
        title: String(option.title || ""),
        description: String(option.description || ""),
        estimatedDuration: String(option.estimatedDuration || ""),
        difficulty: String(option.difficulty || ""),
        xpReward: Number(option.xpReward),
        primarySkill: String(option.primarySkill || ""),
        primarySkillName: String(option.primarySkillName || ""),
      }))),
    });
  };

  return Object.freeze({ createViewModel });
})();

// Side Mission presentation consumes one immutable server-owned mission slot.
// It formats lifecycle and reward values but never decides eligibility or XP.
const KVNXSideMissionExperience = (() => {
  const STATE_LABELS = Object.freeze({
    ready: "Planned",
    active: "In Progress",
    completed: "Completed",
    expired: "Expired",
  });

  const createViewModel = (snapshot) => {
    const mission = snapshot?.sideMission;
    if (!mission?.definition || !mission?.lifecycle) {
      return Object.freeze({ available: false });
    }
    const state = String(mission.lifecycle.state || "").toLowerCase();
    return Object.freeze({
      available: true,
      id: String(mission.id || ""),
      sourceOfferId: String(mission.sourceOfferId || ""),
      title: String(mission.definition.title || ""),
      description: String(mission.definition.description || ""),
      duration: String(mission.definition.estimatedDuration || ""),
      skillKey: String(mission.definition.primarySkill || ""),
      skillName: String(mission.definition.skillName || ""),
      overallXPReward: Number(mission.definition.overallXPReward),
      skillXPReward: Number(mission.definition.skillXPReward),
      state,
      stateLabel: STATE_LABELS[state] || "Unavailable",
      canStart: state === "ready",
      canComplete: state === "active",
      rewardAwarded: mission.lifecycle.rewardAwarded === true,
    });
  };

  return Object.freeze({ STATE_LABELS, createViewModel });
})();

const KVNXProtectedContentGate = (() => {
  const create = ({ loading, content, title, message, retry } = {}) => {
    if (!loading || !content) {
      throw new TypeError("Protected loading and content elements are required.");
    }

    const reveal = () => {
      loading.hidden = true;
      loading.classList.remove("is-error");
      loading.setAttribute("role", "status");
      content.hidden = false;
    };

    const fail = () => {
      content.hidden = true;
      loading.hidden = false;
      loading.classList.add("is-error");
      loading.setAttribute("role", "alert");
      if (title) title.textContent = "We couldn't restore your Vault.";
      if (message) message.textContent = "Check your connection, then refresh the page.";
      if (retry) retry.hidden = false;
    };

    return Object.freeze({ fail, reveal });
  };

  return Object.freeze({ create });
})();

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    ...KVNXReplacementRequestController,
    dailyComplete: KVNXDailyCompleteExperience,
    skills: KVNXSkillsExperience,
    skillCenter: KVNXSkillCenterExperience,
    achievements: KVNXAchievementsExperience,
    analytics: KVNXAnalyticsExperience,
    vaultHistory: KVNXVaultHistoryExperience,
    missionCenter: KVNXMissionCenterExperience,
    dailyMissionChoice: KVNXDailyMissionChoiceExperience,
    sideMission: KVNXSideMissionExperience,
    protectedContent: KVNXProtectedContentGate,
  });
}
if (typeof window !== "undefined") {
  window.KVNXReplacementRequestController = KVNXReplacementRequestController;
  window.KVNXDailyCompleteExperience = KVNXDailyCompleteExperience;
  window.KVNXSkillsExperience = KVNXSkillsExperience;
  window.KVNXSkillCenterExperience = KVNXSkillCenterExperience;
  window.KVNXAchievementsExperience = KVNXAchievementsExperience;
  window.KVNXAnalyticsExperience = KVNXAnalyticsExperience;
  window.KVNXVaultHistoryExperience = KVNXVaultHistoryExperience;
  window.KVNXMissionCenterExperience = KVNXMissionCenterExperience;
  window.KVNXDailyMissionChoiceExperience = KVNXDailyMissionChoiceExperience;
  window.KVNXSideMissionExperience = KVNXSideMissionExperience;
  window.KVNXProtectedContentGate = KVNXProtectedContentGate;
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", async () => {
  const protectedContext = await window.KVNXProtectedPage?.ready;
  if (!protectedContext) return;

  const protectedLoading = document.querySelector("[data-protected-loading]");
  const protectedContent = document.querySelector("[data-protected-content]");
  const protectedLoadingTitle = document.querySelector("[data-protected-loading-title]");
  const protectedLoadingMessage = document.querySelector("[data-protected-loading-message]");
  const protectedLoadingRetry = document.querySelector("[data-protected-loading-retry]");
  const protectedContentGate = window.KVNXProtectedContentGate.create({
    loading: protectedLoading,
    content: protectedContent,
    title: protectedLoadingTitle,
    message: protectedLoadingMessage,
    retry: protectedLoadingRetry,
  });
  protectedLoadingRetry?.addEventListener("click", () => window.location.reload());

  const sidebar = document.querySelector("[data-sidebar]");
  const menuButton = document.querySelector("[data-sidebar-open]");
  const closeButton = document.querySelector("[data-sidebar-close]");
  const backdrop = document.querySelector("[data-sidebar-backdrop]");
  const searchForm = document.querySelector("[data-app-search]");
  const currentDate = document.querySelector("[data-current-date]");
  const dashboardHomeSections = document.querySelectorAll("[data-dashboard-home]");
  const missionsView = document.querySelector("[data-missions-view]");
  const skillsView = document.querySelector("[data-skills-view]");
  const achievementsView = document.querySelector("[data-achievements-view]");
  const vaultView = document.querySelector("[data-vault-view]");
  const analyticsView = document.querySelector("[data-analytics-view]");
  const viewLinks = document.querySelectorAll("[data-view-link]");

  const persistenceError = document.querySelector("[data-persistence-error]");
  const vaultApplication = window.KVNXApplicationService.createApplicationService({
    authService: protectedContext.authService,
    repository: protectedContext.repository,
    lifecycleEngine: window.KVNXMissionLifecycle,
    coordinatorEngine: window.KVNXMissionCoordinator,
    progressionEngine: window.KVNXProgression,
    // Sprint 8 sends only mission intent. PostgreSQL returns the authoritative
    // lifecycle, XP total, history, and daily-status snapshot for rendering.
    transitionMode: "authoritative",
  });

  let applicationSnapshot;
  try {
    const initialization = await vaultApplication.initialize();
    if (initialization.requiresOnboarding) {
      window.location.replace("onboarding.html");
      return;
    }
    applicationSnapshot = initialization.snapshot;
  } catch (error) {
    if (["session-expired", "session-unavailable"].includes(error?.code)) {
      window.location.replace("login.html");
      return;
    }
    protectedContentGate.fail();
    return;
  }

  const onboardingState = applicationSnapshot.onboarding || {};
  const profile = applicationSnapshot.profile || {};
  let coordinatorSnapshot = applicationSnapshot.coordinator;
  let firstMission = coordinatorSnapshot?.currentMission?.definition || null;
  const getInitials = (name) => name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  if (onboardingState.completed) {
    const firstName = String(profile.firstName || "").trim();
    const primaryFocus = onboardingState.primaryFocus || "Your Focus";
    const commitment = onboardingState.commitment || "30 Minutes";
    const challenge = onboardingState.challenge || "Consistency";
    const dashboardName = document.querySelector("[data-dashboard-name]");
    if (dashboardName) dashboardName.textContent = firstName ? `${firstName}.` : "Builder.";

    const profileName = document.querySelector("[data-profile-name]");
    if (profileName) profileName.textContent = firstName || "Builder";

    const profileAvatar = document.querySelector("[data-profile-avatar]");
    if (profileAvatar) profileAvatar.textContent = getInitials(firstName) || "KV";

    const profileStage = document.querySelector("[data-profile-stage]");
    if (profileStage) profileStage.textContent = onboardingState.stage || "Explorer";

    const welcomeTitle = document.querySelector("[data-welcome-title]");
    if (welcomeTitle) welcomeTitle.textContent = "Your direction is clear.";

    const welcomeDescription = document.querySelector("[data-welcome-description]");
    if (welcomeDescription) {
      welcomeDescription.textContent = `${onboardingState.intensity || "Balanced"} guidance, shaped around ${primaryFocus.toLowerCase()} and the progress you can sustain.`;
    }

    const summary = document.querySelector("[data-journey-summary]");
    if (summary) summary.hidden = false;

    const personalizedValues = {
      "[data-summary-focus]": primaryFocus,
      "[data-summary-goal]": firstMission?.title || "Choose today’s path",
      "[data-summary-challenge]": challenge,
      "[data-summary-commitment]": commitment,
    };

    Object.entries(personalizedValues).forEach(([selector, value]) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    });
  }

  const missionCard = document.querySelector("[data-mission-card]");
  const dashboardDailyChoice = document.querySelector("[data-dashboard-daily-choice]");
  const missionCenterDailyChoice = document.querySelector("[data-mission-center-daily-choice]");
  const dailyChoiceLists = document.querySelectorAll("[data-daily-choice-list]");
  const dailyChoiceErrors = document.querySelectorAll("[data-daily-choice-error]");
  const missionActions = document.querySelector("[data-mission-actions]");
  const startMissionButton = document.querySelector("[data-start-mission]");
  const completeMissionButton = document.querySelector("[data-complete-mission]");
  const skipMissionButton = document.querySelector("[data-skip-mission]");
  const missionSuccess = document.querySelector("[data-mission-success]");
  const missionStatus = document.querySelector("[data-mission-status]");
  const missionSuccessXP = document.querySelector("[data-mission-success-xp]");
  const missionOutcome = document.querySelector("[data-mission-outcome]");
  const missionOutcomeTitle = document.querySelector("[data-mission-outcome-title]");
  const missionOutcomeDescription = document.querySelector("[data-mission-outcome-description]");
  const missionReplacement = document.querySelector("[data-mission-replacement]");
  const requestMissionButton = document.querySelector("[data-request-mission]");
  const replacementNote = document.querySelector("[data-replacement-note]");
  const missionCenterLoading = document.querySelector("[data-mission-center-loading]");
  const missionCenterError = document.querySelector("[data-mission-center-error]");
  const missionCenterEmpty = document.querySelector("[data-mission-center-empty]");
  const missionCenterContent = document.querySelector("[data-mission-center-content]");
  const missionCenterRetry = document.querySelector("[data-mission-center-retry]");
  const missionCenterStatus = document.querySelector("[data-mission-center-status]");
  const missionCenterTitle = document.querySelector("[data-mission-center-title]");
  const missionCenterDescription = document.querySelector("[data-mission-center-description]");
  const missionCenterDuration = document.querySelector("[data-mission-center-duration]");
  const missionCenterDifficulty = document.querySelector("[data-mission-center-difficulty]");
  const missionCenterReward = document.querySelector("[data-mission-center-reward]");
  const missionCenterSkill = document.querySelector("[data-mission-center-skill]");
  const missionCenterActions = document.querySelector("[data-mission-center-actions]");
  const missionCenterStart = document.querySelector("[data-mission-center-start]");
  const missionCenterComplete = document.querySelector("[data-mission-center-complete]");
  const missionCenterSkip = document.querySelector("[data-mission-center-skip]");
  const missionCenterReplacement = document.querySelector("[data-mission-center-replacement]");
  const missionCenterRequest = document.querySelector("[data-mission-center-request]");
  const missionCenterDailyComplete = document.querySelector("[data-mission-center-daily-complete]");
  const missionCenterCurrentXP = document.querySelector("[data-mission-center-current-xp]");
  const missionCenterCurrentStreak = document.querySelector("[data-mission-center-current-streak]");
  const missionCenterPrimaryStatus = document.querySelector("[data-mission-center-primary-status]");
  const missionCenterReplacementStatus = document.querySelector("[data-mission-center-replacement-status]");
  const missionCenterReset = document.querySelector("[data-mission-center-reset]");
  const missionCenterRecent = document.querySelector("[data-mission-center-recent]");
  const missionCenterRecentEmpty = document.querySelector("[data-mission-center-recent-empty]");
  const missionCenterSide = document.querySelector("[data-mission-center-side]");
  const missionCenterSideTitle = document.querySelector("[data-mission-center-side-title]");
  const missionCenterSideState = document.querySelector("[data-mission-center-side-state]");
  const missionCenterSideDescription = document.querySelector("[data-mission-center-side-description]");
  const missionCenterSideSkill = document.querySelector("[data-mission-center-side-skill]");
  const missionCenterSideDuration = document.querySelector("[data-mission-center-side-duration]");
  const missionCenterSideReward = document.querySelector("[data-mission-center-side-reward]");
  const dailyComplete = document.querySelector("[data-daily-complete]");
  const dailyCompleteXP = document.querySelector("[data-daily-complete-xp]");
  const dailyCompleteResetLabel = document.querySelector("[data-daily-complete-reset-label]");
  const dailyCompleteResetValue = document.querySelector("[data-daily-complete-reset-value]");
  const dailyCompleteResetAnnouncement = document.querySelector("[data-daily-complete-reset-announcement]");
  const xpValue = document.querySelector("[data-xp-value]");
  const xpProgress = document.querySelector("[data-xp-progress]");
  const xpProgressFill = document.querySelector("[data-xp-progress-fill]");
  const xpPercent = document.querySelector("[data-xp-percent]");
  const xpRemaining = document.querySelector("[data-xp-remaining]");
  const progressionLevel = document.querySelector("[data-progression-level]");
  const progressionCurrentLevel = document.querySelector("[data-progression-current-level]");
  const progressionNextLevel = document.querySelector("[data-progression-next-level]");
  const skillList = document.querySelector("[data-skill-list]");
  const skillsCount = document.querySelector("[data-skills-count]");
  const skillsEmpty = document.querySelector("[data-skills-empty]");
  const skillCenterContent = document.querySelector("[data-skill-center-content]");
  const skillCenterError = document.querySelector("[data-skill-center-error]");
  const skillCenterActive = document.querySelector("[data-skill-center-active]");
  const skillCenterTotalXP = document.querySelector("[data-skill-center-total-xp]");
  const skillCenterHighest = document.querySelector("[data-skill-center-highest]");
  const skillCenterHighestContext = document.querySelector("[data-skill-center-highest-context]");
  const skillCenterRecent = document.querySelector("[data-skill-center-recent]");
  const skillCenterRecentContext = document.querySelector("[data-skill-center-recent-context]");
  const skillCenterFilterButtons = document.querySelectorAll("[data-skill-filter]");
  const skillCenterSort = document.querySelector("[data-skill-sort]");
  const skillCenterEmpty = document.querySelector("[data-skill-center-empty]");
  const skillCenterResults = document.querySelector("[data-skill-center-results]");
  const skillCenterGroups = document.querySelector("[data-skill-center-groups]");
  const skillPathStatus = document.querySelector("[data-skill-path-status]");
  const skillPathOffersPanel = document.querySelector("[data-skill-path-offers-panel]");
  const skillPathOffersTitle = document.querySelector("[data-skill-path-offers-title]");
  const skillPathOffersList = document.querySelector("[data-skill-path-offers-list]");
  const skillPathOffersEmpty = document.querySelector("[data-skill-path-offers-empty]");
  const skillPathOffersStatus = document.querySelector("[data-skill-path-offers-status]");
  const skillPathOffersClose = document.querySelector("[data-skill-path-offers-close]");
  const skillSideMission = document.querySelector("[data-skill-side-mission]");
  const skillSideMissionTitle = document.querySelector("[data-skill-side-mission-title]");
  const skillSideMissionState = document.querySelector("[data-skill-side-mission-state]");
  const skillSideMissionDescription = document.querySelector("[data-skill-side-mission-description]");
  const skillSideMissionSkill = document.querySelector("[data-skill-side-mission-skill]");
  const skillSideMissionDuration = document.querySelector("[data-skill-side-mission-duration]");
  const skillSideMissionReward = document.querySelector("[data-skill-side-mission-reward]");
  const sideMissionStatus = document.querySelector("[data-side-mission-status]");
  const sideMissionStartButtons = document.querySelectorAll("[data-side-mission-start]");
  const sideMissionCompleteButtons = document.querySelectorAll("[data-side-mission-complete]");
  const achievementList = document.querySelector("[data-achievement-list]");
  const achievementsCount = document.querySelector("[data-achievements-count]");
  const achievementCenterContent = document.querySelector("[data-achievement-center-content]");
  const achievementCenterError = document.querySelector("[data-achievement-center-error]");
  const achievementCenterUnlocked = document.querySelector("[data-achievement-center-unlocked]");
  const achievementCenterTotal = document.querySelector("[data-achievement-center-total]");
  const achievementCenterCompletion = document.querySelector("[data-achievement-center-completion]");
  const achievementCenterRecent = document.querySelector("[data-achievement-center-recent]");
  const achievementCenterRecentDate = document.querySelector("[data-achievement-center-recent-date]");
  const achievementCenterRecentEmpty = document.querySelector("[data-achievement-center-recent-empty]");
  const achievementCenterFilterButtons = document.querySelectorAll("[data-achievement-filter]");
  const achievementCenterEmpty = document.querySelector("[data-achievement-center-empty]");
  const achievementCenterResults = document.querySelector("[data-achievement-center-results]");
  const achievementCenterGroups = document.querySelector("[data-achievement-center-groups]");
  const achievementUnlock = document.querySelector("[data-achievement-unlock]");
  const achievementUnlockList = document.querySelector("[data-achievement-unlock-list]");
  const vaultHistory = document.querySelector("[data-vault-history]");
  const vaultCount = document.querySelector("[data-vault-count]");
  const vaultEmpty = document.querySelector("[data-vault-empty]");
  const vaultResultsStatus = document.querySelector("[data-vault-results-status]");
  const vaultSearch = document.querySelector("[data-vault-search]");
  const vaultAchievementsFilter = document.querySelector("[data-vault-achievements-filter]");
  const vaultSkillFilter = document.querySelector("[data-vault-skill-filter]");
  const vaultCategoryFilter = document.querySelector("[data-vault-category-filter]");
  const vaultSort = document.querySelector("[data-vault-sort]");
  const vaultLoadMore = document.querySelector("[data-vault-load-more]");
  const openVaultButton = document.querySelector("[data-open-vault]");
  const currentStreak = document.querySelector("[data-current-streak]");
  const longestStreak = document.querySelector("[data-longest-streak]");
  const streakLastDay = document.querySelector("[data-streak-last-day]");
  const streakGuidance = document.querySelector("[data-streak-guidance]");
  const analyticsPeriodButtons = document.querySelectorAll("[data-analytics-period]");
  const analyticsLoading = document.querySelector("[data-analytics-loading]");
  const analyticsError = document.querySelector("[data-analytics-error]");
  const analyticsRetry = document.querySelector("[data-analytics-retry]");
  const analyticsEmpty = document.querySelector("[data-analytics-empty]");
  const analyticsContent = document.querySelector("[data-analytics-content]");
  const analyticsGenerated = document.querySelector("[data-analytics-generated]");
  const analyticsMissions = document.querySelector("[data-analytics-missions]");
  const analyticsSideMissions = document.querySelector("[data-analytics-side-missions]");
  const analyticsXP = document.querySelector("[data-analytics-xp]");
  const analyticsSkillXP = document.querySelector("[data-analytics-skill-xp]");
  const analyticsTopSkill = document.querySelector("[data-analytics-top-skill]");
  const analyticsTopSkillXP = document.querySelector("[data-analytics-top-skill-xp]");
  const analyticsPeriodLabel = document.querySelector("[data-analytics-period-label]");
  const analyticsActiveDays = document.querySelector("[data-analytics-active-days]");
  const analyticsActiveValue = document.querySelector("[data-analytics-active-value]");
  const analyticsActiveCopy = document.querySelector("[data-analytics-active-copy]");
  const analyticsAchievements = document.querySelector("[data-analytics-achievements]");
  const analyticsCurrentStreak = document.querySelector("[data-analytics-current-streak]");
  const analyticsLongestStreak = document.querySelector("[data-analytics-longest-streak]");
  const analyticsXPTotal = document.querySelector("[data-analytics-xp-total]");
  const analyticsMissionChart = document.querySelector("[data-analytics-mission-chart]");
  const analyticsXPChart = document.querySelector("[data-analytics-xp-chart]");
  const analyticsMissionTableBody = document.querySelector("[data-analytics-mission-table] tbody");
  const analyticsXPTableBody = document.querySelector("[data-analytics-xp-table] tbody");
  const analyticsSkills = document.querySelector("[data-analytics-skills]");
  const analyticsSkillsEmpty = document.querySelector("[data-analytics-skills-empty]");
  const levelUpNotice = document.querySelector("[data-level-up]");
  const levelUpValue = document.querySelector("[data-level-up-value]");
  const progressAward = document.querySelector("[data-progress-award]");
  const progressAwardOverall = document.querySelector("[data-progress-award-overall]");
  const progressAwardSkill = document.querySelector("[data-progress-award-skill]");
  const logoutButton = document.querySelector("[data-logout]");
  let progressionSnapshot = applicationSnapshot.progression;
  let nextResetAt = applicationSnapshot.nextResetAt;
  let countdownResetAt = null;
  let countdownController = null;
  let missionCenterCountdownController = null;
  let missionCenterCountdownResetAt = null;
  let progressAwardTimer = null;
  let achievementUnlockTimer = null;
  let vaultEntries = applicationSnapshot.history || [];
  let vaultPagination = applicationSnapshot.historyPagination || Object.freeze({ hasMore: false });
  let analyticsPeriod = "7d";
  let analyticsLoadedPeriod = applicationSnapshot.analytics?.period || null;
  let analyticsInFlight = false;
  let completionInFlight = false;
  let skillCenterFilter = "all";
  let achievementCenterFilter = "all";

  const showPersistenceFailure = (error) => {
    if (["session-expired", "session-unavailable"].includes(error?.code)) {
      window.location.replace("login.html");
      return;
    }
    if (persistenceError) {
      persistenceError.hidden = false;
      persistenceError.textContent = "Your latest change couldn't be saved. Refresh to restore the last durable state before continuing.";
      persistenceError.focus();
    }
    [startMissionButton, completeMissionButton, skipMissionButton, requestMissionButton,
      missionCenterStart, missionCenterComplete, missionCenterSkip, missionCenterRequest]
      .forEach((button) => { if (button) button.disabled = true; });
    document.querySelectorAll("[data-daily-choice-select]")
      .forEach((button) => { button.disabled = true; });
  };

  const formatStreakDays = (value) => `${value} ${value === 1 ? "day" : "days"}`;

  // Streak values are formatted only. Logical-day and consecutive-day rules
  // remain entirely inside PostgreSQL.
  const renderStreak = (snapshot) => {
    const value = snapshot || { currentStreak: 0, longestStreak: 0, lastCompletedDailyKey: null };
    if (currentStreak) {
      currentStreak.textContent = value.currentStreak > 0
        ? `${formatStreakDays(value.currentStreak)} strong`
        : "No active streak yet";
    }
    if (longestStreak) longestStreak.textContent = formatStreakDays(value.longestStreak);
    if (streakGuidance) {
      streakGuidance.textContent = value.currentStreak > 0
        ? "Keep moving. One verified day at a time."
        : "Complete today's mission to begin building consistency.";
    }
    if (streakLastDay) {
      const timestamp = value.lastCompletedDailyKey
        ? Date.parse(`${value.lastCompletedDailyKey}T00:00:00.000Z`)
        : NaN;
      streakLastDay.textContent = Number.isFinite(timestamp)
        ? new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
        }).format(new Date(timestamp))
        : "Not started";
    }
  };

  // Mission content is rendered only from the coordinator's public snapshot.
  const renderMissionDefinition = (definition) => {
    if (!definition) return;
    firstMission = definition;

    const missionValues = {
      "[data-mission-title]": definition.title,
      "[data-mission-description]": definition.description,
      "[data-mission-duration]": definition.estimatedDuration,
      "[data-mission-difficulty]": definition.difficulty,
      "[data-mission-xp]": definition.xpReward,
    };

    Object.entries(missionValues).forEach(([selector, value]) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    });

    if (missionSuccessXP) missionSuccessXP.textContent = `+${definition.xpReward} XP`;
  };

  // The renderer accepts only a progression snapshot and performs no XP math.
  const renderProgression = (snapshot) => {
    if (!snapshot) return;
    progressionSnapshot = snapshot;

    if (progressionLevel) progressionLevel.textContent = `Level ${snapshot.currentLevel}`;
    if (progressionCurrentLevel) progressionCurrentLevel.textContent = String(snapshot.currentLevel);
    if (progressionNextLevel) {
      progressionNextLevel.textContent = snapshot.isMaxLevel
        ? "Current maximum"
        : `${snapshot.xpForNextLevel.toLocaleString("en-US")} XP`;
    }
    if (xpValue) xpValue.textContent = snapshot.currentXP.toLocaleString("en-US");
    if (xpProgress) {
      xpProgress.setAttribute("aria-valuenow", String(snapshot.progressPercentage));
      xpProgress.setAttribute(
        "aria-label",
        snapshot.isMaxLevel ? "Maximum prototype level reached" : `Progress toward Level ${snapshot.nextLevel}`,
      );
    }
    if (xpProgressFill) xpProgressFill.style.width = `${snapshot.progressPercentage}%`;
    if (xpPercent) xpPercent.textContent = `${snapshot.progressPercentage}% complete`;
    if (xpRemaining) {
      xpRemaining.textContent = snapshot.isMaxLevel
        ? "Prototype maximum reached"
        : `${snapshot.xpRemaining.toLocaleString("en-US")} XP remaining`;
    }

    renderDailyComplete(coordinatorSnapshot, snapshot);
  };

  // Skill totals and derived level snapshots arrive through the application
  // service. This renderer only formats the immutable authoritative data.
  const renderSkills = (skills) => {
    if (!skillList) return;
    const viewModel = KVNXSkillsExperience.createViewModel(skills);
    skillList.replaceChildren();
    if (skillsCount) skillsCount.textContent = `${viewModel.length} active`;
    if (skillsEmpty) skillsEmpty.hidden = viewModel.length > 0;

    viewModel.slice(0, 3).forEach((skill) => {
      const item = document.createElement("li");
      item.className = "skill-item";

      const icon = document.createElement("span");
      icon.className = "skill-item__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = skill.initials;

      const copy = document.createElement("span");
      copy.className = "skill-item__copy";
      const name = document.createElement("strong");
      name.textContent = skill.name;
      const details = document.createElement("span");
      details.textContent = `${skill.totalXPLabel} · ${skill.todayGainLabel}`;
      const progress = document.createElement("span");
      progress.className = "skill-item__progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", `${skill.name}, ${skill.levelText}, ${skill.progressPercentage}% toward the next level`);
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(skill.progressPercentage));
      const fill = document.createElement("i");
      fill.style.width = `${skill.progressPercentage}%`;
      progress.append(fill);
      copy.append(name, details, progress);

      const level = document.createElement("span");
      level.className = "skill-item__level";
      level.textContent = skill.levelLabel;
      level.setAttribute("aria-label", skill.levelText);
      item.append(icon, copy, level);
      skillList.append(item);
    });
  };

  const renderSkillCenter = (snapshot) => {
    if (!skillsView || !skillCenterGroups) return;
    try {
      const viewModel = KVNXSkillCenterExperience.createViewModel(snapshot, window.KVNXProgression, {
        filter: skillCenterFilter,
        sort: skillCenterSort?.value,
      });
      if (skillCenterError) skillCenterError.hidden = true;
      if (skillCenterContent) skillCenterContent.hidden = false;
      if (skillCenterActive) skillCenterActive.textContent = viewModel.activeCount.toLocaleString("en-US");
      if (skillCenterTotalXP) skillCenterTotalXP.textContent = `${viewModel.totalSkillXP.toLocaleString("en-US")} XP`;
      if (skillCenterHighest) skillCenterHighest.textContent = viewModel.highestSkill?.name || "Not established";
      if (skillCenterHighestContext) {
        skillCenterHighestContext.textContent = viewModel.highestSkill
          ? `${viewModel.highestSkill.totalXP.toLocaleString("en-US")} XP · Level ${viewModel.highestSkill.level}`
          : "No mastery recorded";
      }
      if (skillCenterRecent) skillCenterRecent.textContent = viewModel.recentlyDeveloped?.name || "Not established";
      if (skillCenterRecentContext) {
        skillCenterRecentContext.textContent = viewModel.recentlyDeveloped
          ? "Latest attributed Vault completion"
          : "No verified gain yet";
      }
      if (skillCenterEmpty) skillCenterEmpty.hidden = !viewModel.empty;
      if (skillCenterResults) {
        skillCenterResults.textContent = `${viewModel.skills.length} ${viewModel.skills.length === 1 ? "skill" : "skills"} shown`;
      }
      skillCenterFilterButtons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.skillFilter === viewModel.filter));
      });

      skillCenterGroups.replaceChildren();
      const renderGroup = (titleText, skills, stateClass) => {
        if (skills.length === 0) return;
        const section = document.createElement("section");
        section.className = `skill-center__group ${stateClass}`;
        const heading = document.createElement("div");
        heading.className = "skill-center__group-heading";
        const title = document.createElement("h2");
        title.textContent = titleText;
        const count = document.createElement("span");
        count.textContent = `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`;
        heading.append(title, count);
        const grid = document.createElement("div");
        grid.className = "skill-center__grid";

        skills.forEach((skill) => {
          const card = document.createElement(skill.expandable ? "details" : "article");
          card.className = `skill-center__card app-card ${skill.active ? "is-active" : "is-not-started"}`;
          const heading = document.createElement(skill.expandable ? "summary" : "div");
          heading.className = skill.expandable ? "skill-center__summary" : "skill-center__static";
          const headingCopy = document.createElement("span");
          headingCopy.className = "skill-center__card-heading";
          const name = document.createElement("strong");
          name.textContent = skill.name;
          const state = document.createElement("span");
          state.className = "skill-center__state";
          state.textContent = skill.stateLabel;
          headingCopy.append(name, state);
          if (skill.developmentPathActive) {
            const pathState = document.createElement("span");
            pathState.className = "skill-center__path-state";
            pathState.textContent = skill.pathStateLabel;
            headingCopy.append(pathState);
          }

          const pathControl = document.createElement("div");
          pathControl.className = "skill-center__path-control";
          if (skill.developmentPathActive) {
            const exploreButton = document.createElement("button");
            exploreButton.type = "button";
            exploreButton.className = "skill-center__path-action";
            exploreButton.dataset.skillPathKey = skill.key;
            exploreButton.dataset.skillPathAction = "explore";
            exploreButton.textContent = "Explore Missions";
            exploreButton.setAttribute("aria-label", `Explore authoritative ${skill.name} mission offers`);
            pathControl.append(exploreButton);
          }
          const pathButton = document.createElement("button");
          pathButton.type = "button";
          pathButton.className = `skill-center__path-action${skill.developmentPathActive ? " is-secondary" : ""}`;
          pathButton.dataset.skillPathKey = skill.key;
          pathButton.dataset.skillPathAction = skill.developmentPathActive ? "deactivate" : "activate";
          pathButton.textContent = skill.developmentPathActive ? "Pause Path" : "Activate Path";
          pathButton.setAttribute("aria-label", `${pathButton.textContent} for ${skill.name}`);
          pathControl.append(pathButton);

          if (!skill.expandable) {
            const total = document.createElement("span");
            total.className = "skill-center__static-value";
            total.textContent = `${skill.totalXP.toLocaleString("en-US")} XP`;
            heading.append(headingCopy, total);
            card.append(heading);
            card.append(pathControl);
            grid.append(card);
            return;
          }

          heading.setAttribute("aria-label", `${skill.name}, ${skill.stateLabel}, Level ${skill.level}, ${skill.totalXP} XP. Open skill details.`);
          const level = document.createElement("span");
          level.className = "skill-center__level";
          const levelLabel = document.createElement("small");
          levelLabel.textContent = "Level";
          level.append(levelLabel, document.createTextNode(String(skill.level)));
          heading.append(headingCopy, level);

          const overview = document.createElement("div");
          overview.className = "skill-center__overview";
          const total = document.createElement("strong");
          total.textContent = `${skill.totalXP.toLocaleString("en-US")} XP`;
          const progressCopy = document.createElement("span");
          progressCopy.textContent = skill.isMaxLevel
            ? "Current maximum level"
            : `${skill.currentLevelXP.toLocaleString("en-US")} / ${skill.currentLevelTarget.toLocaleString("en-US")} XP toward Level ${skill.nextLevel}`;
          const progress = document.createElement("span");
          progress.className = "skill-center__progress";
          progress.setAttribute("role", "progressbar");
          progress.setAttribute("aria-label", skill.isMaxLevel
            ? `${skill.name} has reached the current maximum level`
            : `${skill.name}: ${skill.progressPercentage}% toward Level ${skill.nextLevel}; ${skill.xpRemaining} XP remaining`);
          progress.setAttribute("aria-valuemin", "0");
          progress.setAttribute("aria-valuemax", "100");
          progress.setAttribute("aria-valuenow", String(skill.progressPercentage));
          const fill = document.createElement("i");
          fill.style.width = `${skill.progressPercentage}%`;
          progress.append(fill);
          const remaining = document.createElement("span");
          remaining.className = "skill-center__remaining";
          remaining.textContent = skill.isMaxLevel
            ? "No next threshold in the current progression configuration"
            : `${skill.xpRemaining.toLocaleString("en-US")} XP remaining`;
          overview.append(total, progressCopy, progress, remaining);

          const detail = document.createElement("div");
          detail.className = "skill-center__detail";
          const detailHeading = document.createElement("h3");
          detailHeading.textContent = "Recent verified gains";
          const gains = document.createElement("ol");
          gains.className = "skill-center__gains";
          skill.recentGains.forEach((gain) => {
            const item = document.createElement("li");
            const date = document.createElement("time");
            date.dateTime = gain.completedAt;
            date.textContent = gain.dateLabel;
            const mission = document.createElement("strong");
            mission.textContent = gain.title;
            const award = document.createElement("span");
            award.textContent = `+${gain.skillXPEarned.toLocaleString("en-US")} XP`;
            item.append(date, mission, award);
            gains.append(item);
          });
          const noGains = document.createElement("p");
          noGains.className = "skill-center__no-gains";
          noGains.hidden = skill.recentGains.length > 0;
          noGains.textContent = "No attributed gains appear in the restored recent Vault window. Lifetime XP remains authoritative.";
          const vaultLink = document.createElement("a");
          vaultLink.className = "skill-center__vault-link";
          vaultLink.href = "#vault";
          vaultLink.textContent = "View in Vault →";
          detail.append(detailHeading, gains, noGains, vaultLink);
          card.append(heading, overview, detail, pathControl);
          grid.append(card);
        });
        section.append(heading, grid);
        skillCenterGroups.append(section);
      };

      renderGroup("Skills with Progress", viewModel.activeSkills, "is-active");
      renderGroup("Not Started", viewModel.notStartedSkills, "is-not-started");
    } catch {
      if (skillCenterContent) skillCenterContent.hidden = true;
      if (skillCenterError) skillCenterError.hidden = false;
    }
  };

  const renderSkillPathOffers = (state) => {
    if (!skillPathOffersPanel || !skillPathOffersList || !state?.skillKey) return;
    skillPathOffersPanel.dataset.skillPathOffersSkill = state.skillKey;
    if (skillPathOffersTitle) skillPathOffersTitle.textContent = `Develop ${state.skillName}`;
    skillPathOffersList.replaceChildren();
    const offers = Array.isArray(state.offers) ? state.offers : [];
    offers.forEach((offer) => {
      const card = document.createElement("article");
      card.className = "skill-path-offers__option";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = offer.title;
      const description = document.createElement("p");
      description.textContent = offer.description;
      const meta = document.createElement("span");
      meta.textContent = `${offer.estimatedDuration} · ${offer.skillName}`;
      copy.append(title, description, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "app-button skill-path-offers__select";
      button.dataset.skillPathOfferSelect = offer.offerId;
      const selected = state.selectedOfferId === offer.offerId;
      const currentSideMission = applicationSnapshot?.sideMission;
      const isCurrentSideMission = currentSideMission?.sourceOfferId === offer.offerId;
      const canPromote = selected && state.status === "planned"
        && !currentSideMission && applicationSnapshot?.sideMissionCapacity?.slotAvailable === true;
      if (canPromote) {
        delete button.dataset.skillPathOfferSelect;
        button.dataset.skillPathOfferPromote = offer.offerId;
        button.textContent = "Make Side Mission";
        button.disabled = false;
        button.setAttribute("aria-label", `Make ${offer.title} today’s Side Mission`);
      } else {
        button.textContent = isCurrentSideMission ? "Side Mission" : selected ? "Planned" : "Select Practice";
        button.disabled = state.status === "planned";
        button.setAttribute("aria-label", `${selected ? "Planned practice" : "Select practice"}: ${offer.title}`);
      }
      card.classList.toggle("is-selected", selected);
      card.append(copy, button);
      skillPathOffersList.append(card);
    });
    if (skillPathOffersEmpty) skillPathOffersEmpty.hidden = offers.length > 0;
    if (skillPathOffersStatus) {
      skillPathOffersStatus.textContent = state.status === "planned"
        ? "Practice selected and preserved as planned work. No progression has been awarded."
        : offers.length > 0 ? `${offers.length} server-approved ${offers.length === 1 ? "practice" : "practices"}.` : "";
    }
    skillPathOffersPanel.hidden = false;
    skillPathOffersPanel.scrollIntoView?.({ block: "nearest" });
  };

  const renderSideMission = (snapshot) => {
    const viewModel = KVNXSideMissionExperience.createViewModel(snapshot);
    [skillSideMission, missionCenterSide].forEach((panel) => {
      if (panel) panel.hidden = !viewModel.available;
    });
    if (!viewModel.available) return;
    [skillSideMissionTitle, missionCenterSideTitle].forEach((element) => {
      if (element) element.textContent = viewModel.title;
    });
    [skillSideMissionState, missionCenterSideState].forEach((element) => {
      if (element) {
        element.textContent = viewModel.stateLabel;
        element.dataset.state = viewModel.state;
      }
    });
    [skillSideMissionDescription, missionCenterSideDescription].forEach((element) => {
      if (element) element.textContent = viewModel.description;
    });
    [skillSideMissionSkill, missionCenterSideSkill].forEach((element) => {
      if (element) element.textContent = viewModel.skillName;
    });
    [skillSideMissionDuration, missionCenterSideDuration].forEach((element) => {
      if (element) element.textContent = viewModel.duration;
    });
    const reward = `+${viewModel.overallXPReward} XP · +${viewModel.skillXPReward} ${viewModel.skillName} XP`;
    [skillSideMissionReward, missionCenterSideReward].forEach((element) => {
      if (element) element.textContent = reward;
    });
    sideMissionStartButtons.forEach((button) => { button.hidden = !viewModel.canStart; });
    sideMissionCompleteButtons.forEach((button) => { button.hidden = !viewModel.canComplete; });
    if (sideMissionStatus) {
      sideMissionStatus.textContent = viewModel.state === "completed"
        ? `${reward} secured. This does not change Daily Complete or the daily streak.`
        : viewModel.state === "expired"
          ? "This Side Mission belongs to an earlier Vault day and can no longer earn a reward."
          : "One rewarded Side Mission is available per Vault day.";
    }
  };

  const renderAchievements = (snapshot) => {
    if (!achievementsView || !achievementCenterGroups) return;
    try {
      const viewModel = KVNXAchievementsExperience.createCenterViewModel(snapshot, {
        filter: achievementCenterFilter,
      });
      if (achievementCenterError) achievementCenterError.hidden = true;
      if (achievementCenterContent) achievementCenterContent.hidden = false;
      if (achievementCenterUnlocked) achievementCenterUnlocked.textContent = viewModel.unlockedCount.toLocaleString("en-US");
      if (achievementCenterTotal) achievementCenterTotal.textContent = viewModel.totalCount.toLocaleString("en-US");
      if (achievementCenterCompletion) achievementCenterCompletion.textContent = `${viewModel.completionPercentage}%`;
      if (achievementCenterRecent) achievementCenterRecent.textContent = viewModel.mostRecent?.name || "Not established";
      if (achievementCenterRecentDate) {
        achievementCenterRecentDate.hidden = !viewModel.mostRecent?.unlockedAt;
        achievementCenterRecentDate.dateTime = viewModel.mostRecent?.unlockedAt || "";
        achievementCenterRecentDate.textContent = viewModel.mostRecent?.dateLabel
          ? `Unlocked ${viewModel.mostRecent.dateLabel}`
          : "";
      }
      if (achievementCenterRecentEmpty) achievementCenterRecentEmpty.hidden = Boolean(viewModel.mostRecent);
      if (achievementCenterEmpty) achievementCenterEmpty.hidden = !viewModel.empty;
      if (achievementCenterResults) {
        achievementCenterResults.textContent = `${viewModel.achievements.length} ${viewModel.achievements.length === 1 ? "achievement" : "achievements"} shown`;
      }
      achievementCenterFilterButtons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.achievementFilter === viewModel.filter));
      });

      const renderCard = (achievement) => {
        const item = document.createElement("li");
        item.className = `achievement-card ${achievement.unlocked ? "is-unlocked" : "is-locked"}${achievement.confidential ? " is-confidential" : ""}`;
        const top = document.createElement("div");
        top.className = "achievement-card__top";
        const icon = document.createElement("span");
        icon.className = "achievement-card__icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = achievement.icon;
        const status = document.createElement("span");
        status.className = "achievement-card__status";
        status.textContent = achievement.statusLabel;
        top.append(icon, status);

        const name = document.createElement("h3");
        name.textContent = achievement.name;
        const description = document.createElement("p");
        description.className = "achievement-card__description";
        description.textContent = achievement.description;
        item.append(top, name, description);

        if (achievement.unlockedAt) {
          const unlockedAt = document.createElement("time");
          unlockedAt.className = "achievement-card__date";
          unlockedAt.dateTime = achievement.unlockedAt;
          unlockedAt.textContent = `Unlocked ${achievement.dateLabel}`;
          item.append(unlockedAt);
        }
        if (achievement.requirement) {
          const requirement = document.createElement("p");
          requirement.className = "achievement-card__requirement";
          const label = document.createElement("span");
          label.textContent = achievement.unlocked ? "Milestone" : "Requirement";
          const copy = document.createElement("strong");
          copy.textContent = achievement.requirement;
          requirement.append(label, copy);
          item.append(requirement);
        }
        if (achievement.progress) {
          const progressBlock = document.createElement("div");
          progressBlock.className = "achievement-card__progress-block";
          const progressLabel = document.createElement("span");
          progressLabel.textContent = achievement.progress.label;
          const progress = document.createElement("span");
          progress.className = "achievement-card__progress";
          progress.setAttribute("role", "progressbar");
          progress.setAttribute("aria-label", `${achievement.name}: ${achievement.progress.label}`);
          progress.setAttribute("aria-valuemin", "0");
          progress.setAttribute("aria-valuemax", String(achievement.progress.target));
          progress.setAttribute("aria-valuenow", String(achievement.progress.value));
          const fill = document.createElement("i");
          fill.style.width = `${achievement.progress.percentage}%`;
          progress.append(fill);
          progressBlock.append(progressLabel, progress);
          item.append(progressBlock);
        }
        if (achievement.verifiedContext) {
          const context = document.createElement("p");
          context.className = "achievement-card__verified-context";
          const label = document.createElement("span");
          label.textContent = "Authoritative context";
          const copy = document.createElement("strong");
          copy.textContent = achievement.verifiedContext;
          context.append(label, copy);
          item.append(context);
        }
        return item;
      };

      achievementCenterGroups.replaceChildren();
      const renderGroup = (titleText, achievements, stateClass) => {
        if (achievements.length === 0) return;
        const section = document.createElement("section");
        section.className = `achievement-center__group ${stateClass}`;
        const heading = document.createElement("div");
        heading.className = "achievement-center__group-heading";
        const title = document.createElement("h2");
        title.textContent = titleText;
        const count = document.createElement("span");
        count.textContent = `${achievements.length} ${achievements.length === 1 ? "milestone" : "milestones"}`;
        heading.append(title, count);
        const list = document.createElement("ul");
        list.className = "achievement-grid";
        achievements.forEach((achievement) => list.append(renderCard(achievement)));
        section.append(heading, list);
        achievementCenterGroups.append(section);
      };
      renderGroup("Unlocked", viewModel.unlocked, "is-unlocked");
      renderGroup("Locked", viewModel.locked, "is-locked");
    } catch {
      if (achievementCenterContent) achievementCenterContent.hidden = true;
      if (achievementCenterError) achievementCenterError.hidden = false;
    }
  };

  const replaceFilterOptions = (select, values, label) => {
    if (!select) return;
    const selected = select.value;
    const first = document.createElement("option");
    first.value = "all";
    first.textContent = `All ${label}`;
    select.replaceChildren(first);
    values.forEach(({ value, text }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  };

  const renderVaultFilters = () => {
    const skills = new Map();
    const categories = new Set();
    vaultEntries.forEach((entry) => {
      if (entry.primarySkillKey && entry.primarySkill) skills.set(entry.primarySkillKey, entry.primarySkill);
      if (entry.category) categories.add(entry.category);
    });
    replaceFilterOptions(
      vaultSkillFilter,
      [...skills].sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, text]) => ({ value, text })),
      "skills",
    );
    replaceFilterOptions(
      vaultCategoryFilter,
      [...categories].sort().map((value) => ({ value, text: value })),
      "categories",
    );
  };

  const createVaultDetail = (term, value) => {
    const wrapper = document.createElement("div");
    const name = document.createElement("dt");
    const detail = document.createElement("dd");
    name.textContent = term;
    detail.textContent = value;
    wrapper.append(name, detail);
    return wrapper;
  };

  const renderVault = () => {
    if (!vaultHistory) return;
    renderVaultFilters();
    const viewModel = KVNXVaultHistoryExperience.createViewModel(vaultEntries, {
      search: vaultSearch?.value,
      achievements: vaultAchievementsFilter?.value,
      skill: vaultSkillFilter?.value,
      category: vaultCategoryFilter?.value,
      sort: vaultSort?.value,
    });
    vaultHistory.replaceChildren();
    if (vaultCount) vaultCount.textContent = `${vaultEntries.length} completed`;
    if (vaultEmpty) vaultEmpty.hidden = viewModel.entries.length > 0;
    if (vaultResultsStatus) {
      vaultResultsStatus.textContent = viewModel.entries.length === vaultEntries.length
        ? ""
        : `${viewModel.entries.length} matching ${viewModel.entries.length === 1 ? "entry" : "entries"}`;
    }

    viewModel.groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "vault-history__group";
      const heading = document.createElement("h2");
      heading.textContent = group.label;
      const list = document.createElement("ol");
      list.className = "vault-history__list";

      group.entries.forEach((entry) => {
        const item = document.createElement("li");
        item.className = "vault-entry app-card";
        const detailId = `vault-entry-${entry.historyId || entry.missionId}`.replace(/[^A-Za-z0-9_-]/g, "-");
        const summary = document.createElement("button");
        summary.className = "vault-entry__summary";
        summary.type = "button";
        summary.setAttribute("aria-expanded", "false");
        summary.setAttribute("aria-controls", detailId);

        const date = document.createElement("time");
        date.dateTime = entry.completedAt;
        date.textContent = entry.dateLabel;
        const title = document.createElement("strong");
        title.textContent = entry.title;
        const meta = document.createElement("span");
        meta.textContent = [
          entry.missionType === "side" ? "Side Mission" : "Daily Mission",
          entry.category,
          entry.primarySkill,
        ].filter(Boolean).join(" · ");
        const xp = document.createElement("span");
        xp.className = "vault-entry__xp";
        xp.textContent = `+${entry.overallXPEarned} XP`;
        const status = document.createElement("span");
        status.className = "vault-entry__status";
        status.textContent = entry.statusLabel;
        const marker = document.createElement("span");
        marker.className = "vault-entry__marker";
        marker.setAttribute("aria-hidden", "true");
        marker.textContent = "+";
        summary.append(date, title, meta, xp, status, marker);

        const details = document.createElement("div");
        details.className = "vault-entry__details";
        details.id = detailId;
        details.hidden = true;
        const description = document.createElement("p");
        description.textContent = entry.description
          || "The mission description was not captured for this earlier archive entry.";
        const facts = document.createElement("dl");
        facts.append(
          createVaultDetail("Completed", entry.timestampLabel),
          createVaultDetail("Overall XP", `+${entry.overallXPEarned} XP`),
          createVaultDetail("Skill XP", entry.primarySkill
            ? `+${entry.skillXPEarned} ${entry.primarySkill}`
            : `+${entry.skillXPEarned} XP`),
          createVaultDetail("Original state", entry.originalMissionState
            ? entry.originalMissionState.replace(/^./, (letter) => letter.toUpperCase())
            : "Not retained for this earlier entry"),
        );
        details.append(description, facts);

        if (entry.achievements?.length) {
          const achievementHeading = document.createElement("h3");
          achievementHeading.textContent = "Achievements unlocked";
          const achievements = document.createElement("ul");
          achievements.className = "vault-entry__achievements";
          entry.achievements.forEach((achievement) => {
            const achievementItem = document.createElement("li");
            achievementItem.textContent = `${achievement.icon} ${achievement.name}`;
            achievements.append(achievementItem);
          });
          details.append(achievementHeading, achievements);
        }

        summary.addEventListener("click", () => {
          const expanded = summary.getAttribute("aria-expanded") === "true";
          summary.setAttribute("aria-expanded", String(!expanded));
          marker.textContent = expanded ? "+" : "−";
          details.hidden = expanded;
        });
        item.append(summary, details);
        list.append(item);
      });
      section.append(heading, list);
      vaultHistory.append(section);
    });

    if (vaultLoadMore) {
      vaultLoadMore.hidden = !vaultPagination.hasMore;
      vaultLoadMore.disabled = false;
      vaultLoadMore.removeAttribute("aria-busy");
    }
  };

  const showAchievementUnlocks = (newAchievements) => {
    if (!achievementUnlock || !achievementUnlockList
      || !Array.isArray(newAchievements) || newAchievements.length === 0) return;
    achievementUnlockList.replaceChildren();
    newAchievements.forEach((achievement) => {
      const item = document.createElement("li");
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = achievement.icon;
      const name = document.createElement("strong");
      name.textContent = achievement.name;
      const description = document.createElement("small");
      description.textContent = achievement.description;
      item.append(icon, name, description);
      achievementUnlockList.append(item);
    });
    if (achievementUnlockTimer !== null) window.clearTimeout(achievementUnlockTimer);
    achievementUnlock.hidden = false;
    window.requestAnimationFrame(() => achievementUnlock.classList.add("is-visible"));
    achievementUnlockTimer = window.setTimeout(() => {
      achievementUnlock.classList.remove("is-visible");
      achievementUnlock.hidden = true;
      achievementUnlockTimer = null;
    }, 4800);
  };

  const renderAnalyticsChart = ({ container, tableBody, series, valueLabel, chartLabel }) => {
    if (!container || !tableBody) return;
    container.replaceChildren();
    tableBody.replaceChildren();
    container.setAttribute("aria-label", chartLabel);
    const labelInterval = Math.max(1, Math.ceil(series.length / 8));

    series.forEach((entry, index) => {
      const item = document.createElement("span");
      item.className = "analytics-chart__item";
      item.setAttribute("aria-hidden", "true");
      const bar = document.createElement("span");
      bar.className = "analytics-chart__bar";
      bar.style.height = `${entry.height}%`;
      bar.dataset.zero = String(entry.value === 0);
      bar.title = `${entry.dateLabel}: ${valueLabel(entry.value)}`;
      const label = document.createElement("span");
      label.className = "analytics-chart__label";
      label.textContent = index % labelInterval === 0 || index === series.length - 1
        ? entry.dateLabel
        : "";
      item.append(bar, label);
      container.append(item);

      const row = document.createElement("tr");
      const date = document.createElement("th");
      date.scope = "row";
      date.textContent = entry.dateLabel;
      const value = document.createElement("td");
      value.textContent = valueLabel(entry.value);
      row.append(date, value);
      tableBody.append(row);
    });
  };

  const renderAnalytics = (analytics) => {
    const viewModel = KVNXAnalyticsExperience.createViewModel(analytics);
    analyticsLoadedPeriod = viewModel.period;
    if (analyticsLoading) analyticsLoading.hidden = true;
    if (analyticsError) analyticsError.hidden = true;
    if (analyticsEmpty) analyticsEmpty.hidden = !viewModel.empty;
    if (analyticsContent) analyticsContent.hidden = viewModel.empty;

    analyticsPeriodButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.analyticsPeriod === viewModel.period));
    });

    if (analyticsGenerated && viewModel.generatedAt) {
      const generatedAt = new Date(viewModel.generatedAt);
      analyticsGenerated.hidden = false;
      analyticsGenerated.dateTime = viewModel.generatedAt;
      analyticsGenerated.textContent = `Updated ${new Intl.DateTimeFormat("en-US", {
        hour: "numeric", minute: "2-digit",
      }).format(generatedAt)}`;
    }
    const authoritativeStreak = applicationSnapshot.streak
      || { currentStreak: 0, longestStreak: 0 };
    if (analyticsCurrentStreak) {
      analyticsCurrentStreak.textContent = formatStreakDays(authoritativeStreak.currentStreak);
    }
    if (analyticsLongestStreak) {
      analyticsLongestStreak.textContent = formatStreakDays(authoritativeStreak.longestStreak);
    }
    if (viewModel.empty) return;

    if (analyticsMissions) analyticsMissions.textContent = viewModel.missionsCompleted.toLocaleString("en-US");
    if (analyticsSideMissions) analyticsSideMissions.textContent = viewModel.sideMissionsCompleted.toLocaleString("en-US");
    if (analyticsXP) analyticsXP.textContent = viewModel.overallXPEarned.toLocaleString("en-US");
    if (analyticsSkillXP) analyticsSkillXP.textContent = viewModel.skillXPEarned.toLocaleString("en-US");
    if (analyticsPeriodLabel) analyticsPeriodLabel.textContent = viewModel.periodLabel;
    if (analyticsTopSkill) {
      analyticsTopSkill.textContent = viewModel.mostDevelopedSkill?.name || "No skill activity";
    }
    if (analyticsTopSkillXP) {
      analyticsTopSkillXP.textContent = viewModel.mostDevelopedSkill?.xpLabel
        || "No skill XP in this period";
    }
    if (analyticsActiveDays) {
      analyticsActiveDays.textContent = `${viewModel.activeDays} active ${viewModel.activeDays === 1 ? "day" : "days"}`;
    }
    if (analyticsActiveValue) analyticsActiveValue.textContent = viewModel.activeDaysLabel;
    if (analyticsActiveCopy) analyticsActiveCopy.textContent = "Days with at least one authoritative completed mission.";
    if (analyticsAchievements) analyticsAchievements.textContent = viewModel.achievementsUnlocked.toLocaleString("en-US");
    if (analyticsXPTotal) analyticsXPTotal.textContent = `${viewModel.overallXPEarned.toLocaleString("en-US")} XP`;

    renderAnalyticsChart({
      container: analyticsMissionChart,
      tableBody: analyticsMissionTableBody,
      series: viewModel.missionActivity,
      valueLabel: (value) => `${value} completed ${value === 1 ? "mission" : "missions"}`,
      chartLabel: viewModel.missionChartLabel,
    });
    renderAnalyticsChart({
      container: analyticsXPChart,
      tableBody: analyticsXPTableBody,
      series: viewModel.xpActivity,
      valueLabel: (value) => `${value} XP earned`,
      chartLabel: viewModel.xpChartLabel,
    });

    if (analyticsSkills) {
      analyticsSkills.replaceChildren();
      viewModel.skillActivity.forEach((skill) => {
        const item = document.createElement("li");
        const heading = document.createElement("div");
        heading.className = "analytics-skill__heading";
        const name = document.createElement("strong");
        name.textContent = skill.name;
        const value = document.createElement("span");
        value.textContent = `${Number(skill.xpEarned).toLocaleString("en-US")} XP earned`;
        heading.append(name, value);
        const track = document.createElement("div");
        track.className = "analytics-skill__track";
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", `${skill.name}: ${skill.xpEarned} XP earned during ${viewModel.periodLabel}`);
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuenow", String(skill.contribution));
        const fill = document.createElement("span");
        fill.className = "analytics-skill__fill";
        fill.style.width = `${skill.contribution}%`;
        track.append(fill);
        item.append(heading, track);
        analyticsSkills.append(item);
      });
      if (analyticsSkillsEmpty) analyticsSkillsEmpty.hidden = viewModel.skillActivity.length > 0;
    }
  };

  const loadAnalytics = async (period = analyticsPeriod) => {
    if (analyticsInFlight) return;
    analyticsInFlight = true;
    analyticsPeriod = period;
    if (analyticsLoading) analyticsLoading.hidden = false;
    if (analyticsError) analyticsError.hidden = true;
    if (analyticsEmpty) analyticsEmpty.hidden = true;
    if (analyticsContent) analyticsContent.hidden = true;
    analyticsPeriodButtons.forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-pressed", String(button.dataset.analyticsPeriod === analyticsPeriod));
    });

    try {
      const snapshot = await vaultApplication.loadAnalytics(analyticsPeriod);
      applicationSnapshot = snapshot;
      renderAnalytics(snapshot.analytics);
    } catch (error) {
      if (["session-expired", "session-unavailable"].includes(error?.code)) {
        window.location.replace("login.html");
        return;
      }
      if (analyticsLoading) analyticsLoading.hidden = true;
      if (analyticsError) analyticsError.hidden = false;
    } finally {
      analyticsInFlight = false;
      analyticsPeriodButtons.forEach((button) => { button.disabled = false; });
    }
  };

  const formatRecentMissionDate = (timestamp) => {
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) return "Completion date unavailable";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric",
    }).format(new Date(parsed));
  };

  const renderDailyMissionChoices = (snapshot) => {
    const viewModel = KVNXDailyMissionChoiceExperience.createViewModel(snapshot);
    if (dashboardDailyChoice) dashboardDailyChoice.hidden = !viewModel.required;
    if (missionCenterDailyChoice) missionCenterDailyChoice.hidden = !viewModel.required;
    if (missionCard) missionCard.hidden = viewModel.required;
    dailyChoiceErrors.forEach((error) => { error.hidden = true; });

    dailyChoiceLists.forEach((list) => {
      list.replaceChildren();
      if (!viewModel.required) return;
      viewModel.options.forEach((option, index) => {
        const card = document.createElement("article");
        const marker = document.createElement("span");
        const title = document.createElement("h3");
        const description = document.createElement("p");
        const details = document.createElement("dl");
        const button = document.createElement("button");
        card.className = "daily-choice__option";
        marker.className = "daily-choice__number";
        marker.textContent = String(index + 1).padStart(2, "0");
        marker.setAttribute("aria-hidden", "true");
        title.textContent = option.title;
        description.textContent = option.description;

        [
          ["Duration", option.estimatedDuration],
          ["Difficulty", option.difficulty],
          ["Builds", option.primarySkillName],
          ["Reward", `+${option.xpReward} XP`],
        ].forEach(([label, value]) => {
          const row = document.createElement("div");
          const term = document.createElement("dt");
          const detail = document.createElement("dd");
          term.textContent = label;
          detail.textContent = value;
          row.append(term, detail);
          details.append(row);
        });

        button.className = "app-button app-button--primary daily-choice__select";
        button.type = "button";
        button.dataset.dailyChoiceSelect = option.choiceId;
        button.textContent = "Choose Mission";
        button.setAttribute("aria-label", `Choose ${option.title} as today’s mission`);
        card.append(marker, title, description, details, button);
        list.append(card);
      });
    });
  };

  const renderMissionCenter = (snapshot) => {
    if (!missionsView) return;
    if (missionCenterLoading) missionCenterLoading.hidden = true;
    if (missionCenterError) missionCenterError.hidden = true;

    try {
      const choiceRequired = snapshot?.dailyChoice?.required === true;
      if (choiceRequired) {
        if (missionCenterStatus) {
          missionCenterStatus.textContent = "Choice required";
          missionCenterStatus.dataset.state = "choice";
        }
        if (missionCenterEmpty) missionCenterEmpty.hidden = true;
        if (missionCenterContent) missionCenterContent.hidden = true;
        missionCenterCountdownController?.stop();
        missionCenterCountdownController = null;
        missionCenterCountdownResetAt = null;
        return;
      }
      const viewModel = KVNXMissionCenterExperience.createViewModel(snapshot);
      if (missionCenterEmpty) missionCenterEmpty.hidden = viewModel.available;
      if (missionCenterContent) missionCenterContent.hidden = !viewModel.available;
      if (!viewModel.available) {
        missionCenterCountdownController?.stop();
        missionCenterCountdownController = null;
        missionCenterCountdownResetAt = null;
        return;
      }

      if (missionCenterStatus) {
        missionCenterStatus.textContent = viewModel.stateLabel;
        missionCenterStatus.dataset.state = viewModel.state;
      }
      if (missionCenterTitle) missionCenterTitle.textContent = viewModel.title;
      if (missionCenterDescription) missionCenterDescription.textContent = viewModel.description;
      if (missionCenterDuration) missionCenterDuration.textContent = viewModel.duration;
      if (missionCenterDifficulty) missionCenterDifficulty.textContent = viewModel.difficulty;
      if (missionCenterReward) {
        missionCenterReward.textContent = Number.isFinite(viewModel.xpReward)
          ? `+${viewModel.xpReward} XP`
          : "Unavailable";
      }
      if (missionCenterSkill) missionCenterSkill.textContent = viewModel.skillName;
      if (missionCenterStart) missionCenterStart.hidden = !viewModel.canStart;
      if (missionCenterComplete) missionCenterComplete.hidden = !viewModel.canComplete;
      if (missionCenterSkip) missionCenterSkip.hidden = !viewModel.canSkip;
      if (missionCenterActions) missionCenterActions.hidden = viewModel.isTerminal;
      if (missionCenterReplacement) {
        missionCenterReplacement.hidden = !viewModel.canRequestReplacement;
      }
      if (missionCenterDailyComplete) missionCenterDailyComplete.hidden = !viewModel.dailyComplete;
      if (missionCenterCurrentXP) missionCenterCurrentXP.textContent = viewModel.currentXPLabel;
      if (missionCenterCurrentStreak) missionCenterCurrentStreak.textContent = viewModel.currentStreakLabel;
      if (missionCenterPrimaryStatus) missionCenterPrimaryStatus.textContent = viewModel.stateLabel;
      if (missionCenterReplacementStatus) {
        missionCenterReplacementStatus.textContent = viewModel.replacementLabel;
      }

      if (missionCenterCountdownResetAt !== viewModel.nextResetAt) {
        missionCenterCountdownController?.stop();
        missionCenterCountdownResetAt = viewModel.nextResetAt;
        missionCenterCountdownController = KVNXDailyCompleteExperience.createCountdown({
          nextResetAt: viewModel.nextResetAt,
          onUpdate: ({ label, value }) => {
            if (missionCenterReset) missionCenterReset.textContent = value || label;
          },
        });
      }

      if (missionCenterRecent) {
        missionCenterRecent.replaceChildren();
        viewModel.recentMissions.forEach((entry) => {
          const item = document.createElement("li");
          const link = document.createElement("a");
          const copy = document.createElement("span");
          const title = document.createElement("strong");
          const context = document.createElement("span");
          const reward = document.createElement("span");
          link.className = "mission-center__recent-item";
          link.href = "#vault";
          link.setAttribute("aria-label", `${entry.title}, completed ${formatRecentMissionDate(entry.completedAt)}. View in Vault.`);
          copy.className = "mission-center__recent-copy";
          title.textContent = entry.title;
          context.textContent = [
            formatRecentMissionDate(entry.completedAt),
            entry.missionType === "side" ? "Side Mission" : "Daily Mission",
            entry.category,
            entry.primarySkill,
          ].filter(Boolean).join(" · ");
          reward.className = "mission-center__recent-reward";
          reward.textContent = `+${entry.overallXPEarned} XP · +${entry.skillXPEarned} skill XP`;
          copy.append(title, context);
          link.append(copy, reward);
          item.append(link);
          missionCenterRecent.append(item);
        });
      }
      if (missionCenterRecentEmpty) {
        missionCenterRecentEmpty.hidden = viewModel.recentMissions.length > 0;
      }
      renderSideMission(snapshot);
    } catch {
      if (missionCenterContent) missionCenterContent.hidden = true;
      if (missionCenterEmpty) missionCenterEmpty.hidden = true;
      if (missionCenterError) missionCenterError.hidden = false;
    }
  };

  const renderApplicationView = () => {
    const showMissions = window.location.hash === "#missions";
    const showSkills = window.location.hash === "#skills";
    const showAchievements = window.location.hash === "#achievements";
    const showVault = window.location.hash === "#vault";
    const showAnalytics = window.location.hash === "#analytics";
    dashboardHomeSections.forEach((section) => { section.hidden = showMissions || showSkills || showAchievements || showVault || showAnalytics; });
    if (missionsView) missionsView.hidden = !showMissions;
    if (skillsView) skillsView.hidden = !showSkills;
    if (achievementsView) achievementsView.hidden = !showAchievements;
    if (vaultView) vaultView.hidden = !showVault;
    if (analyticsView) analyticsView.hidden = !showAnalytics;
    viewLinks.forEach((link) => {
      const activeView = showMissions
        ? "missions"
        : showSkills ? "skills"
        : showAchievements ? "achievements"
        : showVault
          ? "vault"
          : showAnalytics ? "analytics" : "dashboard";
      const active = link.dataset.viewLink === activeView;
      link.classList.toggle("sidebar__link--active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (showAnalytics && analyticsLoadedPeriod !== analyticsPeriod && !analyticsInFlight) {
      loadAnalytics(analyticsPeriod);
    }
  };

  const showProgressAward = (result) => {
    const updatedSkill = result?.updatedSkill;
    const sideCompleted = result?.reason === "completed" && result?.sideMission?.lifecycle?.rewardAwarded;
    const overallAward = Number(result?.event?.xpAwarded
      ?? (sideCompleted ? result.sideMission.definition.overallXPReward : 0));
    const skillAward = Number(result?.event?.skillXPAwarded
      ?? (sideCompleted ? result.sideMission.definition.skillXPReward : 0));
    if (!progressAward || !updatedSkill?.name
      || !(overallAward > 0) || !(skillAward > 0)) return;

    if (progressAwardOverall) progressAwardOverall.textContent = `+${overallAward} XP`;
    if (progressAwardSkill) progressAwardSkill.textContent = `+${skillAward} ${updatedSkill.name}`;
    if (progressAwardTimer !== null) window.clearTimeout(progressAwardTimer);
    progressAward.hidden = false;
    window.requestAnimationFrame(() => progressAward.classList.add("is-visible"));
    progressAwardTimer = window.setTimeout(() => {
      progressAward.classList.remove("is-visible");
      progressAward.hidden = true;
      progressAwardTimer = null;
    }, 3200);
  };

  const missionStateLabels = {
    ready: "Ready",
    active: "In Progress",
    completed: "Completed",
    skipped: "Skipped",
    expired: "Expired",
  };

  const renderDailyComplete = (coordinator, progression) => {
    if (!dailyComplete) return false;
    const viewModel = KVNXDailyCompleteExperience.createViewModel({
      coordinator,
      progression,
      nextResetAt,
    });
    const actionHadFocus = [
      startMissionButton,
      completeMissionButton,
      skipMissionButton,
      requestMissionButton,
    ].includes(document.activeElement);

    const wasHidden = dailyComplete.hidden;
    dailyComplete.hidden = !viewModel.visible;
    missionCard?.classList.toggle("is-daily-complete", viewModel.visible);
    if (dailyCompleteXP) dailyCompleteXP.textContent = viewModel.xpLabel;

    const renderResetDisplay = ({ label, value, announceReady = false }) => {
      if (dailyCompleteResetLabel) dailyCompleteResetLabel.textContent = label;
      if (dailyCompleteResetValue) {
        dailyCompleteResetValue.hidden = !value;
        dailyCompleteResetValue.textContent = value || "";
      }
      if (announceReady && dailyCompleteResetAnnouncement) {
        dailyCompleteResetAnnouncement.textContent = "New mission ready";
      }
    };

    if (viewModel.visible) {
      if (missionActions) missionActions.hidden = true;
      if (missionReplacement) missionReplacement.hidden = true;
      if (missionSuccess) {
        missionSuccess.hidden = true;
        missionSuccess.classList.remove("is-visible");
      }
      if (countdownResetAt !== viewModel.nextResetAt) {
        countdownController?.stop();
        countdownResetAt = viewModel.nextResetAt;
        if (dailyCompleteResetAnnouncement) dailyCompleteResetAnnouncement.textContent = "";
        countdownController = KVNXDailyCompleteExperience.createCountdown({
          nextResetAt: viewModel.nextResetAt,
          onUpdate: renderResetDisplay,
        });
      } else if (!countdownController) {
        renderResetDisplay(viewModel.resetDisplay);
      }
      if (wasHidden) {
        dailyComplete.setAttribute("aria-live", "polite");
        window.requestAnimationFrame(() => dailyComplete.setAttribute("aria-live", "off"));
      }
      if (actionHadFocus) dailyComplete.focus({ preventScroll: true });
    } else {
      countdownController?.stop();
      countdownController = null;
      countdownResetAt = null;
      dailyComplete.setAttribute("aria-live", "polite");
    }

    return viewModel.visible;
  };

  // The renderer receives a coordinator snapshot and never decides mission
  // ownership, lifecycle transitions, history, or replacement eligibility.
  const renderCoordinator = (snapshot) => {
    if (!snapshot || !missionCard) return;
    missionCard.hidden = false;
    coordinatorSnapshot = snapshot;
    const definition = snapshot.currentMission.definition;
    const lifecycle = snapshot.currentMission.lifecycle;
    renderMissionDefinition(definition);

    missionCard.classList.toggle("is-active", lifecycle.state === "active");
    missionCard.classList.toggle("is-complete", lifecycle.state === "completed");
    missionCard.classList.toggle("is-skipped", lifecycle.state === "skipped");
    missionCard.classList.toggle("is-expired", lifecycle.state === "expired");

    if (missionStatus) {
      missionStatus.textContent = missionStateLabels[lifecycle.state] || lifecycle.state;
      missionStatus.dataset.state = lifecycle.state;
    }

    if (startMissionButton) startMissionButton.hidden = !lifecycle.canStart;
    if (completeMissionButton) completeMissionButton.hidden = !lifecycle.canComplete;
    if (skipMissionButton) skipMissionButton.hidden = !lifecycle.canSkip;
    if (missionActions) missionActions.hidden = lifecycle.isTerminal;

    if (lifecycle.state !== "completed" && missionSuccess) {
      missionSuccess.hidden = true;
      missionSuccess.classList.remove("is-visible");
    }

    const hasNeutralOutcome = lifecycle.state === "skipped" || lifecycle.state === "expired";
    if (missionOutcome) missionOutcome.hidden = !hasNeutralOutcome;
    if (hasNeutralOutcome && missionOutcomeTitle && missionOutcomeDescription) {
      const isSkipped = lifecycle.state === "skipped";
      missionOutcomeTitle.textContent = isSkipped ? "Skipped for today" : "Mission expired";
      missionOutcomeDescription.textContent = isSkipped
        ? "No XP was awarded. You can return with a clear start tomorrow."
        : "This mission closed without affecting your progress.";
    }

    if (missionReplacement) {
      missionReplacement.hidden = !snapshot.dailyStatus.canRequestReplacement;
    }
    if (replacementNote) {
      replacementNote.textContent = snapshot.dailyStatus.replacementsRemaining > 0
        ? "One replacement is available in this preview."
        : "The replacement has been used for this preview.";
    }

    renderDailyComplete(snapshot, progressionSnapshot);
  };

  renderDailyMissionChoices(applicationSnapshot);
  renderCoordinator(coordinatorSnapshot);
  renderProgression(applicationSnapshot.progression);
  renderSkills(applicationSnapshot.skills);
  renderSkillCenter(applicationSnapshot);
  renderSideMission(applicationSnapshot);
  renderStreak(applicationSnapshot.streak);
  renderAchievements(applicationSnapshot);
  renderVault();
  renderMissionCenter(applicationSnapshot);
  renderApplicationView();
  protectedContentGate.reveal();
  window.addEventListener("hashchange", renderApplicationView);

  let dailyChoiceSelectionInFlight = false;
  const selectDailyChoice = async (choiceId) => {
    if (dailyChoiceSelectionInFlight) return;
    dailyChoiceSelectionInFlight = true;
    const buttons = [...document.querySelectorAll("[data-daily-choice-select]")];
    buttons.forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    });
    dailyChoiceErrors.forEach((error) => { error.hidden = true; });

    try {
      const result = await vaultApplication.selectDailyMission(choiceId);
      applicationSnapshot = result.snapshot;
      nextResetAt = result.snapshot.nextResetAt;
      renderDailyMissionChoices(result.snapshot);
      renderMissionCenter(result.snapshot);
      if (result.snapshot.coordinator) {
        coordinatorSnapshot = result.snapshot.coordinator;
        renderCoordinator(coordinatorSnapshot);
        const selectedTitle = coordinatorSnapshot.currentMission.definition.title;
        const summaryGoal = document.querySelector("[data-summary-goal]");
        if (summaryGoal) summaryGoal.textContent = selectedTitle;
        (window.location.hash === "#missions" ? missionCenterStart : startMissionButton)?.focus();
      } else if (!result.accepted) {
        dailyChoiceErrors.forEach((error) => { error.hidden = false; });
      }
    } catch (error) {
      if (["session-expired", "session-unavailable"].includes(error?.code)) {
        window.location.replace("login.html");
        return;
      }
      dailyChoiceErrors.forEach((message) => { message.hidden = false; });
    } finally {
      dailyChoiceSelectionInFlight = false;
      document.querySelectorAll("[data-daily-choice-select]").forEach((button) => {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      });
    }
  };

  dailyChoiceLists.forEach((list) => {
    list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-daily-choice-select]");
      if (!button || !list.contains(button)) return;
      selectDailyChoice(button.dataset.dailyChoiceSelect);
    });
  });

  skillCenterFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      skillCenterFilter = button.dataset.skillFilter || "all";
      renderSkillCenter(applicationSnapshot);
    });
  });
  skillCenterSort?.addEventListener("change", () => renderSkillCenter(applicationSnapshot));

  skillCenterGroups?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-skill-path-action]");
    if (!button || !skillCenterGroups.contains(button) || button.disabled) return;
    const skillKey = button.dataset.skillPathKey;
    const action = button.dataset.skillPathAction;
    if (action === "explore") {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (skillPathStatus) skillPathStatus.textContent = "Restoring authoritative mission offers…";
      try {
        const result = await vaultApplication.requestSkillPathMissionOffers(skillKey);
        if (!result?.accepted || !result.offerState) throw new Error(result?.reason || "offers-rejected");
        applicationSnapshot = result.snapshot;
        renderSkillPathOffers(result.offerState);
        if (skillPathStatus) skillPathStatus.textContent = "";
      } catch {
        if (skillPathStatus) skillPathStatus.textContent = "The Vault could not restore mission offers for that path.";
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
      return;
    }
    const activate = action === "activate";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (skillPathStatus) skillPathStatus.textContent = `${activate ? "Activating" : "Pausing"} development path…`;
    try {
      const result = activate
        ? await vaultApplication.activateSkillPath(skillKey)
        : await vaultApplication.deactivateSkillPath(skillKey);
      if (!result?.accepted) throw new Error(result?.reason || "skill-path-rejected");
      applicationSnapshot = result.snapshot;
      renderSkillCenter(applicationSnapshot);
      if (!activate && !skillPathOffersPanel?.hidden
        && skillPathOffersPanel.dataset.skillPathOffersSkill === skillKey) {
        skillPathOffersPanel.hidden = true;
      }
      if (skillPathStatus) {
        const skillName = result.path?.name || "Skill";
        skillPathStatus.textContent = `${skillName} is ${activate ? "now a development path" : "no longer an active development path"}.`;
      }
    } catch {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (skillPathStatus) skillPathStatus.textContent = "The Vault could not update that development path. Try again.";
    }
  });

  skillPathOffersList?.addEventListener("click", async (event) => {
    const promoteButton = event.target.closest("[data-skill-path-offer-promote]");
    if (promoteButton && !promoteButton.disabled) {
      promoteButton.disabled = true;
      promoteButton.setAttribute("aria-busy", "true");
      if (skillPathOffersStatus) skillPathOffersStatus.textContent = "Securing today’s Side Mission…";
      try {
        const result = await vaultApplication.promoteSideMission(
          promoteButton.dataset.skillPathOfferPromote,
        );
        if (!result?.accepted || !result?.sideMission) throw new Error(result?.reason || "promotion-rejected");
        applicationSnapshot = result.snapshot;
        renderSideMission(result.snapshot);
        const offerState = result.snapshot.skillPathMissionOffers.find((state) => (
          state.selectedOfferId === result.sideMission.sourceOfferId
        ));
        if (offerState) renderSkillPathOffers(offerState);
        if (sideMissionStatus) sideMissionStatus.textContent = "Side Mission planned. Start it when you are ready.";
      } catch {
        promoteButton.disabled = false;
        promoteButton.removeAttribute("aria-busy");
        if (skillPathOffersStatus) skillPathOffersStatus.textContent = "That planned practice could not be promoted. Restore the path and try again.";
      }
      return;
    }
    const button = event.target.closest("[data-skill-path-offer-select]");
    if (!button || button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (skillPathOffersStatus) skillPathOffersStatus.textContent = "Securing planned practice…";
    try {
      const result = await vaultApplication.selectSkillPathMissionOffer(
        button.dataset.skillPathOfferSelect,
      );
      if (!result?.accepted || !result.offerState) throw new Error(result?.reason || "selection-rejected");
      applicationSnapshot = result.snapshot;
      renderSkillPathOffers(result.offerState);
    } catch {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (skillPathOffersStatus) skillPathOffersStatus.textContent = "That practice could not be selected. Restore the path and try again.";
    }
  });

  skillPathOffersClose?.addEventListener("click", () => {
    if (skillPathOffersPanel) skillPathOffersPanel.hidden = true;
  });

  let sideMissionActionInFlight = false;
  const runSideMissionAction = async (action) => {
    if (sideMissionActionInFlight) return;
    sideMissionActionInFlight = true;
    [...sideMissionStartButtons, ...sideMissionCompleteButtons].forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    });
    if (sideMissionStatus) sideMissionStatus.textContent = action === "start"
      ? "Starting Side Mission…" : "Securing verified Side Mission completion…";
    try {
      const result = action === "start"
        ? await vaultApplication.startSideMission()
        : await vaultApplication.completeSideMission();
      if (!result?.accepted) throw new Error(result?.reason || "side-mission-rejected");
      applicationSnapshot = result.snapshot;
      progressionSnapshot = result.snapshot.progression;
      vaultEntries = result.snapshot.history || vaultEntries;
      vaultPagination = result.snapshot.historyPagination || vaultPagination;
      if (action === "complete") analyticsLoadedPeriod = null;
      renderSideMission(result.snapshot);
      renderProgression(result.snapshot.progression);
      renderSkills(result.snapshot.skills);
      renderSkillCenter(result.snapshot);
      renderAchievements(result.snapshot);
      renderVault();
      renderMissionCenter(result.snapshot);
      showProgressAward(result);
      showAchievementUnlocks(result.newAchievements);
    } catch (error) {
      if (sideMissionStatus) sideMissionStatus.textContent = "The Side Mission could not be updated. Your saved state remains unchanged.";
    } finally {
      sideMissionActionInFlight = false;
      const viewModel = KVNXSideMissionExperience.createViewModel(applicationSnapshot);
      sideMissionStartButtons.forEach((button) => {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.hidden = !viewModel.canStart;
      });
      sideMissionCompleteButtons.forEach((button) => {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.hidden = !viewModel.canComplete;
      });
    }
  };
  sideMissionStartButtons.forEach((button) => {
    button.addEventListener("click", () => runSideMissionAction("start"));
  });
  sideMissionCompleteButtons.forEach((button) => {
    button.addEventListener("click", () => runSideMissionAction("complete"));
  });

  achievementCenterFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      achievementCenterFilter = button.dataset.achievementFilter || "all";
      renderAchievements(applicationSnapshot);
    });
  });

  analyticsPeriodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const period = button.dataset.analyticsPeriod;
      if (!period || period === analyticsLoadedPeriod || analyticsInFlight) return;
      loadAnalytics(period);
    });
  });
  analyticsRetry?.addEventListener("click", () => loadAnalytics(analyticsPeriod));

  [vaultSearch, vaultAchievementsFilter, vaultSkillFilter, vaultCategoryFilter, vaultSort]
    .forEach((control) => control?.addEventListener(
      control === vaultSearch ? "input" : "change",
      renderVault,
    ));

  openVaultButton?.addEventListener("click", () => {
    window.location.hash = "#vault";
  });

  vaultLoadMore?.addEventListener("click", async () => {
    vaultLoadMore.disabled = true;
    vaultLoadMore.setAttribute("aria-busy", "true");
    try {
      const snapshot = await vaultApplication.loadMoreVaultHistory();
      applicationSnapshot = snapshot;
      vaultEntries = snapshot.history || [];
      vaultPagination = snapshot.historyPagination || Object.freeze({ hasMore: false });
      renderVault();
      renderSkillCenter(snapshot);
    } catch (error) {
      if (vaultResultsStatus) vaultResultsStatus.textContent = "Older entries could not be loaded. Please try again.";
      vaultLoadMore.disabled = false;
      vaultLoadMore.removeAttribute("aria-busy");
    }
  });

  startMissionButton?.addEventListener("click", async () => {
    try {
      const result = await vaultApplication.start();
      if (result.snapshot?.coordinator) {
        applicationSnapshot = result.snapshot;
        nextResetAt = result.snapshot.nextResetAt;
        renderCoordinator(result.snapshot.coordinator);
        renderMissionCenter(result.snapshot);
      }
    } catch (error) {
      showPersistenceFailure(error);
    }
  });

  missionCenterStart?.addEventListener("click", () => startMissionButton?.click());

  skipMissionButton?.addEventListener("click", async () => {
    try {
      const result = await vaultApplication.skip();
      if (result.snapshot?.coordinator) {
        applicationSnapshot = result.snapshot;
        nextResetAt = result.snapshot.nextResetAt;
        renderCoordinator(result.snapshot.coordinator);
        renderProgression(result.snapshot.progression);
        renderMissionCenter(result.snapshot);
      }
    } catch (error) {
      showPersistenceFailure(error);
    }
  });

  missionCenterSkip?.addEventListener("click", () => skipMissionButton?.click());

  const completeFirstMission = async () => {
    if (!missionCard || !completeMissionButton || !missionSuccess || completionInFlight) return;
    completionInFlight = true;
    completeMissionButton.disabled = true;
    if (missionCenterComplete) missionCenterComplete.disabled = true;

    let applicationResult;
    try {
      applicationResult = await vaultApplication.complete();
    } catch (error) {
      completionInFlight = false;
      showPersistenceFailure(error);
      return;
    }
    if (!applicationResult.accepted) {
      applicationSnapshot = applicationResult.snapshot;
      nextResetAt = applicationResult.snapshot.nextResetAt;
      completeMissionButton.disabled = false;
      if (missionCenterComplete) missionCenterComplete.disabled = false;
      renderCoordinator(applicationResult.snapshot.coordinator);
      renderProgression(applicationResult.snapshot.progression);
      renderSkills(applicationResult.snapshot.skills);
      renderSkillCenter(applicationResult.snapshot);
      renderStreak(applicationResult.snapshot.streak);
      renderMissionCenter(applicationResult.snapshot);
      showProgressAward(applicationResult);
      completionInFlight = false;
      return;
    }

    completeMissionButton.disabled = true;
    if (startMissionButton) startMissionButton.disabled = true;
    if (skipMissionButton) skipMissionButton.disabled = true;
    missionCard.classList.add("is-completing");

    const revealDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
    window.setTimeout(() => {
      applicationSnapshot = applicationResult.snapshot;
      nextResetAt = applicationResult.snapshot.nextResetAt;
      analyticsLoadedPeriod = null;
      vaultEntries = applicationResult.snapshot.history || vaultEntries;
      vaultPagination = applicationResult.snapshot.historyPagination || vaultPagination;
      missionCard.classList.remove("is-completing");
      renderProgression(applicationResult.snapshot.progression);
      // The authoritative completion snapshot already contains the reconciled
      // skill total. Redraw the existing Skills card in the same accepted path
      // as overall XP so the pre-completion empty state cannot remain stale.
      renderSkills(applicationResult.snapshot.skills);
      renderSkillCenter(applicationResult.snapshot);
      renderAchievements(applicationResult.snapshot);
      renderStreak(applicationResult.snapshot.streak);
      renderVault();
      renderMissionCenter(applicationResult.snapshot);
      showProgressAward(applicationResult);
      showAchievementUnlocks(applicationResult.newAchievements);
      const isDailyComplete = renderDailyComplete(
        applicationResult.snapshot.coordinator,
        applicationResult.snapshot.progression,
      );
      renderCoordinator(applicationResult.snapshot.coordinator);
      missionSuccess.hidden = isDailyComplete;

      if (applicationResult.progressionResult?.didLevelUp && levelUpNotice) {
        if (levelUpValue) levelUpValue.textContent = String(applicationResult.snapshot.progression.currentLevel);
        levelUpNotice.hidden = false;
        window.requestAnimationFrame(() => levelUpNotice.classList.add("is-visible"));
      }

      if (!isDailyComplete) {
        window.requestAnimationFrame(() => missionSuccess.classList.add("is-visible"));
      }
      completionInFlight = false;
    }, revealDelay);
  };

  completeMissionButton?.addEventListener("click", completeFirstMission);
  missionCenterComplete?.addEventListener("click", completeFirstMission);

  if (requestMissionButton || missionCenterRequest) {
    const replacementButtons = [requestMissionButton, missionCenterRequest].filter(Boolean);
    let replacementInFlight = false;
    const replacementRequest = KVNXReplacementRequestController.create({
      button: requestMissionButton || missionCenterRequest,
      request: () => vaultApplication.requestReplacement(),
      onAccepted: (result) => {
        applicationSnapshot = result.snapshot;
        nextResetAt = result.snapshot.nextResetAt;
        if (missionSuccess) {
          missionSuccess.hidden = true;
          missionSuccess.classList.remove("is-visible");
        }
        if (missionOutcome) missionOutcome.hidden = true;
        if (levelUpNotice) {
          levelUpNotice.hidden = true;
          levelUpNotice.classList.remove("is-visible");
        }
        if (startMissionButton) startMissionButton.disabled = false;
        if (completeMissionButton) completeMissionButton.disabled = false;
        if (skipMissionButton) skipMissionButton.disabled = false;
        renderCoordinator(result.snapshot.coordinator);
        renderMissionCenter(result.snapshot);

        const summaryGoal = document.querySelector("[data-summary-goal]");
        if (summaryGoal) summaryGoal.textContent = result.snapshot.coordinator.currentMission.definition.title;
        startMissionButton?.focus();
      },
      onError: showPersistenceFailure,
      canRetry: ({ result }) => {
        const latest = result?.snapshot || vaultApplication.getSnapshot();
        return latest?.persistenceBlocked !== true
          && latest?.coordinator?.dailyStatus?.canRequestReplacement === true;
      },
    });

    const runReplacement = async () => {
      if (replacementInFlight) return;
      replacementInFlight = true;
      replacementButtons.forEach((button) => {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      });
      try {
        await replacementRequest.run();
      } finally {
        replacementInFlight = false;
        replacementButtons.forEach((button) => {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        });
      }
    };
    requestMissionButton?.addEventListener("click", runReplacement);
    missionCenterRequest?.addEventListener("click", runReplacement);
  }

  missionCenterRetry?.addEventListener("click", () => window.location.reload());

  logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      window.KVNXOnboardingState?.clear();
      await vaultApplication.signOut();
      window.location.replace("login.html");
    } catch {
      logoutButton.disabled = false;
      if (persistenceError) {
        persistenceError.hidden = false;
        persistenceError.textContent = "We couldn't sign you out. Check your connection and try again.";
      }
    }
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.hash = "#vault";
    renderVault();
  });

  if (currentDate) {
    const now = new Date();
    currentDate.dateTime = now.toISOString().slice(0, 10);
    currentDate.textContent = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now);
  }

  if (!sidebar || !menuButton || !closeButton || !backdrop) return;

  // Mobile navigation behavior only; product features are intentionally absent.
  const setSidebarOpen = (isOpen) => {
    sidebar.classList.toggle("is-open", isOpen);
    backdrop.classList.toggle("is-visible", isOpen);
    backdrop.hidden = !isOpen;
    menuButton.setAttribute("aria-expanded", String(isOpen));
    document.body.style.overflow = isOpen ? "hidden" : "";

    if (isOpen) {
      closeButton.focus();
    } else {
      menuButton.focus();
    }
  };

  menuButton.addEventListener("click", () => setSidebarOpen(true));
  closeButton.addEventListener("click", () => setSidebarOpen(false));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("is-open")) {
      setSidebarOpen(false);
    }
  });

  const desktopQuery = window.matchMedia("(min-width: 861px)");
  desktopQuery.addEventListener("change", (event) => {
    if (event.matches && sidebar.classList.contains("is-open")) {
      setSidebarOpen(false);
    }
  });
});
