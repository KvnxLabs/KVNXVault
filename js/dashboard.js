"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const sidebar = document.querySelector("[data-sidebar]");
  const menuButton = document.querySelector("[data-sidebar-open]");
  const closeButton = document.querySelector("[data-sidebar-close]");
  const backdrop = document.querySelector("[data-sidebar-backdrop]");
  const searchForm = document.querySelector("[data-app-search]");
  const currentDate = document.querySelector("[data-current-date]");

  // Personalization is session-scoped and falls back to the Sprint 1 placeholders.
  const onboardingState = window.KVNXOnboardingState?.read() || {};
  const fallbackMission = {
    id: "first-mission-general",
    focus: "Personal Growth",
    title: "Build Focused Momentum",
    description: "Complete one intentional work session toward the direction you chose.",
    estimatedDuration: "30 minutes",
    difficulty: "Balanced",
    xpReward: 25,
  };
  let firstMission = fallbackMission;

  try {
    firstMission = await window.KVNXMissionEngine?.generateMission(onboardingState) || fallbackMission;
  } catch {
    // A safe first mission keeps the dashboard useful if a future provider fails.
  }
  const getInitials = (name) => name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  if (onboardingState.completed) {
    const firstName = String(onboardingState.firstName || "").trim();
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

  // Mission generation is separate from rendering so a future engine or AI
  // provider can supply the same object shape without changing this interface.
  const missionValues = {
    "[data-mission-title]": firstMission.title,
    "[data-mission-description]": firstMission.description,
    "[data-mission-duration]": firstMission.estimatedDuration,
    "[data-mission-difficulty]": firstMission.difficulty,
    "[data-mission-xp]": firstMission.xpReward,
  };

  Object.entries(missionValues).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  });

  const missionCard = document.querySelector("[data-mission-card]");
  const completeMissionButton = document.querySelector("[data-complete-mission]");
  const missionSuccess = document.querySelector("[data-mission-success]");
  const missionStatus = document.querySelector("[data-mission-status]");
  const xpValue = document.querySelector("[data-xp-value]");
  const xpProgress = document.querySelector("[data-xp-progress]");
  const xpProgressFill = document.querySelector("[data-xp-progress-fill]");
  const xpPercent = document.querySelector("[data-xp-percent]");
  const xpRemaining = document.querySelector("[data-xp-remaining]");
  const initialXp = 1240;
  const levelTargetXp = 2000;

  const completeFirstMission = () => {
    if (!missionCard || !completeMissionButton || !missionSuccess) return;

    completeMissionButton.disabled = true;
    missionCard.classList.add("is-completing");

    const revealDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
    window.setTimeout(() => {
      const updatedXp = initialXp + firstMission.xpReward;
      const progressPercent = (updatedXp / levelTargetXp) * 100;

      missionCard.classList.remove("is-completing");
      missionCard.classList.add("is-complete");
      completeMissionButton.hidden = true;
      missionSuccess.hidden = false;
      if (missionStatus) missionStatus.textContent = "Complete";

      if (xpValue) xpValue.textContent = updatedXp.toLocaleString("en-US");
      if (xpProgress) xpProgress.setAttribute("aria-valuenow", String(updatedXp));
      if (xpProgressFill) xpProgressFill.style.width = `${progressPercent}%`;
      if (xpPercent) xpPercent.textContent = `${Math.round(progressPercent)}% complete`;
      if (xpRemaining) xpRemaining.textContent = `${levelTargetXp - updatedXp} to next level`;

      window.requestAnimationFrame(() => missionSuccess.classList.add("is-visible"));
    }, revealDelay);
  };

  completeMissionButton?.addEventListener("click", completeFirstMission);

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
