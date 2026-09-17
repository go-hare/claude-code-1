/**
 * densable 2.1.246 #38 — batching_reminder producer (mXn / TXo / kXo)
 * + C latch consumer lives in normalizeMessagesForAPI.
 *
 * Official:
 *   SXo @214227438  env text (lu||jr reject, then fXn)
 *   kXo @214228145  env else client_data tengu_toasty_thimble map
 *   TXo @214228613  mid-conv only; per-session+model latch
 *   mXn @214229333  insert after tool_result tail
 *   CXo @214229043  [iV, NWe, BS, MQ, p_, kw, Q0]
 *   EXo queued_command | teammate_mailbox | poll_events
 *
 * No default reminder copy. Empty env + empty/missing map → no inject.
 * QOs/qXe/eHr/Qzr live in messages.ts + claude.ts hosts.
 */

import { randomUUID } from 'crypto'
import { getSessionId } from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { logError } from './log.js'
import { shouldUseMidConversationSystem } from './midConversationSystem.js'
import { getCanonicalName } from './model/model.js'
import type { Message } from '../types/message.js'

/**
 * densable CXo @214229043 = [iV, NWe, BS, MQ, p_, kw, Q0].
 * Literals locked from SEA; same strings as messages.ts exports.
 * Do not import messages.ts — query already imports both (cycle).
 */
const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
const REJECT_MESSAGE_WITH_REASON_PREFIX =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n"
const SUBAGENT_REJECT_MESSAGE =
  'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.'
const SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX =
  'Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user said:\n'
const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
const INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE =
  '[Request interrupted by a plugin for tool use]'

export const TOASTY_THIMBLE_FEATURE = 'tengu_toasty_thimble'
export const TOASTY_THIMBLE_ENV = 'CLAUDE_CODE_TOASTY_THIMBLE'

const WILDCARD = '*'

/** densable EXo — trailing types that abort inject. */
const ABORT_TRAILING_ATTACHMENT_TYPES = new Set([
  'queued_command',
  'teammate_mailbox',
  'poll_events',
])

/** densable CXo — tool_result content prefixes that abort inject. */
const INTERRUPT_OR_REJECT_PREFIXES = [
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  CANCEL_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE,
]

type ReminderSource = 'env' | 'clientData'

type ResolvedReminder = {
  text: string
  textForAnalytics: string
  source: ReminderSource
  matchedPattern?: string
}

type SessionLatch = {
  conversationId: string
  byModel: Map<string, ResolvedReminder>
}

const sessionLatches = new Map<string, SessionLatch>()
let ignoredClientDataWarned = false

export function resetBatchingReminderLatch(): void {
  sessionLatches.clear()
  ignoredClientDataWarned = false
}

export type BatchingReminderInject = {
  messages: Message[]
  text: string | null
  afterUuid: string | null
}

/**
 * densable mXn(e, t, n).
 * Inserts batching_reminder after the trailing tool_result user (before
 * skipped non-EXo attachments). Returns the original list when gated off.
 */
export function injectBatchingReminder(
  messages: Message[],
  session: { id: string } = { id: getSessionId() },
  model: string,
): BatchingReminderInject {
  const noop: BatchingReminderInject = {
    messages,
    text: null,
    afterUuid: null,
  }
  try {
    let insertAfter = messages.length - 1
    for (; insertAfter >= 0; insertAfter--) {
      const msg = messages[insertAfter]
      if (!msg || isSkippableTranscriptMessage(msg)) continue
      if (msg.type !== 'attachment') break
      const trailingType = msg.attachment?.type
      if (
        trailingType !== undefined &&
        ABORT_TRAILING_ATTACHMENT_TYPES.has(trailingType)
      ) {
        return noop
      }
    }
    const toolResultUser = insertAfter >= 0 ? messages[insertAfter] : undefined
    if (!isToolResultUserMessage(toolResultUser)) {
      return noop
    }
    for (let i = insertAfter; i >= 0; i--) {
      const msg = messages[i]
      if (
        !msg ||
        isSkippableTranscriptMessage(msg) ||
        msg.type === 'attachment'
      ) {
        continue
      }
      if (!isToolResultUserMessage(msg)) break
      if (msg.message.content.some(toolResultHasAbortPrefix)) {
        return noop
      }
    }
    const text = resolveBatchingReminderText(session, model)
    if (text === null) return noop
    const reminder = {
      type: 'attachment' as const,
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      attachment: { type: 'batching_reminder' as const, text },
    } as unknown as Message
    return {
      messages: [
        ...messages.slice(0, insertAfter + 1),
        reminder,
        ...messages.slice(insertAfter + 1),
      ],
      text,
      afterUuid: toolResultUser.uuid,
    }
  } catch (error) {
    logError(error)
    return noop
  }
}

/**
 * densable TXo(e, t) — mid-conv + resolved text, latched per
 * conversationId + canonical model.
 */
export function resolveBatchingReminderText(
  session: { id: string },
  model: string,
): string | null {
  if (!shouldUseMidConversationSystem({ model })) return null
  const resolved = resolveToastyThimble(model)
  if (resolved === null) return null
  let latch = sessionLatches.get(session.id)
  if (latch?.conversationId !== session.id) {
    latch = { conversationId: session.id, byModel: new Map() }
    sessionLatches.set(session.id, latch)
  }
  const modelKey = getCanonicalName(model).toLowerCase()
  let latched = latch.byModel.get(modelKey)
  if (latched === undefined) {
    latched = resolved
    latch.byModel.set(modelKey, latched)
    logEvent('batching_reminder', {})
    logEvent('tengu_toasty_thimble_applied', {
      source:
        latched.source as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      text: latched.textForAnalytics as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model: getCanonicalName(
        model,
      ) as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      len: latched.text.length,
    })
  }
  return latched.text
}

