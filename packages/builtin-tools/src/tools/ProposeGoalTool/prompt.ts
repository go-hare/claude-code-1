/**
 * Official 2.1.331 SetGoal product strings — oEl / rEl / sEl / searchHint 1:1.
 */

import { PROPOSE_GOAL_CONDITION_MAX_CHARS } from './constants.js'

/** Official oEl — whenToUse summary. */
export const WHEN_TO_USE =
  'Set a session goal, a stop check that keeps you working until it is met, when the user asks you to set one (such as by naming /goal or set_goal)'

/** Official rEl */
export const DESCRIPTION =
  'Set a session goal, a stop check that keeps Claude working until a separate evaluator confirms it is met, asking the user first unless their own words stated it'

/** Official sEl — ${ckr} interpolated. */
export const PROMPT = `Set a completion condition for this session's work — a goal enforced by a stop check, which keeps you working until a separate evaluator confirms it is met. Non-blocking: a request for approval renders alongside your work, so keep working while it is handled.

ask_user true (the default) asks the user first, with an approval dialog. If they decline you will not be notified — do not ask about the decision and do not re-propose the same or a reworded condition. Set ask_user false — which sets the goal directly, with no dialog — ONLY when the user's own words in this conversation stated this outcome as what they want; if you inferred it from their intent or the task's shape — or are in doubt — ask. While a goal is active the user is always asked, whatever ask_user says, and the current goal stays in force unless they approve. An approval reaches you as a "Goal set" message; until it does, the proposed goal is not set. You cannot see whether a proposal is still waiting or was declined, so never say it is pending; GetGoal shows the goal in force. Once a goal is set, work toward it without asking what to do. It clears by itself once met, so do not tell the user to run /goal clear after success.

Set a goal only when the user has asked for an outcome with a verifiable end state ("make the tests pass", "migrate every call site") and the work spans multiple turns. Not for one-off tasks, and never to widen scope: the condition must follow from their request.

The evaluator verifies the condition from the conversation alone — it cannot run commands or read files — so state one measurable end state with its check (e.g. "bun test exits 0"), in at most ${PROPOSE_GOAL_CONDITION_MAX_CHARS} characters. One stop-check goal is active at a time; a newly approved goal replaces the current one.`

/** Official searchHint */
export const SEARCH_HINT =
  'set a session goal condition, asking the user first (set_goal)'

export const CONDITION_SCHEMA_DESCRIPTION = `The completion condition to set, written so a separate evaluator can verify it from the conversation (e.g. "all tests in test/auth pass (bun test exits 0)"). At most ${PROPOSE_GOAL_CONDITION_MAX_CHARS} characters — the user must be able to read the whole condition in the approval dialog.`

export const ASK_USER_SCHEMA_DESCRIPTION =
  "Whether to ask the user for approval before the goal is set. Defaults to true — an approval dialog is shown. Set false ONLY when the user's own words in this conversation stated this outcome as what they want; the goal is then set directly, with a visible notice in the transcript, and the user can clear it with /goal clear. While a goal is active the dialog is shown whatever this says."

export const OUTPUT_CONDITION_DESCRIPTION =
  'The condition shown to the user for approval, or set directly'

export const OUTPUT_ASK_USER_DESCRIPTION =
  'Whether the user was asked for approval (true) or the goal was set directly (false)'

/** Official mapToolResultToToolResultBlockParam — askUser false */
export const TOOL_RESULT_DIRECT =
  'The goal is set, without an approval dialog. The user can see it and can clear it with /goal clear. The stop check applies from your next stop.'

/** Official mapToolResultToToolResultBlockParam — askUser true */
export const TOOL_RESULT_ASK_USER =
  'Sent the goal proposal to the user for approval. If they approve, any previously set goal ends, the proposed goal is set, and you will receive a "Goal set" message; until they answer, any previously set goal remains in effect. A decline is not reported.'
