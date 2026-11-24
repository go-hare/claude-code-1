import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../api/errors.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import {
  type CompactionResult,
  canOmitToolResultsToRecoverPTL,
  compactConversation,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
  ERROR_MESSAGE_USER_ABORT,
  isThirdPartyDesktopLargeToolResultOmissionEnabled,
  type OmitLargestToolResultsResult,
  omitLargestToolResultsForSummary,
} from './compact.js'
import { TOOL_RESULT_LEFT_OUT_PREFIX } from './prompt.js'
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
  options: {
    customInstructions?: string
    trigger?: string
    requestCannotGoOut?: boolean
  },
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
        false,
        undefined,
        undefined,
        options.requestCannotGoOut ?? true,
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
  // densable r8o: e?.type==="assistant" && l8o(e). Media and PTL both enter
  // n8o/tryReactiveCompact (full summary) — not query-level stripImages.
  // SEA has strippedMedia only inside compact group retries. Collapse drain
  // still PTL-only (media skip collapse). mediaRecoveryEnabled must match
  // stream withhold (module present). Tail-preserved media may re-error once;
  // hasAttemptedReactiveCompact prevents a spiral.
  if (message?.type !== 'assistant' || !message.isApiErrorMessage) return false
  return isMediaSizeErrorMessage(message as AssistantMessage)
}

/** v2.1.311 (#1227): SEA cD = 200_000 standard-context ceiling */
export const STANDARD_CONTEXT_MAX_TOKENS = 200_000

/**
 * v2.1.311 (#1227): SEA Nae/LFn — true when the API error message indicates
 * >200K tokens required usage credits for 1M context.
 */
export function isLongContextCreditsRequiredMessage(
  message: Message | null | undefined,
): boolean {
  if (message?.type !== 'assistant' || !message.isApiErrorMessage) return false
  const msg = message as AssistantMessage
  if (msg.apiError === 'long_context_credits_required') return true
  return (
    typeof msg.errorDetails === 'string' &&
    (msg.errorDetails.includes('Extra usage is required for long context') ||
      msg.errorDetails.includes('Usage credits are required for long context'))
  )
}

/**
 * v2.1.311 (#1227): SEA Bc(e, n, r) — eligible to withhold a
 * long_context_credits_required refusal and recover via reactive compact
 * when the session is on a standard-context window (<= 200K) and
 * tengu_linked_rose is enabled.
 */
export function isEligibleForLongContextRefusalCompact(
  message: Message | null | undefined,
  contextWindowTokens: number,
  querySource: string,
): boolean {
  if (!isLongContextCreditsRequiredMessage(message)) return false
  if (contextWindowTokens > STANDARD_CONTEXT_MAX_TOKENS) return false
  if (
    !canAttemptReactiveCompact({
      hasAttempted: false,
      querySource,
      aborted: false,
    })
  ) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_linked_rose', true)
}

export {
  canOmitToolResultsToRecoverPTL,
  isThirdPartyDesktopLargeToolResultOmissionEnabled,
  type OmitLargestToolResultsResult,
  omitLargestToolResultsForSummary,
  TOOL_RESULT_LEFT_OUT_PREFIX,
}

const PTL_RECOVERY_MIN_TIMEOUT_MS = 600_000
const PTL_RECOVERY_MAX_TIMEOUT_MS = 3_600_000

/**
 * Official 2.1.328 (#625): build a child AbortController for PTL compaction
 * recovery that ALWAYS forwards parent abort (including agent-hook timeout
 * aborts that carry no user-cancel reason) AND bounds recovery with a deadline.
 * Prevents agent hooks from running past their timeout while compacting after
 * a request was refused as too large.
 */
export function computePtlRecoveryTimeoutMs(estimatedTokens: number): number {
  if (!Number.isFinite(estimatedTokens)) return PTL_RECOVERY_MIN_TIMEOUT_MS
  return Math.min(
    PTL_RECOVERY_MAX_TIMEOUT_MS,
    Math.max(PTL_RECOVERY_MIN_TIMEOUT_MS, Math.round(estimatedTokens * 1.5)),
  )
}

export function createPtlRecoveryAbortController(
  parentController: AbortController,
  opts?: {
    timeoutMs?: number
    querySource?: string
  },
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()
  const parentSignal = parentController.signal
  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason)
    }
  }
  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason)
    return { controller, cleanup: () => {} }
  }
  parentSignal.addEventListener('abort', onParentAbort, { once: true })

  const timeoutMs = opts?.timeoutMs ?? PTL_RECOVERY_MIN_TIMEOUT_MS
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('recovery-timeout', 'AbortError'))
    }
  }, timeoutMs)
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }

  const cleanup = () => {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', onParentAbort)
  }
  controller.signal.addEventListener('abort', cleanup, { once: true })

  return { controller, cleanup }
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
  /** Optional token gap from PTL refusal (forwarded to compactConversation to seed initial trim) */
  tokenGap?: number
  /** Official 2.1.328 (`compact_despite_hook_block`): true when the request cannot go out uncompacted */
  requestCannotGoOut?: boolean
}) => Promise<TryReactiveCompactOutcome> = async ({
  hasAttempted,
  querySource,
  aborted,
  messages,
  cacheSafeParams,
  tokenGap,
  requestCannotGoOut,
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
      { ...params, forkContextMessages: messages },
      true,
      undefined,
      true,
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: 0,
        autoCompactThreshold: 0,
        querySource: 'compact',
      },
      false,
      undefined,
      tokenGap,
      requestCannotGoOut ?? true,
    )
    return { result }
  } catch (finalError) {
    if (
      isAbortError(finalError) ||
      hasExactErrorMessage(finalError, ERROR_MESSAGE_USER_ABORT) ||
      hasExactErrorMessage(finalError, ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    ) {
      logForDebugging('Reactive compact aborted', { level: 'info' })
      return { result: null, failure: { reason: 'aborted' } }
    }
    const detail =
      finalError instanceof Error ? finalError.message : String(finalError)
    logForDebugging(
      `reactiveCompact: emergency compaction failed — ${detail}`,
      { level: 'warn' },
    )
    logError(finalError)
    return {
      result: null,
      failure: { reason: 'error', detail },
    }
  }
}
