"use strict";

const assert = require("node:assert/strict");
const routeGuard = require("../js/route-guard.js");

const cases = [
  [{ authenticated: false, onboardingComplete: false }, "login.html"],
  [{ authenticated: true, onboardingComplete: false }, "onboarding.html"],
  [{ authenticated: true, onboardingComplete: true }, "dashboard.html"],
];

cases.forEach(([state, destination]) => {
  assert.equal(routeGuard.getAuthenticatedDestination(state), destination);
  console.log(`✓ route resolves to ${destination}`);
});

assert.deepEqual(routeGuard.evaluateProtectedRoute({
  route: "dashboard",
  authenticated: false,
  onboardingComplete: false,
}), { allowed: false, destination: "login.html" });
console.log("✓ unauthenticated protected-page access is rejected");

(async () => {
  const restored = await routeGuard.restoreRouteState({
    authService: { getCurrentUser: async () => ({ id: "user-a" }) },
    repository: { loadOnboarding: async () => ({ completed: true }) },
  });
  assert.equal(restored.authenticated, true);
  assert.equal(restored.onboarding.completed, true);
  console.log("✓ authenticated session restoration loads onboarding state");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
