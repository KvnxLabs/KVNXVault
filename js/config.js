"use strict";

// Public browser configuration only. Replace the Supabase placeholders during
// setup. The Vault origin is deployment configuration, not domain logic; change
// this one value if the app later moves to https://vault.kvnxlabs.com.
// Never place a service-role key, database password, or private secret here.
window.KVNXConfig = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabasePublishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  vaultApplicationUrl: "https://kvnx-vault.vercel.app",
  authRedirectPath: "/login.html",
});
