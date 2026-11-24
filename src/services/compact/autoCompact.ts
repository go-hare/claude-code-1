import { feature } from 'bun:bundle'
import { getSdkBetas, markPostCompaction } from 'src/bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import {
  getAgentContext,
  runWithAgentContext,
} from '../../utils/agentContext.js'
import { getGlobalConfig } from '../../utils/config.js'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../utils/context.js'
import { getRuntimeMainLoopModel } from '../../utils/model/model.js'
import { isFableModel } from '../../utils/fableConsent.js'
import { isFableCreditsSuffixExempt } from '../../utils/model/fableCreditsLabel.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage, isAbortError } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { isCompactBoundaryMessage } from '../../utils/messages.js'
import { resolveColdCompactStripNonEssential } from '../../utils/coldCompact.js'
import { getEnabledSettingSources } from '../../utils/settings/constants.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { getTokenUsage, tokenCountWithEstimation } from '../../utils/tokens.js'
import { roughTokenCountEstimationForMessages } from '../tokenEstimation.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
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

// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  // densable 2.1.234 Nq: env CLAUDE_CODE_AUTO_COMPACT_WINDOW, then
  // settings.autoCompactWindow, else model max (already in contextWindow).
  try {
    const { resolveAutoCompactWindow } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/autoCompactWindow.js') as typeof import('../../utils/autoCompactWindow.js')
    const resolved = resolveAutoCompactWindow(model)
    contextWindow = Math.min(contextWindow, resolved.window)
  } catch {
    try {
      const { resolveAutoCompactWindowOverride } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
      const parsed = resolveAutoCompactWindowOverride()
      if (parsed !== null) {
        contextWindow = Math.min(contextWindow, parsed)
      }
    } catch {
      const autoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
      if (autoCompactWindow) {
        const parsed = parseInt(autoCompactWindow, 10)
        if (!isNaN(parsed) && parsed > 0) {
          contextWindow = Math.min(contextWindow, parsed)
        }
      }
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
  // Official 2.1.328 (`KQn`): consecutive uncounted failures (e.g. Esc user
  // aborts) tracked separately so they never trip the circuit breaker.
  consecutiveUncountedFailures?: number
  // #863 SEA 325 G_o: rapid-refill breaker counter across compactions.
  consecutiveRapidRefills?: number
}

const RAPID_REFILL_TURN_THRESHOLD = 3
const RAPID_REFILL_TRIP_COUNT = 3

export const AUTOCOMPACT_THRASHING_MESSAGE =
  'Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.'

export function checkRapidRefillBreaker(tracking?: AutoCompactTrackingState): {
  action: 'trip' | 'proceed'
  consecutiveRapidRefills: number
} {
  const consecutiveRapidRefills =
    tracking?.compacted === true &&
    tracking.turnCounter < RAPID_REFILL_TURN_THRESHOLD
      ? (tracking?.consecutiveRapidRefills ?? 0) + 1
      : 0
  return {
    action:
      consecutiveRapidRefills >= RAPID_REFILL_TRIP_COUNT ? 'trip' : 'proceed',
    consecutiveRapidRefills,
  }
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
 * densable 2.1.247 xWe — always `e-13000` (f3n). Local 50k/30k tiers were
 * not in official; they made 1M sessions compact near 930k instead of 967k.
 */
export function getAutocompactBufferTokens(_model: string): number {
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

// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isZeroUsage(usage: {
  input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  output_tokens?: number | null
}): boolean {
  return (
    (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) ===
    0
  )
}

type ContextManagementPayload = {
  client_cut_tool_uses?: unknown
  client_estimated_cleared_input_tokens?: unknown
  client_estimate_measured_from_prompts?: unknown
  applied_edits?: unknown
}

/**
 * Official 2.1.328 (`Dtn`, `chunk@286370035.js @374986`):
 * sum input tokens cleared by server-side `clear_tool_uses_20250919` edits
 * (or client-cut edits) recorded on an assistant message's `context_management`.
 */
function clearedInputTokensFromContextManagement(
  contextManagement: ContextManagementPayload | undefined,
): number {
  if (!contextManagement || typeof contextManagement !== 'object') {
    return 0
  }
  const clientCut = contextManagement.client_cut_tool_uses
  if (isFiniteNumber(clientCut) && clientCut > 0) {
    const est = contextManagement.client_estimated_cleared_input_tokens
    return isFiniteNumber(est) ? est : 0
  }
  const appliedEdits = contextManagement.applied_edits
  if (!Array.isArray(appliedEdits)) {
    return 0
  }
  let clearedTokens = 0
  for (const edit of appliedEdits) {
    if (typeof edit !== 'object' || edit === null) continue
    const rec = edit as {
      type?: unknown
      cleared_input_tokens?: unknown
    }
    if (rec.type !== 'clear_tool_uses_20250919') continue
    if (isFiniteNumber(rec.cleared_input_tokens)) {
      clearedTokens += rec.cleared_input_tokens
    }
  }
  const clientEst = contextManagement.client_estimated_cleared_input_tokens
  if (!isFiniteNumber(clientEst)) {
    return clearedTokens
  }
  const measuredFromPrompts =
    contextManagement.client_estimate_measured_from_prompts === true &&
    clearedTokens > 0
  return measuredFromPrompts ? clientEst : Math.min(clearedTokens, clientEst)
}

/**
 * Official 2.1.328 (`N6` + `H_t` + `pUn`, `chunk@294254613.js @1966716`):
 * extract the server-cleared token count from the most recent post-boundary
 * assistant message's `context_management`. Stopping at the latest compact
 * boundary prevents pre-compact edits from inflating post-compact sizing.
 */
export function getServerClearedTokens(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (isCompactBoundaryMessage(msg)) return 0
    if (msg.type !== 'assistant') continue
    const usage = getTokenUsage(msg)
    if (!usage || isZeroUsage(usage)) continue
    const rawMsg = msg.message as
      | (NonNullable<typeof msg.message> & {
          context_management?: ContextManagementPayload
        })
      | undefined
    if (!rawMsg?.context_management && rawMsg?.stop_reason === null) {
      continue
    }
    return clearedInputTokensFromContextManagement(rawMsg?.context_management)
  }
  return 0
}

