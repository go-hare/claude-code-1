/**
 * Message constants, interruption/rejection/classifier denial helpers, synthetic message predicates, and system-reminder wrappers.
 */

import { isAutoMemoryEnabled } from '../../memdir/paths.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import { shouldShowSettingsHint } from '../hideSettingsHint.js'
import {
  formatServerUnavailableInputTooLongDetail,
  SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
} from '../permissions/autoModeUnavailable.js'

const MEMORY_CORRECTION_HINT =
  "\n\nNote: The user's next message may contain a correction or preference. Pay close attention — if they explain what went wrong or how they'd prefer you to work, consider saving that to memory for future sessions."

export const TOOL_REFERENCE_TURN_BOUNDARY = 'Tool loaded.'

/**
 * Appends a memory correction hint to a rejection/cancellation message
 * when auto-memory is enabled and the GrowthBook flag is on.
 */
export function withMemoryCorrectionHint(message: string): string {
  if (
    isAutoMemoryEnabled() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_prism', false)
  ) {
    return message + MEMORY_CORRECTION_HINT
  }
  return message
}

/**
 * Derive a short stable message ID (6-char base36 string) from a UUID.
 * Used for snip tool referencing — injected into API-bound messages as [id:...] tags.
 * Deterministic: same UUID always produces the same short ID.
 */
export function deriveShortMessageId(uuid: string): string {
  // Take first 10 hex chars from the UUID (skipping dashes)
  const hex = uuid.replace(/-/g, '').slice(0, 10)
  // Convert to base36 for shorter representation, take 6 chars
  return parseInt(hex, 16).toString(36).slice(0, 6)
}

export const INTERRUPT_MESSAGE = '[Request interrupted by user]'

export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'

/** densable `Q0` — aTe prefix for plugin-cancelled tool_use. */
export const INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE =
  '[Request interrupted by a plugin for tool use]'

/** densable `foe` — StreamingToolExecutor user_interrupted toolUseResult. */
export const USER_REJECTED_TOOL_USE = 'User rejected tool use'

/**
 * Official 2.1.296 (#499) `zKn`: tool result text for tool calls interrupted
 * by session shutdown so resumed subagents are not told the user rejected them.
 */
export const SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE =
  'The tool call was interrupted before a result was received. It may or may not have completed on the server — verify before assuming it succeeded, and retry if needed.'

export const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."

export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."

/** v2.1.314 (#1399): SEA fbn — stopped-while-running correction for remote-cancel */
export const STOPPED_WHILE_RUNNING_REJECT_MESSAGE = `${REJECT_MESSAGE} Correction to the text above: this call was stopped while running, not refused before it ran. It may have run in part or in full, and its changes may have been written. No permission prompt was involved. Work it started elsewhere (a remote command, a background process) may still be running, so check before starting the same work again. The instruction to stop and wait still stands.`

export const REJECT_MESSAGE_WITH_REASON_PREFIX =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n"

export const SUBAGENT_REJECT_MESSAGE =
  'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.'

export const SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX =
  'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user said:\n'

export const PLAN_REJECTION_PREFIX =
  'The agent proposed a plan that was rejected by the user. The user chose to stay in plan mode rather than proceed with implementation.\n\nRejected plan:\n'

/** densable `aTe` — Nvo interrupt content prefixes. */
const INTERRUPT_TOOL_RESULT_PREFIXES = [
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE,
  CANCEL_MESSAGE,
] as const

/**
 * Bash/PowerShell mapToolResult abort tag. Mid-run Esc kills the process and
 * writes this into the tool_result body — not an aTe prefix.
 */
const COMMAND_ABORTED_ERROR_TAG =
  '<error>Command was aborted before completion</error>'

function isInterruptedToolUseResult(value: unknown): boolean {
  if (value === USER_REJECTED_TOOL_USE) return true
  return (
    typeof value === 'object' &&
    value !== null &&
    'interrupted' in value &&
    (value as { interrupted?: unknown }).interrupted === true
  )
}

/**
 * densable `Nvo` / `qn.interruptedCall`.
 * Collapse uses this so "Ran 1 shell command" is not the only signal when
 * a command in the group was cut (2.1.246 #12).
 *
 * Mid-run shell abort is `is_error` + `toolUseResult.interrupted` (TUI
 * equivalent of Desktop `calls[].interrupted`) or the abort error tag.
 * foe / aTe still cover permission-reject synthetics.
 */
