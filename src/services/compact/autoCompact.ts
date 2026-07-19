import { feature } from 'bun:bundle'
import { getSdkBetas, markPostCompaction } from 'src/bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import {
  autoCompactCircuitBreakerEventPayload,
  isAutoCompactCircuitTripped,
  recordAutoCompactFailure,
} from '../../utils/autoCompactCircuitBreaker.js'
import {
  evaluateAutoCompactThrashing,
  trackingAfterSuccessfulCompact,
} from '../../utils/autoCompactThrashingBreaker.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getMaxOutputTokensForModel } from '../api/claude.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
  type RecompactionInfo,
} from './compact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'

// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

/**
 * Returns the context window size minus the max output tokens for the model.
 *
 * densable QV residual: env CLAUDE_CODE_AUTO_COMPACT_WINDOW wins; else optional
 * `autoCompactWindow` (AppState/options from apply_flag_settings Xat / settings)
 * caps the window; then model default.
 */
export function getEffectiveContextWindowSize(
  model: string,
  autoCompactWindow?: number,
): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  // Official AUTO_COMPACT_WINDOW densable pure parse (env source).
  let envApplied = false
  try {
    const { resolveAutoCompactWindowOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    const parsed = resolveAutoCompactWindowOverride()
    if (parsed !== null) {
      contextWindow = Math.min(contextWindow, parsed)
      envApplied = true
    }
  } catch {
    const envWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    if (envWindow) {
      const parsed = parseInt(envWindow, 10)
      if (!isNaN(parsed) && parsed > 0) {
        contextWindow = Math.min(contextWindow, parsed)
        envApplied = true
      }
    }
  }

  // densable settings/session autoCompactWindow (source "settings") when env absent.
  if (
    !envApplied &&
    typeof autoCompactWindow === 'number' &&
    Number.isFinite(autoCompactWindow) &&
    autoCompactWindow > 0
  ) {
    contextWindow = Math.min(contextWindow, autoCompactWindow)
    envApplied = true // mark configured so experiment/redwood does not re-cap
  }

  // densable QV experiment source: mJi / amber_redwood2|3 when auto-compact on
  // and no env/settings window was applied. clientdata remains denser.
  if (!envApplied && isAutoCompactEnabled()) {
    try {
      const redwood =
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_redwood2', '') ||
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_redwood3', '')
      if (typeof redwood === 'string' && redwood.trim()) {
        const {
          amberRedwoodWindowTokensFromString,
        } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/amberRedwoodWindow.js') as typeof import('../../utils/amberRedwoodWindow.js')
        const tokens = amberRedwoodWindowTokensFromString(redwood)
        if (tokens !== undefined) {
          contextWindow = Math.min(contextWindow, tokens)
        }
      }
    } catch {
      // densable optional
    }
  }

  return contextWindow - reservedTokensForSummary
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  // Unique ID per turn
  turnId: string
  // Consecutive autocompact failures. Reset on success.
  // Used as a circuit breaker to stop retrying when the context is
  // irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number
  // densable consecutiveRapidRefills — rapid refill thrashing counter (fto/Dkg).
  consecutiveRapidRefills?: number
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// Conservative estimate for tool result growth per turn.
// Typical tool results (file reads, grep, bash) average ~5-10K tokens;
// occasional large reads can spike to 20K+.
const TOOL_RESULT_GROWTH_ESTIMATE = 15_000

/**
 * Context-aware autocompact buffer. Larger context windows need more
 * headroom because a single turn can produce proportionally more tokens
 * (longer model outputs + larger tool results).
 */
export function getAutocompactBufferTokens(
  model: string,
  autoCompactWindow?: number,
): number {
  const effectiveWindow = getEffectiveContextWindowSize(
    model,
    autoCompactWindow,
  )
  if (effectiveWindow >= 800_000) return 50_000
  if (effectiveWindow >= 400_000) return 30_000
  return AUTOCOMPACT_BUFFER_TOKENS
}

/**
 * Estimate the maximum token growth a single turn can produce.
 * Used for predictive autocompact checks before the API call.
 */
export function estimateMaxTurnGrowth(model: string): number {
  const maxOutput = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  return maxOutput + TOOL_RESULT_GROWTH_ESTIMATE
}

// densable vvu / Evu — trip after AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD (3)
// consecutive failures. BQ 2026-03-10: 1,279 sessions had 50+ consecutive
// failures (up to 3,272) in a single session, wasting ~250K API calls/day.
export {
  AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD,
  autoCompactCircuitBreakerEventPayload,
  isAutoCompactCircuitTripped,
  recordAutoCompactFailure,
} from '../../utils/autoCompactCircuitBreaker.js'

// densable fto / Dkg / _Ji — rapid-refill thrashing pure residual.
export {
  AUTO_COMPACT_THRASHING_MESSAGE,
  AUTO_COMPACT_THRASHING_THRESHOLD,
  evaluateAutoCompactThrashing,
  nextConsecutiveRapidRefills,
  trackingAfterSuccessfulCompact,
} from '../../utils/autoCompactThrashingBreaker.js'

export function getAutoCompactThreshold(
  model: string,
  autoCompactWindow?: number,
): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(
    model,
    autoCompactWindow,
  )

  // Official zNy cold-compact densable — larger buffer → earlier autocompact.
  let bufferTokens = getAutocompactBufferTokens(model, autoCompactWindow)
  try {
    const { scaleAutocompactBufferForColdCompact } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/coldCompact.js') as typeof import('../../utils/coldCompact.js')
    bufferTokens = scaleAutocompactBufferForColdCompact(bufferTokens)
  } catch {
    // densable optional
  }

  const autocompactThreshold = effectiveContextWindow - bufferTokens

  // Override for easier testing of autocompact
  const envPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }

  return autocompactThreshold
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  autoCompactWindow?: number,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model, autoCompactWindow)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model, autoCompactWindow)

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(
    model,
    autoCompactWindow,
  )
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  // Official BLOCKING_LIMIT_OVERRIDE densable pure parse.
  let blockingLimit = defaultBlockingLimit
  try {
    const { resolveBlockingLimitOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    const parsedOverride = resolveBlockingLimitOverride()
    if (parsedOverride !== null) blockingLimit = parsedOverride
  } catch {
    const blockingLimitOverride =
      process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
    const parsedOverride = blockingLimitOverride
      ? parseInt(blockingLimitOverride, 10)
      : NaN
    if (!isNaN(parsedOverride) && parsedOverride > 0) {
      blockingLimit = parsedOverride
    }
  }

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = getGlobalConfig()
  return userConfig.autoCompactEnabled
}