function getPromptTokensForPutOff(message: Message): number | undefined {
  if (message.type !== 'assistant') return undefined
  if ((message as { handedOff?: boolean }).handedOff) return undefined
  const usage = getTokenUsage(message)
  if (!usage || isZeroUsage(usage)) return undefined
  const rawUsage = usage as typeof usage & {
    iterations?: Array<{
      type?: string
      input_tokens?: number | null
      cache_creation_input_tokens?: number | null
      cache_read_input_tokens?: number | null
    }> | null
    server_tool_use?: {
      web_search_requests?: number | null
      web_fetch_requests?: number | null
    } | null
  }
  if (Array.isArray(rawUsage.iterations) && rawUsage.iterations.length > 0) {
    const firstMsgIter = rawUsage.iterations.find(
      it => it && it.type === 'message',
    )
    if (!firstMsgIter) return undefined
    const total =
      (firstMsgIter.input_tokens ?? 0) +
      (firstMsgIter.cache_creation_input_tokens ?? 0) +
      (firstMsgIter.cache_read_input_tokens ?? 0)
    return total > 0 ? total : undefined
  }
  const webSearch = rawUsage.server_tool_use?.web_search_requests ?? 0
  const webFetch = rawUsage.server_tool_use?.web_fetch_requests ?? 0
  const total =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  if (webSearch > 0 || webFetch > 0 || total === 0) return undefined
  return total
}