export function interruptedCall(
  message:
    | {
        type?: string
        message?: { content?: unknown }
        toolUseResult?: unknown
      }
    | undefined
    | null,
): boolean {
  if (message?.type !== 'user') return false
  const content = message.message?.content
  const first = Array.isArray(content) ? content.at(0) : undefined
  if (
    first === undefined ||
    typeof first !== 'object' ||
    first === null ||
    !('type' in first) ||
    first.type !== 'tool_result' ||
    !('is_error' in first) ||
    first.is_error !== true
  ) {
    return false
  }
  if (isInterruptedToolUseResult(message.toolUseResult)) return true
  const body = 'content' in first ? first.content : undefined
  return (
    typeof body === 'string' &&
    (INTERRUPT_TOOL_RESULT_PREFIXES.some(prefix => body.startsWith(prefix)) ||
      body.includes(COMMAND_ABORTED_ERROR_TAG))
  )
}

/**
 * Shared guidance for permission denials, instructing the model on appropriate workarounds.
 */
export const DENIAL_WORKAROUND_GUIDANCE =
  `IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, ` +
  `e.g. using head instead of cat. But you *should not* attempt to work around this denial in malicious ways, ` +
  `e.g. do not use your ability to run tests to execute non-test actions. ` +
  `You should only try to work around this restriction in reasonable ways that do not attempt to bypass the intent behind this denial. ` +
  `If you believe this capability is essential to complete the user's request, STOP and explain to the user ` +
  `what you were trying to do and why you need this permission. Let the user decide how to proceed.`

export function AUTO_REJECT_MESSAGE(toolName: string): string {
  return `Permission to use ${toolName} has been denied. ${DENIAL_WORKAROUND_GUIDANCE}`
}

export function DONT_ASK_REJECT_MESSAGE(toolName: string): string {
  return `Permission to use ${toolName} has been denied because Claude Code is running in don't ask mode. ${DENIAL_WORKAROUND_GUIDANCE}`
}

export const NO_RESPONSE_REQUESTED = 'No response requested.'

// Synthetic tool_result content inserted by ensureToolResultPairing when a
// tool_use block has no matching tool_result. Exported so HFI submission can
// reject any payload containing it — placeholder satisfies pairing structurally
// but the content is fake, which poisons training data if submitted.
export const SYNTHETIC_TOOL_RESULT_PLACEHOLDER =
  '[Tool result missing due to internal error]'

// Prefix used by UI to detect classifier denials and render them concisely
const AUTO_MODE_REJECTION_PREFIX =
  'Permission for this action has been denied. Reason: '

/**
 * Check if a tool result message is a classifier denial.
 * Used by the UI to render a short summary instead of the full message.
 */
export function isClassifierDenial(content: string): boolean {
  return content.startsWith(AUTO_MODE_REJECTION_PREFIX)
}

/**
 * densable `HSa` — auto mode classifier denial message.
 * When `refused` (stop_reason=refusal), use the no-retry / no-rewrite copy;
 * otherwise the transient retry guidance + settings hint path.
 */
export function buildYoloRejectionMessage(
  reason: string,
  opts?: { refused?: boolean; allowRuleToolName?: string },
): string {
  if (opts?.refused) {
    // densable HSa(e,{refused:!0}) — no AUTO_MODE_REJECTION_PREFIX (distinct copy)
    return (
      `${reason}. This is not a judgment that the action is unsafe. ` +
      `Retrying it will hit the same refusal, so don't rewrite or rework the action to get around this — ` +
      `it reacts to earlier conversation content, not to the action itself, and it will keep firing for the rest of this conversation. ` +
      `Continue with other tasks that don't require this action. If it is essential, stop and tell the user that auto mode could not evaluate it, ` +
      `and suggest running this action outside auto mode (switch back to the default permission mode) or starting a fresh session.`
    )
  }

  const prefix = AUTO_MODE_REJECTION_PREFIX

  // Official CXa / Bvo — suppress settings/config permission-rule hint for remote
  // entrypoints, when CLAUDE_CODE_HIDE_SETTINGS_HINT is set, or when no safe
  // allowRuleToolName is eligible (#64: never suggest whole-tool classifier-skipping
  // or ignored rules).
  const showSettingsHint = shouldShowSettingsHint()
  const ruleHint =
    !showSettingsHint || opts?.allowRuleToolName === undefined
      ? ''
      : `To allow this type of action in the future, the user can add a permission rule for ${opts.allowRuleToolName} to their settings.`

  return (
    `${prefix}${reason}. ` +
    `If you have other tasks that don't depend on this action, continue working on those. ` +
    `${DENIAL_WORKAROUND_GUIDANCE}` +
    (ruleHint ? ` ${ruleHint}` : '')
  )
}

