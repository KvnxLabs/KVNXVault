"use strict";

// Supabase Auth is isolated behind this service. Application modules never
// call Supabase Auth directly.
(function initializeAuthService(root, factory) {
  const serviceFactory = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = serviceFactory;
  }

  if (root) root.KVNXAuthService = serviceFactory;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  const CONFIGURATION_ERROR = "supabase-configuration-required";

  const hasUsableConfiguration = (config = {}) => {
    const url = String(config.supabaseUrl || "").trim();
    const key = String(config.supabasePublishableKey || "").trim();

    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)
      && key.length > 20
      && !url.includes("YOUR_PROJECT_REF")
      && !key.includes("YOUR_SUPABASE");
  };

  const createConfigurationError = () => {
    const error = new Error("Supabase public configuration is required.");
    error.code = CONFIGURATION_ERROR;
    return error;
  };

  const createAuthService = (options = {}) => {
    const config = options.config || root?.KVNXConfig || {};
    const createClient = options.createClient || root?.supabase?.createClient;

    if (!options.client && (!hasUsableConfiguration(config) || typeof createClient !== "function")) {
      throw createConfigurationError();
    }

    const client = options.client || createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      },
    );

    const unwrap = async (operation) => {
      const { data, error } = await operation;
      if (error) throw error;
      return data;
    };

    const signUp = async ({ email, password, firstName, emailRedirectTo } = {}) => {
      const normalizedFirstName = String(firstName || "").trim();
      return unwrap(client.auth.signUp({
        email: String(email || "").trim(),
        password: String(password || ""),
        options: {
          data: { first_name: normalizedFirstName },
          ...(emailRedirectTo ? { emailRedirectTo } : {}),
        },
      }));
    };

    const signIn = ({ email, password } = {}) => unwrap(client.auth.signInWithPassword({
      email: String(email || "").trim(),
      password: String(password || ""),
    }));

    const signOut = () => unwrap(client.auth.signOut());

    const getCurrentSession = async () => {
      const data = await unwrap(client.auth.getSession());
      return data.session || null;
    };

    // getUser performs an authenticated request and is used for authorization-
    // sensitive decisions instead of trusting browser session payloads alone.
    const getCurrentUser = async () => {
      const data = await unwrap(client.auth.getUser());
      return data.user || null;
    };

    const observeAuthState = (callback) => {
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    };

    return Object.freeze({
      getClient: () => client,
      getCurrentSession,
      getCurrentUser,
      observeAuthState,
      signIn,
      signOut,
      signUp,
    });
  };

  return Object.freeze({
    CONFIGURATION_ERROR,
    createAuthService,
    hasUsableConfiguration,
  });
});
