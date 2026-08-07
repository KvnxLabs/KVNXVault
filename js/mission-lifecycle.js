"use strict";

// Mission lifecycle owns state transitions and validated mission events.
// Mission definitions remain unchanged and separate from this state model.
(function initializeMissionLifecycle(root, factory) {
  const lifecycle = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = lifecycle;
  }

  if (root) root.KVNXMissionLifecycle = lifecycle;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MISSION_STATES = Object.freeze({
    READY: "ready",
    ACTIVE: "active",
    COMPLETED: "completed",
    SKIPPED: "skipped",
    EXPIRED: "expired",
  });

  const MISSION_ACTIONS = Object.freeze({
    START: "start",
    COMPLETE: "complete",
    SKIP: "skip",
    EXPIRE: "expire",
  });

  const ACTION_TARGETS = Object.freeze({
    [MISSION_ACTIONS.START]: MISSION_STATES.ACTIVE,
    [MISSION_ACTIONS.COMPLETE]: MISSION_STATES.COMPLETED,
    [MISSION_ACTIONS.SKIP]: MISSION_STATES.SKIPPED,
    [MISSION_ACTIONS.EXPIRE]: MISSION_STATES.EXPIRED,
  });

  const VALID_TRANSITIONS = Object.freeze({
    [MISSION_STATES.READY]: Object.freeze([
      MISSION_STATES.ACTIVE,
      MISSION_STATES.COMPLETED,
      MISSION_STATES.SKIPPED,
      MISSION_STATES.EXPIRED,
    ]),
    [MISSION_STATES.ACTIVE]: Object.freeze([
      MISSION_STATES.COMPLETED,
      MISSION_STATES.SKIPPED,
      MISSION_STATES.EXPIRED,
    ]),
    [MISSION_STATES.COMPLETED]: Object.freeze([]),
    [MISSION_STATES.SKIPPED]: Object.freeze([]),
    [MISSION_STATES.EXPIRED]: Object.freeze([]),
  });

  const EVENT_TYPES = Object.freeze({
    [MISSION_ACTIONS.START]: "mission.started",
    [MISSION_ACTIONS.COMPLETE]: "mission.completed",
    [MISSION_ACTIONS.SKIP]: "mission.skipped",
    [MISSION_ACTIONS.EXPIRE]: "mission.expired",
    REJECTED: "mission.transition-rejected",
  });

  const normalizeXP = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
  };

  const createTimestamp = (clock) => {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  };

  const createState = (missionId, state = MISSION_STATES.READY, completionAwarded = false) =>
    Object.freeze({
      missionId,
      state,
      completionAwarded: Boolean(completionAwarded),
    });

  const createSnapshot = (missionState) => {
    const allowedStates = VALID_TRANSITIONS[missionState.state] || [];

    return Object.freeze({
      missionId: missionState.missionId,
      state: missionState.state,
      completionAwarded: missionState.completionAwarded,
      isTerminal: allowedStates.length === 0,
      canStart: allowedStates.includes(MISSION_STATES.ACTIVE),
      canComplete: allowedStates.includes(MISSION_STATES.COMPLETED),
      canSkip: allowedStates.includes(MISSION_STATES.SKIPPED),
      canExpire: allowedStates.includes(MISSION_STATES.EXPIRED),
    });
  };

  const transitionState = (missionState, action, missionDefinition, clock = () => new Date()) => {
    const targetState = ACTION_TARGETS[action];
    const allowedStates = VALID_TRANSITIONS[missionState.state] || [];
    const isValid = Boolean(targetState && allowedStates.includes(targetState));
    const previousState = missionState.state;
    const nextState = isValid
      ? createState(
          missionState.missionId,
          targetState,
          missionState.completionAwarded || action === MISSION_ACTIONS.COMPLETE,
        )
      : missionState;
    const xpAwarded = isValid && action === MISSION_ACTIONS.COMPLETE && !missionState.completionAwarded
      ? normalizeXP(missionDefinition.xpReward)
      : 0;

    const event = Object.freeze({
      missionId: missionState.missionId,
      previousState,
      currentState: nextState.state,
      eventType: isValid ? EVENT_TYPES[action] : EVENT_TYPES.REJECTED,
      requestedAction: action,
      xpAwarded,
      timestamp: createTimestamp(clock),
    });

    return Object.freeze({
      accepted: isValid,
      reason: isValid ? null : "invalid-transition",
      missionState: nextState,
      snapshot: createSnapshot(nextState),
      event,
    });
  };

  const createMissionLifecycle = (missionDefinition, options = {}) => {
    if (!missionDefinition || !String(missionDefinition.id || "").trim()) {
      throw new TypeError("A mission definition with an id is required.");
    }

    const initialState = options.initialState || MISSION_STATES.READY;
    if (!Object.values(MISSION_STATES).includes(initialState)) {
      throw new TypeError(`Unknown mission state: ${initialState}`);
    }

    const clock = typeof options.clock === "function" ? options.clock : () => new Date();
    let missionState = createState(
      String(missionDefinition.id),
      initialState,
      initialState === MISSION_STATES.COMPLETED,
    );

    const dispatch = (action) => {
      const result = transitionState(missionState, action, missionDefinition, clock);
      missionState = result.missionState;
      return result;
    };

    return Object.freeze({
      getSnapshot: () => createSnapshot(missionState),
      dispatch,
      start: () => dispatch(MISSION_ACTIONS.START),
      complete: () => dispatch(MISSION_ACTIONS.COMPLETE),
      skip: () => dispatch(MISSION_ACTIONS.SKIP),
      expire: () => dispatch(MISSION_ACTIONS.EXPIRE),
    });
  };

  return Object.freeze({
    MISSION_STATES,
    MISSION_ACTIONS,
    EVENT_TYPES,
    VALID_TRANSITIONS,
    createMissionLifecycle,
    transitionState,
  });
});