/**
 * Official 2.1.328 (`fqt`, `chunk@294254613.js @1968792`):
 * minimum API prompt token size observed since the most recent compact boundary
 * that stamped `compactMetadata.postTokens`. Returns `undefined` when no prior
 * compact boundary with `postTokens` exists in `messages`.
 */
export function getMinPromptTokensSinceLastCompact(
  messages: readonly Message[],
): number | undefined {
  let minTokens: number | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (isCompactBoundaryMessage(msg)) {
      const meta = (msg as { compactMetadata?: { postTokens?: unknown } })
        .compactMetadata
      return meta?.postTokens === undefined ? undefined : minTokens
    }
    const tokens = getPromptTokensForPutOff(msg)
    if (tokens !== undefined) {
      minTokens = minTokens === undefined ? tokens : Math.min(minTokens, tokens)
    }
  }
  return undefined
}

/**
 * Official 2.1.328 (`CLa`, `chunk@293843120.js @2394`): minimum remaining room
 * below threshold (`tengu_spare_attic`) before auto-compact put-off kicks in.
 */
export function getPutOffMinRoomTokens(): number {
  const val = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_spare_attic',
    0,
  )
  return typeof val === 'number' && Number.isFinite(val) ? val : 0
}

/**
 * Official 2.1.328 (`Ikt`, `chunk@294254613.js @2077793`):
 * auto-compact threshold for the model's full context window (ignoring any
 * smaller `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `settings.autoCompactWindow` cap).
 */
export function getFullWindowAutoCompactThreshold(
  model: string,
  options?: { querySource?: string; ignorePctOverride?: boolean },
): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  const fullEffectiveWindow =
    getContextWindowForModel(model, getSdkBetas()) - reservedTokensForSummary
  let bufferTokens = getAutocompactBufferTokens(model)
  try {
    const { scaleAutocompactBufferForColdCompact } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/coldCompact.js') as typeof import('../../utils/coldCompact.js')
    bufferTokens = scaleAutocompactBufferForColdCompact(bufferTokens)
  } catch {
    // optional
  }
  const fullThreshold = fullEffectiveWindow - bufferTokens
  const exemptPctOverride =
    options?.ignorePctOverride === true ||
    isCloudAutocompactPctOverrideExempt(options?.querySource)
  const envPercent = exemptPctOverride
    ? undefined
    : process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const pct = Math.floor(fullEffectiveWindow * (parsed / 100))
      return Math.min(pct, fullThreshold)
    }
  }
  return fullThreshold
}

/**
 * Official 2.1.328 (`sBe`, `chunk@294254613.js @2077837`):
 * true when post-summary room below `thresholdTokens` is smaller than the
 * configured `tengu_spare_attic` minimum room, so compacting again right at
 * the capped threshold would thrash — defer to the model's full window instead.
 */
export function shouldPutOffAutoCompact(
  leftBySummary: number,
  thresholdTokens: number,
  minRoomTokens: number = getPutOffMinRoomTokens(),
): boolean {
  return (
    minRoomTokens > 0 &&
    minRoomTokens < thresholdTokens &&
    thresholdTokens - leftBySummary < minRoomTokens
  )
}

export type AutoCompactPrefixOverflow = {
  prefixTokens: number
  thresholdTokens: number
  totalInputTokens: number
  messagesEstimate: number
  snipTokensFreed: number
  documentBlockCount: number
  imageBlockCount: number
}

/**
 * Official 2.1.328 (`MRs`, `chunk@294254613.js @3055520`):
 * detect when the fixed prefix (system prompt + tools + CLAUDE.md + memories)
 * alone exceeds the auto-compact threshold, meaning compaction cannot free
 * enough space to drop under threshold.
 */
