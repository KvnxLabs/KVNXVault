"use strict";

const assert = require("node:assert/strict");
const repositoryFactory = require("../js/user-repository.js");

const captured = [];
const createBuilder = (table) => {
  let payload;
  const builder = {
    upsert(value, options) { payload = value; captured.push({ table, payload, options }); return builder; },
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    limit() { return Promise.resolve({ data: [], error: null }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    single() {
      return Promise.resolve({
        data: table === "profiles"
          ? { ...payload, created_at: "created", updated_at: "updated" }
          : payload,
        error: null,
      });
    },
  };
  return builder;
};

const client = {
  from: (table) => createBuilder(table),
  rpc: async (name, payload) => { captured.push({ name, payload }); return { data: null, error: null }; },
};
const authService = {
  getClient: () => client,
  getCurrentUser: async () => ({ id: "authenticated-user" }),
};
const repository = repositoryFactory.createUserRepository({ authService });

(async () => {
  await repository.saveProfile({ firstName: "Doug", userId: "attacker-controlled" });
  const profileWrite = captured.find(({ table }) => table === "profiles");
  assert.equal(profileWrite.payload.user_id, "authenticated-user");
  assert.notEqual(profileWrite.payload.user_id, "attacker-controlled");
  console.log("✓ repository derives row ownership from the authenticated user");

  await repository.persistMissionTransition({
    dailyMission: {
      dailySessionId: "browser:UTC:2026-08-07",
      definition: { id: "mission-1" },
      lifecycle: { state: "completed", completionAwarded: true },
      replacementsUsed: 0,
      terminalAt: "2026-08-07T12:00:00.000Z",
    },
    totalXP: 100,
    historyRecord: { missionId: "mission-1" },
  });
  const rpc = captured.find(({ name }) => name === "persist_vault_transition");
  assert.equal(Object.hasOwn(rpc.payload, "user_id"), false);
  assert.equal(Object.hasOwn(rpc.payload, "p_user_id"), false);
  console.log("✓ transactional persistence accepts no client-provided owner id");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
