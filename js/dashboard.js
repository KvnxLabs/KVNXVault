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

if (typeof module === "object" && module.exports) {
  module.exports = KVNXReplacementRequestController;
}
if (typeof window !== "undefined") {
  window.KVNXReplacementRequestController = KVNXReplacementRequestController;
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
  const xpValue = document.querySelector("[data-xp-value]");
  const xpProgress = document.querySelector("[data-xp-progress]");
  const xpProgressFill = document.querySelector("[data-xp-progress-fill]");
  const xpPercent = document.querySelector("[data-xp-percent]");
  const xpRemaining = document.querySelector("[data-xp-remaining]");
  const progressionLevel = document.querySelector("[data-progression-level]");
  const progressionCurrentLevel = document.querySelector("[data-progression-current-level]");
  const progressionNextLevel = document.querySelector("[data-progression-next-level]");
  const levelUpNotice = document.querySelector("[data-level-up]");
  const levelUpValue = document.querySelector("[data-level-up-value]");
  const logoutButton = document.querySelector("[data-logout]");

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
  };

  renderProgression(applicationSnapshot.progression);

  const missionStateLabels = {
    ready: "Ready",
    active: "In Progress",
    completed: "Completed",
    skipped: "Skipped",
    expired: "Expired",
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
  };

  renderCoordinator(coordinatorSnapshot);

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
      return;
    }

    completeMissionButton.disabled = true;
    if (startMissionButton) startMissionButton.disabled = true;
    if (skipMissionButton) skipMissionButton.disabled = true;
    missionCard.classList.add("is-completing");

    const revealDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
    window.setTimeout(() => {
      missionCard.classList.remove("is-completing");
      renderCoordinator(applicationResult.snapshot.coordinator);
      missionSuccess.hidden = false;

      renderProgression(applicationResult.snapshot.progression);

      if (applicationResult.progressionResult?.didLevelUp && levelUpNotice) {
        if (levelUpValue) levelUpValue.textContent = String(applicationResult.snapshot.progression.currentLevel);
        levelUpNotice.hidden = false;
        window.requestAnimationFrame(() => levelUpNotice.classList.add("is-visible"));
      }

      window.requestAnimationFrame(() => missionSuccess.classList.add("is-visible"));
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
