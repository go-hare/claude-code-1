/**
 * Official 2.1.331 SetGoal (canonical wire name, legacy alias ProposeGoal) — yK / Qxe / ckr.
 */

export const SET_GOAL_TOOL_NAME = 'SetGoal'

/** Official Qxe — legacy alias for backwards-compatible tool lookup and permission rules. */
export const PROPOSE_GOAL_LEGACY_TOOL_NAME = 'ProposeGoal'

/** Backwards-compatible export pointing to canonical wire name `'SetGoal'`. */
export const PROPOSE_GOAL_TOOL_NAME = SET_GOAL_TOOL_NAME

/** Official ckr — schema + canonicalized-length cap. */
export const PROPOSE_GOAL_CONDITION_MAX_CHARS = 500

/** Official tengu_propose_goal — GB default false. */
export const PROPOSE_GOAL_GB_FLAG = 'tengu_propose_goal'