// Official zNy — re-export portable cold-compact gate for compact callers.
export { isColdCompactEnabled } from '../../utils/coldCompact.js'

/**
 * densable bqr / nXi residual — precompute compaction gates.
 * Full Tvu/fvu sidecar pipeline remains denser; pure gates live in
 * precomputeCompactionGates.ts (sepia_moth + precomputeCompactionEnabled setting).
 */
export {
  isAmberPacketEnabled,
  isPrecomputeCompactionEnabled,
  isPrecomputeCompactionEnabledLive,
  isSepiaMothEnabled,
} from '../../utils/precomputeCompactionGates.js'

/**
 * densable Tvu/fvu pure residual — sidecar path + rehydrate decision helpers.
 * Full arm/persist/consume (iXi/p8) remains denser.
 */
export {
  evaluatePrecompactRehydrate,
  isPastPrecomputeArmThreshold,
  parsePrecompactSidecarPayload,
  PRECOMPACT_ARM_MAX_ATTEMPTS,
  PRECOMPACT_REHYDRATE_MAX_AGE_MS,
  PRECOMPACT_REHYDRATE_MAX_GROWTH_TOKENS,
  PRECOMPACT_SIDECAR_MAX_BYTES,
  PRECOMPACT_SIDECAR_SUFFIX,
  PRECOMPACT_SIDECAR_VERSION,
  precompactSidecarPathFromTranscript,
  precomputeAgentKey,
  precomputeArmGateReason,
  shouldArmPrecomputeCompaction,
} from '../../utils/precomputeCompactionSidecar.js'

/**
 * densable amber_rokovoko / amber_moleskin pure residual — precompute buffer
 * fraction resolution + cJi arm threshold (Hkg/hJi pure half).
 */
export {
  buildPrecomputeThresholdOptions,
  DEFAULT_PRECOMPUTE_BUFFER_FRACTION,
  livePrecomputeBufferFraction,
  precomputeArmTokenThreshold,
  resolveLivePrecomputeBufferFraction,
  resolvePrecomputeBufferFraction,
} from '../../utils/precomputeBufferFraction.js'

/**
 * densable amber_redwood2/3 + fJi pure residual — window string parse / QV order.
 */