/**
 * densable f6d(httpStatus, errorKind) — extension point for detail suffix after
 * "temporarily unavailable". Empty body in densable 2.1.216 (do NOT invent
 * user-facing "HTTP 401" text).
 */
export function formatClassifierUnavailableDetail(
  _httpStatus?: number,
  _errorKind?: string,
): string {
  return ''
}

/** densable DX — header value is milliseconds. */
export function formatClassifierWaitDuration(ms: number): string {
  if (ms < 120_000) {
    const seconds = Math.max(1, Math.round(ms / 1000))
    return `about ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `about ${minutes} minutes`
  if (minutes > 1440) return 'more than a day'
  const hours = Math.round(minutes / 6) / 10
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** densable V5 — parenthetical on the wait sentence only. */
export function formatClassifierWaitDetail(
  httpStatus?: number,
  errorKind?: string,
): string {
  if (httpStatus === 429) return ' (rate-limited)'
  if (httpStatus === 529) return ' (overloaded)'
  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus < 600) {
    return ' (server error)'
  }
  if (
    errorKind === 'wall_clock_timeout' ||
    errorKind === 'connection_timeout' ||
    errorKind === 'server_call_unavailable_timeout'
  ) {
    return ' (timed out)'
  }
  if (errorKind === 'connection_error') return ' (connection failed)'
  if (errorKind === 'server_call_skipped') return ' (it skipped this action)'
  if (errorKind === 'server_unsupported') {
    return ' (this request is not covered)'
  }
  if (errorKind === 'server_thread_unsupported') {
    return ' (the request was sent on a message thread, which it does not cover; the next one will not be)'
  }
  if (errorKind === 'server_stream_ended') {
    return ' (the response ended before its verdict arrived)'
  }
  if (errorKind === 'server_call_unavailable_refused') {
    return ' (a safeguard refused to let the check read this conversation)'
  }
  const inputTooLongDetail =
    formatServerUnavailableInputTooLongDetail(errorKind)
  if (inputTooLongDetail !== undefined) {
    return inputTooLongDetail
  }
  for (const prefix of ['server_unavailable_', 'server_call_unavailable_']) {
    if (errorKind?.startsWith(prefix)) {
      const rest = errorKind.slice(prefix.length)
      return rest === 'other' ? '' : ` (${rest.replaceAll('_', ' ')})`
    }
  }
  if (errorKind === 'server_no_result') {
    return ' (the server returned none for this action)'
  }
  if (errorKind === 'server_context_stale') {
    return ' (the artifact changed while it was reviewed)'
  }
  if (errorKind === 'server_unrecognized_result') {
    return ' (the server returned none)'
  }
  return ''
}

const CLASSIFIER_WAIT_NOTE =
  'Note: reading files, searching code, and other read-only operations do not require the classifier and can still be used.'

/** densable qdn when the API supplied a wait. kRr is 120000ms. */
function buildClassifierToldToWaitMessage(
  toolName: string,
  classifierModel: string,
  retryAfterMs: number,
  httpStatus?: number,
  errorKind?: string,
): string {
  const duration = formatClassifierWaitDuration(retryAfterMs)
  const detail = formatClassifierWaitDetail(httpStatus, errorKind)
  const lead =
    `The API told auto mode's safety classifier (${classifierModel}) to wait ${duration} from now${detail}, so auto mode cannot determine the safety of ${toolName} until then. ` +
    `This is not a judgment that the action is unsafe, so don't rework the action to get around it. `
  if (retryAfterMs >= 120_000) {
    return (
      lead +
      `You cannot wait this out inside the turn. Do not retry the action before then, and do not try any other action that needs auto mode's review: while the API still says to wait, each one is denied the same way, without being reviewed. Continue with work that needs no review. If there is none, stop and tell the user that auto mode has to wait ${duration} for the API and that they can try again after that. When the user next asks, you may try again. ` +
      CLASSIFIER_WAIT_NOTE
    )
  }
  return (
    lead +
    `Do not retry the action before then, and do not try any other action that needs auto mode's review: while the API still says to wait, each one is denied the same way, without being reviewed. Continue with work that needs no review, and try this action again once the wait is over. ` +
    CLASSIFIER_WAIT_NOTE
  )
}

/**
 * densable hUd — auto mode classifier temporarily unavailable (main path).
 * Tells the agent to wait and retry, and suggests working on other tasks.
 * A retryAfterMs from the API switches this to qdn's wait sentence.
 */
export function buildClassifierUnavailableMessage(
  toolName: string,
  classifierModel: string,
  httpStatus?: number,
  errorKind?: string,
  retryAfterMs?: number,
): string {
  if (retryAfterMs !== undefined) {
    return buildClassifierToldToWaitMessage(
      toolName,
      classifierModel,
      retryAfterMs,
      httpStatus,
      errorKind,
    )
  }
  // Official 2.1.325 `vyt` (#1730): `server_call_unavailable_input_too_long`
  // is a hard failure — retrying will get the same answer.
  if (errorKind === SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG) {
    const detail = formatServerUnavailableInputTooLongDetail(errorKind) ?? ''
    return (
      `${classifierModel} gave no verdict${detail}, so auto mode cannot determine the safety of ${toolName}. ` +
      `This is a hard failure, not a transient one: the check cannot or does not judge this request, so retrying this action will get the same answer. ` +
      `Don't retry it. Continue with other tasks that don't require it; if it is essential, stop and tell the user that auto mode could not evaluate it. ` +
      CLASSIFIER_WAIT_NOTE
    )
  }
  const detail = formatClassifierUnavailableDetail(httpStatus, errorKind)
  return (
    `${classifierModel} is temporarily unavailable${detail}, so auto mode cannot determine the safety of ${toolName} right now. ` +
    `Wait briefly and then try this action again. ` +
    `If it keeps failing, continue with other tasks that don't require this action and come back to it later. ` +
    CLASSIFIER_WAIT_NOTE
  )
}

/**
 * densable CYu — handoff allow-with-warning when classifier is unavailable.
 * Distinct from main-path fail-closed deny (hUd).
 */
export function buildHandoffClassifierUnavailableMessage(
  classifierModel?: string,
  httpStatus?: number,
  errorKind?: string,
): string {
  const detail = formatClassifierUnavailableDetail(httpStatus, errorKind)
  const who = classifierModel
    ? `${classifierModel} (the safety classifier)`
    : 'The safety classifier'
  return `Note: ${who} was unavailable${detail} when reviewing this subagent's work. Please carefully verify the subagent's actions and output before acting on them.`
}

export const SYNTHETIC_MODEL = '<synthetic>'

export const SYNTHETIC_MESSAGES = new Set([
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  REJECT_MESSAGE + MEMORY_CORRECTION_HINT,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE + MEMORY_CORRECTION_HINT,
  NO_RESPONSE_REQUESTED,
])

export function isSyntheticMessage(message: Message): boolean {
  return (
    message.type !== 'progress' &&
    message.type !== 'attachment' &&
    message.type !== 'system' &&
    Array.isArray(message.message?.content) &&
    message.message?.content[0]?.type === 'text' &&
    SYNTHETIC_MESSAGES.has(
      (message.message?.content[0] as { text: string }).text,
    )
  )
}

export function isSyntheticApiErrorMessage(
  message: Message,
): message is AssistantMessage & { isApiErrorMessage: true } {
  return (
    message.type === 'assistant' &&
    message.isApiErrorMessage === true &&
    message.message?.model === SYNTHETIC_MODEL
  )
}

export function wrapInSystemReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`
}

/**
 * Official 2.1.328 `nN` / `pTe` (`chunk@294254613.js:1259365, 5970592`):
 * escape nested `<system-reminder>` / `</system-reminder>` tags (and trailing
 * `<` / `</`) before wrapping untrusted hook/plugin output in a system-reminder.
 */
function escapeSystemReminderTagsLocal(text: string): string {
  return text
    .replaceAll(/<(?=\s*(?:\/\s*)?system-reminder\b)/gi, '&lt;')
    .replace(/<(?=\s*(?:\/\s*)?$)/, '&lt;')
}

export function wrapEscapedSystemReminder(content: string): string {
  return wrapInSystemReminder(escapeSystemReminderTagsLocal(content))
}

export function wrapMessagesInSystemReminder(
  messages: UserMessage[],
): UserMessage[] {
  return messages.map(msg => {
    if (typeof msg.message.content === 'string') {
      return {
        ...msg,
        message: {
          ...msg.message,
          content: wrapInSystemReminder(msg.message.content),
        },
      }
    } else if (Array.isArray(msg.message.content)) {
      // For array content, wrap text blocks in system-reminder
      const wrappedContent = msg.message.content.map(block => {
        if (block.type === 'text') {
          return {
            ...block,
            text: wrapInSystemReminder(block.text),
          }
        }
        return block
      })
      return {
        ...msg,
        message: {
          ...msg.message,
          content: wrappedContent,
        },
      }
    }
    return msg
  })
}
