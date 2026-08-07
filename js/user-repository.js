"use strict";

// All Supabase table and RPC knowledge lives here. Consumers work with KVNX
// domain objects rather than rows or query builders.
(function initializeUserRepository(root, factory) {
  const repositoryFactory = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = repositoryFactory;
  }

  if (root) root.KVNXUserRepository = repositoryFactory;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const createRepositoryError = (code, cause) => {
    const error = new Error("KVNX Vault could not access your saved data.");
    error.code = code;
    error.cause = cause;
    return error;
  };

  const createUserRepository = ({ authService, client } = {}) => {
    if (!authService || typeof authService.getCurrentUser !== "function") {
      throw new TypeError("An authentication service is required.");
    }

    const database = client || authService.getClient();

    const getAuthenticatedUser = async () => {
      let user;
      try {
        user = await authService.getCurrentUser();
      } catch (error) {
        throw createRepositoryError("session-unavailable", error);
      }
      if (!user) throw createRepositoryError("session-expired");
      return user;
    };

    const unwrap = async (operation, code) => {
      const { data, error } = await operation;
      if (error) throw createRepositoryError(code, error);
      return data;
    };

    const mapProfile = (row) => row ? Object.freeze({
      firstName: row.first_name || "",
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }) : null;

    const mapOnboarding = (row) => row ? Object.freeze({
      focus: Array.isArray(row.focus) ? [...row.focus] : [],
      primaryFocus: row.primary_focus || "",
      stage: row.current_stage || "",
      challenge: row.biggest_challenge || "",
      commitment: row.daily_commitment || "",
      vision: row.future_vision || "",
      intensity: row.intensity || "",
      completed: Boolean(row.completed),
    }) : null;

    const mapDailyMission = (row) => row ? Object.freeze({
      dailySessionId: row.daily_session_id,
      definition: Object.freeze({ ...row.mission_definition }),
      lifecycle: Object.freeze({
        state: row.lifecycle_state,
        completionAwarded: Boolean(row.completion_awarded),
      }),
      replacementsUsed: row.replacements_used,
      terminalAt: row.terminal_at,
      terminalRecorded: Boolean(row.terminal_recorded),
    }) : null;

    const mapHistory = (row) => Object.freeze({
      missionId: row.mission_id,
      title: row.title,
      focus: row.focus,
      finalState: row.final_state,
      xpAwarded: row.xp_awarded,
      terminalAt: row.terminal_at,
    });

    const loadProfile = async () => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("profiles").select("user_id, first_name, created_at, updated_at")
          .eq("user_id", user.id).maybeSingle(),
        "profile-load-failed",
      );
      return mapProfile(row);
    };

    const saveProfile = async ({ firstName } = {}) => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("profiles").upsert({
          user_id: user.id,
          first_name: String(firstName || "").trim(),
        }, { onConflict: "user_id" }).select("user_id, first_name, created_at, updated_at").single(),
        "profile-save-failed",
      );
      return mapProfile(row);
    };

    const loadOnboarding = async () => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("onboarding_profiles").select("*")
          .eq("user_id", user.id).maybeSingle(),
        "onboarding-load-failed",
      );
      return mapOnboarding(row);
    };

    const saveOnboarding = async (answers = {}) => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("onboarding_profiles").upsert({
          user_id: user.id,
          focus: Array.isArray(answers.focus) ? answers.focus : [],
          primary_focus: answers.primaryFocus || "",
          current_stage: answers.stage || "",
          biggest_challenge: answers.challenge || "",
          daily_commitment: answers.commitment || "",
          future_vision: answers.vision || "",
          intensity: answers.intensity || "",
          completed: Boolean(answers.completed),
        }, { onConflict: "user_id" }).select("*").single(),
        "onboarding-save-failed",
      );
      return mapOnboarding(row);
    };

    const loadProgression = async () => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("progression_state").select("total_xp")
          .eq("user_id", user.id).maybeSingle(),
        "progression-load-failed",
      );
      return row ? Object.freeze({ totalXP: row.total_xp }) : null;
    };

    const loadDailyMissionState = async (dailySessionId) => {
      const user = await getAuthenticatedUser();
      const row = await unwrap(
        database.from("daily_mission_state").select("*")
          .eq("user_id", user.id)
          .eq("daily_session_id", dailySessionId)
          .maybeSingle(),
        "mission-state-load-failed",
      );
      return mapDailyMission(row);
    };

    const loadMissionHistory = async (limit = 100) => {
      const user = await getAuthenticatedUser();
      const rows = await unwrap(
        database.from("mission_history").select("mission_id, title, focus, final_state, xp_awarded, terminal_at")
          .eq("user_id", user.id)
          .order("terminal_at", { ascending: false })
          .limit(Math.min(100, Math.max(1, Number(limit) || 100))),
        "mission-history-load-failed",
      );
      return Object.freeze((rows || []).map(mapHistory));
    };

    // Creates missing baseline rows without accepting an XP total. The database
    // owns the initial XP value. Mission rewards are not trusted by this call.
    const initializeVaultSession = async ({ dailySessionId, definition } = {}) => {
      await getAuthenticatedUser();
      return unwrap(database.rpc("initialize_vault_session", {
        p_daily_session_id: dailySessionId,
        p_mission_definition: definition,
      }), "vault-session-initialize-failed");
    };

    // Preferred durable mutation contract: the browser submits intent only.
    // Sprint 7.1's SQL boundary rejects mutation until Sprint 8 implements the
    // trusted transition and reward rules behind this exact interface.
    const requestMissionAction = async ({ missionId, action } = {}) => {
      await getAuthenticatedUser();
      const normalizedMissionId = String(missionId || "").trim();
      const normalizedAction = String(action || "").trim().toLowerCase();
      if (!normalizedMissionId) throw new TypeError("A mission id is required.");
      if (!["start", "complete", "skip", "expire"].includes(normalizedAction)) {
        throw new TypeError("A supported mission action is required.");
      }
      const result = await unwrap(database.rpc("request_vault_mission_action", {
        p_mission_id: normalizedMissionId,
        p_action: normalizedAction,
      }), "mission-action-request-failed");
      return Object.freeze({ ...(result || {}) });
    };

    // DEPRECATED TEST-COMPATIBILITY ADAPTER (Sprint 7 only).
    // The Sprint 7.1 migration revokes authenticated execution of this RPC, so
    // it cannot persist browser-calculated XP in a corrected database. Keep
    // only until the original Sprint 7 contract tests are retired in Sprint 8.
    const persistMissionTransition = async ({ dailyMission, totalXP, historyRecord = null }) => {
      await getAuthenticatedUser();
      return unwrap(database.rpc("persist_vault_transition", {
        p_completion_awarded: dailyMission.lifecycle.completionAwarded,
        p_daily_session_id: dailyMission.dailySessionId,
        p_history_record: historyRecord,
        p_lifecycle_state: dailyMission.lifecycle.state,
        p_mission_definition: dailyMission.definition,
        p_replacements_used: dailyMission.replacementsUsed,
        p_terminal_at: dailyMission.terminalAt || null,
        p_total_xp: totalXP,
      }), "deprecated-mission-transition-rejected");
    };

    return Object.freeze({
      initializeVaultSession,
      loadDailyMissionState,
      loadMissionHistory,
      loadOnboarding,
      loadProfile,
      loadProgression,
      persistMissionTransition,
      requestMissionAction,
      saveOnboarding,
      saveProfile,
    });
  };

  return Object.freeze({ createUserRepository });
});
