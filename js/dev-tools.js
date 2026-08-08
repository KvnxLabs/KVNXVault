"use strict";

(function initializeDevTools(root, factory) {
  const devTools = factory(root);

  if (typeof module === "object" && module.exports) module.exports = devTools;
  if (root) root.KVNXDevTools = devTools;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  const formatTestTime = (value) => new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));

  const createPanel = (documentRef) => {
    const panel = documentRef.createElement("section");
    panel.className = "dev-tools";
    panel.dataset.devToolsPanel = "true";
    panel.setAttribute("aria-labelledby", "dev-tools-title");
    panel.innerHTML = `
      <header class="dev-tools__header">
        <div>
          <p>Developer tools</p>
          <h2 id="dev-tools-title">Test environment only</h2>
        </div>
        <span>Internal</span>
      </header>
      <div class="dev-tools__clock">
        <span>Current test time</span>
        <strong data-dev-test-time>Loading…</strong>
        <small data-dev-clock-mode>Checking server gate</small>
      </div>
      <div class="dev-tools__actions" aria-label="Developer test actions">
        <button type="button" data-dev-action="advance-hour">Advance 1 Hour</button>
        <button type="button" data-dev-action="advance-day">Advance To Next Day</button>
        <button type="button" data-dev-action="request-mission">Request Daily Mission</button>
        <button type="button" data-dev-action="complete-mission">Complete Current Mission</button>
        <button type="button" data-dev-action="prepare-replacement">Prepare Replacement</button>
        <button type="button" data-dev-action="refresh">Refresh Authoritative State</button>
        <button type="button" data-dev-action="clear-clock">Clear Test Clock</button>
      </div>
      <p class="dev-tools__status" data-dev-status role="status" aria-live="polite"></p>
    `;
    return panel;
  };

  const initialize = async () => {
    if (!root?.document || !root.KVNXDevToolsRepository) return false;
    const protectedContext = await root.KVNXProtectedPage?.ready;
    if (!protectedContext) return false;

    const repository = root.KVNXDevToolsRepository.createDevToolsRepository({
      authService: protectedContext.authService,
    });

    let state;
    try {
      state = await repository.getTestState();
    } catch {
      // A failed server gate leaves no tooling UI behind.
      return false;
    }

    const mount = root.document.querySelector(".dashboard__inner");
    if (!mount || root.document.querySelector("[data-dev-tools-panel]")) return false;
    const panel = createPanel(root.document);
    mount.append(panel);

    const time = panel.querySelector("[data-dev-test-time]");
    const mode = panel.querySelector("[data-dev-clock-mode]");
    const status = panel.querySelector("[data-dev-status]");
    const buttons = [...panel.querySelectorAll("[data-dev-action]")];

    const renderState = (nextState) => {
      state = nextState;
      time.textContent = formatTestTime(nextState.simulatedNow);
      mode.textContent = nextState.testClockEnabled
        ? `Simulated clock · next reset ${formatTestTime(nextState.nextResetAt)}`
        : "Real database time · simulation cleared";
    };
    renderState(state);

    const setBusy = (busy) => {
      panel.setAttribute("aria-busy", String(busy));
      buttons.forEach((button) => { button.disabled = busy; });
    };

    const run = async (operation, successMessage, reload = false) => {
      let reloadStarted = false;
      setBusy(true);
      status.textContent = "Running authoritative development action…";
      try {
        const nextState = await operation();
        renderState(nextState);
        status.textContent = successMessage;
        if (reload) {
          reloadStarted = true;
          root.location.reload();
        }
      } catch {
        status.textContent = "Developer action unavailable. Verify the staging database gates and test-account allowlist.";
      } finally {
        if (!reloadStarted) setBusy(false);
      }
    };

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-dev-action]");
      if (!button) return;
      const action = button.dataset.devAction;

      if (action === "advance-hour") {
        run(repository.advanceOneHour, "Test time advanced by one hour.");
      } else if (action === "advance-day") {
        run(repository.advanceToNextDay, "Next authoritative day reached. Restoring Vault…", true);
      } else if (action === "clear-clock") {
        run(repository.clearTestClock, "Test clock cleared. Restoring real database time…", true);
      } else if (["request-mission", "refresh"].includes(action)) {
        root.location.reload();
      } else if (action === "complete-mission") {
        const missionButton = root.document.querySelector("[data-complete-mission]");
        if (missionButton && !missionButton.hidden && !missionButton.disabled) missionButton.click();
        else status.textContent = "The current authoritative mission cannot be completed from its present state.";
      } else if (action === "prepare-replacement") {
        const replacementButton = root.document.querySelector("[data-request-mission]");
        if (replacementButton && !replacementButton.hidden && !replacementButton.disabled) replacementButton.click();
        else status.textContent = "A replacement is not currently available.";
      }
    });

    return true;
  };

  return Object.freeze({ createPanel, formatTestTime, initialize });
});
