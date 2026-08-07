"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const loginForm = document.querySelector("[data-login-form]");
  const signupForm = document.querySelector("[data-signup-form]");
  const form = loginForm || signupForm;
  if (!form) return;

  const message = document.querySelector("[data-auth-message]");
  const submitButton = form.querySelector('button[type="submit"]');
  const confirmation = document.querySelector("[data-auth-confirmation]");

  const showMessage = (text, type = "error") => {
    if (!message) return;
    message.textContent = text;
    message.dataset.type = type;
    message.hidden = !text;
  };

  const setLoading = (loading) => {
    form.setAttribute("aria-busy", String(loading));
    if (submitButton) {
      submitButton.disabled = loading;
      submitButton.querySelector("[data-submit-label]").textContent = loading
        ? (loginForm ? "Signing In..." : "Creating Account...")
        : (loginForm ? "Sign In" : "Create Account");
    }
  };

  const getFriendlyError = (error, context) => {
    if (error?.code === "supabase-configuration-required") {
      return "KVNX Vault authentication is not configured yet. Complete the Supabase setup in the project documentation.";
    }
    if (error?.code === "over_email_send_rate_limit") {
      return "Please wait a moment before requesting another confirmation email.";
    }
    if (context === "login") {
      return "We couldn't sign you in. Check your email and password, then try again.";
    }
    return "We couldn't create your account. Review your details and try again.";
  };

  let authService;
  let repository;
  try {
    authService = window.KVNXAuthService.createAuthService();
    repository = window.KVNXUserRepository.createUserRepository({ authService });

    const routeState = await window.KVNXRouteGuard.restoreRouteState({ authService, repository });
    if (routeState.authenticated) {
      window.location.replace(window.KVNXRouteGuard.getAuthenticatedDestination({
        authenticated: true,
        onboardingComplete: Boolean(routeState.onboarding?.completed),
      }));
      return;
    }
  } catch (error) {
    if (error?.code === "supabase-configuration-required") {
      showMessage(getFriendlyError(error));
      setLoading(true);
      return;
    }
    // A failed initial session check should not prevent a fresh sign-in attempt.
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage("");
    if (!form.reportValidity()) return;

    setLoading(true);
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      if (loginForm) {
        await authService.signIn({ email, password });
        const onboarding = await repository.loadOnboarding();
        window.location.assign(window.KVNXRouteGuard.getAuthenticatedDestination({
          authenticated: true,
          onboardingComplete: Boolean(onboarding?.completed),
        }));
        return;
      }

      const firstName = String(formData.get("firstName") || "").trim();
      const vaultOrigin = window.KVNXConfig?.vaultApplicationUrl || window.location.origin;
      const redirectPath = window.KVNXConfig?.authRedirectPath || "/login.html";
      const result = await authService.signUp({
        email,
        password,
        firstName,
        emailRedirectTo: new URL(redirectPath, vaultOrigin).href,
      });

      if (!result.session) {
        form.hidden = true;
        document.querySelector("[data-auth-intro]")?.setAttribute("hidden", "");
        if (confirmation) confirmation.hidden = false;
        return;
      }

      await repository.saveProfile({ firstName });
      window.location.assign("onboarding.html");
    } catch (error) {
      showMessage(getFriendlyError(error, loginForm ? "login" : "signup"));
      setLoading(false);
    }
  });
});