export function detectAutoCompactPrefixOverflow(
  messages: readonly Message[],
  model: string,
  snipTokensFreed = 0,
  options?: { querySource?: string; ignorePctOverride?: boolean },
): AutoCompactPrefixOverflow | null {
  let lastUsage: ReturnType<typeof getTokenUsage>
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (isCompactBoundaryMessage(msg)) break
    const u = getTokenUsage(msg)
    if (u && !isZeroUsage(u)) {
      lastUsage = u
      break
    }
  }
  if (!lastUsage) return null
  const totalInputTokens =
    (lastUsage.input_tokens ?? 0) +
    (lastUsage.cache_read_input_tokens ?? 0) +
    (lastUsage.cache_creation_input_tokens ?? 0)
  const messagesEstimate = roughTokenCountEstimationForMessages(
    messages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
  )
  const prefixTokens = Math.max(
    0,
    totalInputTokens - snipTokensFreed - messagesEstimate,
  )
  const thresholdTokens = getAutoCompactThreshold(model, options)
  if (prefixTokens <= thresholdTokens) return null

  let documentBlockCount = 0
  let imageBlockCount = 0
  const countMedia = (blocks: readonly unknown[]): void => {
    for (const raw of blocks) {
      if (typeof raw !== 'object' || raw === null) continue
      const block = raw as {
        type?: unknown
        source?: { type?: unknown }
        content?: unknown
      }
      if (
        block.type === 'document' &&
        block.source?.type !== 'text' &&
        block.source?.type !== 'content'
      ) {
        documentBlockCount++
      } else if (block.type === 'image') {
        imageBlockCount++
      } else if (block.type === 'tool_result' && Array.isArray(block.content)) {
        countMedia(block.content)
      }
    }
  }
  for (const msg of messages) {
    const content = (msg as { message?: { content?: unknown } }).message
      ?.content
    if (Array.isArray(content)) {
      countMedia(content)
    }
  }

  return {
    prefixTokens,
    thresholdTokens,
    totalInputTokens,
    messagesEstimate,
    snipTokensFreed,
    documentBlockCount,
    imageBlockCount,
  }
}

/**
 * Official 2.1.328 (`KQn`, `chunk@294254613.js @3055125`):
 * update autocompact failure counters. Uncounted failures (e.g. user Esc abort)
 * increment `consecutiveUncountedFailures` without incrementing
 * `consecutiveFailures`, so repeated Esc cancellations never permanently trip
 * the circuit breaker.
 */
export function recordAutoCompactFailure(
  tracking: AutoCompactTrackingState | undefined,
  opts?: {
    uncounted?: boolean
    routedThroughReactive?: boolean
  },
): {
  consecutiveFailures: number
  consecutiveUncountedFailures: number
  uncountedStopReached: boolean
} {
  const uncounted = opts?.uncounted === true
  const consecutiveFailures =
    (tracking?.consecutiveFailures ?? 0) + (uncounted ? 0 : 1)
  const consecutiveUncountedFailures =
    (tracking?.consecutiveUncountedFailures ?? 0) + (uncounted ? 1 : 0)
  if (consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    logForDebugging(
      `autocompact: circuit breaker tripped after ${consecutiveFailures} consecutive failures${opts?.routedThroughReactive ? ' (reactive path)' : ''} — skipping future attempts this session`,
      { level: 'warn' },
    )
    logEvent('tengu_auto_compact_circuit_breaker', {
      consecutiveFailures,
      ...(opts?.routedThroughReactive ? { routedThroughReactive: true } : {}),
    })
  }
  return {
    consecutiveFailures,
    consecutiveUncountedFailures,
    uncountedStopReached:
      uncounted &&
      consecutiveUncountedFailures === MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  }
}

let lastSentClaudeMdTokens: number | undefined

export function recordSentClaudeMdTokens(tokens: number): void {
  lastSentClaudeMdTokens = tokens
}

export function getLastSentClaudeMdTokens(): number | undefined {
  return lastSentClaudeMdTokens
}

export function resetSentClaudeMdTokensForTesting(): void {
  lastSentClaudeMdTokens = undefined
}

/**
 * #1562: When a very large CLAUDE.md changes on disk since it was last sent,
 * compute the extra token growth so auto-compact triggers before hitting PTL.
 */
