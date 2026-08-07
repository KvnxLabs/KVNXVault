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

if (typeof module === "object" && module.exports) {
  module.exports = Object.freeze({
    ...KVNXReplacementRequestController,
    dailyComplete: KVNXDailyCompleteExperience,
    skills: KVNXSkillsExperience,
  });
}
if (typeof window !== "undefined") {
  window.KVNXReplacementRequestController = KVNXReplacementRequestController;
  window.KVNXDailyCompleteExperience = KVNXDailyCompleteExperience;
  window.KVNXSkillsExperience = KVNXSkillsExperience;
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", async () => {
  const protectedContext = await window.KVNXProtectedPage?.ready;
  if (!protectedContext) return;

  const sidebar = document.querySelector("[data-sidebar]");
  const menuButton = document.querySelector("[data-sidebar-open]");
  const closeButton = document.querySelector("[data-sidebar-close]");
  const backdrop = document.querySelector("[data-sidebar-backdrop]");
  const searchForm = document.querySelector("[data-app-search]");
  const currentDate = document.querySelector("[data-current-date]");

  const persistenceError = document.querySelector("[data-persistence-error]");
  const vaultApplication = window.KVNXApplicationService.createApplicationService({
    authService: protectedContext.authService,
    repository: protectedContext.repository,
    missionEngine: window.KVNXMissionEngine,
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
    if (persistenceError) {
      persistenceError.hidden = false;
      persistenceError.textContent = "We couldn't restore your Vault. Check your connection, then refresh the page.";
    }
    return;
  }

  const onboardingState = applicationSnapshot.onboarding || {};
  const profile = applicationSnapshot.profile || {};
  let coordinatorSnapshot = applicationSnapshot.coordinator;
  let firstMission = coordinatorSnapshot.currentMission.definition;
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
      "[data-summary-goal]": firstMission.title,
      "[data-summary-challenge]": challenge,
      "[data-summary-commitment]": commitment,
    };

    Object.entries(personalizedValues).forEach(([selector, value]) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    });
  }

  const missionCard = document.querySelector("[data-mission-card]");
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
  let progressAwardTimer = null;

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
    [startMissionButton, completeMissionButton, skipMissionButton, requestMissionButton]
      .forEach((button) => { if (button) button.disabled = true; });
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

  const showProgressAward = (result) => {
    const updatedSkill = result?.updatedSkill;
    const overallAward = Number(result?.event?.xpAwarded);
    const skillAward = Number(result?.event?.skillXPAwarded);
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

  renderCoordinator(coordinatorSnapshot);
  renderProgression(applicationSnapshot.progression);
  renderSkills(applicationSnapshot.skills);

  startMissionButton?.addEventListener("click", async () => {
    try {
      const result = await vaultApplication.start();
      if (result.snapshot?.coordinator) renderCoordinator(result.snapshot.coordinator);
    } catch (error) {
      showPersistenceFailure(error);
    }
  });

  skipMissionButton?.addEventListener("click", async () => {
    try {
      const result = await vaultApplication.skip();
      if (result.snapshot?.coordinator) {
        renderCoordinator(result.snapshot.coordinator);
        renderProgression(result.snapshot.progression);
      }
    } catch (error) {
      showPersistenceFailure(error);
    }
  });

  const completeFirstMission = async () => {
    if (!missionCard || !completeMissionButton || !missionSuccess) return;

    let applicationResult;
    try {
      applicationResult = await vaultApplication.complete();
    } catch (error) {
      showPersistenceFailure(error);
      return;
    }
    if (!applicationResult.accepted) {
      renderCoordinator(applicationResult.snapshot.coordinator);
      renderProgression(applicationResult.snapshot.progression);
      renderSkills(applicationResult.snapshot.skills);
      showProgressAward(applicationResult);
      return;
    }

    completeMissionButton.disabled = true;
    if (startMissionButton) startMissionButton.disabled = true;
    if (skipMissionButton) skipMissionButton.disabled = true;
    missionCard.classList.add("is-completing");

    const revealDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
    window.setTimeout(() => {
      missionCard.classList.remove("is-completing");
      renderProgression(applicationResult.snapshot.progression);
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
    }, revealDelay);
  };

  completeMissionButton?.addEventListener("click", completeFirstMission);

  if (requestMissionButton) {
    const replacementRequest = KVNXReplacementRequestController.create({
      button: requestMissionButton,
      request: () => vaultApplication.requestReplacement(),
      onAccepted: (result) => {
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

    requestMissionButton.addEventListener("click", () => replacementRequest.run());
  }

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

  // Search is visual-only until a future feature sprint supplies search logic.
  searchForm?.addEventListener("submit", (event) => event.preventDefault());

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
