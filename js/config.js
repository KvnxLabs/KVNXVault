"use strict";

// Public browser configuration only. Replace the Supabase placeholders during
// setup. The Vault origin is deployment configuration, not domain logic; change
// this one value if the app later moves to https://vault.kvnxlabs.com.
// Never place a service-role key, database password, or private secret here.
window.KVNXConfig = Object.freeze({
  supabaseUrl: "https://dfxarwitsatmuzcaxepl.supabase.co",
  supabasePublishableKey: "sb_publishable_GALP6Ry639jW5dRWC8Eeew_t7qZGP9Q",
  vaultApplicationUrl: "https://kvnx-vault.vercel.app",
  authRedirectPath: "/login.html",
  // Development tooling is opt-in per build and independently gated by the
  // staging database. Keep false in every production deployment.
  devToolsEnabled: false,
  devToolsAllowedHosts: Object.freeze(["localhost", "127.0.0.1", "[::1]"]),
});
