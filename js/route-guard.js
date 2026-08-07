"use strict";

// Routing decisions are pure and reusable. Static-page redirects improve the
// experience; Supabase RLS remains the authoritative security boundary.
(function initializeRouteGuard(root, factory) {
  const routeGuard = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = routeGuard;
  }

  if (root) root.KVNXRouteGuard = routeGuard;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const ROUTES = Object.freeze({
    LOGIN: "login.html",
    ONBOARDING: "onboarding.html",
    DASHBOARD: "dashboard.html",
  });

  const getAuthenticatedDestination = ({ authenticated, onboardingComplete }) => {
    if (!authenticated) return ROUTES.LOGIN;
    return onboardingComplete ? ROUTES.DASHBOARD : ROUTES.ONBOARDING;
  };

  const evaluateProtectedRoute = ({ route, authenticated, onboardingComplete }) => {
    const destination = getAuthenticatedDestination({ authenticated, onboardingComplete });
    const expectedRoute = route === "dashboard" ? ROUTES.DASHBOARD : ROUTES.ONBOARDING;

    return Object.freeze({
      allowed: destination === expectedRoute,
      destination,
    });
  };

  const restoreRouteState = async ({ authService, repository }) => {
    const user = await authService.getCurrentUser();
    if (!user) {
      return Object.freeze({ authenticated: false, onboarding: null, user: null });
    }

    const onboarding = await repository.loadOnboarding();
    return Object.freeze({
      authenticated: true,
      onboarding,
      user,
    });
  };

  return Object.freeze({
    ROUTES,
    evaluateProtectedRoute,
    getAuthenticatedDestination,
    restoreRouteState,
  });
});