export async function getClaudeMdGrowthTokens(
  providedClaudeMd?: string,
): Promise<number> {
  if (lastSentClaudeMdTokens === undefined) {
    return 0
  }
  try {
    const { roughTokenCountEstimation } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../tokenEstimation.js') as typeof import('../tokenEstimation.js')
    let currentTokens = providedClaudeMd
      ? roughTokenCountEstimation(providedClaudeMd)
      : 0
    try {
      const { getUserContext } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../context.js') as typeof import('../../context.js')
      const userCtx = await getUserContext()
      if (userCtx.claudeMd) {
        currentTokens = Math.max(
          currentTokens,
          roughTokenCountEstimation(userCtx.claudeMd),
        )
      }
    } catch {
      // Fall back to providedClaudeMd when getUserContext is unavailable
    }
    return Math.max(0, currentTokens - lastSentClaudeMdTokens)
  } catch {
    return 0
  }
}

/**
 * Official 2.1.323 (#2209): In Anthropic-hosted cloud sessions
 * (`CLAUDE_CODE_REMOTE`), `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` no longer applies
 * to auto-memory extraction or `/btw` side questions; the main conversation
 * still follows it.
 */
const CLOUD_AUTOCOMPACT_PCT_EXEMPT_QUERY_SOURCES = new Set([
  'extract_memories',
  'auto_memory',
  'session_memory',
  'btw',
  'side_question',
])

export function isCloudAutocompactPctOverrideExempt(
  querySource?: string,
): boolean {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return false
  }
  if (!querySource) return false
  return (
    CLOUD_AUTOCOMPACT_PCT_EXEMPT_QUERY_SOURCES.has(querySource) ||
    querySource.startsWith('extract_memories') ||
    querySource.startsWith('btw')
  )
}

export function getAutoCompactThreshold(
  model: string,
  options?: { querySource?: string; ignorePctOverride?: boolean },
): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)

  // Official zNy cold-compact densable — larger buffer → earlier autocompact.
  let bufferTokens = getAutocompactBufferTokens(model)
  try {
    const { scaleAutocompactBufferForColdCompact } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/coldCompact.js') as typeof import('../../utils/coldCompact.js')
    bufferTokens = scaleAutocompactBufferForColdCompact(bufferTokens)
  } catch {
    // densable optional
  }

  const autocompactThreshold = effectiveContextWindow - bufferTokens

  // Override for easier testing of autocompact (exempt for cloud auto-memory / /btw per #2209)
  const exemptPctOverride =
    options?.ignorePctOverride === true ||
    isCloudAutocompactPctOverrideExempt(options?.querySource)
  const envPercent = exemptPctOverride
    ? undefined
    : process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
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
  options?: { querySource?: string; ignorePctOverride?: boolean },
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model, options)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

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

  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  const actualContextWindow =
    getContextWindowForModel(model, getSdkBetas()) - reservedTokensForSummary
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
  // densable Yo("autoCompactEnabled", true): merged settings (incl. flagSettings
  // inline from bridge ne / tN) beat legacy GlobalConfig when defined.
  const fromSettings = getInitialSettings().autoCompactEnabled
  if (fromSettings !== undefined) {
    return fromSettings
  }
  return getGlobalConfig().autoCompactEnabled
}

/** densable LJr — precompute setting default is off. */
export function getPrecomputeCompactionDefault(): boolean {
  return false
}

/**
 * densable UJr — auto-compact + zSe/Rhe + tengu_sepia_moth + setting.
 * Does not invent kpw/$t() sidecar swap; this is the official gate only.
 * zSe inlined (same as isReactiveCompactRemoteAllowed) to avoid autoCompact↔reactiveCompact cycle.
 */
