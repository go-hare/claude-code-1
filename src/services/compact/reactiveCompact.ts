import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../api/errors.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
  ERROR_MESSAGE_USER_ABORT,
} from './compact.js'
import { isAutoCompactEnabled } from './autoCompact.js'
import { logError } from '../../utils/log.js'
import { logForDebugging } from '../../utils/debug.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { createAssistantAPIErrorMessage } from '../../utils/messages.js'
import { stringWidth } from '@anthropic/ink'
import { truncateToWidth } from '../../utils/truncate.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { hasExactErrorMessage, isAbortError } from '../../utils/errors.js'

/** densable raccoon — same GB as autoCompact / TokenWarning / analyzeContext. */
export function isReactiveOnlyMode(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)
}

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
  // densable Rhe: GB tengu_reactive_compact_remote must be strictly true.
  // Cast: getFeatureValue typed with false default can collapse to literal false.
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_reactive_compact_remote',
      false as boolean,
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

/**
 * densable `cup(e){return e?.type==="assistant"&&e8e(e)}` — PTL withhold gate.
 * Optional-chain outer so `undefined` lastMessage does not throw (query recovery).
 * Inner e8e still assumes a real assistant when type matches.
 */
export const isWithheldPromptTooLong: (
  message: Message | null | undefined,
) => boolean = message => {
  // densable cup: e?.type==="assistant" && e8e(e)
  if (message?.type !== 'assistant' || !message.isApiErrorMessage) return false
  return isPromptTooLongMessage(message as AssistantMessage)
}

/**
 * densable `r8o(e){return e?.type==="assistant"&&l8o(e)}` — media-size withhold.
 * Same optional outer as cup. densable recovery: media and PTL both enter n8o
 * (full tryReactiveCompact), not a separate query-level stripImages path.
 */
export const isWithheldMediaSizeError: (
  message: Message | null | undefined,
) => boolean = message => {
  // densable r8o: e?.type==="assistant" && l8o(e)
  if (message?.type !== 'assistant' || !message.isApiErrorMessage) return false
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
    // densable: user Esc / incomplete compact → reason "aborted" so Ysa (oaa)
    // stays off (Ysa only annotates reason==="error"+detail). Terminal query
    // reason may still be prompt_too_long|image_error (SEA 231).
    if (
      isAbortError(error) ||
      hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT) ||
      hasExactErrorMessage(error, ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    ) {
      return { result: null, failure: { reason: 'aborted' } }
    }
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