export {
  AMBER_REDWOOD_WINDOW_MAX,
  AMBER_REDWOOD_WINDOW_MIN,
  amberRedwoodWindowTokensFromString,
  parseAmberRedwoodWindowString,
  resolveAutoCompactWindowSource,
} from '../../utils/amberRedwoodWindow.js'

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
  /** densable options.autoCompactWindow / AppState session window. */
  autoCompactWindow?: number,
): Promise<boolean> {
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
  // marble_origami is the ctx-agent — if ITS context blows up and
  // autocompact fires, runPostCompactCleanup calls resetContextCollapse()
  // which destroys the MAIN thread's committed log (module-level state
  // shared across forks). Inside feature() so the string DCEs from
  // external builds (it's in excluded-strings.txt).
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return false
    }
  }

  if (!isAutoCompactEnabled()) {
    return false
  }

  // Reactive-only mode: suppress proactive autocompact, let reactive compact
  // catch the API's prompt-too-long. feature() wrapper keeps the flag string
  // out of external builds (REACTIVE_COMPACT is ant-only).
  // Note: returning false here also means autoCompactIfNeeded never reaches
  // trySessionMemoryCompaction in the query loop — the /compact call site
  // still tries session memory first. Revisit if reactive-only graduates.
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }

  // Context-collapse mode: same suppression. Collapse IS the context
  // management system when it's on — the 90% commit / 95% blocking-spawn
  // flow owns the headroom problem. Autocompact firing at effective-13k
  // (~93% of effective) sits right between collapse's commit-start (90%)
  // and blocking (95%), so it would race collapse and usually win, nuking
  // granular context that collapse was about to save. Gating here rather
  // than in isAutoCompactEnabled() keeps reactiveCompact alive as the 413
  // fallback (it consults isAutoCompactEnabled directly) and leaves
  // sessionMemory + manual /compact working.
  //
  // Consult isContextCollapseEnabled (not the raw gate) so the
  // CLAUDE_CONTEXT_COLLAPSE env override is honored here too. require()
  // inside the block breaks the init-time cycle (this file exports
  // getEffectiveContextWindowSize which collapse's index imports).
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      return false
    }
  }

  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model, autoCompactWindow)
  const effectiveWindow = getEffectiveContextWindowSize(
    model,
    autoCompactWindow,
  )

  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}`,
  )

  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
    autoCompactWindow,
  )

  return isAboveAutoCompactThreshold
}

export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
  /** densable fto — rapid-refill thrash trip (query surfaces bJi). */
  thrashingTripped?: boolean
  consecutiveRapidRefills?: number
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  // densable Evu trip: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (isAutoCompactCircuitTripped(tracking?.consecutiveFailures ?? 0)) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  const autoCompactWindow = toolUseContext.options.autoCompactWindow
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
    autoCompactWindow,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

  // densable fto — rapid-refill thrashing breaker before another compact.
  const thrash = evaluateAutoCompactThrashing(tracking)
  if (thrash.action === 'trip') {
    logForDebugging(
      `autocompact: rapid-refill breaker tripped — ${thrash.consecutiveRapidRefills} consecutive refills within <3 turns each (last was ${tracking?.turnCounter} turns)`,
      { level: 'warn' },
    )
    logEvent('tengu_auto_compact_rapid_refill_breaker', {
      consecutiveRapidRefills: thrash.consecutiveRapidRefills,
      turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    })
    return {
      wasCompacted: false,
      thrashingTripped: true,
      consecutiveRapidRefills: thrash.consecutiveRapidRefills,
    }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model, autoCompactWindow),
    querySource,
  }

  // EXPERIMENT: Try session memory compaction first
  const sessionMemoryResult = await trySessionMemoryCompaction(
    messages,
    toolUseContext.agentId,
    recompactionInfo.autoCompactThreshold,
  )
  if (sessionMemoryResult) {
    // Reset lastSummarizedMessageId since session memory compaction prunes messages
    // and the old message UUID will no longer exist after the REPL replaces messages
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    // Reset cache read baseline so the post-compact drop isn't flagged as a
    // break. compactConversation does this internally; SM-compact doesn't.
    // BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break events
    // false positives (systemPromptChanged=true, timeSinceLastAssistantMsg=-1).
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
    }
    markPostCompaction()
    // densable _Ji carries thrash count on success (session-memory path).
    const afterSm = trackingAfterSuccessfulCompact({
      turnId: tracking?.turnId ?? 'sm',
      consecutiveRapidRefills: thrash.consecutiveRapidRefills,
    })
    return {
      wasCompacted: true,
      compactionResult: sessionMemoryResult,
      consecutiveFailures: afterSm.consecutiveFailures,
      consecutiveRapidRefills: afterSm.consecutiveRapidRefills,
    }
  }

  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions for autocompact
      undefined, // No custom instructions for autocompact
      true, // isAutoCompact
      recompactionInfo,
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)

    // densable _Ji on success — keep thrash counter, zero failures.
    const after = trackingAfterSuccessfulCompact({
      turnId: tracking?.turnId ?? 'auto',
      consecutiveRapidRefills: thrash.consecutiveRapidRefills,
    })
    return {
      wasCompacted: true,
      compactionResult,
      consecutiveFailures: after.consecutiveFailures,
      consecutiveRapidRefills: after.consecutiveRapidRefills,
    }
  } catch (error) {
    if (!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      logError(error)
    }
    // densable Evu — record failure; on trip log warn + analytics event.
    // Caller threads consecutiveFailures through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const next = recordAutoCompactFailure({
      previous: tracking,
      // proactive autoCompactIfNeeded path (reactive path sets this true)
      routedThroughReactive: false,
    })
    if (isAutoCompactCircuitTripped(next.consecutiveFailures)) {
      const reactiveNote = next.routedThroughReactive
        ? ' (reactive path)'
        : ''
      logForDebugging(
        `autocompact: circuit breaker tripped after ${next.consecutiveFailures} consecutive failures${reactiveNote} — skipping future attempts this session`,
        { level: 'warn' },
      )
      const payload = autoCompactCircuitBreakerEventPayload(next)
      logEvent('tengu_auto_compact_circuit_breaker', {
        consecutiveFailures: payload.consecutiveFailures,
        ...(payload.routedThroughReactive
          ? { routedThroughReactive: true }
          : {}),
        ...(payload.thresholdSource
          ? {
              thresholdSource:
                payload.thresholdSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
    }
    return {
      wasCompacted: false,
      consecutiveFailures: next.consecutiveFailures,
    }
  }
}