export function isPrecomputeCompactionEnabled(): boolean {
  if (!isAutoCompactEnabled()) return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    if (
      getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_reactive_compact_remote',
        false as boolean,
      ) !== true
    ) {
      return false
    }
  }
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_sepia_moth', false)) {
    return false
  }
  return (
    getInitialSettings().precomputeCompactionEnabled ??
    getPrecomputeCompactionDefault()
  )
}

/**
 * densable SEA `RPa` — whether PTL UI should append
 * ` · auto-compact is off · /config to turn it on`.
 *
 * Gold: env disable (`z2p`) → false; if autoCompact on → false; if
 * `resolveSetting` source is `userSettings` → true; if
 * `legacyGlobalConfig` → `getEnabledSettingSources().includes('userSettings')`;
 * else false.
 *
 * Local Config still persists the durable toggle via GlobalConfig (densable
 * legacyGlobalConfig path). Bridge/session flagSettings can force-on via
 * `isAutoCompactEnabled`; when that path is on, hide the hint. When off,
 * return `getEnabledSettingSources().includes('userSettings')`.
 */
export function shouldShowAutoCompactOffHint(): boolean {
  if (
    isEnvTruthy(process.env.DISABLE_COMPACT) ||
    isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)
  ) {
    return false
  }

  if (isAutoCompactEnabled()) {
    return false
  }

  // densable legacyGlobalConfig branch of Vd("autoCompactEnabled", true)
  return getEnabledSettingSources().includes('userSettings')
}

// Official zNy — re-export portable cold-compact gate for compact callers.
export { isColdCompactEnabled } from '../../utils/coldCompact.js'

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
  currentClaudeMd?: string,
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

  const claudeMdGrowth = await getClaudeMdGrowthTokens(currentClaudeMd)
  const serverCleared = getServerClearedTokens(messages)
  const tokenCount =
    tokenCountWithEstimation(messages) -
    snipTokensFreed +
    serverCleared +
    claudeMdGrowth
  const threshold = getAutoCompactThreshold(model, { querySource })
  const effectiveWindow = getEffectiveContextWindowSize(model)

  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}${serverCleared > 0 ? ` serverCleared=${serverCleared}` : ''}${claudeMdGrowth > 0 ? ` claudeMdGrowth=${claudeMdGrowth}` : ''}`,
  )

  const { isAboveAutoCompactThreshold, isAtBlockingLimit } =
    calculateTokenWarningState(tokenCount, model, { querySource })

  if (isAboveAutoCompactThreshold && !isAtBlockingLimit) {
    const lastAssistant = messages.findLast(
      m => m.type === 'assistant' && !m.isApiErrorMessage,
    )
    const hasUnHandedOffAssistant =
      lastAssistant?.type === 'assistant' &&
      !(lastAssistant as { handedOff?: boolean }).handedOff
    if (hasUnHandedOffAssistant) {
      const leftBySummary = getMinPromptTokensSinceLastCompact(messages)
      const fullWindowLimit = getFullWindowAutoCompactThreshold(model, {
        querySource,
      })
      if (
        leftBySummary !== undefined &&
        tokenCount < fullWindowLimit &&
        shouldPutOffAutoCompact(leftBySummary, threshold)
      ) {
        logEvent('tengu_auto_compact_put_off', {
          tokenCount,
          leftBySummary,
          thresholdTokens: threshold,
          limit: fullWindowLimit,
        })
        logForDebugging(
          `autocompact: not compacting at ${threshold}: no prompt since the last summary was under ${leftBySummary} tokens, so this conversation compacts at the threshold of the model's whole window (${fullWindowLimit})`,
        )
        return false
      }
    }
  }

  return isAboveAutoCompactThreshold || isAtBlockingLimit
}

/**
 * #862 / #882 SEA 325 bJr + wJr:
 * When switching to a model with a smaller context window and the conversation
 * is already at the new model's blocking limit, summarize with the previous
 * larger-window model first — unless that previous model requires usage credits
 * without exemption/consent (#862).
 */
