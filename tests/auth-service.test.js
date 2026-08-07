"use strict";

const assert = require("node:assert/strict");
const authFactory = require("../js/auth-service.js");

const tests = [];
const test = (name, run) => tests.push({ name, run });

const createFakeClient = () => {
  const calls = [];
  const user = { id: "user-a" };
  return {
    calls,
    auth: {
      signUp: async (payload) => { calls.push(["signUp", payload]); return { data: { user, session: null }, error: null }; },
      signInWithPassword: async (payload) => { calls.push(["signIn", payload]); return { data: { user, session: { user } }, error: null }; },
      signOut: async () => { calls.push(["signOut"]); return { data: {}, error: null }; },
      getSession: async () => ({ data: { session: { user } }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange: (callback) => {
        callback("INITIAL_SESSION", { user });
        return { data: { subscription: { unsubscribe: () => calls.push(["unsubscribe"]) } } };
      },
    },
  };
};

test("placeholder configuration is rejected safely", () => {
  assert.equal(authFactory.hasUsableConfiguration({
    supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
    supabasePublishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  }), false);
  assert.throws(() => authFactory.createAuthService({ config: {} }), (error) => (
    error.code === authFactory.CONFIGURATION_ERROR
  ));
});

test("signup sends first name as auth metadata", async () => {
  const client = createFakeClient();
  const service = authFactory.createAuthService({ client });
  const result = await service.signUp({
    email: " Doug@example.com ",
    password: "strong-password",
    firstName: " Doug ",
    emailRedirectTo: "https://kvnxlabs.com/login.html",
  });
  assert.equal(result.session, null);
  assert.deepEqual(client.calls[0][1], {
    email: "Doug@example.com",
    password: "strong-password",
    options: {
      data: { first_name: "Doug" },
      emailRedirectTo: "https://kvnxlabs.com/login.html",
    },
  });
});

test("session restoration, authenticated user verification, and sign-out use the auth boundary", async () => {
  const client = createFakeClient();
  const service = authFactory.createAuthService({ client });
  assert.equal((await service.getCurrentSession()).user.id, "user-a");
  assert.equal((await service.getCurrentUser()).id, "user-a");
  await service.signIn({ email: "doug@example.com", password: "password" });
  await service.signOut();
  assert.equal(client.calls.some(([name]) => name === "signIn"), true);
  assert.equal(client.calls.some(([name]) => name === "signOut"), true);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
