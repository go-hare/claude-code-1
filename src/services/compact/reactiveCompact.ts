import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../api/errors.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { type CompactionResult, compactConversation } from './compact.js'
import { logError } from '../../utils/log.js'
import { logForDebugging } from '../../utils/debug.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { createAssistantAPIErrorMessage } from '../../utils/messages.js'
import { stringWidth } from '@anthropic/ink'
import { truncateToWidth } from '../../utils/truncate.js'

export const isReactiveOnlyMode: () => boolean = () => false

/**
 * densable m0b — max display width of compact-failure detail in Ysa.
 */
export const AUTOMATIC_COMPACTION_FAILED_DETAIL_MAX_WIDTH = 300

/**
 * densable compact failure shape (precompute/reactive path).
 * Ysa only annotates when reason === "error" && detail is set.
 */
export type ReactiveCompactFailure = {
  reason: string
  detail?: string
}

/**
 * densable Qa(e, t, r=true) — first-sentence (period) clip then width truncate.
 * Used by Ysa for the compact-failure detail suffix.
 */
export function truncateCompactFailureDetail(
  detail: string,
  maxWidth: number = AUTOMATIC_COMPACTION_FAILED_DETAIL_MAX_WIDTH,
): string {
  let n = detail
  const period = detail.indexOf('.')
  if (period !== -1) {
    n = detail.substring(0, period)
    // densable: if width(n)+1 > t → Vi(n,t); else n + …
    if (stringWidth(n) + 1 > maxWidth) {
      return truncateToWidth(n, maxWidth)
    }
    return `${n}…`
  }
  if (stringWidth(n) <= maxWidth) {
    return n
  }
  return truncateToWidth(n, maxWidth)
}

/**
 * densable Ysa — "Prompt is too long · automatic compaction failed: <detail>"
 * Returns undefined when failure is not an error-with-detail (caller keeps bare PTL).
 */
export function formatAutomaticCompactionFailed(
  failure: ReactiveCompactFailure | null | undefined,
): string | undefined {
  if (failure?.reason !== 'error' || !failure.detail) {
    return undefined
  }
  return (
    `${PROMPT_TOO_LONG_ERROR_MESSAGE} · automatic compaction failed: ` +
    truncateCompactFailureDetail(failure.detail)
  )
}

/**
 * densable bua — rewrite withheld PTL content with Ysa text; keep errorDetails.
 */
export function annotatePromptTooLongWithCompactFailure(
  message: AssistantMessage,
  failure: ReactiveCompactFailure | null | undefined,
): AssistantMessage {
  const content = formatAutomaticCompactionFailed(failure)
  if (!content) {
    return message
  }
  const annotated = createAssistantAPIErrorMessage({
    content,
    error: 'invalid_request',
    errorDetails:
      typeof message.errorDetails === 'string'
        ? message.errorDetails
        : undefined,
    apiError: message.apiError as AssistantMessage['apiError'],
  }) as AssistantMessage
  // densable bua preserves requestId / apiErrorStatus from the withheld message
  const src = message as AssistantMessage & {
    requestId?: unknown
    apiErrorStatus?: unknown
  }
  if (src.requestId !== undefined) {
    ;(annotated as { requestId?: unknown }).requestId = src.requestId
  }
  if (src.apiErrorStatus !== undefined) {
    ;(annotated as { apiErrorStatus?: unknown }).apiErrorStatus =
      src.apiErrorStatus
  }
  return annotated
}

export const reactiveCompactOnPromptTooLong: (
  messages: Message[],
  cacheSafeParams: Record<string, unknown>,
  options: { customInstructions?: string; trigger?: string },
) => Promise<{ ok: boolean; reason?: string; result?: CompactionResult }> =
  async (messages, cacheSafeParams, options) => {
    const params = cacheSafeParams as unknown as CacheSafeParams
    try {
      const result = await compactConversation(
        messages,
        params.toolUseContext,
        params,
        true,
        options.customInstructions,
        true,
        {
          isRecompactionInChain: false,
          turnsSincePreviousCompact: 0,
          autoCompactThreshold: 0,
          querySource: 'compact',
        },
      )
      return { ok: true, result }
    } catch (error) {
      logError(error)
      return { ok: false, reason: String(error) }
    }
  }

export const isReactiveCompactEnabled: () => boolean = () => {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  return true
}

export const isWithheldPromptTooLong: (message: Message) => boolean =
  message => {
    if (message.type !== 'assistant' || !message.isApiErrorMessage) return false
    return isPromptTooLongMessage(message as AssistantMessage)
  }

export const isWithheldMediaSizeError: (message: Message) => boolean =
  message => {
    if (message.type !== 'assistant' || !message.isApiErrorMessage) return false
    return isMediaSizeErrorMessage(message as AssistantMessage)
  }

export type TryReactiveCompactOutcome = {
  result: CompactionResult | null
  /** densable ia — set when compact threw; Ysa uses reason==="error"+detail */
  failure?: ReactiveCompactFailure
}

export const tryReactiveCompact: (params: {
  hasAttempted: boolean
  querySource: string
  aborted: boolean
  messages: Message[]
  cacheSafeParams: Record<string, unknown>
}) => Promise<TryReactiveCompactOutcome> = async ({
  hasAttempted,
  aborted,
  messages,
  cacheSafeParams,
}) => {
  if (hasAttempted || aborted) {
    return { result: null }
  }
  const params = cacheSafeParams as unknown as CacheSafeParams
  try {
    const result = await compactConversation(
      messages,
      params.toolUseContext,
      params,
      true,
      undefined,
      true,
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: 0,
        autoCompactThreshold: 0,
      },
    )
    return { result }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logForDebugging(
      `reactiveCompact: emergency compaction failed — ${detail}`,
      { level: 'warn' },
    )
    logError(error)
    return {
      result: null,
      failure: { reason: 'error', detail },
    }
  }
}
