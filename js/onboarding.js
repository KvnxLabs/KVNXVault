"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const protectedContext = await window.KVNXProtectedPage?.ready;
  if (!protectedContext) return;

  const repository = protectedContext.repository;
  const stateStore = window.KVNXOnboardingState;
  const form = document.querySelector("[data-onboarding-form]");
  const steps = [...document.querySelectorAll("[data-step]")];
  const beginButton = document.querySelector("[data-begin]");
  const backButton = document.querySelector("[data-back]");
  const nextButton = document.querySelector("[data-next]");
  const controls = document.querySelector("[data-controls]");
  const progress = document.querySelector("[data-progress]");
  const progressLabel = document.querySelector("[data-progress-label]");
  const progressName = document.querySelector("[data-progress-name]");
  const progressTrack = document.querySelector("[data-progress-track]");
  const progressFill = document.querySelector("[data-progress-fill]");
  const errorMessage = document.querySelector("[data-step-error]");
  const vision = document.querySelector("#future-vision");
  const visionCount = document.querySelector("[data-vision-count]");
  const focusInputs = [...document.querySelectorAll('input[name="focus"]')];
  const focusStatus = document.querySelector("[data-focus-status]");
  const vaultIntro = document.querySelector("[data-vault-intro]");

  if (!form || !stateStore || !steps.length) return;

  const questionSteps = ["focus", "stage", "challenge", "commitment", "vision", "intensity"];
  const stepNames = ["Direction", "Starting point", "Challenge", "Commitment", "Vision", "Intensity"];
  let currentIndex = -1;

  const clearError = () => {
    if (!errorMessage) return;
    errorMessage.hidden = true;
    errorMessage.textContent = "";
  };

  const showError = (message, target) => {
    if (!errorMessage) return;
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    target?.focus();
  };

  try {
    const profile = await repository.loadProfile();
    stateStore.write({ firstName: profile?.firstName || "" });
  } catch (error) {
    if (["session-expired", "session-unavailable"].includes(error?.code)) {
      window.location.replace("login.html");
      return;
    }
    showError("We couldn't load your profile. Refresh the page to try again.");
  }

  const updateCustomFields = () => {
    document.querySelectorAll("[data-custom-field]").forEach((field) => {
      const group = field.dataset.customField;
      const toggle = document.querySelector(`[data-custom-toggle="${group}"]`);
      const shouldShow = Boolean(toggle?.checked);
      field.hidden = !shouldShow;
      field.querySelector("input").required = shouldShow;
    });
  };

  const updateFocusLimit = () => {
    const selectedCount = focusInputs.filter((input) => input.checked).length;
    const limitReached = selectedCount >= 3;

    focusInputs.forEach((input) => {
      const shouldDisable = limitReached && !input.checked;
      input.disabled = shouldDisable;
      input.closest(".choice-pill")?.classList.toggle("is-limit-disabled", shouldDisable);
    });

    if (focusStatus) {
      focusStatus.textContent = `${selectedCount} of 3 selected`;
    }

    updateCustomFields();
  };

  const focusCurrentStep = () => {
    const activeStep = steps.find((step) => !step.hidden);
    const firstControl = activeStep?.querySelector("input, textarea, button");
    firstControl?.focus({ preventScroll: true });
  };

  const showStep = (index) => {
    currentIndex = index;
    clearError();

    steps.forEach((step) => {
      const isCurrent = index === -1 ? step.dataset.step === "welcome" : step.dataset.step === questionSteps[index];
      step.hidden = !isCurrent;
      step.classList.toggle("is-active", isCurrent);
    });

    const isQuestion = index >= 0;
    progress.hidden = !isQuestion;
    controls.hidden = !isQuestion;

    if (isQuestion) {
      const stepNumber = index + 1;
      progressLabel.textContent = `Step ${stepNumber} of ${questionSteps.length}`;
      progressName.textContent = stepNames[index];
      progressTrack.setAttribute("aria-valuenow", String(stepNumber));
      progressFill.style.width = `${(stepNumber / questionSteps.length) * 100}%`;
      backButton.hidden = false;
      const label = index === questionSteps.length - 1 ? "Enter the Vault" : "Continue";
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      nextButton.replaceChildren(document.createTextNode(`${label} `), arrow);
    }

    window.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(focusCurrentStep);
  };

  const getCheckedValue = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || "";

  const validateCurrentStep = () => {
    const stepName = questionSteps[currentIndex];

    if (stepName === "focus") {
      const selected = focusInputs.filter((input) => input.checked);
      if (!selected.length) {
        showError("Choose at least one area to continue.", focusInputs[0]);
        return false;
      }

      const customInput = form.elements.focusCustom;
      if (selected.some((input) => input.value === "Custom") && !customInput.value.trim()) {
        showError("Tell Vault what custom focus you have in mind.", customInput);
        return false;
      }
    }

    if (["stage", "challenge", "commitment", "intensity"].includes(stepName)) {
      const firstInput = form.querySelector(`input[name="${stepName}"]`);
      if (!getCheckedValue(stepName)) {
        showError("Choose the option that fits you best.", firstInput);
        return false;
      }
    }

    if (stepName === "challenge" && getCheckedValue("challenge") === "Custom") {
      const customInput = form.elements.challengeCustom;
      if (!customInput.value.trim()) {
        showError("Tell Vault what challenge you want to overcome.", customInput);
        return false;
      }
    }

    return true;
  };

  const collectAnswers = () => {
    const focusCustom = form.elements.focusCustom.value.trim();
    const focus = focusInputs
      .filter((input) => input.checked)
      .map((input) => (input.value === "Custom" ? focusCustom : input.value));
    const challengeValue = getCheckedValue("challenge");

    return {
      focus,
      primaryFocus: focus[0],
      stage: getCheckedValue("stage"),
      challenge: challengeValue === "Custom"
        ? form.elements.challengeCustom.value.trim()
        : challengeValue,
      commitment: getCheckedValue("commitment"),
      vision: vision.value.trim(),
      intensity: getCheckedValue("intensity"),
      completed: true,
    };
  };

  const revealAfter = (element, delay) => {
    window.setTimeout(() => element?.classList.add("is-visible"), delay);
  };

  const startVaultIntro = async () => {
    const answers = collectAnswers();
    nextButton.disabled = true;
    nextButton.setAttribute("aria-busy", "true");
    let persistedAnswers;
    try {
      persistedAnswers = await repository.saveOnboarding(answers);
    } catch (error) {
      if (["session-expired", "session-unavailable"].includes(error?.code)) {
        window.location.replace("login.html");
        return;
      }
      nextButton.disabled = false;
      nextButton.removeAttribute("aria-busy");
      showError("We couldn't save your setup. Your answers are still here—please try again.", nextButton);
      return;
    }

    const state = stateStore.write(persistedAnswers);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      window.location.assign("dashboard.html");
      return;
    }
    const firstName = String(state.firstName || "").trim();
    const welcome = document.querySelector("[data-intro-welcome]");
    const mark = document.querySelector(".vault-intro__mark");
    const journey = document.querySelector('[data-intro-line="journey"]');
    const today = document.querySelector('[data-intro-line="today"]');
    const preparing = document.querySelector('[data-intro-line="preparing"]');
    const tasks = [...document.querySelectorAll("[data-intro-task]")];

    welcome.textContent = firstName ? `Welcome, ${firstName}.` : "Welcome to the Vault.";
    vaultIntro.hidden = false;
    document.querySelector(".onboarding-header")?.setAttribute("aria-hidden", "true");
    document.querySelector(".onboarding")?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => vaultIntro.classList.add("is-visible"));
    revealAfter(mark, 240);
    revealAfter(welcome, 650);
    revealAfter(journey, 1150);
    revealAfter(today, 1650);
    revealAfter(preparing, 2250);
    tasks.forEach((task, index) => revealAfter(task, 2800 + index * 430));

    window.setTimeout(() => vaultIntro.classList.add("is-leaving"), 4850);
    window.setTimeout(() => window.location.assign("dashboard.html"), 5450);
  };

  beginButton?.addEventListener("click", () => showStep(0));
  backButton?.addEventListener("click", () => showStep(currentIndex - 1));
  nextButton?.addEventListener("click", async () => {
    clearError();
    if (!validateCurrentStep()) return;

    if (currentIndex === questionSteps.length - 1) {
      await startVaultIntro();
      return;
    }

    showStep(currentIndex + 1);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    nextButton?.click();
  });

  form.addEventListener("change", (event) => {
    clearError();
    if (event.target.name === "focus") updateFocusLimit();
    if (["focus", "challenge"].includes(event.target.name)) updateCustomFields();
  });

  vision?.addEventListener("input", () => {
    visionCount.textContent = `${vision.value.length} / 500`;
  });

  updateFocusLimit();
  updateCustomFields();
});
