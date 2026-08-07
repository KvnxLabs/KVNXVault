"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const signupForm = document.querySelector("[data-signup-form]");
  if (!signupForm || !window.KVNXOnboardingState) return;

  // Sprint 2 captures only the first name; no account data is submitted or stored.
  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!signupForm.reportValidity()) return;

    const formData = new FormData(signupForm);
    const firstName = String(formData.get("firstName") || "").trim();

    window.KVNXOnboardingState.clear();
    window.KVNXOnboardingState.write({ firstName });
    window.location.assign("onboarding.html");
  });
});
