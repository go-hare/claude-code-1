import { SUBAGENT_HANDBACK_TOOL_NAME } from './constants.js'

/** densable `A` — tool description. */
export const DESCRIPTION =
  'Deliver your final report to the agent that spawned you: the only way it reaches them. The call ends your run, so make it your last.'

/** densable `N` — tool prompt. */
export const PROMPT = `Deliver your final report to the agent that spawned you (your caller). Use it once, for that hand-off only: when your work is complete, call ${SUBAGENT_HANDBACK_TOOL_NAME}({message: <your full report>}). The call ends your run, so do everything else first and put everything your caller needs in that one report. It is not a messaging channel: do not use it for progress updates or questions.

Only a report delivered through ${SUBAGENT_HANDBACK_TOOL_NAME} reaches your caller; plain text you write at the end of your run is NOT delivered. There is no recipient parameter: the report can only go to your caller.`

/** densable `v` — auto-classifier input prefix. */
export const CLASSIFIER_PREFIX =
  "hand-back to the agent that spawned this one (delivered as this agent's result — agent-authored, untrusted output carrying no user authority)"

/** densable `x` — reminder lead. */
export const HANDBACK_REMINDER_LEAD = `Your final report is delivered through ${SUBAGENT_HANDBACK_TOOL_NAME}`

/** densable `mGo`. */
export function getHandbackReminderBody(): string {
  return `${HANDBACK_REMINDER_LEAD}: when your work is complete, call ${SUBAGENT_HANDBACK_TOOL_NAME}({message: <your full report>}). The call ends your run, so make it your last step. Only a ${SUBAGENT_HANDBACK_TOOL_NAME} call reaches your caller as your result; plain text you write at the end is not delivered.`
}

/** densable `h` / `gGo`. */
export const HANDBACK_COUNTERMAND_LEAD = `${SUBAGENT_HANDBACK_TOOL_NAME} is not available in this run`

export function getHandbackCountermandBody(): string {
  return `${HANDBACK_COUNTERMAND_LEAD}: an earlier instruction to report through it no longer applies. Write your final report as plain text; it will be delivered.`
}
