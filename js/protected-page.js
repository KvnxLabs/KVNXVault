"use strict";

// One bootstrap promise protects both application pages without duplicating
// session and onboarding routing logic.
window.KVNXProtectedPage = (() => {
  const route = document.body.dataset.protectedRoute;
  const ready = (async () => {
    try {
      const authService = window.KVNXAuthService.createAuthService();
      const repository = window.KVNXUserRepository.createUserRepository({ authService });
      const routeState = await window.KVNXRouteGuard.restoreRouteState({ authService, repository });
      const decision = window.KVNXRouteGuard.evaluateProtectedRoute({
        route,
        authenticated: routeState.authenticated,
        onboardingComplete: Boolean(routeState.onboarding?.completed),
      });

      if (!decision.allowed) {
        window.location.replace(decision.destination);
        return null;
      }

      document.documentElement.classList.remove("auth-pending");
      return Object.freeze({ authService, repository, routeState });
    } catch (error) {
      // Protected content never falls through to a stale placeholder state.
      // Login owns configuration and session-facing recovery messaging.
      window.location.replace("login.html");
      return null;
    }
  })();

  return Object.freeze({ ready });
})();
