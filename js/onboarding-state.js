"use strict";

// This synchronous cache preserves the onboarding UI contract. Durable state
// is owned by user-repository.js; no auth or product data is stored in browser
// sessionStorage or localStorage by this adapter.
window.KVNXOnboardingState = (() => {
  let state = {};

  const read = () => ({ ...state });

  const write = (nextState) => {
    state = { ...state, ...nextState };
    return read();
  };

  const clear = () => {
    state = {};
  };

  return { clear, read, write };
})();