/** densable kXo */
function resolveToastyThimble(model: string): ResolvedReminder | null {
  const envText = process.env[TOASTY_THIMBLE_ENV]
  if (envText !== undefined) return resolveEnvReminder(envText)
  const raw = getGlobalConfig().clientDataCache?.[TOASTY_THIMBLE_FEATURE]
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnBadClientData(
      `expected a map from model pattern to text, got ${Array.isArray(raw) ? 'array' : typeof raw}`,
    )
    return null
  }
  const matched = matchToastyThimbleMap(raw as Record<string, unknown>, model)
  if (matched === undefined) return null
  const [pattern, value] = matched
  if (typeof value !== 'string') {
    warnBadClientData(
      `value for pattern "${pattern}" is ${typeof value}, expected the reminder text`,
    )
    return null
  }
  return finalizeReminder(value, 'clientData', pattern)
}

/** densable SXo — lu||jr reject flag-like env values. */
function resolveEnvReminder(raw: string): ResolvedReminder | null {
  const trimmed = raw.trim()
  if (isEnvTruthy(trimmed) || isEnvDefinedFalsy(trimmed)) return null
  return finalizeReminder(trimmed, 'env', undefined)
}

/** densable fXn */
function finalizeReminder(
  text: string,
  source: ReminderSource,
  matchedPattern: string | undefined,
): ResolvedReminder | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return {
    text: trimmed,
    textForAnalytics: trimmed,
    source,
    matchedPattern,
  }
}

/** densable wXo */
export function matchToastyThimbleMap(
  map: Record<string, unknown>,
  model: string,
): [string, unknown] | undefined {
  const raw = model.toLowerCase()
  const canonical = getCanonicalName(model).toLowerCase()
  let exactCanonical: [string, unknown] | undefined
  let star: [string, unknown] | undefined
  let wildcard: [string, unknown] | undefined
  let wildcardScore = -1
  for (const [pattern, value] of Object.entries(map)) {
    const key = pattern.trim().toLowerCase()
    if (key === WILDCARD) {
      star ??= [pattern, value]
      continue
    }
    if (key === raw) return [pattern, value]
    if (key === canonical) {
      exactCanonical ??= [pattern, value]
      continue
    }
    const stripped = key.replaceAll('*', '')
    if (stripped === '') continue
    if (
      (wildcardSubsequence(key, raw) || wildcardSubsequence(key, canonical)) &&
      stripped.length > wildcardScore
    ) {
      wildcard = [pattern, value]
      wildcardScore = stripped.length
    }
  }
  if (exactCanonical !== undefined) return exactCanonical
  if (wildcard !== undefined) return wildcard
  return star
}

/** densable uXn */
function wildcardSubsequence(pattern: string, model: string): boolean {
  const parts = pattern.split('*').filter(part => part !== '')
  let from = 0
  for (const part of parts) {
    const at = model.indexOf(part, from)
    if (at === -1) return false
    from = at + part.length
  }
  return true
}

function warnBadClientData(detail: string): void {
  if (ignoredClientDataWarned) return
  ignoredClientDataWarned = true
  logForDebugging(
    `[batching reminder] ignoring client_data ${TOASTY_THIMBLE_FEATURE}: ${detail}`,
    { level: 'warn' },
  )
}

/** densable dXn */
function isToolResultUserMessage(msg: Message | undefined): msg is Message & {
  type: 'user'
  uuid: string
  message: { content: Array<{ type: string; content?: unknown }> }
} {
  if (!msg || msg.type !== 'user') return false
  const content = msg.message?.content
  return (
    Array.isArray(content) &&
    content.some(block => block.type === 'tool_result')
  )
}

/** densable RXo */
function toolResultHasAbortPrefix(block: {
  type: string
  content?: unknown
}): boolean {
  if (block.type !== 'tool_result') return false
  const content = block.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map(part =>
              part &&
              typeof part === 'object' &&
              'type' in part &&
              part.type === 'text' &&
              'text' in part &&
              typeof part.text === 'string'
                ? part.text
                : '',
            )
            .join('')
        : ''
  return INTERRUPT_OR_REJECT_PREFIXES.some(prefix => text.startsWith(prefix))
}

/**
 * densable aE — skip progress / non-local_command system / virtual /
 * synthetic API error. api_system is not skipped (break → abort inject).
 * Official r6 = _815 we @205147424 (import ged as r6): user text
 * startsWith `<${xt}>` where xt = _825 Am session getter. Always false.
 * Omit (same observable). Do not invent isCompactSummary / command-name.
 */
function isSkippableTranscriptMessage(msg: Message): boolean {
  if (msg.type === 'progress') return true
  if (msg.type === 'system' && msg.subtype !== 'local_command') return true
  if ((msg.type === 'user' || msg.type === 'assistant') && msg.isVirtual) {
    return true
  }
  if (msg.type === 'assistant' && msg.isApiErrorMessage === true) return true
  return false
}
