import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../api/errors.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { type CompactionResult, compactConversation } from './compact.js'
import { isAutoCompactEnabled } from './autoCompact.js'
import { logError } from '../../utils/log.js'
import { logForDebugging } from '../../utils/debug.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { createAssistantAPIErrorMessage } from '../../utils/messages.js'
import { stringWidth } from '@anthropic/ink'
import { truncateToWidth } from '../../utils/truncate.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export const isReactiveOnlyMode: () => boolean = () => false

/**
 * densable yAt / Plb — side-channel querySources that must not run reactive
 * compact unless a precomputed swap is already available (we do not ship
 * precompute, so these always skip try).
 */
export const REACTIVE_COMPACT_SKIP_QUERY_SOURCES = new Set([
  'prompt_suggestion',
  'away_summary',
  'agent_summary',
])

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

/**
 * densable $Ir — reactive must not re-enter from the compact agent itself.
 */
export function isReactiveCompactBlockedQuerySource(
  querySource: string | undefined,
): boolean {
  return querySource === 'compact'
}

/**
 * densable ex() — shared master gate with proactive auto-compact:
 * DISABLE_COMPACT | DISABLE_AUTO_COMPACT | autoCompactEnabled:false → false.
 * QGo/Jsa requires ex(); stream withhold (gup/XGo) does NOT.
 */
export function isReactiveCompactExEnabled(): boolean {
  return isAutoCompactEnabled()
}

/**
 * Legacy name: DISABLE_COMPACT only (not full densable ex).
 * Prefer isReactiveCompactExEnabled / canAttemptReactiveCompact for recovery.
 * Kept so call sites that only need "compact fully disabled" stay narrow.
 */
export const isReactiveCompactEnabled: () => boolean = () => {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  return true
}

/**
 * densable Rhe() — under CLAUDE_CODE_REMOTE, require GB
 * tengu_reactive_compact_remote (latched in densable lGd; we read GB each call).
 * Local / non-remote always true.
 */
export function isReactiveCompactRemoteAllowed(): boolean {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return true
  }
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_reactive_compact_remote',
      false,
    ) === true
  )
}

/**
 * densable Jsa (without precomputed swap — we do not ship precompute).
 * Gates whether tryReactiveCompact may call summarize.
 *
 * densable:
 *   !hasAttempted && !$Ir(querySource)
 *   && (hasPrecomputedSwap || !yAt(querySource))
 *   && ex() && Rhe() && !aborted
 */
export function canAttemptReactiveCompact(params: {
  hasAttempted: boolean
  querySource: string
  aborted: boolean
  /** densable hasPrecomputedSwap — always false until precompute lands */
  hasPrecomputedSwap?: boolean
}): boolean {
  if (params.hasAttempted || params.aborted) {
    return false
  }
  if (isReactiveCompactBlockedQuerySource(params.querySource)) {
    return false
  }
  if (
    !params.hasPrecomputedSwap &&
    REACTIVE_COMPACT_SKIP_QUERY_SOURCES.has(params.querySource)
  ) {
    return false
  }
  if (!isReactiveCompactExEnabled()) {
    return false
  }
  if (!isReactiveCompactRemoteAllowed()) {
    return false
  }
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
  querySource,
  aborted,
  messages,
  cacheSafeParams,
}) => {
  // densable Jsa: withhold may already have happened; do not summarize when
  // ex()/Rhe()/source gates fail (return null → surface bare/Ysa PTL).
  if (
    !canAttemptReactiveCompact({
      hasAttempted,
      querySource,
      aborted,
    })
  ) {
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
