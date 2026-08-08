"use strict";

// Isolated staging-only adapter. Every mutation is a zero-argument RPC; the
// authenticated owner and permitted time movement are selected in PostgreSQL.
(function initializeDevToolsRepository(root, factory) {
  const repositoryFactory = factory();

  if (typeof module === "object" && module.exports) module.exports = repositoryFactory;
  if (root) root.KVNXDevToolsRepository = repositoryFactory;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const createDevToolsError = (cause) => {
    const error = new Error("KVNX developer tools are unavailable.");
    error.code = "dev-tools-unavailable";
    error.cause = cause;
    return error;
  };

  const mapState = (result) => {
    if (!result || typeof result !== "object") throw createDevToolsError();
    const simulatedNow = String(result.simulatedNow || "");
    const realDatabaseNow = String(result.realDatabaseNow || "");
    const nextResetAt = String(result.nextResetAt || "");
    if (![simulatedNow, realDatabaseNow, nextResetAt]
      .every((value) => Number.isFinite(Date.parse(value)))) {
      throw createDevToolsError();
    }
    return Object.freeze({
      testClockEnabled: result.testClockEnabled === true,
      simulatedNow,
      realDatabaseNow,
      nextResetAt,
    });
  };

  const createDevToolsRepository = ({ authService, client } = {}) => {
    if (!authService || typeof authService.getCurrentUser !== "function") {
      throw new TypeError("An authentication service is required.");
    }
    const database = client || authService.getClient();

    const request = async (rpcName) => {
      let user;
      try {
        user = await authService.getCurrentUser();
      } catch (error) {
        throw createDevToolsError(error);
      }
      if (!user) throw createDevToolsError();

      const { data, error } = await database.rpc(rpcName);
      if (error) throw createDevToolsError(error);
      return mapState(data);
    };

    return Object.freeze({
      advanceOneHour: () => request("dev_advance_one_hour"),
      advanceToNextDay: () => request("dev_advance_to_next_day"),
      clearTestClock: () => request("dev_clear_test_clock"),
      getTestState: () => request("dev_get_test_state"),
    });
  };

  return Object.freeze({ createDevToolsRepository });
});
