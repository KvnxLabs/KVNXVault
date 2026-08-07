"use strict";

// One namespace owns temporary onboarding state so future pages can reuse it.
window.KVNXOnboardingState = (() => {
  const storageKey = "kvnxVault.onboarding";

  const read = () => {
    try {
      return JSON.parse(window.sessionStorage.getItem(storageKey)) || {};
    } catch {
      return {};
    }
  };

  const write = (nextState) => {
    const state = { ...read(), ...nextState };

    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // The flow remains usable when browser storage is unavailable.
    }

    return state;
  };

  const clear = () => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // No action is needed when browser storage is unavailable.
    }
  };

  return { clear, read, write };
})();