export function findLargerPreviousModelForCompact(
  messages: Message[],
  currentModel: string,
  snipTokensFreed = 0,
): string | undefined {
  const lastAssistant = messages.findLast(
    m => m.type === 'assistant' && !m.isApiErrorMessage && m.message?.model,
  )
  const prevModel =
    lastAssistant?.type === 'assistant'
      ? lastAssistant.message?.model
      : undefined
  if (typeof prevModel !== 'string' || !prevModel) return undefined

  const betas = getSdkBetas()
  if (
    getContextWindowForModel(prevModel, betas) <=
    getContextWindowForModel(currentModel, betas)
  ) {
    return undefined
  }
  if (!isRecognizedModelForWindowEnforcement(prevModel)) {
    return undefined
  }

  const tokenCount =
    tokenCountWithEstimation(messages) -
    snipTokensFreed +
    getServerClearedTokens(messages)
  if (!calculateTokenWarningState(tokenCount, currentModel).isAtBlockingLimit) {
    return undefined
  }

  // #862 SEA 325 wJr: do not silently spend usage credits on a summary by the
  // previous model when it requires usage credits without exemption/consent.
  const calmSealModels = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_calm_seal',
    null,
  )
  const requiresCredits =
    isFableModel(prevModel) ||
    (Array.isArray(calmSealModels) &&
      calmSealModels.some(
        entry =>
          typeof entry === 'string' &&
          entry.trim().toLowerCase() === prevModel.trim().toLowerCase(),
      ))
  if (requiresCredits && !isFableCreditsSuffixExempt()) {
    return undefined
  }

  return prevModel
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
  consecutiveUncountedFailures?: number
  uncountedStopReached?: boolean
  consecutiveRapidRefills?: number
  rapidRefillBreakerTripped?: boolean
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  // Official 2.1.326 (#332): resolve runtime model for current permission mode
  // so plan mode with `opusplan` compacts using Opus (the active runtime model)
  // rather than the raw alias/non-plan model.
  const appStateForModel = toolUseContext.getAppState()
  const model = getRuntimeMainLoopModel({
    permissionMode: appStateForModel.toolPermissionContext.mode,
    mainLoopModel: toolUseContext.options.mainLoopModel,
    isSubagent: Boolean(toolUseContext.agentId),
  })
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
    cacheSafeParams.userContext?.claudeMd,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

  // Official 2.1.328 (`MRs`, `chunk@294254613.js @3055520, @3060200`):
  // emit diagnostic telemetry when the fixed prefix alone exceeds the
  // auto-compact threshold (compaction cannot drop below threshold).
  const prefixOverflow = detectAutoCompactPrefixOverflow(
    messages,
    model,
    snipTokensFreed ?? 0,
    { querySource },
  )
  if (prefixOverflow) {
    logForDebugging(
      `autocompact: fixed prefix ~${prefixOverflow.prefixTokens} > threshold ${prefixOverflow.thresholdTokens} — compaction cannot help`,
      { level: 'warn' },
    )
    logEvent('tengu_auto_compact_prefix_overflow', {
      ...prefixOverflow,
      wouldHaveBlocked: true,
    })
  }

  // #863 SEA 325 G_o: rapid-refill thrashing breaker
  const rapidRefill = checkRapidRefillBreaker(tracking)
  if (rapidRefill.action === 'trip') {
    logForDebugging(
      `autocompact: rapid-refill breaker tripped — ${rapidRefill.consecutiveRapidRefills} consecutive refills within <${RAPID_REFILL_TURN_THRESHOLD} turns each (last was ${tracking?.turnCounter} turns)`,
      { level: 'warn' },
    )
    logEvent('tengu_auto_compact_rapid_refill_breaker', {
      consecutiveRapidRefills: rapidRefill.consecutiveRapidRefills,
      turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    })
    return {
      wasCompacted: false,
      rapidRefillBreakerTripped: true,
      consecutiveRapidRefills: rapidRefill.consecutiveRapidRefills,
    }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model, { querySource }),
    querySource,
  }

  // Official 2.1.323 #2103: ensure subagent identity (agent_id / agent_type)
  // is present in AsyncLocalStorage when post-compaction SessionStart('compact')
  // hooks run via executeSessionStartHooks.
  const runWithSubagentCompactContext = <T>(
    fn: () => Promise<T>,
  ): Promise<T> => {
    if (!toolUseContext.agentId) return fn()
    const existing = getAgentContext()
    if (existing?.agentId === toolUseContext.agentId) return fn()
    const inferredSubagentName =
      existing?.agentType === 'subagent' && existing.subagentName
        ? existing.subagentName
        : querySource?.startsWith('agent:builtin:')
          ? querySource.slice('agent:builtin:'.length)
          : querySource?.startsWith('agent:custom:')
            ? querySource.slice('agent:custom:'.length)
            : querySource?.startsWith('agent:')
              ? querySource.slice('agent:'.length)
              : undefined
    return runWithAgentContext(
      {
        agentId: toolUseContext.agentId,
        agentType: 'subagent',
        ...(inferredSubagentName !== undefined
          ? { subagentName: inferredSubagentName }
          : {}),
        isBackgroundAgent: toolUseContext.isBackgroundAgent,
      },
      fn,
    )
  }

  // EXPERIMENT: Try session memory compaction first
  const sessionMemoryResult = await runWithSubagentCompactContext(() =>
    trySessionMemoryCompaction(
      messages,
      toolUseContext.agentId,
      recompactionInfo.autoCompactThreshold,
      toolUseContext.getAppState(),
    ),
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
    return {
      wasCompacted: true,
      compactionResult: sessionMemoryResult,
      consecutiveRapidRefills: rapidRefill.consecutiveRapidRefills,
    }
  }

  try {
    const largerPrevModel =
      (tracking?.consecutiveFailures ?? 0) === 0
        ? findLargerPreviousModelForCompact(messages, model, snipTokensFreed)
        : undefined
    const effectiveCompactModel = largerPrevModel ?? model
    const compactContext =
      effectiveCompactModel !== toolUseContext.options.mainLoopModel
        ? {
            ...toolUseContext,
            options: {
              ...toolUseContext.options,
              mainLoopModel: effectiveCompactModel,
            },
          }
        : toolUseContext
    const resolvedCacheSafeParams: CacheSafeParams =
      compactContext !== toolUseContext
        ? { ...cacheSafeParams, toolUseContext: compactContext }
        : cacheSafeParams

    const compactionResult = await runWithSubagentCompactContext(() =>
      compactConversation(
        messages,
        compactContext,
        resolvedCacheSafeParams,
        true, // Suppress user questions for autocompact
        undefined, // No custom instructions for autocompact
        true, // isAutoCompact
        recompactionInfo,
        // densable Z$o → Pqn stripNonEssential:M=!1
        resolveColdCompactStripNonEssential(),
      ),
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure counts on success
      consecutiveFailures: 0,
      consecutiveUncountedFailures: 0,
      consecutiveRapidRefills: rapidRefill.consecutiveRapidRefills,
    }
  } catch (error) {
    const isUserAbort =
      hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT) ||
      isAbortError(error)
    if (!isUserAbort) {
      logError(error)
    }
    // Official 2.1.328 (`KQn`): user-aborted autocompact (Esc) does NOT
    // increment `consecutiveFailures` so repeated Esc cancels never
    // permanently trip the circuit breaker.
    const failureState = recordAutoCompactFailure(tracking, {
      uncounted: isUserAbort,
    })
    return {
      wasCompacted: false,
      consecutiveFailures: failureState.consecutiveFailures,
      consecutiveUncountedFailures: failureState.consecutiveUncountedFailures,
      ...(failureState.uncountedStopReached
        ? { uncountedStopReached: true }
        : {}),
    }
  }
}
