/**
 * densable 2.1.239 ProposeGoal product strings — dOp / pOp / searchHint 1:1.
 */

import { PROPOSE_GOAL_CONDITION_MAX_CHARS } from './constants.js'

/** densable dOp */
export const DESCRIPTION =
  'Propose a session goal condition, with one-keypress user approval; once set, Claude keeps working until a separate evaluator confirms it is met'

/** densable pOp — ${AGn} interpolated. */
export const PROMPT = `Propose a completion condition for this session's work — a goal that keeps you working until a separate evaluator confirms it is met. Non-blocking: the proposal renders alongside your work, so keep working while it is handled.

ask_user true (the default) asks the user first, with a one-keypress approval dialog. If they decline you will not be notified — do not ask about the decision and do not re-propose the same or a reworded condition. Set ask_user false — which sets the goal directly, with no dialog — ONLY when the user's own words in this conversation stated this outcome as what they want; if you inferred it from their intent or the task's shape — or are in doubt — ask. Either path confirms a set goal with a kickoff message; until that message arrives, no new goal is active.

Propose only when the user has asked for an outcome with a verifiable end state ("make the tests pass", "migrate every call site") and the work spans multiple turns. Not for one-off tasks, and never to widen scope: the condition must follow from their request.

The evaluator verifies the condition from the conversation alone — it cannot run commands or read files — so state one measurable end state with its check (e.g. "bun test exits 0"), in at most ${PROPOSE_GOAL_CONDITION_MAX_CHARS} characters. One goal is active at a time; a newly approved or directly set proposal replaces the current one.`

/** densable searchHint */
export const SEARCH_HINT =
  'propose a session goal condition for the user to approve with one keypress'

export const CONDITION_SCHEMA_DESCRIPTION = `The completion condition to propose, written so a separate evaluator can verify it from the conversation (e.g. "all tests in test/auth pass (bun test exits 0)"). At most ${PROPOSE_GOAL_CONDITION_MAX_CHARS} characters — the user must be able to read the whole condition in the approval dialog.`

export const ASK_USER_SCHEMA_DESCRIPTION =
  "Whether to ask the user for approval before the goal is set. Defaults to true — an approval dialog is shown. Set false ONLY when the user's own words in this conversation stated this outcome as what they want; the goal is then set directly, with a visible notice in the transcript, and the user can clear it with /goal clear."

export const OUTPUT_CONDITION_DESCRIPTION =
  'The condition shown to the user for approval, or set directly when ask_user was false'

export const OUTPUT_ASK_USER_DESCRIPTION =
  'Whether the user was asked for approval (true) or the goal was set directly (false)'

/** densable mapToolResultToToolResultBlockParam — askUser false */
export const TOOL_RESULT_DIRECT =
  'Setting the goal now, without an approval dialog — the user sees it being set and can clear it with /goal clear. It becomes active at the end of this turn, when you will receive a kickoff message confirming it; until that message arrives, any previously set goal remains in effect. Continue working — do not wait for the kickoff.'

/** densable mapToolResultToToolResultBlockParam — askUser true */
export const TOOL_RESULT_ASK_USER =
  'Shown the goal proposal to the user for approval. Continue working — do not wait for their decision. If they approve, the proposed goal is set and you will receive a kickoff message; until then, no new goal is active — any previously set goal remains in effect. If they decline you will not be notified — do not ask about the decision or re-propose the same condition.'
