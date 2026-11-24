// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import {
  FallbackTriggeredError,
  getRetryDelay,
} from './services/api/withRetry.js'
import { isResumedUsageMessageDelta } from './services/api/claude.js'
import {
  POLL_CHUNK_MAX_BYTES,
  POLL_CHUNK_MAX_EVENTS,
} from '@claude-code/builtin-tools/tools/PollTool/constants.js'
import { sleep } from './utils/sleep.js'
import { randomUUID } from 'crypto'
import {
  AUTOCOMPACT_THRASHING_MESSAGE,
  calculateTokenWarningState,
  checkRapidRefillBreaker,
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
  isPrecomputeCompactionEnabled,
  recordSentClaudeMdTokens,
  type AutoCompactTrackingState,
} from './services/compact/autoCompact.js'
import { roughTokenCountEstimation } from './services/tokenEstimation.js'
import {
  buildPostCompactMessages,
  compactConversation,
} from './services/compact/compact.js'
import { applyStreamMediaReplay } from './services/compact/streamMediaReplay.js'
/* eslint-disable @typescript-eslint/no-require-imports */
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('./services/compact/reactiveCompact.js') as typeof import('./services/compact/reactiveCompact.js'))
  : null
const contextCollapse = feature('CONTEXT_COLLAPSE')
  ? (require('./services/contextCollapse/index.js') as typeof import('./services/contextCollapse/index.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { ImageSizeError } from './utils/imageValidation.js'
import { ImageResizeError } from './utils/imageResizer.js'
import { findToolByName, type ToolUseContext } from './Tool.js'
import { applyPendingUiInvalidations } from './utils/plugins/functionHooksModules.js'
import { clearSystemPromptSections } from './constants/systemPromptSections.js'
import { getSystemContext, getUserContext } from './context.js'
import type { SpinnerMode } from './components/Spinner/types.js'
import { asSystemPrompt, type SystemPrompt } from './utils/systemPromptType.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  SystemAPIErrorMessage,
  ToolUseSummaryMessage,
  UserMessage,
  TombstoneMessage,
} from './types/message.js'
import { logError } from './utils/log.js'
import { getAgentContext, runWithAgentContext } from './utils/agentContext.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
} from './utils/plugins/pluginToolList.js'
import {
  deriveAttributionFromQuerySource,
  type OTelAttributionInput,
} from './utils/telemetry/pluginTelemetry.js'
import {
  updateTurnAttributionFromCommands,
  withTurnAttributionGenerator,
} from './utils/turnAttribution.js'
import {
  ControlStreamClosedError,
  errorMessage,
  isAbortError,
} from './utils/errors.js'
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  getPromptTooLongTokenGap,
  isPromptTooLongMessage,
} from './services/api/errors.js'
import {
  THINKING_ONLY_RETRY_PROMPT,
  assistantTextHasLeakedInvoke,
  getMaxOutputTokensRecoveryPrompt,
  malformedToolUseRetryAction,
  querySourceFamilyOf,
} from './query/queryHelpers.js'
import type { CallModelParams } from './query/turnStepHooks.js'
import { logAntError, logForDebugging } from './utils/debug.js'
import {
  isShutdownAbortReason,
  shouldSuppressInterruptionMessage,
} from './utils/abortController.js'
import {
  createUserMessage,
  createUserInterruptionMessage,
  normalizeMessagesForAPI,
  createSystemMessage,
  createAssistantMessage,
  createAssistantAPIErrorMessage,
  getMessagesAfterCompactBoundary,
  createToolUseSummaryMessage,
  isHumanLikeOrigin,
  isThinkingMessage,
  isUnparsedToolInput,
  stripSignatureBlocks,
} from './utils/messages.js'
import { generateToolUseSummary } from './services/toolUseSummary/toolUseSummaryGenerator.js'
import { prependUserContext, appendSystemContext } from './utils/api.js'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  getAttachmentMessages,
  getQueuedCommandAttachments,
  startRelevantMemoryPrefetch,
} from './utils/attachments.js'
import { injectBatchingReminder } from './utils/batchingReminder.js'
import {
  emitRelayThinkingStripped,
  takePendingThinkingStripped,
} from './utils/thinking.js'
/* eslint-disable @typescript-eslint/no-require-imports */
const skillPrefetch = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('./services/skillSearch/prefetch.js') as typeof import('./services/skillSearch/prefetch.js'))
  : null
const searchExtraToolsPrefetch = feature('EXPERIMENTAL_SEARCH_EXTRA_TOOLS')
  ? (require('./services/searchExtraTools/prefetch.js') as typeof import('./services/searchExtraTools/prefetch.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
import { resolveStopHookBlockCap } from './utils/residualMsEnvGates.js'
import { messagesEndWithSuccessfulTerminalMcpTool } from './utils/residualUiEnvGates.js'
import {
  enqueue,
  remove as removeFromQueue,
  consume as consumeFromQueue,
  getCommandsByMaxPriority,
  isSlashCommand,
  registerFoldInFlight,
  unregisterFoldInFlight,
  isMidTurnFoldSuspended,
  startRequeueWindow,
  settleTaken,
  wasPutBack,
} from './utils/messageQueueManager.js'
import { addToHistory } from './history.js'
import {
  bindMainThreadTurn,
  getMainThreadTurn,
  releaseMainThreadTurn,
} from './utils/mainThreadTurn.js'
import {
  type AutonomyTurnOutcome,
  claimConsumableQueuedAutonomyCommands,
  finalizeAutonomyCommandsForTurn,
} from './utils/autonomyQueueLifecycle.js'
import { notifyCommandLifecycle } from './utils/commandLifecycle.js'
import { headlessProfilerCheckpoint } from './utils/headlessProfiler.js'
import {
  getRuntimeMainLoopModel,
  renderModelName,
} from './utils/model/model.js'
import {
  getModelFacts,
  isSmallerContextWindow,
  resolveModelFacts,
  type ModelFacts,
} from './utils/model/modelFacts.js'
import {
  doesMostRecentAssistantMessageExceed200k,
  finalContextTokensFromLastResponse,
  tokenCountWithEstimation,
} from './utils/tokens.js'
import { ESCALATED_MAX_TOKENS } from './utils/context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './services/analytics/growthbook.js'
import { SLEEP_TOOL_NAME } from '@claude-code/builtin-tools/tools/SleepTool/prompt.js'
import { executePostSamplingHooks } from './utils/hooks/postSamplingHooks.js'
import {
  executePostToolBatchHooks,
  executeStopFailureHooks,
  hasHookForEvent,
} from './utils/hooks.js'
import type { QuerySource } from './constants/querySource.js'
import type { PromptCacheTtl } from './utils/promptCacheTtl.js'
import type { QueuedCommand } from './types/textInputTypes.js'
import { createDumpPromptsFetch } from './services/api/dumpPrompts.js'
import {
  mergeToolDrainEvents,
  StreamingToolExecutor,
} from './services/tools/StreamingToolExecutor.js'
import { queryCheckpoint } from './utils/queryProfiler.js'
import {
  isToolBridgeEvent,
  type ToolBridgeEvent,
} from './services/tools/toolExecution.js'
import { applyToolResultBudget } from './utils/toolResultStorage.js'
import { recordContentReplacement } from './utils/sessionStorage.js'
import { handleStopHooks, runTurnEndReactions } from './query/stopHooks.js'
import { BRIEF_ENFORCE_SENTINEL } from '@claude-code/builtin-tools/tools/BriefTool/BriefTool.js'
import {
  getModelSwitchSession,
  takePostModelSwitchHooks,
} from './utils/hooks/modelSwitchHooks.js'
import { enqueueSdkEvent } from './utils/sdkEventQueue.js'
import {
  endTurnSourceFromToolResult,
  type ToolEndTurnSource,
} from './query/endTurnFromToolResult.js'
import { buildQueryConfig } from './query/config.js'
import { productionDeps, type QueryDeps } from './query/deps.js'
import type { Terminal, Continue } from './query/transitions.js'
import { isTransientApiErrorMessage } from './services/goal/goalUnrecoverableClear.js'
import { accumulateToolResultForMidTurn } from './query/accumulateToolResultForMidTurn.js'
import { feature } from 'bun:bundle'
import {
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
  incrementBudgetContinuationCount,
  getSessionId,
  getPromptRenderEpoch,
} from './bootstrap/state.js'
import { createBudgetTracker, checkTokenBudget } from './query/tokenBudget.js'
import { count } from './utils/array.js'
import {
  createTrace,
  endTrace,
  flushLangfuse,
  isLangfuseEnabled,
} from './services/langfuse/index.js'
import { getAPIProvider } from './utils/model/providers.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js'))
  : null
const taskSummaryModule = feature('BG_SESSIONS')
  ? (require('./utils/taskSummary.js') as typeof import('./utils/taskSummary.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

import {
  MALFORMED_TOOL_USE_RETRY_PROMPT,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
  announceOutputLimitRecovery,
  collectPostToolBatchCalls,
  getAutonomyTurnOutcome,
  hasBriefRepliedInTranscript,
  isRequestEligibleForEmptyCompletionResend,
  isTruncatedAfterOutputRecovery,
  isWithheldMaxOutputTokens,
  maybeHandbackBounce,
  maybeSkillInlineCommandHandoffNotRun,
  resolveRefusalFallbackCandidate,
  truncatedRecoveryCopy,
  yieldMissingToolResultBlocks,
} from './query/queryHelpers.js'
import { runPostCompactCleanup } from './services/compact/postCompactCleanup.js'
import { getContextWindowForModel } from './utils/context.js'
import {
  getQueryFunctionHooks,
  streamTurnStepWithHooks,
} from './query/turnStepHooks.js'

export {
  LEAKED_INVOKE_RE,
  MALFORMED_TOOL_USE_EXHAUSTED_TEXT,
  MALFORMED_TOOL_USE_RETRY_PROMPT,
  THINKING_ONLY_RETRY_PROMPT,
  assistantTextHasLeakedInvoke,
  malformedToolUseRetryAction,
  type MalformedToolUseRetryAction,
} from './query/queryHelpers.js'

/**
 * densable `OS` @186864583 sha=`97e1299be7b26e5e`.
 * Gold: `let o=cT(e); if(!Jh||!o||!t.startsWith("repl_main_thread")||e.agentId)return;
 * Jh().markApiFailure(o,pu(),r.error,ex(r)??r.errorDetails??"",r.apiError).catch(()=>{})`
 *
 * Call site (gold-f): exhausted path `OS(ct,A,Li)` after `x0e(Li,ct)`.
 * `Jh` / `cT` / `pu` / `ex` bodies are ABSENT across peels — gold's first gate
 * is `!Jh`, so without a tracker this is a structured no-op (not invented Jh).
 */
export function OS(
  e: { agentId?: string },
  t: string,
  r: {
    error?: unknown
    errorDetails?: unknown
    apiError?: unknown
  },
): void {
  // cT(e) ABSENT — treat as missing query-cost handle.
  const o = undefined as unknown
  // Jh tracker ABSENT — optional global, gold short-circuits on !Jh.
  const Jh = undefined as
    | undefined
    | (() => {
        markApiFailure: (
          costHandle: unknown,
          now: unknown,
          error: unknown,
          details: unknown,
          apiError: unknown,
        ) => Promise<void>
      })
  if (!Jh || !o || !t.startsWith('repl_main_thread') || e.agentId) return
  // Unreachable while Jh/cT stay ABSENT; keep gold arm shape for when a
  // tracker lands without inventing callees here.
  const details =
    (typeof r.errorDetails === 'string' ? r.errorDetails : undefined) ?? ''
  void Jh()
    .markApiFailure(o, Date.now(), r.error, details, r.apiError)
    .catch(() => {})
}

export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  /** densable 2.1.248 #2 — per-agent experimental.cacheTtl → Ivt/jTt. */
  agentCacheTtlOverride?: PromptCacheTtl
  /**
   * densable Fl / pe — omitClaudeMd kept only managed policy CLAUDE.md.
   * Memory inject filters to type==="Managed" when this is set.
   */
  managedInstructionsOnly?: boolean
  /**
   * Official drain: when the dequeued turn carried stopHookActive (stop-hook
   * continuation / concurrent re-queue), seed the loop so nested stop hooks
   * see stop_hook_active=true. Undefined on normal keyboard turns.
   */
  stopHookActive?: boolean
  /**
   * densable `tte` snapshot captured before system-prompt render.
   * queryLoop falls back to getPromptRenderEpoch() when omitted.
   */
  promptRenderEpoch?: number
  /**
   * densable `zu` snapshot. queryLoop reuses when model matches, else Tqe.
   */
  modelFacts?: ModelFacts
  // API task_budget (output_config.task_budget, beta task-budgets-2026-03-13).
  // Distinct from the tokenBudget +500k auto-continue feature. `total` is the
  // budget for the whole agentic turn; `remaining` is computed per iteration
  // from cumulative API usage. See configureTaskBudgetParams in claude.ts.
  taskBudget?: { total: number }
  /**
   * densable Aa `requiresHandback` — SubagentHandback arm. Semantic field on
   * query params (gold BODY in Aa); not a public minify-shaped API.
   */
  requiresHandback?: boolean
  /**
   * densable qC → Gut `thinkingStripPlan` / `advisorStripPlan`. Compact
   * qjt threads these into runQuery; Lv peels attachments at normalize.
   */
  thinkingStripPlan?: import('./utils/thinking.js').ThinkingStripPlan
  advisorStripPlan?: import('./utils/messages.js').AdvisorStripPlan
  /**
   * Official 2.1.328 (#555): optional callback invoked after automatic or
   * reactive compaction to rebuild the system prompt the way `/compact` does,
   * instead of reusing the earlier session system prompt.
   */
  renderSystemPrompt?: (
    context: ToolUseContext,
    modelFacts?: ModelFacts,
  ) => Promise<
    | SystemPrompt
    | { systemPrompt: SystemPrompt; promptRenderEpoch?: number }
    | undefined
  >
  deps?: QueryDeps
}

export type AmberMoleskinEntry = {
  windowSize?: number
  repl: number
  sdk: number
}

export type AmberMoleskinTable = {
  entries: Array<{ windowSize: number; repl: number; sdk: number }>
  defaultEntry: { repl: number; sdk: number } | null
}

function parseAmberMoleskinFraction(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < 1
  ) {
    return value
  }
  return null
}

function parseAmberMoleskinEntry(
  value: unknown,
): { repl: number; sdk: number } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const rec = value as Record<string, unknown>
  const repl = parseAmberMoleskinFraction(rec.repl)
  const sdk = parseAmberMoleskinFraction(rec.sdk)
  return repl === null || sdk === null ? null : { repl, sdk }
}

/** Official JEn — parse `tengu_amber_moleskin` window-keyed precompute table. */
export function parseAmberMoleskinTable(
  raw: unknown,
): AmberMoleskinTable | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const entries: Array<{ windowSize: number; repl: number; sdk: number }> = []
  let defaultEntry: { repl: number; sdk: number } | null = null
  for (const [key, val] of Object.entries(raw)) {
    const parsed = parseAmberMoleskinEntry(val)
    if (parsed === null) return null
    if (key === 'default') {
      defaultEntry = parsed
      continue
    }
    const windowSize = Number(key)
    if (!Number.isSafeInteger(windowSize) || windowSize <= 0) return null
    entries.push({ windowSize, ...parsed })
  }
  if (entries.length === 0 && defaultEntry === null) return null
  return { entries, defaultEntry }
}

/** Official Nlt — resolve precompute buffer fraction from `tengu_amber_moleskin`. */
export function resolvePrecomputeBufferFraction(
  tableValue: unknown,
  windowSize: number,
  entrypoint: string | undefined,
  fallbackFraction: number,
): {
  fraction: number
  source:
    | 'scalar'
    | 'malformed'
    | 'table_no_match'
    | 'table_exact'
    | 'table_default'
  matchedWindowKey?: number
} {
  if (tableValue === null || tableValue === undefined) {
    return { fraction: fallbackFraction, source: 'scalar' }
  }
  const table = parseAmberMoleskinTable(tableValue)
  if (table === null) {
    return { fraction: fallbackFraction, source: 'malformed' }
  }
  const kind = entrypoint === 'sdk' ? 'sdk' : 'repl'
  const exact = table.entries.find(e => e.windowSize === windowSize)
  if (exact !== undefined) {
    return {
      fraction: exact[kind],
      source: 'table_exact',
      matchedWindowKey: exact.windowSize,
    }
  }
  if (table.defaultEntry === null) {
    return { fraction: fallbackFraction, source: 'table_no_match' }
  }
  return { fraction: table.defaultEntry[kind], source: 'table_default' }
}

const DEFAULT_PRECOMPUTE_BUFFER_FRACTION = 0.2
let precomputeArmTableMalformedLogged = false

/** Official 2.1.328 `Pkt()` (`tengu_amber_rokovoko`, default `oBe = 0.2`). */
export function getScalarPrecomputeBufferFraction(): number {
  const val = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_amber_rokovoko',
    DEFAULT_PRECOMPUTE_BUFFER_FRACTION,
  )
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val < 1
    ? val
    : DEFAULT_PRECOMPUTE_BUFFER_FRACTION
}

/**
 * Official 2.1.328 `Okt` (`chunk@294254613.js @2075971`): resolve the live
 * precompute buffer fraction from `tengu_amber_moleskin` (falling back to
 * `tengu_amber_rokovoko` / `0.2`) and emit a one-shot malformed-table event.
 */
export function resolveLivePrecomputeBufferFraction(
  model: string,
  querySource: string | undefined,
): ReturnType<typeof resolvePrecomputeBufferFraction> {
  const rawTable = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_amber_moleskin',
    null,
  )
  const windowSize = getContextWindowForModel(model)
  const resolved = resolvePrecomputeBufferFraction(
    rawTable,
    windowSize,
    querySource,
    getScalarPrecomputeBufferFraction(),
  )
  if (resolved.source === 'malformed' && !precomputeArmTableMalformedLogged) {
    precomputeArmTableMalformedLogged = true
    logEvent('tengu_precompute_arm_table_malformed', {
      payloadType: (Array.isArray(rawTable)
        ? 'array'
        : typeof rawTable) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  return resolved
}

/**
 * Official 2.1.328 `wWn` / `MWn` (`chunk@294254613.js @2068650`): compute the
 * live precompute arming threshold in tokens from `resolvePrecomputeBufferFraction`.
 */
export function getPrecomputeArmThreshold(
  model: string,
  querySource: string | undefined,
): ReturnType<typeof resolvePrecomputeBufferFraction> & {
  threshold: number
  effectiveWindow: number
} {
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const resolved = resolveLivePrecomputeBufferFraction(model, querySource)
  const autoCompactThreshold = getAutoCompactThreshold(model, { querySource })
  const threshold = Math.min(
    effectiveWindow - Math.round(effectiveWindow * resolved.fraction),
    autoCompactThreshold,
  )
  return {
    ...resolved,
    threshold,
    effectiveWindow,
  }
}

// -- official 2.1.328 pure helpers

const GOAL_TOOL_NAMES = new Set([
  'SetGoal',
  'ProposeGoal',
  'PauseGoal',
  'GetGoal',
])

/** Official 2.1.328 `cf` (`chunk@305854618.js @207056`): preserve stopHookBlockCount on goal-only tool turns. */
export function isGoalToolsOnly(blocks: readonly ToolUseBlock[]): boolean {
  return blocks.length > 0 && blocks.every(b => GOAL_TOOL_NAMES.has(b.name))
}

/**
 * Official 2.1.328 `wSr` / `Iir` (`chunk@294254613.js:756964`): non-mutating
 * 20-event / 32KB group-preserving poll-event slice so aborting during
 * attachment building leaves events safely queued.
 */
export function selectPollEventChunk(
  pollEvents: readonly QueuedCommand[],
): QueuedCommand[] {
  if (pollEvents.length === 0) return []
  const chunk: QueuedCommand[] = []
  let bytes = 0
  for (let i = 0; i < pollEvents.length; ) {
    const groupId = (pollEvents[i]!.pollEvent as { group?: string } | undefined)
      ?.group
    let end = i + 1
    while (
      groupId !== undefined &&
      end < pollEvents.length &&
      (pollEvents[end]!.pollEvent as { group?: string } | undefined)?.group ===
        groupId
    ) {
      end++
    }
    const group = pollEvents.slice(i, end)
    const groupBytes = group.reduce(
      (sum, cmd) =>
        sum + Buffer.byteLength(cmd.pollEvent?.envelope ?? '', 'utf8'),
      0,
    )
    if (
      chunk.length > 0 &&
      (chunk.length + group.length > POLL_CHUNK_MAX_EVENTS ||
        bytes + groupBytes > POLL_CHUNK_MAX_BYTES)
    ) {
      break
    }
    chunk.push(...group)
    bytes += groupBytes
    i = end
  }
  return chunk
}

/** Official 2.1.328 `Xus` (`chunk@285203830.js @12178`): max_tokens cut inside a tool call. */
export const TOOL_CALL_CUT_RECOVERY_PROMPT =
  'Your response was cut off because it exceeded the output token limit. The cut fell inside a tool call, so that call did not run and nothing of it was kept. Make the call again in a shorter response: split long content across several smaller tool calls. For a long file, write the first part and then append the rest in later calls.'

/** Official 2.1.328 `qus` (`chunk@285203830.js @11247`): max_tokens cut in finished text block (reopen fence/table). */
export const REOPEN_BLOCK_RECOVERY_PROMPT =
  'Your response was cut off because it exceeded the output token limit. Continue from where you left off and finish the response. Start a new code fence or table header first if you were inside one.'

/** Official 2.1.328 `CHn` (`chunk@285203830.js @9869`): MCP endTurn overridden by failed sibling tool call. */
export const MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT =
  'The turn did not end: a tool call in your last message asked to end it, but another call in that message failed. Deal with the failure, then finish the turn. The calls that succeeded took effect, so do not repeat them.'

/** Official 2.1.328 `amo` / `Kus` (`chunk@285203830.js @10150`): same-model refusal retry nudge. */
export const SAME_MODEL_REFUSAL_RETRY_PROMPT =
  'Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of it was withheld, and tool calls in it that had not finished did not run. Do not produce that content again, even reworded.'

export const SAME_MODEL_REFUSAL_RETRY_INTERRUPTED_PROMPT = `${SAME_MODEL_REFUSAL_RETRY_PROMPT} Exception: a tool call whose result reads "Interrupted" was already running when stopped, so some of its effects may have happened.`

const MAX_SERVER_ERROR_CUT_RETRIES = 5

function buildCutRetryWaitMessage(
  error: unknown,
  retryInMs: number,
  retryAttempt: number,
  uuid: () => string,
): SystemAPIErrorMessage {
  return {
    type: 'system' as const,
    subtype: 'api_error' as const,
    level: 'error' as const,
    error,
    retryInMs,
    retryAttempt,
    maxRetries: MAX_SERVER_ERROR_CUT_RETRIES,
    source: 'cut_retry',
    timestamp: new Date().toISOString(),
    uuid: uuid(),
  } as unknown as SystemAPIErrorMessage
}

function isSafetyMonitorBlockedMessage(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return (
    msg?.type === 'assistant' &&
    msg.isApiErrorMessage === true &&
    msg.apiError === 'safety_monitor_blocked'
  )
}

function isSameModelRefusalMessage(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return (
    msg?.type === 'assistant' &&
    msg.isApiErrorMessage === true &&
    (msg.message as { stop_reason?: unknown } | undefined)?.stop_reason ===
      'refusal'
  )
}

function isSameModelRefusalRetryArmed(
  querySource: QuerySource,
  refusalRetrySpent: boolean,
): boolean {
  if (refusalRetrySpent) return false
  if (querySourceFamilyOf(querySource) === 'auxiliary') return false
  if (
    process.env.CLAUDE_CODE_DISABLE_REFUSAL_RETRY === '1' ||
    process.env.CLAUDE_CODE_DISABLE_REFUSAL_RETRY === 'true'
  ) {
    return false
  }
  return true
}

/**
 * Official 2.1.328 `x_` (`chunk@305854618.js @166703`): single non-error
 * assistant message containing only an incomplete thinking block cut at
 * `max_tokens` with server `resumable === true`.
 */
function canResumeIncompleteThinking(
  responses: readonly AssistantMessage[],
): boolean {
  const nonError = responses.filter(m => !m.isApiErrorMessage)
  if (nonError.length !== 1) return false
  const msg = nonError[0]!
  const content = msg.message?.content
  if (!Array.isArray(content) || content.length !== 1) return false
  const firstBlock = content[0] as { type?: string } | undefined
  if (
    firstBlock?.type !== 'thinking' &&
    firstBlock?.type !== 'redacted_thinking'
  ) {
    return false
  }
  const inner = msg.message as unknown as {
    stop_reason?: unknown
    resumable?: unknown
  }
  return inner.stop_reason === 'max_tokens' && inner.resumable === true
}

/**
 * Official 2.1.328 `O_` (`chunk@305854618.js @167100`): select specific
 * `max_tokens` recovery nudge (`tool_call_cut` / `reopen_block` / default).
 */
export function selectMaxOutputTokensRecoveryPrompt(
  responses: readonly AssistantMessage[],
  isSubagent: boolean,
  attempt: number,
): string {
  const toolCallCut = responses.some(
    m =>
      (m as AssistantMessage & { toolCallCutAtOutputLimit?: boolean })
        .toolCallCutAtOutputLimit === true,
  )
  if (toolCallCut) {
    return TOOL_CALL_CUT_RECOVERY_PROMPT
  }
  const lastNonError = responses.findLast(m => !m.isApiErrorMessage)
  const content = lastNonError?.message?.content
  const lastBlock = Array.isArray(content)
    ? (content.at(-1) as { type?: string; text?: string } | undefined)
    : undefined
  const endedInNonEmptyText =
    lastNonError?.message?.stop_reason === 'max_tokens' &&
    lastBlock?.type === 'text' &&
    typeof lastBlock.text === 'string' &&
    lastBlock.text.trim() !== '' &&
    !responses.some(
      m =>
        (m as AssistantMessage & { cutInUnfinishedBlock?: boolean })
          .cutInUnfinishedBlock === true,
    )
  if (!isSubagent && endedInNonEmptyText) {
    return REOPEN_BLOCK_RECOVERY_PROMPT
  }
  return getMaxOutputTokensRecoveryPrompt(isSubagent, attempt)
}

// -- query loop state

// Mutable state carried between loop iterations
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  serverErrorCutRetryCount?: number
  hasAttemptedReactiveCompact: boolean
  /** Official 2.1.328 (`chunk@305854618.js @206900`): two-pass 413 reactive compact. */
  reactiveCompactDeeperPass?: 'none' | 'available' | 'spent'
  /** Official 2.1.328 `resumeIncompleteThinking`: resume thinking cut at max_tokens. */
  resumeIncompleteThinking?: boolean
  /** Official 2.1.328 `refusalRetrySpent`: one-shot same-model refusal retry latch. */
  refusalRetrySpent?: boolean
  /** Official 2.1.328 `Ol`: one-shot guard on overriding MCP endTurn via Stop hook / failed sibling. */
  mcpEndTurnOverrideSpent?: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  stopHookBlockCount: number
  turnCount: number
  /**
   * densable Pe.thinkingOnlyNudged — one-shot latch on the continue bag after
   * a jlt nudge (gold-251-g #11). Not React AppState.
   */
  thinkingOnlyNudged: boolean
  /**
   * Official 2.1.328 `emptyCompletionResent` — one-shot latch on the continue
   * bag after an empty completion was resent once before giving up.
   */
  emptyCompletionResent: boolean
  malformedToolUseRetryCount?: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition: Continue | { reason: 'refusal_retry'; model?: string } | undefined
}

async function* queryBody(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage
  | ToolBridgeEvent
  | { type: 'spinner_mode'; mode: SpinnerMode },
  Terminal
> {
  const consumedCommandUuids: string[] = []
  const consumedAutonomyCommands: QueuedCommand[] = []

  // Create Langfuse trace for this query turn (no-op if not configured).
  // When called as a sub-agent, langfuseTrace is already set by runAgent()
  // — reuse it instead of creating an independent trace.
  const ownsTrace = !params.toolUseContext.langfuseTrace
  logForDebugging(
    `[query] ownsTrace=${ownsTrace} incoming langfuseTrace=${params.toolUseContext.langfuseTrace ? 'present' : 'null/undefined'} isLangfuseEnabled=${isLangfuseEnabled()}`,
  )
  const langfuseTrace =
    params.toolUseContext.langfuseTrace ??
    (isLangfuseEnabled()
      ? createTrace({
          sessionId: getSessionId(),
          model: params.toolUseContext.options.mainLoopModel,
          provider: getAPIProvider(),
          input: params.messages,
          querySource: params.querySource,
        })
      : null)

  // Official 2.1.325 #2356: propagate `querySource` and scheduled-task / `/loop`
  // execution flags into `ToolUseContext.options` so `SkillTool`
  // (`isScheduledOrLoopSkillExecution`) asks before running skills declaring
  // `allowed-tools` or `hooks`.
  const existingToolOpts = params.toolUseContext
    .options as ToolUseContext['options'] & {
    isCron?: boolean
    isScheduledTask?: boolean
    isLoop?: boolean
  }
  const effectiveQuerySource =
    existingToolOpts.querySource ?? params.querySource
  let turnTriggeredByScheduledFire = false
  let turnOriginKind: string | undefined
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]
    if (!m) continue
    if (m.type === 'assistant') break
    if (
      m.type === 'system' &&
      (m as { subtype?: unknown }).subtype === 'scheduled_task_fire'
    ) {
      turnTriggeredByScheduledFire = true
      break
    }
    if (m.type === 'user' && !m.isMeta) {
      const originKind = (m as { origin?: { kind?: string } }).origin?.kind
      if (originKind) {
        turnOriginKind = originKind
      }
      if (
        originKind === 'cron' ||
        originKind === 'scheduled' ||
        originKind === 'loop'
      ) {
        turnTriggeredByScheduledFire = true
        break
      }
    }
  }
  const querySourceMatchesScheduledOrLoop =
    typeof effectiveQuerySource === 'string' &&
    /(?:^|_)(?:cron|schedule|scheduled|loop)(?:$|_)/i.test(effectiveQuerySource)
  const isScheduledOrLoop =
    existingToolOpts.isCron === true ||
    existingToolOpts.isScheduledTask === true ||
    existingToolOpts.isLoop === true ||
    turnTriggeredByScheduledFire ||
    querySourceMatchesScheduledOrLoop
  const isLoopTurn =
    existingToolOpts.isLoop === true ||
    turnOriginKind === 'loop' ||
    (typeof effectiveQuerySource === 'string' &&
      /(?:^|_)loop(?:$|_)/i.test(effectiveQuerySource))
  const propagatedOptions = {
    ...existingToolOpts,
    querySource: effectiveQuerySource,
    ...(isScheduledOrLoop
      ? {
          isCron: true,
          isScheduledTask: true,
          isLoop: isLoopTurn,
        }
      : {}),
  } as ToolUseContext['options']

  // Attach trace and propagated options to toolUseContext so tool execution
  // can record observations and inspect scheduled/loop execution context.
  const paramsWithTrace: QueryParams = {
    ...params,
    toolUseContext: {
      ...params.toolUseContext,
      options: propagatedOptions,
      ...(langfuseTrace ? { langfuseTrace } : {}),
    },
  }

  let boundMainThreadTurnId: string | undefined
  if (querySourceFamilyOf(paramsWithTrace.querySource) === 'main') {
    boundMainThreadTurnId = randomUUID()
    let personStarted = false
    for (let i = paramsWithTrace.messages.length - 1; i >= 0; i--) {
      const message = paramsWithTrace.messages[i]
      if (message?.type !== 'user') continue
      personStarted = isHumanLikeOrigin(
        (message as { origin?: { kind?: string } }).origin,
      )
      break
    }
    bindMainThreadTurn({
      turnId: boundMainThreadTurnId,
      abort: () => {
        const ac = paramsWithTrace.toolUseContext.abortController
        if (ac && !ac.signal.aborted) ac.abort('user-cancel')
      },
      startedBy: personStarted ? 'person' : 'automatic',
    })
  }

  // Official queryWithObserverTap densable — capture stream activity for armed
  // observer pairings (JOu). Lazy require keeps observer optional for cold paths.
  // Official VOu: on main-family queries, fire-and-forget ensure main-session
  // observer when mainThreadAgent declares observer: (await only non-interactive).
  let observerTap: {
    capture: (value: unknown) => void
    flushSegment: () => void
    finish: (reason: string) => void
  } | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      createObserverActivityTap,
      ensureMainSessionObserver,
      getQuerySourceFamily,
    } =
      require('./utils/observerAgents.js') as typeof import('./utils/observerAgents.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMainThreadAgentType } =
      require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
    // Install real G0t host (AgentTool spawn/deliver/abort) before VOu arm so
    // main-session first delivery is a real async fork, not the refuse stub.
    if (getQuerySourceFamily(paramsWithTrace.querySource) === 'main') {
      const activeAgents =
        paramsWithTrace.toolUseContext.options.agentDefinitions?.activeAgents ??
        []
      const mainType = getMainThreadAgentType()
      const mainAgentDefinition = mainType
        ? activeAgents.find(a => a.agentType === mainType)
        : undefined
      // Skip ensure work when main agent has no observer: declaration.
      if (mainAgentDefinition?.observer) {
        const ensurePromise = (async () => {
          try {
            const { installAgentObserverRuntimeHost } = await import(
              '@claude-code/builtin-tools/tools/AgentTool/observerRuntimeHost.js'
            )
            await installAgentObserverRuntimeHost({
              toolUseContext: paramsWithTrace.toolUseContext,
              canUseTool: paramsWithTrace.canUseTool,
              setAppState:
                paramsWithTrace.toolUseContext.setAppStateForTasks ??
                paramsWithTrace.toolUseContext.setAppState,
              log: msg => logForDebugging(msg),
            })
          } catch (err) {
            logForDebugging(
              `[agentObserver] real host install failed (arm may refuse first-run): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          const armCtx = paramsWithTrace.toolUseContext
          let armingPermissionMode: string | undefined
          try {
            armingPermissionMode =
              armCtx.getAppState().toolPermissionContext.mode
          } catch {
            armingPermissionMode = undefined
          }
          // createAgentId for real agent ids (observer spawn / resume paths).
          const { createAgentId } = await import('src/utils/uuid.js')
          return ensureMainSessionObserver({
            mainAgentDefinition,
            activeAgents,
            armingToolUseContext: armCtx,
            canUseTool: paramsWithTrace.canUseTool,
            setAppState: armCtx.setAppStateForTasks ?? armCtx.setAppState,
            ...(armingPermissionMode !== undefined
              ? { armingPermissionMode }
              : {}),
            generateObserverTaskId: () => createAgentId(),
            // Match AgentTool o5r arm density (wZi tools + Agent checkPermissions).
            tools: armCtx.options.tools?.map(t => ({
              name: t.name,
              ...(t.aliases ? { aliases: t.aliases } : {}),
            })),
            allowedAgentTypes:
              armCtx.options.agentDefinitions?.allowedAgentTypes,
            gateCanUseTool: async ({
              subagentType,
              description: gateDesc,
              prompt: gatePrompt,
            }) => {
              const agentTool =
                findToolByName(armCtx.options.tools, 'Agent') ??
                findToolByName(armCtx.options.tools, 'Task')
              if (!agentTool) return 'deny'
              try {
                const result = await agentTool.checkPermissions(
                  {
                    description: gateDesc,
                    prompt: gatePrompt,
                    subagent_type: subagentType,
                    run_in_background: true,
                  },
                  armCtx,
                )
                if (result.behavior === 'allow') return 'allow'
                if (result.behavior === 'deny') return 'deny'
                if (result.behavior === 'ask') return 'ask'
                return 'allow'
              } catch {
                return 'error'
              }
            },
            // Cold resume of main-session observer: no live local_agent task
            // → firstRunDone stays false and spawnFirstRun restarts lifecycle.
            // Main HXt pointer load/save is defaulted inside ensureMainSessionObserver.
            isObserverProcessRunning: observerTaskId => {
              try {
                const task = armCtx.getAppState().tasks?.[observerTaskId] as
                  | { type?: string; status?: string }
                  | undefined
                return task?.type === 'local_agent' && task.status === 'running'
              } catch {
                return false
              }
            },
            log: msg => logForDebugging(msg),
          })
        })()
        // Official: non-interactive (cn()) awaits ensure so arm completes before
        // first turn activity; interactive fire-and-forget.
        const nonInteractive =
          paramsWithTrace.toolUseContext.options.isNonInteractiveSession ===
          true
        if (nonInteractive) {
          try {
            await ensurePromise
          } catch (err) {
            logForDebugging(
              `[agentObserver] non-interactive arm failed (degrading to unobserved): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        } else {
          void ensurePromise.catch(err => {
            logForDebugging(
              `[agentObserver] main-session ensure failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          })
        }
      }
    }
    observerTap = createObserverActivityTap({
      querySource: paramsWithTrace.querySource,
      toolUseContext: paramsWithTrace.toolUseContext,
      messages: paramsWithTrace.messages,
      turnStartIndex: 0,
      log: msg => logForDebugging(msg),
    })
  } catch {
    observerTap = null
  }

  let terminal: Terminal | undefined
  let didThrow = false
  let thrownError: unknown
  try {
    const loop = queryLoop(
      paramsWithTrace,
      consumedCommandUuids,
      consumedAutonomyCommands,
    )
    if (observerTap) {
      while (true) {
        const next = await loop.next()
        if (next.done) {
          terminal = next.value
          break
        }
        const value = next.value
        if (
          value &&
          typeof value === 'object' &&
          'type' in value &&
          (value as { type: unknown }).type === 'stream_request_start'
        ) {
          observerTap.flushSegment()
        } else {
          observerTap.capture(value)
        }
        yield value
      }
      if (terminal) {
        observerTap.finish(terminal.reason)
      }
    } else {
      terminal = yield* loop
    }
  } catch (error) {
    didThrow = true
    thrownError = error
    if (observerTap) {
      try {
        observerTap.finish('error')
      } catch {
        // best-effort
      }
    }
    throw error
  } finally {
    if (boundMainThreadTurnId !== undefined) {
      releaseMainThreadTurn(boundMainThreadTurnId)
    }
    await finalizeAutonomyCommandsForTurn({
      commands: consumedAutonomyCommands,
      outcome: getAutonomyTurnOutcome({
        terminal,
        ...(didThrow ? { thrownError } : {}),
      }),
      priority: 'later',
    })
      .then(nextCommands => {
        for (const command of nextCommands) {
          enqueue(command)
        }
      })
      .catch(logError)

    // Only end the trace if we created it — sub-agents own their traces
    if (ownsTrace) {
      const isAborted =
        terminal?.reason === 'aborted_streaming' ||
        terminal?.reason === 'aborted_tools'
      endTrace(langfuseTrace, undefined, isAborted ? 'interrupted' : undefined)
      // Flush the processor to release span data (including serialized
      // conversation history stored as langfuse.observation.input). Without
      // this, SpanImpl objects retain hundreds of KB of JSON until the
      // processor's batch timer fires (default 10s).
      await flushLangfuse()
    }

    // Break the closure chain: toolUseContext captures langfuseTrace which
    // holds SpanImpl → otperformance (the 571MB Performance object). Nulling
    // these after endTrace allows GC to reclaim the span tree.
    if (paramsWithTrace !== params) {
      paramsWithTrace.toolUseContext.langfuseTrace = null
      paramsWithTrace.toolUseContext.langfuseRootTrace = null
      paramsWithTrace.toolUseContext.langfuseBatchSpan = null
    }

    // Clear JSC's native Performance buffers. OTel (otperformance) references
    // globalThis.performance which stores marks/measures/resource timings in a
    // C++ Vector that never shrinks. Long-running sessions accumulate hundreds
    // of MB of dead capacity even after spans are flushed and nullified.
    const gPerf = globalThis.performance
    if (gPerf && typeof gPerf.clearMarks === 'function') {
      try {
        gPerf.clearMarks()
        gPerf.clearMeasures?.()
        gPerf.clearResourceTimings?.()
      } catch {
        // Non-critical — some environments may not support all methods
      }
    }
  }

  // Only reached if queryLoop returned normally. Skipped on throw (error
  // propagates through yield*) and on .return() (Return completion closes
  // both generators). Official 2.1.328 `Pp` (`chunk@305854618.js @189350, @222333`):
  // close the requeue window on main-thread turns, omit commands put back by
  // `requeueTaken()`, and emit `cancelled` on abort vs `completed` normally.
  if (!paramsWithTrace.toolUseContext.agentId) {
    settleTaken()
  }
  const lifecycleEndState =
    terminal?.reason === 'aborted_streaming' ||
    terminal?.reason === 'aborted_tools'
      ? 'cancelled'
      : 'completed'
  for (const uuid of consumedCommandUuids) {
    if (!wasPutBack(uuid)) {
      notifyCommandLifecycle(uuid, lifecycleEndState)
    }
  }
  if (!paramsWithTrace.toolUseContext.agentId) {
    settleTaken({ turnEnded: true })
  }
  return terminal!
}

async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
  consumedAutonomyCommands: QueuedCommand[],
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage
  | ToolBridgeEvent
  | { type: 'spinner_mode'; mode: SpinnerMode },
  Terminal
> {
  // Official 2.1.328 (#555): systemPrompt is rebuilt after autocompact and
  // reactive compact when `params.renderSystemPrompt` is provided, matching `/compact`.
  let { systemPrompt, userContext } = params
  let needsSystemPromptRebuild = false
  const {
    systemContext,
    canUseTool,
    fallbackModel,
    querySource,
    maxTurns,
    skipCacheWrite,
    agentCacheTtlOverride,
    managedInstructionsOnly,
    thinkingStripPlan,
    advisorStripPlan,
  } = params
  const deps = params.deps ?? productionDeps()
  // densable `ht=e.promptRenderEpoch??tte()`, `mo=e.modelFacts` — once per query.
  let promptRenderEpoch = params.promptRenderEpoch ?? getPromptRenderEpoch()
  let pendingModelFacts = params.modelFacts
  const turnStepFamily = querySourceFamilyOf(querySource)
  const turnStepTurnId =
    turnStepFamily === 'auxiliary'
      ? undefined
      : params.toolUseContext.agentId === undefined
        ? (getMainThreadTurn()?.turnId ?? deps.uuid())
        : deps.uuid()
  let turnStepIndex = 0

  // Mutable cross-iteration state. The loop body destructures this at the top
  // of each iteration so reads stay bare-name (`messages`, `toolUseContext`).
  // Continue sites write `state = { ... }` instead of N separate assignments.
  if (managedInstructionsOnly) {
    params.toolUseContext.options.managedInstructionsOnly = true
  }

  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
    // Seed from drain when the turn was a stop-hook continuation / concurrent
    // re-queue (official JWH.stopHookActive from onQuery e9).
    stopHookActive: params.stopHookActive,
    stopHookBlockCount: 0,
    maxOutputTokensRecoveryCount: 0,
    serverErrorCutRetryCount: 0,
    hasAttemptedReactiveCompact: false,
    reactiveCompactDeeperPass: 'none',
    resumeIncompleteThinking: undefined,
    refusalRetrySpent: false,
    mcpEndTurnOverrideSpent: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
    // densable Pe.thinkingOnlyNudged — first iteration false.
    thinkingOnlyNudged: false,
    emptyCompletionResent: false,
    malformedToolUseRetryCount: 0,
    transition: undefined,
  }
  const budgetTracker = feature('TOKEN_BUDGET') ? createBudgetTracker() : null

  // task_budget.remaining tracking across compaction boundaries. Undefined
  // until first compact fires — while context is uncompacted the server can
  // see the full history and handles the countdown from {total} itself (see
  // api/api/sampling/prompt/renderer.py:292). After a compact, the server sees
  // only the summary and would under-count spend; remaining tells it the
  // pre-compact final window that got summarized away. Cumulative across
  // multiple compacts: each subtracts the final context at that compact's
  // trigger point. Loop-local (not on State) to avoid touching the 7 continue
  // sites.
  let taskBudgetRemaining: number | undefined

  // Snapshot immutable env/statsig/session state once at entry. See QueryConfig
  // for what's included and why feature() gates are intentionally excluded.
  const config = buildQueryConfig()

  // Fired once per user turn — the prompt is invariant across loop iterations,
  // so per-iteration firing would ask sideQuery the same question N times.
  // Consume point polls settledAt (never blocks). `using` disposes on all
  // generator exit paths — see MemoryPrefetch for dispose/telemetry semantics.
  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages,
    state.toolUseContext,
  )

  // Official 2.1.328 turn-start poll-event fold (`chunk@305854618.js @226800-227600`):
  // respect `isMidTurnFoldSuspended()`, apply 20-event / 32KB `selectPollEventChunk`
  // cap, wrap with `registerFoldInFlight`/`unregisterFoldInFlight`, re-check abort
  // after attachment building, consume with `{ reason: 'absorbed_mid_turn' }`,
  // and emit `command_lifecycle('started')`.
  {
    const isMainThread =
      querySource.startsWith('repl_main_thread') || querySource === 'sdk'
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isMainThreadQueuedCommand } =
      require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
    const rawTurnStartPoll = isMidTurnFoldSuspended()
      ? []
      : getCommandsByMaxPriority('next').filter(cmd => {
          if (cmd.mode !== 'poll-event') return false
          if (cmd.waitsOutStop === true || cmd.passive === true) return false
          if (isMainThread) return isMainThreadQueuedCommand(cmd)
          return cmd.agentId === state.toolUseContext.agentId
        })
    const turnStartPoll = selectPollEventChunk(rawTurnStartPoll)
    if (turnStartPoll.length > 0) {
      registerFoldInFlight(turnStartPoll)
      try {
        const built = await getQueuedCommandAttachments(turnStartPoll)
        if (
          built.some(attachment => attachment.type === 'poll_events') &&
          !state.toolUseContext.abortController.signal.aborted &&
          !isMidTurnFoldSuspended()
        ) {
          for (const att of built) {
            const msg = createAttachmentMessage(att)
            state.messages = [...state.messages, msg]
            yield msg
          }
          consumeFromQueue(turnStartPoll, { reason: 'absorbed_mid_turn' })
          for (const cmd of turnStartPoll) {
            if (cmd.uuid && !wasPutBack(cmd.uuid)) {
              consumedCommandUuids.push(cmd.uuid)
              notifyCommandLifecycle(cmd.uuid, 'started')
            }
          }
        }
      } catch (err) {
        if (isAbortError(err)) {
          const { QUERY_TURN_START_POLL_EVENTS_ABORTED } = await import(
            './cli/printControlExtras.js'
          )
          logForDebugging(QUERY_TURN_START_POLL_EVENTS_ABORTED)
        } else {
          logError(err)
        }
      } finally {
        unregisterFoldInFlight(turnStartPoll)
      }
    }
  }

  // densable adn.isRunning — true for this queryLoop, depth-counted so a
  // nested subagent loop does not clear the parent. Disposes on close.
  using _pluginDevModsTurn = (() => {
    try {
      const { isDevModsPersonTurn, trackPluginDevModsTurn } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./utils/plugins/pluginDevMods.js') as typeof import('./utils/plugins/pluginDevMods.js')
      return trackPluginDevModsTurn({
        person:
          params.toolUseContext.agentId === undefined &&
          isDevModsPersonTurn(params.messages),
        abort: () => {
          const ac = params.toolUseContext.abortController
          if (ac && !ac.signal.aborted) ac.abort()
        },
      })
    } catch {
      return { [Symbol.dispose]() {} }
    }
  })()
  void _pluginDevModsTurn

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Destructure state at the top of each iteration. toolUseContext alone
      // is reassigned within an iteration (queryTracking, messages updates);
      // the rest are read-only between continue sites.
      let { toolUseContext } = state
      const leftoverSpinnerModes: Array<{
        type: 'spinner_mode'
        mode: SpinnerMode
      }> = []
      const leftoverPrevSetMode = toolUseContext.setStreamMode
      // Children (fork/teammate) have no setStreamMode; the runner consumes
      // the yielded spinner_mode and Phn(taskId).setMode. A parent callback
      // (REPL, QueryEngine) applies the mode immediately — those consumers
      // also handle the yield, so queueing as well would apply it twice and
      // replay a stale mode at the next drain.
      toolUseContext = {
        ...toolUseContext,
        setStreamMode: mode => {
          if (leftoverPrevSetMode) leftoverPrevSetMode(mode)
          else leftoverSpinnerModes.push({ type: 'spinner_mode', mode })
        },
      }
      // Unwrap the per-iteration spinner tap. Callers pass the live context
      // (recovery continue, or toolUseContextWithQueryTracking after tools)
      // so queryTracking, model fallback, and context modifiers survive.
      // Always restore previous — including undefined (fork/teammate have no
      // parent UI callback). Returning the tapped ctx nests taps across continues.
      const leftoverUnwrapStreamMode = (
        ctx: ToolUseContext,
      ): ToolUseContext => ({
        ...ctx,
        setStreamMode: leftoverPrevSetMode,
      })
      // Drain spinner_mode events pushed after the last mid-loop drain before
      // leaving this iteration — return/continue otherwise drops them because
      // the next while-true pass allocates a fresh leftoverSpinnerModes array.
      const leftoverDrainSpinnerModes = function* (): Generator<{
        type: 'spinner_mode'
        mode: SpinnerMode
      }> {
        while (leftoverSpinnerModes.length > 0) {
          yield leftoverSpinnerModes.shift()!
        }
      }
      const {
        messages,
        autoCompactTracking,
        maxOutputTokensRecoveryCount,
        hasAttemptedReactiveCompact,
        maxOutputTokensOverride,
        pendingToolUseSummary,
        stopHookActive,
        stopHookBlockCount,
        turnCount,
        thinkingOnlyNudged,
        emptyCompletionResent,
      } = state
      const malformedToolUseRetryCount = state.malformedToolUseRetryCount ?? 0
      const reactiveCompactDeeperPass =
        state.reactiveCompactDeeperPass ?? 'none'
      const resumeIncompleteThinking = state.resumeIncompleteThinking
      const serverErrorCutRetryCount = state.serverErrorCutRetryCount ?? 0
      const refusalRetrySpent = state.refusalRetrySpent ?? false
      const mcpEndTurnOverrideSpent = state.mcpEndTurnOverrideSpent ?? false

      // densable fl(H.transition, f.agentId) — gold skips when agentId is set
      // (subagent spinner store is per-id via $xe). Analog: only the main REPL
      // wires setOutputLimitRecovery; subagents have no spinner row.
      announceOutputLimitRecovery(
        state.transition?.reason === 'refusal_retry'
          ? undefined
          : state.transition,
        toolUseContext,
      )

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { bindPluginDevModsSession, restorePluginDevModsHost } =
          require('./utils/plugins/pluginDevMods.js') as typeof import('./utils/plugins/pluginDevMods.js')
        const { refreshActivePlugins } =
          require('./utils/plugins/refresh.js') as typeof import('./utils/plugins/refresh.js')
        bindPluginDevModsSession({
          canUseTool,
          toolContext: ac => ({
            ...toolUseContext,
            abortController: ac,
          }),
          reloadPlugins: async () => {
            await refreshActivePlugins(toolUseContext.setAppState, {
              applyStagedInstalls: false,
            })
          },
        })
        restorePluginDevModsHost()
      } catch {
        // optional until plugin_dev_mods host is present
      }

      // Skill discovery prefetch — per-iteration (uses findWritePivot guard
      // that returns early on non-write iterations). Discovery runs while the
      // model streams and tools execute; awaited post-tools alongside the
      // memory prefetch consume. Replaces the blocking assistant_turn path
      // that ran inside getAttachmentMessages (97% of those calls found
      // nothing in prod). Turn-0 user-input discovery still blocks in
      // userInputAttachments — that's the one signal where there's no prior
      // work to hide under.
      const pendingSkillPrefetch = skillPrefetch?.startSkillDiscoveryPrefetch(
        null,
        messages,
        toolUseContext,
      )
      const pendingToolPrefetch =
        searchExtraToolsPrefetch?.startSearchExtraToolsPrefetch(
          toolUseContext.options.tools ?? [],
          messages,
        )

      // densable: if(ne&&y.toolUseContext.shouldStopBeforeNextApiCall?.())
      // return {reason:"background_requested"} — ne = main thread (no agentId)
      // or undefined querySource family. Tip: !agentId ≈ main REPL/SDK.
      if (
        !toolUseContext.agentId &&
        toolUseContext.shouldStopBeforeNextApiCall?.()
      ) {
        yield* leftoverDrainSpinnerModes()
        return { reason: 'background_requested' }
      }

      // Official 2.1.328 `Ip` (`chunk@305854618.js @230720`): arm the interrupt
      // requeue window deadline on the last absorbed main-thread prompt before
      // starting the next streaming API request.
      if (!toolUseContext.agentId) {
        startRequeueWindow()
      }

      yield { type: 'stream_request_start' }
      yield* leftoverDrainSpinnerModes()

      queryCheckpoint('query_fn_entry')

      // Record query start for headless latency tracking (skip for subagents)
      if (!toolUseContext.agentId) {
        headlessProfilerCheckpoint('query_started')
      }

      // Initialize or increment query chain tracking
      const queryTracking = toolUseContext.queryTracking
        ? {
            chainId: toolUseContext.queryTracking.chainId,
            depth: toolUseContext.queryTracking.depth + 1,
          }
        : {
            chainId: deps.uuid(),
            depth: 0,
          }

      const queryChainIdForAnalytics =
        queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

      toolUseContext = {
        ...toolUseContext,
        queryTracking,
      }

      let messagesForQuery = getMessagesAfterCompactBoundary(messages)

      // densable VOo @195437089 — main-thread PostModelSwitch pending drain
      const resumeActive =
        (
          params as {
            resumeActive?: boolean
            resumeIncompleteThinking?: boolean
          }
        ).resumeActive === true ||
        (
          params as {
            resumeActive?: boolean
            resumeIncompleteThinking?: boolean
          }
        ).resumeIncompleteThinking === true
      if (
        querySourceFamilyOf(querySource) === 'main' &&
        !toolUseContext.agentId &&
        !resumeActive
      ) {
        try {
          const fallbackSession = getModelSwitchSession()
          const ctxSession = toolUseContext.session
          const switchSession =
            ctxSession !== undefined
              ? {
                  id:
                    'id' in ctxSession && typeof ctxSession.id === 'string'
                      ? ctxSession.id
                      : fallbackSession.id,
                  root: ctxSession.root,
                }
              : fallbackSession
          const landed = await takePostModelSwitchHooks(switchSession)
          for (const item of landed) {
            for (const message of item.messages) {
              yield message
              messagesForQuery = [...messagesForQuery, message]
            }
            if (item.contexts.length > 0) {
              const ctx = createAttachmentMessage({
                type: 'hook_additional_context',
                content: item.contexts,
                hookName: 'PostModelSwitch',
                toolUseID: 'PostModelSwitch',
                hookEvent: 'PostModelSwitch',
              })
              yield ctx
              messagesForQuery = [...messagesForQuery, ctx]
            }
          }
        } catch (err) {
          logError(err)
        }
      }

      // Official 2.1.328 (`chunk@294254613.js:3319260, 6069470`): foreign-model
      // thinking stripping (`stripForeignThinkingBlocks`) runs inside claude.ts
      // per message.model compatibility, so same-model turns preserve prompt
      // cache and extended-thinking continuity instead of unconditionally
      // stripping signature blocks here.
      // Release toolUseResult payloads from previous turns — the next API call
      // only needs message.message.content (tool_result blocks), not the raw
      // output object. This prevents unbounded memory growth in long sessions
      // before compact triggers (a single FileRead of a 400KB file would
      // otherwise stay in mutableMessages forever).
      //
      // IMPORTANT: shallow-copy rather than mutate. messagesForQuery elements
      // are references shared with mutableMessages (UI state); deleting
      // toolUseResult in place strips it from the live message while React may
      // still be rendering it. The next query can start within milliseconds of
      // tool_result creation (model immediately calls the next tool), before
      // the UI commit lands — UserToolSuccessMessage reads
      // message.toolUseResult to delegate to tool.renderToolResultMessage, so a
      // mutation race makes tool-result rows render blank. Map to a stripped
      // copy so mutableMessages keeps the original for the UI; downstream API
      // transformations (applyToolResultBudget, snip, microcompact) already
      // build new arrays via .map(), so they compose cleanly with this copy.
      messagesForQuery = messagesForQuery.map(msg => {
        if (
          msg.type !== 'user' ||
          !('toolUseResult' in msg) ||
          (msg as { toolUseResult?: unknown }).toolUseResult === undefined
        ) {
          return msg
        }
        const copy: typeof msg = { ...msg }
        delete (copy as Message & { toolUseResult?: unknown }).toolUseResult
        return copy
      })

      let tracking = autoCompactTracking

      // Enforce per-message budget on aggregate tool result size. Runs BEFORE
      // microcompact — cached MC operates purely by tool_use_id (never inspects
      // content), so content replacement is invisible to it and the two compose
      // cleanly. No-ops when contentReplacementState is undefined (feature off).
      // Persist only for querySources that read records back on resume: agentId
      // routes to sidechain file (AgentTool resume) or session file (/resume).
      // Ephemeral runForkedAgent callers (agent_summary etc.) don't persist.
      const persistReplacements =
        querySource.startsWith('agent:') ||
        querySource.startsWith('repl_main_thread')
      messagesForQuery = await applyToolResultBudget(
        messagesForQuery,
        toolUseContext.contentReplacementState,
        persistReplacements
          ? records =>
              void recordContentReplacement(
                records,
                toolUseContext.agentId,
              ).catch(logError)
          : undefined,
        new Set(
          toolUseContext.options.tools
            .filter(t => !Number.isFinite(t.maxResultSizeChars))
            .map(t => t.name),
        ),
      )

      // Apply snip before microcompact (both may run — they are not mutually exclusive).
      // snipTokensFreed is plumbed to autocompact so its threshold check reflects
      // what snip removed; tokenCountWithEstimation alone can't see it (reads usage
      // from the protected-tail assistant, which survives snip unchanged).
      let snipTokensFreed = 0
      if (feature('HISTORY_SNIP')) {
        queryCheckpoint('query_snip_start')
        const snipResult = snipModule!.snipCompactIfNeeded(messagesForQuery)
        messagesForQuery = snipResult.messages
        snipTokensFreed = snipResult.tokensFreed
        if (snipResult.boundaryMessage) {
          yield snipResult.boundaryMessage
        }
        queryCheckpoint('query_snip_end')
      }

      // Apply microcompact before autocompact
      queryCheckpoint('query_microcompact_start')
      const microcompactResult = await deps.microcompact(
        messagesForQuery,
        toolUseContext,
        querySource,
      )
      messagesForQuery = microcompactResult.messages
      // Release original strings from contentReplacementState.replacements for
      // tool results whose content was replaced with the cleared message.
      if (microcompactResult.clearedToolUseIds?.length) {
        const replacements =
          toolUseContext?.contentReplacementState?.replacements
        if (replacements) {
          for (const id of microcompactResult.clearedToolUseIds) {
            replacements.delete(id)
          }
        }
      }
      queryCheckpoint('query_microcompact_end')

      // Project the collapsed context view and maybe commit more collapses.
      // Runs BEFORE autocompact so that if collapse gets us under the
      // autocompact threshold, autocompact is a no-op and we keep granular
      // context instead of a single summary.
      //
      // Nothing is yielded — the collapsed view is a read-time projection
      // over the REPL's full history. Summary messages live in the collapse
      // store, not the REPL array. This is what makes collapses persist
      // across turns: projectView() replays the commit log on every entry.
      // Within a turn, the view flows forward via state.messages at the
      // continue site (query.ts:1192), and the next projectView() no-ops
      // because the archived messages are already gone from its input.
      if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
        const collapseResult = await contextCollapse.applyCollapsesIfNeeded(
          messagesForQuery,
          toolUseContext,
          querySource,
        )
        messagesForQuery = collapseResult.messages
      }

      let fullSystemPrompt = asSystemPrompt(
        appendSystemContext(systemPrompt, systemContext),
      )

      queryCheckpoint('query_autocompact_start')
      const autocompactOutcome = await deps.autocompact(
        messagesForQuery,
        toolUseContext,
        {
          systemPrompt,
          userContext,
          systemContext,
          toolUseContext,
          forkContextMessages: messagesForQuery,
        },
        querySource,
        tracking,
        snipTokensFreed,
      )
      let { compactionResult } = autocompactOutcome
      const {
        consecutiveFailures,
        consecutiveRapidRefills,
        rapidRefillBreakerTripped,
      } = autocompactOutcome
      queryCheckpoint('query_autocompact_end')

      if (
        !compactionResult &&
        !rapidRefillBreakerTripped &&
        toolUseContext.abortController.signal.aborted
      ) {
        yield* leftoverDrainSpinnerModes()
        return { reason: 'aborted_streaming' }
      }

      if (rapidRefillBreakerTripped) {
        yield createAssistantAPIErrorMessage({
          content: AUTOCOMPACT_THRASHING_MESSAGE,
          error: 'invalid_request',
          apiError: 'autocompact_thrashing',
        })
        yield* leftoverDrainSpinnerModes()
        return { reason: 'rapid_refill_breaker' }
      }

      // #921 — consume pending classifier overflow compact request (EJr)
      {
        const canCompactNext =
          isAutoCompactEnabled() &&
          querySource !== 'compact' &&
          querySource !== 'session_memory' &&
          (consecutiveFailures ?? tracking?.consecutiveFailures ?? 0) < 3
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {
          consumeClassifierOverflowCompact,
          markClassifierOverflowCompactSpent,
        } =
          require('./utils/permissions/permissions.js') as typeof import('./utils/permissions/permissions.js')
        const { pending: classifierOverflowPending, stale } =
          consumeClassifierOverflowCompact(
            toolUseContext.agentId,
            messagesForQuery,
            canCompactNext,
          )
        if (classifierOverflowPending !== undefined && !compactionResult) {
          const currentMode =
            toolUseContext.getAppState().toolPermissionContext.mode
          const leftAutoMode =
            stale !== 'epoch' &&
            currentMode !== classifierOverflowPending.mode &&
            currentMode !== 'auto' &&
            currentMode !== 'dontAsk'
          if (stale === 'epoch' || leftAutoMode) {
            logEvent('tengu_auto_mode_classifier_overflow_compact', {
              stage:
                'dropped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              reason: (stale === 'epoch'
                ? 'stale'
                : 'left_auto_mode') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              isSubagent: toolUseContext.agentId !== undefined,
            })
          } else if (!canCompactNext) {
            logEvent('tengu_auto_mode_classifier_overflow_compact', {
              stage:
                'skipped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              reason:
                'unavailable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              deniedCalls: classifierOverflowPending.deniedToolNames.length,
              isSubagent: toolUseContext.agentId !== undefined,
            })
          } else {
            try {
              // Official 2.1.323 #2103: preserve subagent identity during
              // post-compaction SessionStart('compact') hooks.
              const runCompactWithAgent = () =>
                compactConversation(
                  messagesForQuery,
                  toolUseContext,
                  {
                    systemPrompt,
                    userContext,
                    systemContext,
                    toolUseContext,
                    forkContextMessages: messagesForQuery,
                  },
                  true,
                  undefined,
                  true,
                )
              const activeAgentCtx = getAgentContext()
              compactionResult =
                toolUseContext.agentId &&
                activeAgentCtx?.agentId !== toolUseContext.agentId
                  ? await runWithAgentContext(
                      {
                        agentId: toolUseContext.agentId,
                        agentType: 'subagent',
                        ...(activeAgentCtx?.agentType === 'subagent' &&
                        activeAgentCtx.subagentName
                          ? { subagentName: activeAgentCtx.subagentName }
                          : querySource?.startsWith('agent:builtin:')
                            ? {
                                subagentName: querySource.slice(
                                  'agent:builtin:'.length,
                                ),
                              }
                            : querySource?.startsWith('agent:custom:')
                              ? {
                                  subagentName: querySource.slice(
                                    'agent:custom:'.length,
                                  ),
                                }
                              : querySource?.startsWith('agent:')
                                ? {
                                    subagentName: querySource.slice(
                                      'agent:'.length,
                                    ),
                                  }
                                : {}),
                        isBackgroundAgent: toolUseContext.isBackgroundAgent,
                      },
                      runCompactWithAgent,
                    )
                  : await runCompactWithAgent()
              markClassifierOverflowCompactSpent(
                toolUseContext.agentId,
                classifierOverflowPending.epoch,
              )
              logEvent('tengu_auto_mode_classifier_overflow_compact', {
                stage:
                  'compacted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                deniedCalls: classifierOverflowPending.deniedToolNames.length,
                isSubagent: toolUseContext.agentId !== undefined,
                preCompactTokenCount: compactionResult.preCompactTokenCount,
                postCompactTokenCount: compactionResult.postCompactTokenCount,
                truePostCompactTokenCount:
                  compactionResult.truePostCompactTokenCount,
              })
            } catch (err) {
              const aborted = toolUseContext.abortController.signal.aborted
              logEvent('tengu_auto_mode_classifier_overflow_compact', {
                stage: (aborted
                  ? 'skipped'
                  : 'failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                reason: (aborted
                  ? 'aborted'
                  : 'error') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                deniedCalls: classifierOverflowPending.deniedToolNames.length,
                isSubagent: toolUseContext.agentId !== undefined,
              })
              if (aborted) {
                yield* leftoverDrainSpinnerModes()
                return { reason: 'aborted_streaming' }
              }
              markClassifierOverflowCompactSpent(
                toolUseContext.agentId,
                classifierOverflowPending.epoch,
              )
              logForDebugging(
                `Classifier overflow compaction failed: ${errorMessage(err)}`,
                { level: 'warn' },
              )
            }
          }
        }
      }

      if (compactionResult) {
        const {
          preCompactTokenCount,
          postCompactTokenCount,
          truePostCompactTokenCount,
          compactionUsage,
        } = compactionResult

        logEvent('tengu_auto_compact_succeeded', {
          originalMessageCount: messages.length,
          compactedMessageCount:
            compactionResult.summaryMessages.length +
            compactionResult.attachments.length +
            compactionResult.hookResults.length,
          preCompactTokenCount,
          postCompactTokenCount,
          truePostCompactTokenCount,
          compactionInputTokens: compactionUsage?.input_tokens,
          compactionOutputTokens: compactionUsage?.output_tokens,
          compactionCacheReadTokens:
            compactionUsage?.cache_read_input_tokens ?? 0,
          compactionCacheCreationTokens:
            compactionUsage?.cache_creation_input_tokens ?? 0,
          compactionTotalTokens: compactionUsage
            ? compactionUsage.input_tokens +
              (compactionUsage.cache_creation_input_tokens ?? 0) +
              (compactionUsage.cache_read_input_tokens ?? 0) +
              compactionUsage.output_tokens
            : 0,

          queryChainId: queryChainIdForAnalytics,
          queryDepth: queryTracking.depth,
        })

        // task_budget: capture pre-compact final context window before
        // messagesForQuery is replaced with postCompactMessages below.
        // iterations[-1] is the authoritative final window (post server tool
        // loops); see #304930.
        if (params.taskBudget) {
          const preCompactContext =
            finalContextTokensFromLastResponse(messagesForQuery)
          taskBudgetRemaining = Math.max(
            0,
            (taskBudgetRemaining ?? params.taskBudget.total) -
              preCompactContext,
          )
        }

        // Reset on every compact so turnCounter/turnId reflect the MOST RECENT
        // compact. recompactionInfo (autoCompact.ts:190) already captured the
        // old values for turnsSincePreviousCompact/previousCompactTurnId before
        // the call, so this reset doesn't lose those.
        tracking = {
          compacted: true,
          turnId: deps.uuid(),
          turnCounter: 0,
          consecutiveFailures: 0,
          consecutiveRapidRefills: consecutiveRapidRefills ?? 0,
        }

        const postCompactMessages = buildPostCompactMessages(compactionResult)

        for (const message of postCompactMessages) {
          yield message
        }

        // Continue on with the current query call using the post compact messages
        messagesForQuery = postCompactMessages
        // Official 2.1.328 (#555): trigger systemPrompt rebuild after automatic
        // compaction the way `/compact` does, and refresh userContext.
        needsSystemPromptRebuild = true
        runPostCompactCleanup(querySource)
        try {
          const refreshed = await getUserContext()
          if (
            Object.keys(refreshed).length > 0 ||
            Object.keys(userContext).length > 0
          ) {
            userContext = refreshed
          }
        } catch {
          // Keep existing userContext if refresh fails
        }
      } else if (consecutiveFailures !== undefined) {
        // Autocompact failed — propagate failure count so the circuit breaker
        // can stop retrying on the next iteration.
        tracking = {
          ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
          consecutiveFailures,
        }
      }

      // Official 2.1.328 (`chunk@305854618.js @238400`, `Okt` in
      // `chunk@294254613.js @2075695`): evaluate live precompute arm threshold
      // from `tengu_amber_moleskin` when autocompact did not run.
      if (
        !compactionResult &&
        !hasAttemptedReactiveCompact &&
        isPrecomputeCompactionEnabled()
      ) {
        const precomputeCheck = getPrecomputeArmThreshold(
          toolUseContext.options.mainLoopModel,
          querySource,
        )
        const currentEstimate =
          tokenCountWithEstimation(messagesForQuery) - snipTokensFreed
        if (currentEstimate >= precomputeCheck.threshold) {
          logForDebugging(
            `[precompute] context estimate ${currentEstimate} reached threshold ${precomputeCheck.threshold} (fraction=${precomputeCheck.fraction}, source=${precomputeCheck.source})`,
          )
        }
      }

      const rebuildSystemPromptIfNeeded = async (): Promise<void> => {
        if (
          !needsSystemPromptRebuild ||
          params.renderSystemPrompt === undefined
        ) {
          return
        }
        needsSystemPromptRebuild = false
        try {
          const rebuilt = await params.renderSystemPrompt(
            toolUseContext,
            pendingModelFacts,
          )
          if (rebuilt !== undefined) {
            if ('systemPrompt' in rebuilt) {
              systemPrompt = rebuilt.systemPrompt
              if (rebuilt.promptRenderEpoch !== undefined) {
                promptRenderEpoch = rebuilt.promptRenderEpoch
              }
            } else {
              systemPrompt = rebuilt
            }
            fullSystemPrompt = asSystemPrompt(
              appendSystemContext(systemPrompt, systemContext),
            )
          }
        } catch (err) {
          logError(err)
        }
      }

      // Official 2.1.328 (#555): rebuild systemPrompt after autocompact /
      // reactive compact when a renderSystemPrompt callback was provided.
      await rebuildSystemPromptIfNeeded()

      //TODO: no need to set toolUseContext.messages during set-up since it is updated here
      toolUseContext = {
        ...toolUseContext,
        messages: messagesForQuery,
      }

      const assistantMessages: AssistantMessage[] = []
      let withheldLongContextRefusal: AssistantMessage | undefined
      const toolResults: (UserMessage | AttachmentMessage)[] = []
      // @see https://docs.claude.com/en/docs/build-with-claude/tool-use
      // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly.
      // Set during streaming whenever a tool_use block arrives — the sole
      // loop-exit signal. If false after streaming, we're done (modulo stop-hook retry).
      const toolUseBlocks: ToolUseBlock[] = []
      let needsFollowUp = false
      // densable 2.1.283 smo / ee.toolRequestedEndTurn — must be in scope for
      // both streaming mid-turn results and the post-stream tool loop.
      let toolRequestedEndTurn: ToolEndTurnSource | false = false

      queryCheckpoint('query_setup_start')
      // Official 2.1.328 (`chunk@305854618.js`): StreamingToolExecutor is always
      // enabled (dead `tengu_streaming_tool_execution2` gate removed).
      let streamingToolExecutor: StreamingToolExecutor =
        new StreamingToolExecutor(
          toolUseContext.options.tools,
          canUseTool,
          toolUseContext,
        )

      const appState = toolUseContext.getAppState()
      // densable Ya — kickoff qc+Ha in parallel with the rest of query_setup
      const autoModeServerContextKickoff = (() => {
        try {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { kickoffAutoModeServerContext } =
            require('./services/api/autoModeServerContext.js') as typeof import('./services/api/autoModeServerContext.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          return kickoffAutoModeServerContext(toolUseContext)
        } catch {
          return undefined
        }
      })()
      // densable bn/qO: sticky permissionLayers last-wins over appState/options
      const {
        getToolPermissionContextFromLayers,
        getMainLoopModelFromLayers,
        getThinkingConfigFromLayers,
        getEffortValueFromLayers,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./engine/permissionLayerReaders.js') as typeof import('./engine/permissionLayerReaders.js')
      const layeredPermissionContext =
        getToolPermissionContextFromLayers(toolUseContext)
      const layeredMainLoopModel = getMainLoopModelFromLayers(toolUseContext)
      const layeredThinkingConfig = getThinkingConfigFromLayers(toolUseContext)
      // densable bb — last effort layer wins over appState.effortValue
      const layeredEffortValue = getEffortValueFromLayers(toolUseContext)
      const leftoverStampTurnEffort = (model: unknown) => {
        try {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { leftoverIhrStampTurnEffort } =
            require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          leftoverIhrStampTurnEffort(
            toolUseContext.agentId,
            layeredEffortValue,
            model,
          )
        } catch {
          // isolation — optional
        }
      }
      leftoverStampTurnEffort(layeredMainLoopModel)
      const permissionMode = layeredPermissionContext.mode
      let currentModel = getRuntimeMainLoopModel({
        permissionMode,
        mainLoopModel: layeredMainLoopModel,
        exceeds200kTokens:
          permissionMode === 'plan' &&
          doesMostRecentAssistantMessageExceed200k(messagesForQuery),
        isSubagent: Boolean(toolUseContext.agentId),
      })
      // densable qs: reuse mo when model matches, else Tqe; Ase → Tqe(fallback).
      const factsCtx = {
        credentials: toolUseContext.credentials,
        abortController: toolUseContext.abortController,
      }
      const reusedFacts = pendingModelFacts
      pendingModelFacts = undefined
      let modelFacts =
        reusedFacts?.model === currentModel
          ? reusedFacts
          : await resolveModelFacts(currentModel, factsCtx)
      if (
        fallbackModel !== undefined &&
        isSmallerContextWindow(currentModel, fallbackModel)
      ) {
        await resolveModelFacts(fallbackModel, factsCtx)
      }

      // Official model_fable_consent densable at query_setup (X6e + ORu).
      // Full ExtraUsageDialog 3DS purchase remains denser.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {
          isFableModel,
          runFableOverageConsentFlow,
          shouldWatchFableParkCommandQueue,
        } =
          require('./utils/fableConsent.js') as typeof import('./utils/fableConsent.js')
        if (isFableModel(currentModel)) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getOauthAccountInfo } =
            require('./utils/auth.js') as typeof import('./utils/auth.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getDefaultMainLoopModel } =
            require('./utils/model/model.js') as typeof import('./utils/model/model.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { resolveFableBridgeDialogTimeoutMsOrDefault } =
            require('./utils/residualFinalEnvGates.js') as typeof import('./utils/residualFinalEnvGates.js')
          const oauth = getOauthAccountInfo()
          const fallbackModel = getDefaultMainLoopModel()
          const fallbackAllowed =
            Boolean(fallbackModel) && !isFableModel(fallbackModel)
          // Session latch when no org/account key (API-key users): shared with
          // /model via bootstrap state so a picker accept is honored on first
          // query, and cleared on logout / account switch.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const {
            getFableSessionFallbackConsented,
            setFableSessionFallbackConsented,
          } =
            require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
          // densable Ns=xo&&On>0 — park timeout only when xo watch is on.
          const xo = shouldWatchFableParkCommandQueue()
          const flow = await runFableOverageConsentFlow({
            model: currentModel,
            requestDialog: toolUseContext.requestDialog ?? null,
            organizationUuid: oauth?.organizationUuid ?? null,
            accountUuid: oauth?.accountUuid ?? null,
            sessionFallbackConsented: getFableSessionFallbackConsented(),
            onSessionConsent: () => {
              setFableSessionFallbackConsented(true)
            },
            signal: toolUseContext.abortController.signal,
            parkTimeoutMs: xo
              ? resolveFableBridgeDialogTimeoutMsOrDefault()
              : undefined,
            fallbackModel: fallbackAllowed ? fallbackModel : null,
            isFallbackAllowed: fallbackAllowed,
            overagesEnabled: true,
          })
          // densable I3: parent abort during park → aborted_streaming (before
          // Ar / dialog_declined fallback / billing model_error).
          if (flow.reason === 'parent_aborted') {
            yield* leftoverDrainSpinnerModes()
            return { reason: 'aborted_streaming' }
          }
          if (flow.shouldAbort) {
            yield createAssistantAPIErrorMessage({
              content:
                flow.errorMessage ??
                'Your model policy only allows Fable 5, which requires usage credits — /model to set it up',
              error: 'billing_error',
            })
            yield* leftoverDrainSpinnerModes()
            return {
              reason: 'model_error',
              error: new Error(flow.errorMessage ?? 'model_fable_consent'),
            }
          }
          if (
            (flow.choice === 'switch_default' ||
              flow.reason === 'model_consent_fallback' ||
              flow.reason === 'dialog_declined' ||
              flow.reason === 'no_dialog_fallback') &&
            flow.fallbackModel
          ) {
            currentModel = flow.fallbackModel
            modelFacts = getModelFacts(currentModel)
            leftoverStampTurnEffort(flow.fallbackModel)
            toolUseContext = {
              ...toolUseContext,
              options: {
                ...toolUseContext.options,
                mainLoopModel: flow.fallbackModel,
              },
            }
          }
          // Official purchase-intent densable after consent — ExtraUsageDialog
          // 3DS remains denser; open_purchase surfaces /usage-credits hint
          // only when v_() / Zur() allow the command (#38).
          const { isUsageCreditsHintEnabled } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('./services/rateLimitMessages.js') as typeof import('./services/rateLimitMessages.js')
          if (
            flow.choice === 'consent' &&
            flow.purchaseIntent?.next === 'open_purchase' &&
            isUsageCreditsHintEnabled()
          ) {
            const hint = flow.purchaseIntent.commandHint ?? '/usage-credits'
            toolUseContext.addNotification?.({
              key: 'fable-open-purchase',
              text: `Fable 5 needs usage credits — run ${hint} to buy, or /model to switch`,
              priority: 'immediate',
            })
          }
        }
      } catch {
        // densable optional — never block query on fable consent failures
      }

      queryCheckpoint('query_setup_end')

      // Create fetch wrapper once per query session to avoid memory retention.
      // Each call to createDumpPromptsFetch creates a closure that captures the request body.
      // Creating it once means only the latest request body is retained (~700KB),
      // instead of all request bodies from the session (~500MB for long sessions).
      // Note: agentId is effectively constant during a query() call - it only changes
      // between queries (e.g., /clear command or session resume).
      const dumpPromptsFetch = config.gates.isAnt
        ? createDumpPromptsFetch(toolUseContext.agentId ?? config.sessionId)
        : undefined

      // Block if we've hit the hard blocking limit (only applies when auto-compact is OFF)
      // This reserves space so users can still run /compact manually
      // Skip this check if compaction just happened - the compaction result is already
      // validated to be under the threshold, and tokenCountWithEstimation would use
      // stale input_tokens from kept messages that reflect pre-compaction context size.
      // Same staleness applies to snip: subtract snipTokensFreed (otherwise we'd
      // falsely block in the window where snip brought us under autocompact threshold
      // but the stale usage is still above blocking limit — before this PR that
      // window never existed because autocompact always fired on the stale count).
      // Also skip for compact/session_memory queries — these are forked agents that
      // inherit the full conversation and would deadlock if blocked here (the compact
      // agent needs to run to REDUCE the token count).
      // Also skip when reactive compact is enabled and automatic compaction is
      // allowed — the preempt's synthetic error returns before the API call,
      // so reactive compact would never see a prompt-too-long to react to.
      // Widened to walrus so RC can act as fallback when proactive fails.
      //
      // Same skip for context-collapse: its recoverFromOverflow drains
      // staged collapses on a REAL API 413, then falls through to
      // reactiveCompact. A synthetic preempt here would return before the
      // API call and starve both recovery paths. The isAutoCompactEnabled()
      // conjunct preserves the user's explicit "no automatic anything"
      // config — if they set DISABLE_AUTO_COMPACT, they get the preempt.
      let collapseOwnsIt = false
      if (feature('CONTEXT_COLLAPSE')) {
        collapseOwnsIt =
          (contextCollapse?.isContextCollapseEnabled() ?? false) &&
          isAutoCompactEnabled()
      }
      // densable stream: gup/XGo withhold without ex(); recovery is gated later
      // by Jsa (canAttemptReactiveCompact → ex()+Rhe()+source). When the
      // REACTIVE_COMPACT module is compiled in, media errors are withheld the
      // same way as PTL so tryReactiveCompact can strip/retry or surface.
      // (Previously gated on isReactiveCompactEnabled=DISABLE_COMPACT only,
      // which diverged from densable XGo always-withhold.)
      const mediaRecoveryEnabled = reactiveCompact != null
      // densable: skip synthetic blocking_limit preempt when ex() would allow
      // QGo recovery (isAutoCompactEnabled ≈ densable ex()). Remote Rhe is
      // checked inside try; if remote-disallowed we still prefer API 413 path
      // over a synthetic PTL when auto-compact is on.
      if (
        !compactionResult &&
        querySource !== 'compact' &&
        querySource !== 'session_memory' &&
        !(reactiveCompact != null && isAutoCompactEnabled()) &&
        !collapseOwnsIt
      ) {
        const { isAtBlockingLimit } = calculateTokenWarningState(
          tokenCountWithEstimation(messagesForQuery) - snipTokensFreed,
          layeredMainLoopModel,
        )
        if (isAtBlockingLimit) {
          yield createAssistantAPIErrorMessage({
            content: PROMPT_TOO_LONG_ERROR_MESSAGE,
            error: 'invalid_request',
          })
          yield* leftoverDrainSpinnerModes()
          return { reason: 'blocking_limit' }
        }
      }

      let attemptWithFallback = true
      // densable En — refusal_continuation begin active until end / land
      let refusalContinuationActive = false
      // densable Gt — silent stitch buffer pending (blocks server_fallback seam Yt)
      let silentStitchPending = false
      // densable Gt text — soft-join prefix for Cjs land
      let silentStitchText: string | undefined
      // densable Yt — exact-join salvage package (server_fallback midStream seam)
      let exactSalvagePackage:
        | {
            text: string
            originals: readonly { uuid?: string }[]
          }
        | undefined
      // densable R — client_retry supersedes uuids applied on next assistant yield
      let clientRetrySupersedesUuids: string[] | undefined
      // densable or — convolute_arcades silent-retry arm for multi-exit telemetry
      let convoluteArcadesRetryActive = false
      // densable wr — DRd meta user message for silent-stitch salvage
      let partialResponseMetaMessage: Message | undefined
      // densable kr/og — fallback credit token for next request stamp
      let pendingFallbackCreditCode: string | undefined
      // densable vu — model that minted the credit (original refusing model)
      let pendingFallbackCreditMintModel: string | undefined
      // densable Jn / qa — first-flag preference ask on this request
      let refusalFallbackPreferencePending = false
      let refusalFallbackPreferenceChoice:
        | import('./utils/printRequestDialog.js').RefusalFallbackResult
        | undefined
      // Official B3s / KSa carriedEffort loop state + turn-start latch reconciliation
      let refusalFallbackEffort:
        | { model: string; level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
        | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {
          getRefusalFallbackModelLatch,
          getMainLoopModelOverride,
          clearCarriedEffortFromLatch,
        } =
          require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
        const latch = getRefusalFallbackModelLatch()
        if (latch?.carriedEffort !== undefined) {
          const killed = getFeatureValue_CACHED_MAY_BE_STALE(
            'tengu_loggia_passage',
            false,
          )
          const override = getMainLoopModelOverride()
          if (killed) {
            clearCarriedEffortFromLatch('kill_switch')
          } else if (
            override == null ||
            override.toLowerCase() !== latch.fallbackModel.toLowerCase()
          ) {
            clearCarriedEffortFromLatch('model_change')
          }
        }
      } catch {
        // carriedEffort reconciliation optional
      }

      // densable 2.1.222 #6 — Br/To capture + ARd clear once per query API loop
      // (main/subagent only). Stamps set by MCP tool call; cost attrs only for
      // this request, then cleared so later turns don't sticky-overattribute.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        captureAndClearActiveMcpAttribution,
        clearActiveMcpStamps,
        shouldAttributeMcpUsage,
      } =
        require('./utils/mcpUsageAttribution.js') as typeof import('./utils/mcpUsageAttribution.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getQuerySourceFamily: getQuerySourceFamilyForMcp } =
        require('./utils/observerAgents.js') as typeof import('./utils/observerAgents.js')
      const attributeMcpUsage = shouldAttributeMcpUsage(
        getQuerySourceFamilyForMcp(querySource),
      )
      const capturedMcpAttribution = captureAndClearActiveMcpAttribution(
        toolUseContext.options,
        attributeMcpUsage,
      )

      queryCheckpoint('query_api_loop_start')
      // densable oe — dedupe batching_reminder_sent across fallback hops
      let lastBatchingReminderSent:
        | { afterUuid: string; text: string; model: string }
        | undefined
      // Track models already attempted in this API loop so availability/refusal
      // fallbacks never cycle indefinitely.
      const triedFallbackModels = new Set<string>([currentModel])
      // Official 2.1.328 `zr` (`chunk@305854618.js @275704`): last stop_reason
      // observed in stream_event(message_delta) across the current API stream.
      let lastDeltaStopReason: string | undefined
      let lastDeltaOutputTokens: number | undefined
      // Official 2.1.328 `Tt` (`chunk@305854618.js @275400-275950`): track
      // cloned assistant messages so `message_delta` writebacks stay in sync.
      const backfillClones: Array<{
        src: AssistantMessage
        dst: AssistantMessage
      }> = []
      const syncBackfillClones = () => {
        for (const { src, dst } of backfillClones) {
          const srcMsg = src.message as unknown as Record<string, unknown>
          const dstMsg = dst.message as unknown as Record<string, unknown>
          dst.message.usage = src.message.usage
          dst.message.stop_reason = src.message.stop_reason
          if ('stop_details' in srcMsg) {
            dstMsg.stop_details = srcMsg.stop_details
          }
          if (srcMsg.context_management !== undefined) {
            dstMsg.context_management = srcMsg.context_management
          }
          if (srcMsg.resumable !== undefined) {
            dstMsg.resumable = srcMsg.resumable
          }
          if (srcMsg.pausedResponses !== undefined) {
            dstMsg.pausedResponses = srcMsg.pausedResponses
          }
        }
      }
      const sameModelRefusalArmed = isSameModelRefusalRetryArmed(
        querySource,
        refusalRetrySpent,
      )
      let withheldSafetyMonitorBlock: AssistantMessage | undefined
      let withheldSameModelRefusal: AssistantMessage | undefined
      let pendingCallerFallbackRequest:
        | {
            originalModel: string
            fallbackModel: string
            requestId?: string | null
            apiRefusalCategory?: string | null
            silentArmAtTrigger?: boolean
          }
        | undefined
      try {
        while (attemptWithFallback) {
          attemptWithFallback = false
          lastDeltaStopReason = undefined
          lastDeltaOutputTokens = undefined
          backfillClones.length = 0
          withheldSafetyMonitorBlock = undefined
          withheldSameModelRefusal = undefined
          pendingCallerFallbackRequest = undefined
          try {
            let streamingFallbackOccured = false
            // densable Ji — media-size (EFi) withheld AND buffered; flushed on
            // next !Gm only. Stream end does not drain leftover Ji.
            const withheldMediaBuffer: Array<
              StreamEvent | AssistantMessage | SystemAPIErrorMessage
            > = []
            queryCheckpoint('query_api_streaming_start')
            // densable _u / mXn — skip inject when silent-stitch meta (_o)
            const injected =
              partialResponseMetaMessage !== undefined
                ? {
                    messages: [...messagesForQuery, partialResponseMetaMessage],
                    text: null as string | null,
                    afterUuid: null as string | null,
                  }
                : injectBatchingReminder(
                    messagesForQuery,
                    { id: getSessionId() },
                    currentModel,
                  )
            if (
              injected.text !== null &&
              injected.afterUuid !== null &&
              !(
                lastBatchingReminderSent?.afterUuid === injected.afterUuid &&
                lastBatchingReminderSent.text === injected.text &&
                lastBatchingReminderSent.model === currentModel
              )
            ) {
              lastBatchingReminderSent = {
                afterUuid: injected.afterUuid,
                text: injected.text,
                model: currentModel,
              }
              const sent = createAttachmentMessage({
                type: 'batching_reminder_sent',
                text: injected.text,
                model: currentModel,
              })
              yield sent
              messagesForQuery = [...messagesForQuery, sent]
            }
            const callMessages = injected.messages
            // consume credit stamp for this attempt only (re-arm on next hop)
            const creditCodeForAttempt = pendingFallbackCreditCode
            const creditMintModelForAttempt = pendingFallbackCreditMintModel
            // densable clears kr after pass; re-set if hop yields new token
            pendingFallbackCreditCode = undefined
            pendingFallbackCreditMintModel = undefined
            const autoModeServerContext = await (async () => {
              try {
                /* eslint-disable @typescript-eslint/no-require-imports */
                const { awaitAutoModeServerContext } =
                  require('./services/api/autoModeServerContext.js') as typeof import('./services/api/autoModeServerContext.js')
                /* eslint-enable @typescript-eslint/no-require-imports */
                return await awaitAutoModeServerContext(
                  autoModeServerContextKickoff,
                )
              } catch {
                return undefined
              }
            })()
            const serverClassifierKickoffActive = (() => {
              try {
                /* eslint-disable @typescript-eslint/no-require-imports */
                const { isServerClassifierKickoffActive } =
                  require('./services/api/autoModeServerContext.js') as typeof import('./services/api/autoModeServerContext.js')
                /* eslint-enable @typescript-eslint/no-require-imports */
                return isServerClassifierKickoffActive(toolUseContext)
              } catch {
                return false
              }
            })()
            // Official 2.1.323 #2126: forward active skill/plugin/agent/MCP
            // attribution so OTel `api_request` carries complete attribution.
            const derivedAttribution = deriveAttributionFromQuerySource(
              querySource,
              toolUseContext.options.activeSkill,
            )
            const requestAttribution: OTelAttributionInput | undefined =
              derivedAttribution.attributionSkill !== undefined ||
              derivedAttribution.attributionPlugin !== undefined ||
              derivedAttribution.attributionAgent !== undefined ||
              capturedMcpAttribution.activeMcpServer !== undefined
                ? {
                    ...derivedAttribution,
                    ...(capturedMcpAttribution.activeMcpServer !== undefined
                      ? {
                          attributionMcpServer:
                            capturedMcpAttribution.activeMcpServer,
                        }
                      : {}),
                    ...(capturedMcpAttribution.activeMcpTool !== undefined
                      ? {
                          attributionMcpTool:
                            capturedMcpAttribution.activeMcpTool,
                        }
                      : {}),
                  }
                : undefined
            const modelCallArgs: CallModelParams = {
              messages: prependUserContext(callMessages, userContext),
              systemPrompt: fullSystemPrompt,
              thinkingConfig: layeredThinkingConfig,
              tools: applyPluginToolListFilter(toolUseContext.options.tools),
              signal: toolUseContext.abortController.signal,
              options: {
                async getToolPermissionContext() {
                  // densable bn — sticky layers on each permission re-read
                  // Official 2.1.323 #2188: merge plugin tool.list deny rules.
                  return applyPluginToolListDenyRules(
                    getToolPermissionContextFromLayers(toolUseContext),
                  )
                },
                model: currentModel,
                modelFacts,
                promptRenderEpoch,
                ...(config.gates.fastModeEnabled && {
                  fastMode: appState.fastMode,
                }),
                toolChoice: undefined,
                isNonInteractiveSession:
                  toolUseContext.options.isNonInteractiveSession,
                fallbackModel,
                // Official m1u/w_i refusal-arm densable → Options.refusalFallback*
                ...(() => {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const {
                      planRefusalFallbackArm,
                      resolveSilentRearmModel,
                      resolveRefusalFallbackModelAndLane,
                      isRefusalFallbackEnabled,
                      getSwitchModelsOnFlag,
                      shouldAskRefusalFallbackPreference,
                    } =
                      require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                    if (!isRefusalFallbackEnabled()) return {}
                    const isMainThread = toolUseContext.agentId === undefined
                    refusalFallbackPreferencePending =
                      shouldAskRefusalFallbackPreference({
                        toolUseContext,
                        isMainThread,
                      })
                    // densable lkd: serverLane via dkd() (vK && $c("switchModelsOnFlag", true))
                    const arm = planRefusalFallbackArm({
                      currentModel,
                      alreadyUsed: false,
                      declined: false,
                      requestDialog: toolUseContext.requestDialog,
                      isMainThread,
                      isAgentThread: !isMainThread,
                      switchModelsOnFlag: getSwitchModelsOnFlag(),
                      preferenceQuestionPending:
                        refusalFallbackPreferencePending,
                      resolveArmedFallbackModel: () =>
                        resolveRefusalFallbackCandidate({
                          currentModel,
                          fallbackModel,
                        }),
                    })
                    const silentRearm = resolveSilentRearmModel({
                      currentModel,
                      isVisiblyArmable: arm.visibleModel !== undefined,
                      silentRearmGateEnabled: false,
                    })
                    const resolved = resolveRefusalFallbackModelAndLane({
                      visibleModel: arm.visibleModel,
                      silentRearmModel: silentRearm,
                      serverLane: arm.serverLane,
                    })
                    // densable: pass serverRefusalFallback even when visible
                    // client model is deferred (Ks = la===void 0 ? visible : void 0)
                    if (
                      !resolved.refusalFallbackModel &&
                      !resolved.serverRefusalFallback &&
                      creditCodeForAttempt === undefined
                    ) {
                      return {}
                    }
                    return {
                      ...(resolved.refusalFallbackModel !== undefined && {
                        refusalFallbackModel: resolved.refusalFallbackModel,
                        refusalFallbackModelLane:
                          resolved.refusalFallbackModelLane,
                        refusalFallbackSilentArmActive:
                          resolved.refusalFallbackSilentArmActive,
                      }),
                      ...(resolved.serverRefusalFallback !== undefined && {
                        serverRefusalFallback: resolved.serverRefusalFallback,
                      }),
                      // densable fallbackCreditCode/Mint + laneArmed
                      ...(creditCodeForAttempt !== undefined && {
                        fallbackCreditCode: creditCodeForAttempt,
                        ...(creditMintModelForAttempt !== undefined && {
                          fallbackCreditMintModel: creditMintModelForAttempt,
                        }),
                      }),
                      ...(arm.visibleModel !== undefined && {
                        fallbackCreditLaneArmed: true,
                      }),
                      ...(refusalFallbackPreferencePending && {
                        refusalFallbackPreferencePending: true,
                      }),
                      ...(refusalFallbackEffort?.model === currentModel && {
                        refusalFallbackEffort: refusalFallbackEffort.level,
                      }),
                    }
                  } catch {
                    return {}
                  }
                })(),
                onStreamingFallback: () => {
                  streamingFallbackOccured = true
                },
                querySource,
                autoModeServerContext,
                ...(autoModeServerContext !== undefined &&
                  serverClassifierKickoffActive && { serverClassifier: true }),
                promptTooLongIsHandled: true,
                agents: toolUseContext.options.agentDefinitions.activeAgents,
                allowedAgentTypes:
                  toolUseContext.options.agentDefinitions.allowedAgentTypes,
                hasAppendSystemPrompt:
                  !!toolUseContext.options.appendSystemPrompt,
                maxOutputTokensOverride,
                fetchOverride: dumpPromptsFetch,
                mcpTools: appState.mcp.tools,
                hasPendingMcpServers: appState.mcp.clients.some(
                  c => c.type === 'pending',
                ),
                // densable activeMcpServer/Tool (Br/To) — one-shot for this request
                activeMcpServer: capturedMcpAttribution.activeMcpServer,
                activeMcpTool: capturedMcpAttribution.activeMcpTool,
                ...(requestAttribution !== undefined
                  ? ({
                      attribution: requestAttribution,
                    } as Partial<CallModelParams['options']>)
                  : {}),
                queryTracking,
                effortValue: layeredEffortValue,
                advisorModel: appState.advisorModel,
                continuesCutReply: maxOutputTokensRecoveryCount > 0,
                ...(resumeIncompleteThinking === true && {
                  resumeIncompleteThinking: true,
                }),
                onMessageDelta: () => {
                  syncBackfillClones()
                },
                refusalFallbackHandledByCaller: true,
                skipCacheWrite,
                agentCacheTtlOverride,
                thinkingStripPlan,
                advisorStripPlan,
                agentId: toolUseContext.agentId,
                isBackgroundAgent: toolUseContext.isBackgroundAgent,
                requestDialog: toolUseContext.requestDialog,
                addNotification: toolUseContext.addNotification,
                // densable 2.1.214 #39: wire spinner stalled / retry status
                onRetryStatus: toolUseContext.setRetryStatus,
                ...(params.taskBudget && {
                  taskBudget: {
                    total: params.taskBudget.total,
                    ...(taskBudgetRemaining !== undefined && {
                      remaining: taskBudgetRemaining,
                    }),
                  },
                }),
                langfuseTrace: toolUseContext.langfuseTrace,
              },
            }
            const turnStepHooks =
              turnStepTurnId !== undefined ? getQueryFunctionHooks() : null
            const modelStream =
              turnStepTurnId !== undefined &&
              turnStepHooks !== null &&
              turnStepHooks.hasMatchingFunctionHook('turn.step')
                ? streamTurnStepWithHooks({
                    hooks: turnStepHooks,
                    callModel: deps.callModel,
                    callArgs: modelCallArgs,
                    turnId: turnStepTurnId,
                    stepIndex: turnStepIndex++,
                  })
                : deps.callModel(modelCallArgs)
            let recordedClaudeMdTokensForRequest = false
            function* drainStreamingTools() {
              if (
                !streamingToolExecutor ||
                toolUseContext.abortController.signal.aborted
              )
                return
              for (const result of streamingToolExecutor.getCompletedResults()) {
                if (isToolBridgeEvent(result)) {
                  yield result
                  continue
                }
                if (result.message) {
                  yield result.message
                  const endTurn = endTurnSourceFromToolResult(result.message)
                  if (endTurn) toolRequestedEndTurn = endTurn
                  accumulateToolResultForMidTurn(
                    result.message,
                    toolResults,
                    applyPluginToolListFilter(
                      toolUseContext.options.refreshTools?.() ??
                        toolUseContext.options.tools,
                    ),
                    toolUseContext.options.mainLoopModel,
                  )
                }
              }
            }
            for await (const message of mergeToolDrainEvents(
              modelStream,
              () => streamingToolExecutor ?? undefined,
            )) {
              if (message.type === 'tool_drain_tick') {
                yield* drainStreamingTools()
                continue
              }
              if (message.type === 'stream_event') {
                const streamEv = message.event as
                  | {
                      type?: unknown
                      delta?: { stop_reason?: unknown }
                      usage?: { output_tokens?: unknown }
                    }
                  | undefined
                if (streamEv?.type === 'message_delta') {
                  if (typeof streamEv.delta?.stop_reason === 'string') {
                    lastDeltaStopReason = streamEv.delta.stop_reason
                  }
                  if (typeof streamEv.usage?.output_tokens === 'number') {
                    lastDeltaOutputTokens = streamEv.usage.output_tokens
                  }
                  // Official 2.1.328 `Tt` (`chunk@305854618.js @275700-275950`):
                  // sync cloned assistant messages on `message_delta`, and clear
                  // the clone list on final (non-resumed) `message_delta`.
                  syncBackfillClones()
                  if (
                    !isResumedUsageMessageDelta(
                      streamEv as Parameters<
                        typeof isResumedUsageMessageDelta
                      >[0],
                    )
                  ) {
                    backfillClones.length = 0
                  }
                }
              }
              yield* leftoverDrainSpinnerModes()
              // densable server_fallback consumer — retainedText/Messages + Gt seam gate
              if (
                message &&
                typeof message === 'object' &&
                (message as { type?: string }).type === 'server_fallback'
              ) {
                const sf = message as {
                  type: 'server_fallback'
                  fromModel: string
                  toModel: string
                  reason?: string
                  apiRefusalCategory?: string | null
                  midStream: boolean
                  requestId?: string | null
                  discardedMessages?: readonly {
                    uuid?: string
                    isApiErrorMessage?: boolean
                    message?: { content?: unknown }
                  }[]
                  retainedMessages?: readonly {
                    uuid?: string
                    isApiErrorMessage?: boolean
                    message?: { content?: unknown }
                  }[]
                  retainedText?: string
                  finalStopReason?: string | null
                }
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const {
                    planServerFallbackSeamMerge,
                    buildRefusalContinuationBeginEvent,
                    buildQueryModelChangeEvent,
                    planRefusalFallbackPresentation,
                    buildModelRefusalFallbackSystemMessage,
                    SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN,
                  } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  const discarded = sf.discardedMessages ?? []
                  const isMainThread = toolUseContext.agentId === undefined
                  const presentation = planRefusalFallbackPresentation({
                    reason: sf.reason ?? 'refusal',
                    midStream: sf.midStream === true,
                    discardedMessages: discarded as readonly {
                      message?: { content?: readonly { type?: string }[] }
                    }[],
                    requestId: sf.requestId,
                    fromModel: sf.fromModel,
                    finalStopReason: sf.finalStopReason,
                    apiRefusalCategory: sf.apiRefusalCategory,
                    isMainThread,
                    originalModelScope: querySource,
                  })
                  logEvent('tengu_server_fallback', {
                    from_model:
                      sf.fromModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    to_model:
                      sf.toModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    reason: (sf.reason ??
                      'refusal') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    mid_stream: sf.midStream === true,
                    discarded_count: discarded.length,
                    retained_chars:
                      typeof sf.retainedText === 'string'
                        ? sf.retainedText.length
                        : 0,
                    queryChainId: queryChainIdForAnalytics,
                    queryDepth: queryTracking.depth,
                    entitlement_blind: presentation.telemetry.entitlementBlind,
                  })
                  // densable: yield query_model_change then tombstones
                  leftoverStampTurnEffort(sf.toModel)
                  yield buildQueryModelChangeEvent(
                    sf.toModel,
                  ) as unknown as Message
                  for (const m of discarded) {
                    yield {
                      type: 'tombstone' as const,
                      message: m,
                      displayOnly: true,
                    } as unknown as Message
                  }
                  const seam = planServerFallbackSeamMerge({
                    midStream: sf.midStream === true,
                    retainedText: sf.retainedText,
                    retainedMessages: sf.retainedMessages,
                    silentStitchPending,
                  })
                  if (seam.action === 'skip_silent_stitch_pending') {
                    logForDebugging(SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN, {
                      level: 'warn',
                    })
                  } else if (seam.action === 'merge') {
                    refusalContinuationActive = true
                    // densable Yt = seam package for exact land + supersedes
                    exactSalvagePackage = {
                      text: seam.yt.text,
                      originals: seam.yt.originals,
                    }
                    yield buildRefusalContinuationBeginEvent(
                      seam.yt,
                    ) as unknown as Message
                  }
                  if (presentation.showBanner) {
                    const banner = buildModelRefusalFallbackSystemMessage({
                      content: `Switched to ${renderModelName(sf.toModel)} after a model refusal on ${renderModelName(sf.fromModel)}`,
                      fromModel: sf.fromModel,
                      toModel: sf.toModel,
                      requestId: sf.requestId,
                      apiRefusalCategory: sf.apiRefusalCategory,
                      timestamp: new Date().toISOString(),
                      uuid: crypto.randomUUID(),
                      reason: sf.reason ?? 'refusal',
                    })
                    yield banner as unknown as Message
                  }
                } catch {
                  // densable optional
                }
                continue
              }
              // densable refusal_no_fallback — chain exhausted multi-exit
              if (
                message &&
                typeof message === 'object' &&
                (message as { type?: string }).type === 'refusal_no_fallback'
              ) {
                const rnf = message as {
                  type: 'refusal_no_fallback'
                  reason?: string
                }
                if (refusalContinuationActive) {
                  refusalContinuationActive = false
                  yield {
                    type: 'refusal_continuation' as const,
                    phase: 'end' as const,
                  } as unknown as Message
                }
                logEvent('tengu_rotunda_pennant_chain_exhausted', {
                  reason: (rnf.reason ??
                    'client_chain_exhausted') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  queryChainId: queryChainIdForAnalytics,
                  queryDepth: queryTracking.depth,
                  querySource:
                    querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                continue
              }
              // Official stream fallback_request densable consumer (query path).
              // Stream also throws FallbackTriggeredError; this branch yields the
              // model_refusal_fallback banner / salvage telemetry before retry.
              if (
                message &&
                typeof message === 'object' &&
                (message as { type?: string }).type === 'fallback_request'
              ) {
                const fb = message as {
                  type: 'fallback_request'
                  trigger?: string
                  originalModel: string
                  fallbackModel: string
                  requestId?: string | null
                  apiRefusalCategory?: string | null
                  silentArmAtTrigger?: boolean
                  routeMatched?: 'category' | 'catch_all' | null
                  creditCode?: string | null
                }
                // densable kr = X.creditCode — hold for next request stamp
                if (
                  typeof fb.creditCode === 'string' &&
                  fb.creditCode.length > 0
                ) {
                  pendingFallbackCreditCode = fb.creditCode
                  pendingFallbackCreditMintModel = fb.originalModel
                }
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const {
                    salvageRefusalPartialText,
                    planRefusalFallbackPresentation,
                    buildModelRefusalFallbackSystemMessage,
                    planRefusalContinuationBeginWithSilentStitchGate,
                    SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN,
                  } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  const salvage = salvageRefusalPartialText({
                    messages: assistantMessages,
                  })
                  const isMainThread = toolUseContext.agentId === undefined
                  const presentation = planRefusalFallbackPresentation({
                    reason: fb.trigger ?? 'refusal',
                    midStream: assistantMessages.length > 0,
                    discardedMessages:
                      assistantMessages as unknown as readonly {
                        message?: { content?: readonly { type?: string }[] }
                      }[],
                    requestId: fb.requestId,
                    fromModel: fb.originalModel,
                    apiRefusalCategory: fb.apiRefusalCategory,
                    isMainThread,
                    originalModelScope: querySource,
                  })
                  // densable 2.1.220: entitlement_blind:zkt() on refusal-fallback
                  // telemetry (SEA: tengu_rotunda_pennant_applied + bn payload).
                  logEvent('tengu_refusal_fallback_request', {
                    original_model:
                      fb.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    fallback_model:
                      fb.fallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    queryChainId: queryChainIdForAnalytics,
                    queryDepth: queryTracking.depth,
                    mid_stream: presentation.telemetry.midStream,
                    had_partial_text: salvage.partialTextChars > 0,
                    partial_text_chars: salvage.partialTextChars,
                    salvaged_tool_use_count: salvage.toolUseCount,
                    silent_arm: fb.silentArmAtTrigger === true,
                    entitlement_blind: presentation.telemetry.entitlementBlind,
                    ...(fb.routeMatched != null
                      ? {
                          route_matched:
                            fb.routeMatched as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        }
                      : {}),
                  })
                  if (presentation.showBanner) {
                    const banner = buildModelRefusalFallbackSystemMessage({
                      content: `Switched to ${renderModelName(fb.fallbackModel)} after a model refusal on ${renderModelName(fb.originalModel)}`,
                      fromModel: fb.originalModel,
                      toModel: fb.fallbackModel,
                      requestId: fb.requestId,
                      apiRefusalCategory: fb.apiRefusalCategory,
                      timestamp: new Date().toISOString(),
                      uuid: crypto.randomUUID(),
                      reason: 'refusal',
                    })
                    yield banner as unknown as Message
                  }
                  // densable Yt begin with Gt silent-stitch gate
                  const beginPlan =
                    planRefusalContinuationBeginWithSilentStitchGate({
                      messages: assistantMessages,
                      silentStitchPending,
                    })
                  if (beginPlan.action === 'skip_silent_stitch_pending') {
                    logForDebugging(SERVER_FALLBACK_SILENT_STITCH_SKIP_WARN, {
                      level: 'warn',
                    })
                  } else if (beginPlan.action === 'begin') {
                    refusalContinuationActive = true
                    // densable silent arm fill: Gt=Gi, or=!0 only when salvage
                    // text is present (Gi!==void 0)
                    try {
                      const { planSilentStitchFillOnFallbackRequest } =
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                      const fill = planSilentStitchFillOnFallbackRequest({
                        silentArmAtTrigger: fb.silentArmAtTrigger === true,
                        salvageText: beginPlan.event.salvageText,
                      })
                      if (fill.fillSilentStitch) {
                        silentStitchPending = true
                        // densable Gt=Gi — soft-join prefix for Cjs land
                        if (typeof beginPlan.event.salvageText === 'string') {
                          silentStitchText = beginPlan.event.salvageText
                          // densable DRd: wr = zr({content:DRd(Gi), isMeta:!0})
                          try {
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            const {
                              buildPartialResponseSalvageMetaContent,
                              planSameModelRefusalRetryNudge,
                            } =
                              require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            const { createUserMessage } =
                              require('./utils/messages.js') as typeof import('./utils/messages.js')
                            // Official 2.1.321 (#1852): when the refused model
                            // produced nothing before blocking, mark the retry
                            // nudge virtual so the fallback model does not see
                            // a spurious stopped-response note.
                            const producedNothing =
                              salvage.partialTextChars === 0 &&
                              salvage.toolUseCount === 0
                            const nudgePlan = planSameModelRefusalRetryNudge({
                              producedNothing,
                              interruptedToolCount: salvage.toolUseCount,
                            })
                            partialResponseMetaMessage = createUserMessage({
                              content: producedNothing
                                ? nudgePlan.nudgeContent
                                : buildPartialResponseSalvageMetaContent(
                                    beginPlan.event.salvageText,
                                  ),
                              isMeta: true,
                              ...(nudgePlan.isVirtual && { isVirtual: true }),
                            })
                          } catch {
                            // densable optional
                          }
                        }
                      }
                      if (fill.fillConvolute) {
                        convoluteArcadesRetryActive = true
                      }
                    } catch {
                      if (fb.silentArmAtTrigger === true) {
                        convoluteArcadesRetryActive = true
                      }
                    }
                    // densable client begin: display salvage only (Yt is
                    // server_fallback midStream seam; Gt is silent arm fill)
                    yield beginPlan.event as unknown as Message
                  }
                } catch {
                  // densable optional
                }
                // densable ke=Jn&&!xe&&!X — qa on fallback_request, else FXl
                // stays in claude.ts. Silent arm skips the preference ask.
                if (
                  refusalFallbackPreferencePending &&
                  fb.silentArmAtTrigger !== true
                ) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { askRefusalFallbackPreference } =
                      require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                    refusalFallbackPreferenceChoice =
                      await askRefusalFallbackPreference({
                        canUseTool,
                        toolUseContext,
                        originalModel: fb.originalModel,
                        fallbackModel: fb.fallbackModel,
                        apiRefusalCategory: fb.apiRefusalCategory,
                        telemetry: {
                          original_model: fb.originalModel,
                          fallback_model: fb.fallbackModel,
                        },
                      })
                  } catch {
                    refusalFallbackPreferenceChoice = 'retry_fallback'
                  }
                }
                // Record for caller-driven fallback if stream returns cleanly
                // (when `refusalFallbackHandledByCaller: true` in claude.ts).
                pendingCallerFallbackRequest = {
                  originalModel: fb.originalModel,
                  fallbackModel: fb.fallbackModel,
                  requestId: fb.requestId,
                  apiRefusalCategory: fb.apiRefusalCategory,
                  silentArmAtTrigger: fb.silentArmAtTrigger,
                }
                backfillClones.length = 0
                // Do not push into assistantMessages; either stream throws
                // FallbackTriggeredError or caller handles `pendingCallerFallbackRequest`
                // right after stream exits.
                continue
              }
              // We won't use the tool_calls from the first attempt
              // We could.. but then we'd have to merge assistant messages
              // with different ids and double up on full the tool_results
              if (streamingFallbackOccured) {
                // Yield tombstones for orphaned messages so they're removed from UI and transcript.
                // These partial messages (especially thinking blocks) have invalid signatures
                // that would cause "thinking blocks cannot be modified" API errors.
                for (const msg of assistantMessages) {
                  yield { type: 'tombstone' as const, message: msg }
                }
                logEvent('tengu_orphaned_messages_tombstoned', {
                  orphanedMessageCount: assistantMessages.length,
                  queryChainId: queryChainIdForAnalytics,
                  queryDepth: queryTracking.depth,
                })

                assistantMessages.length = 0
                toolResults.length = 0
                toolUseBlocks.length = 0
                needsFollowUp = false
                backfillClones.length = 0

                // Discard pending results from the failed streaming attempt and create
                // a fresh executor. This prevents orphan tool_results (with old tool_use_ids)
                // from being yielded after the fallback response arrives.
                if (streamingToolExecutor) {
                  streamingToolExecutor.discard()
                  // densable XId onReset → ARd(U.options,V) — drop mid-stream stamps
                  clearActiveMcpStamps(
                    toolUseContext.options,
                    attributeMcpUsage,
                  )
                  streamingToolExecutor = new StreamingToolExecutor(
                    toolUseContext.options.tools,
                    canUseTool,
                    toolUseContext,
                  )
                }
              }
              // Backfill tool_use inputs on a cloned message before yield so
              // SDK stream output and transcript serialization see legacy/derived
              // fields. The original `message` is left untouched for
              // assistantMessages.push below — it flows back to the API and
              // mutating it would break prompt caching (byte mismatch).
              let yieldMessage: typeof message = message
              if (message.type === 'assistant') {
                const assistantMsg = message as AssistantMessage
                // #1562: record the CLAUDE.md token count once the main-thread API
                // request succeeds so later CLAUDE.md growth is counted in auto-compact budget.
                if (
                  !recordedClaudeMdTokensForRequest &&
                  !assistantMsg.isApiErrorMessage &&
                  toolUseContext.agentId === undefined &&
                  querySource !== 'compact' &&
                  querySource !== 'session_memory'
                ) {
                  recordedClaudeMdTokensForRequest = true
                  recordSentClaudeMdTokens(
                    userContext.claudeMd
                      ? roughTokenCountEstimation(userContext.claudeMd)
                      : 0,
                  )
                }
                const contentArr = Array.isArray(assistantMsg.message?.content)
                  ? (assistantMsg.message.content as unknown as Array<{
                      type: string
                      input?: unknown
                      name?: string
                      [key: string]: unknown
                    }>)
                  : []
                let clonedContent: typeof contentArr | undefined
                for (let i = 0; i < contentArr.length; i++) {
                  const block = contentArr[i]!
                  if (
                    block.type === 'tool_use' &&
                    typeof block.input === 'object' &&
                    block.input !== null
                  ) {
                    const tool = findToolByName(
                      toolUseContext.options.tools,
                      block.name as string,
                    )
                    if (tool?.backfillObservableInput) {
                      const originalInput = block.input as Record<
                        string,
                        unknown
                      >
                      const inputCopy = { ...originalInput }
                      tool.backfillObservableInput(inputCopy)
                      // Only yield a clone when backfill ADDED fields; skip if
                      // it only OVERWROTE existing ones (e.g. file tools
                      // expanding file_path). Overwrites change the serialized
                      // transcript and break VCR fixture hashes on resume,
                      // while adding nothing the SDK stream needs — hooks get
                      // the expanded path via toolExecution.ts separately.
                      const addedFields = Object.keys(inputCopy).some(
                        k => !(k in originalInput),
                      )
                      if (addedFields) {
                        clonedContent ??= [...contentArr]
                        clonedContent[i] = { ...block, input: inputCopy }
                      }
                    }
                  }
                }
                if (clonedContent) {
                  yieldMessage = {
                    ...message,
                    message: {
                      ...(assistantMsg.message ?? {}),
                      content: clonedContent,
                    },
                  } as typeof message
                  // Official 2.1.328 `Tt` (`chunk@305854618.js @275400-275950`):
                  // record shallow clone so `message_delta` syncs usage/stop_reason/etc.
                  backfillClones.push({
                    src: assistantMsg,
                    dst: yieldMessage as AssistantMessage,
                  })
                }
              }
              // Withhold recoverable errors (prompt-too-long, media-size,
              // max-output-tokens, truncatedAfterOutput/ap) until we know
              // whether recovery (collapse drain / reactive compact /
              // truncation retry) can succeed. Still pushed to
              // assistantMessages so recovery finds them.
              // Media (EFi) is also buffered in Ji and replayed on the next
              // non-withheld message; leftover Ji is not flushed at stream end.
              // Either subsystem's withhold is sufficient — they're
              // independent so turning one off doesn't break the other's
              // recovery path.
              //
              // feature() only works in if/ternary conditions (bun:bundle
              // tree-shaking constraint), so the collapse check is nested
              // rather than composed.
              // densable Gm/Ji: ztm/EFi/Jsm/ap withhold; only EFi pushes Co.
              let withholdPtl = false
              if (feature('CONTEXT_COLLAPSE')) {
                if (
                  contextCollapse?.isWithheldPromptTooLong(
                    message as Message,
                    isPromptTooLongMessage as (msg: Message) => boolean,
                    querySource,
                  )
                ) {
                  withholdPtl = true
                }
              }
              if (
                reactiveCompact?.isWithheldPromptTooLong(message as Message)
              ) {
                withholdPtl = true
              }
              if (
                !needsFollowUp &&
                reactiveCompact?.isEligibleForLongContextRefusalCompact(
                  message as Message,
                  getContextWindowForModel(currentModel),
                  querySource,
                )
              ) {
                withholdPtl = true
                withheldLongContextRefusal = message as AssistantMessage
              }
              const { withheld: baseWithheld, replay: withheldMediaReplay } =
                applyStreamMediaReplay(withheldMediaBuffer, message, {
                  ptl: withholdPtl,
                  media:
                    mediaRecoveryEnabled &&
                    reactiveCompact?.isWithheldMediaSizeError(
                      message as Message,
                    ) === true,
                  maxOutputTokens: isWithheldMaxOutputTokens(message),
                  truncatedAfterOutput:
                    !needsFollowUp &&
                    isTruncatedAfterOutputRecovery(
                      message,
                      toolUseContext,
                      querySource,
                    ),
                })
              let withheld = baseWithheld
              if (
                !withheld &&
                needsFollowUp &&
                isSafetyMonitorBlockedMessage(message)
              ) {
                withheld = true
                withheldSafetyMonitorBlock = message
              }
              if (
                !withheld &&
                sameModelRefusalArmed &&
                isSameModelRefusalMessage(message)
              ) {
                withheld = true
                withheldSameModelRefusal = message
              }
              // densable: (Gt||Yt) soft/exact land BEFORE yield so consumers
              // see joined text + supersedesUuids on first delivery.
              // Yt → exact Yt.text+Ki.text + supersedes lane server_stitch
              // Gt → Cjs(Gt, Ki.text); clear so convolute → "merged"
              // Use yieldMessage (mutable) — for-await `message` is const.
              let landedAssistant: AssistantMessage | undefined
              if (
                message.type === 'assistant' &&
                !(message as AssistantMessage).isApiErrorMessage &&
                (exactSalvagePackage !== undefined ||
                  silentStitchPending ||
                  clientRetrySupersedesUuids !== undefined)
              ) {
                const assistantForLand = yieldMessage as AssistantMessage
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const { planRefusalLandJoin } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  const content = assistantForLand.message?.content
                  if (
                    Array.isArray(content) &&
                    (exactSalvagePackage !== undefined || silentStitchPending)
                  ) {
                    const land = planRefusalLandJoin({
                      content,
                      exactSalvage: exactSalvagePackage,
                      softSalvageText: silentStitchText,
                      isMainThread: toolUseContext.agentId === undefined,
                    })
                    if (land.joined) {
                      landedAssistant = {
                        ...assistantForLand,
                        message: {
                          ...assistantForLand.message,
                          content: land.content,
                        },
                        ...(land.supersedesUuids !== undefined &&
                        land.supersedesUuids.length > 0
                          ? { supersedesUuids: land.supersedesUuids }
                          : {}),
                      } as AssistantMessage
                      backfillClones.push({
                        src: message as AssistantMessage,
                        dst: landedAssistant,
                      })
                      yieldMessage = landedAssistant
                      if (
                        land.supersedesUuids !== undefined &&
                        land.supersedesUuids.length > 0
                      ) {
                        logEvent('tengu_refusal_fallback_supersedes', {
                          lane: 'server_stitch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          count: land.supersedesUuids.length,
                          queryChainId: queryChainIdForAnalytics,
                          queryDepth: queryTracking.depth,
                        })
                      }
                      if (land.clearExact) {
                        exactSalvagePackage = undefined
                      }
                      if (land.clearSoft) {
                        silentStitchPending = false
                        silentStitchText = undefined
                        // densable: clear wr after soft land (salvage joined)
                        partialResponseMetaMessage = undefined
                      }
                    }
                  }
                } catch {
                  // densable optional
                }
                // densable R client_retry supersedes on next assistant
                if (clientRetrySupersedesUuids !== undefined) {
                  const uuids = clientRetrySupersedesUuids
                  clientRetrySupersedesUuids = undefined
                  landedAssistant = {
                    ...((landedAssistant ?? yieldMessage) as AssistantMessage),
                    supersedesUuids: uuids,
                  } as AssistantMessage
                  yieldMessage = landedAssistant
                  logEvent('tengu_refusal_fallback_supersedes', {
                    lane: 'client_retry' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    count: uuids.length,
                    queryChainId: queryChainIdForAnalytics,
                    queryDepth: queryTracking.depth,
                  })
                }
              }
              if (!withheld) {
                // densable: if(Ji.length>0) yield*Ji, Ji.length=0; yield Kl
                for (const replayed of withheldMediaReplay) {
                  yield replayed
                }
                yield yieldMessage
              }
              if (message.type === 'assistant') {
                const assistantMessage =
                  landedAssistant ?? (message as AssistantMessage)
                assistantMessages.push(assistantMessage)

                const msgToolUseBlocks = (
                  Array.isArray(assistantMessage.message?.content)
                    ? assistantMessage.message.content
                    : []
                ).filter(
                  (content: { type: string }) => content.type === 'tool_use',
                ) as ToolUseBlock[]
                if (msgToolUseBlocks.length > 0) {
                  toolUseBlocks.push(...msgToolUseBlocks)
                  needsFollowUp = true
                }

                if (
                  streamingToolExecutor &&
                  !toolUseContext.abortController.signal.aborted
                ) {
                  for (const toolBlock of msgToolUseBlocks) {
                    streamingToolExecutor.addTool(toolBlock, assistantMessage)
                  }
                }
              }

              yield* drainStreamingTools()
            }
            queryCheckpoint('query_api_streaming_end')
            // Official 2.1.328 `Tt`: final sync of cloned assistant messages after stream end.
            syncBackfillClones()
            backfillClones.length = 0
            // Official 2.1.328 (`chunk@294254613.js:3449563`): when claude.ts
            // returned cleanly after yielding `fallback_request` (because
            // `refusalFallbackHandledByCaller: true`), own the dialog + retry
            // trigger here in query.ts.
            if (pendingCallerFallbackRequest !== undefined) {
              const fbReq = pendingCallerFallbackRequest
              pendingCallerFallbackRequest = undefined
              let choice = refusalFallbackPreferenceChoice
              if (
                choice === undefined &&
                !fbReq.silentArmAtTrigger &&
                toolUseContext.requestDialog
              ) {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const {
                    getProviderRefusalFallbackGuidanceText,
                    getSwitchModelsOnFlag,
                    runRefusalFallbackDialogFlow,
                  } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  const flow = await runRefusalFallbackDialogFlow({
                    decision: {
                      isMainThread: toolUseContext.agentId === undefined,
                      requestDialog: toolUseContext.requestDialog,
                      silentAttempt: false,
                      switchModelsOnFlag: getSwitchModelsOnFlag(),
                    },
                    requestDialog: toolUseContext.requestDialog,
                    signal: toolUseContext.abortController.signal,
                    payload: {
                      originalModel: fbReq.originalModel,
                      fallbackModel: fbReq.fallbackModel,
                      apiRefusalCategory: fbReq.apiRefusalCategory ?? null,
                      guidanceText: getProviderRefusalFallbackGuidanceText(
                        getAPIProvider() === 'firstParty',
                      ),
                    },
                  })
                  choice = flow.choice
                } catch {
                  choice = 'retry_fallback'
                }
              }
              refusalFallbackPreferenceChoice = choice
              if (choice === undefined || choice === 'retry_fallback') {
                throw new FallbackTriggeredError(
                  fbReq.originalModel,
                  fbReq.fallbackModel,
                  'refusal',
                )
              }
            }
            // densable Zue() @184980379 — Xue stash, else relay-stopped strip
            {
              const stripped =
                takePendingThinkingStripped() ??
                emitRelayThinkingStripped(
                  assistantMessages.some(m => isThinkingMessage(m)),
                )
              if (stripped) {
                yield createAttachmentMessage(stripped)
              }
            }
          } catch (innerError) {
            if (
              innerError instanceof FallbackTriggeredError &&
              (innerError.fallbackModel || fallbackModel)
            ) {
              // densable qa cancelled/edit_prompt — do not switch. Gold
              // abort(_l("refusal-fallback-edit")) on pause.
              if (
                refusalFallbackPreferenceChoice === 'cancelled' ||
                refusalFallbackPreferenceChoice === 'edit_prompt'
              ) {
                if (refusalFallbackPreferenceChoice === 'edit_prompt') {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { createAbortErrorReason } =
                      require('./utils/abortController.js') as typeof import('./utils/abortController.js')
                    toolUseContext.abortController.abort(
                      createAbortErrorReason('refusal-fallback-edit'),
                    )
                  } catch {
                    toolUseContext.abortController.abort()
                  }
                }
                assistantMessages.length = 0
                toolResults.length = 0
                toolUseBlocks.length = 0
                needsFollowUp = false
                backfillClones.length = 0
              } else {
                // Fallback was triggered - switch model and retry
                // Prefer the error's fallback model (refusal & availability paths
                // supply target directly even when --fallback-model is unset).
                const switchTo =
                  innerError.fallbackModel &&
                  typeof innerError.fallbackModel === 'string'
                    ? innerError.fallbackModel
                    : (fallbackModel as string)
                if (triedFallbackModels.has(switchTo)) {
                  throw innerError
                }
                triedFallbackModels.add(switchTo)
                currentModel = switchTo
                modelFacts = getModelFacts(currentModel)
                leftoverStampTurnEffort(switchTo)
                attemptWithFallback = true

                // Official B3s carriedEffort — latch on main conversation or carry in loop
                const carriedFromError = (
                  innerError as {
                    carriedEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
                  }
                ).carriedEffort
                const carriedLevel =
                  carriedFromError ??
                  (refusalFallbackEffort?.model === currentModel
                    ? refusalFallbackEffort.level
                    : undefined)
                const heldBySession = !toolUseContext.agentId
                if (heldBySession) {
                  refusalFallbackEffort = undefined
                } else if (carriedLevel !== undefined) {
                  refusalFallbackEffort = {
                    model: switchTo,
                    level: carriedLevel,
                  }
                }

                // Official BMg densable — rebind AppState + latch previous models.
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const {
                    planRefusalFallbackAppStateRebind,
                    applyRefusalFallbackAppStateRebind,
                    applyRefusalFallbackLatchArm,
                  } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const {
                    getMainLoopModelOverride,
                    setMainLoopModelOverride,
                    setRefusalFallbackModelLatch,
                    markRefusalFallbackOccurred,
                  } =
                    require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
                  const appState = toolUseContext.getAppState()
                  applyRefusalFallbackLatchArm({
                    fallbackModel: switchTo,
                    previousOverride: getMainLoopModelOverride(),
                    previousAppStateModel: appState.mainLoopModel,
                    previousModelForSession: appState.mainLoopModelForSession,
                    setLatch: latch =>
                      setRefusalFallbackModelLatch({
                        ...(latch as Parameters<
                          typeof setRefusalFallbackModelLatch
                        >[0]),
                        ...(heldBySession &&
                          carriedLevel !== undefined && {
                            carriedEffort: carriedLevel,
                          }),
                      }),
                    setMainLoopModelOverride,
                    markOccurred: markRefusalFallbackOccurred,
                  })
                  const rebind = planRefusalFallbackAppStateRebind({
                    appStateModel: switchTo,
                    forSessionValue: null,
                    overrideValue: switchTo,
                    currentMainLoopModel: appState.mainLoopModel,
                    currentMainLoopModelForSession:
                      appState.mainLoopModelForSession,
                    fastMode: appState.fastMode,
                  })
                  applyRefusalFallbackAppStateRebind({
                    plan: rebind,
                    setAppState: toolUseContext.setAppState as unknown as (
                      f: (prev: {
                        mainLoopModel?: string | null
                        mainLoopModelForSession?: string | null
                        fastMode?: boolean
                        [k: string]: unknown
                      }) => {
                        mainLoopModel?: string | null
                        mainLoopModelForSession?: string | null
                        fastMode?: boolean
                        [k: string]: unknown
                      },
                    ) => void,
                    setMainLoopModelOverride,
                  })
                } catch {
                  // BMg densable optional
                }

                // Clear assistant messages since we'll retry the entire request
                yield* yieldMissingToolResultBlocks(
                  assistantMessages,
                  'Model fallback triggered',
                )
                assistantMessages.length = 0
                toolResults.length = 0
                toolUseBlocks.length = 0
                needsFollowUp = false
                backfillClones.length = 0

                // Update tool use context with new model before recreating executor
                toolUseContext = {
                  ...toolUseContext,
                  options: {
                    ...toolUseContext.options,
                    mainLoopModel: switchTo,
                  },
                }

                // Discard pending results from the failed attempt and create a
                // fresh executor. This prevents orphan tool_results (with old
                // tool_use_ids) from leaking into the retry.
                if (streamingToolExecutor) {
                  streamingToolExecutor.discard()
                  // densable XId onReset → ARd(U.options,V)
                  clearActiveMcpStamps(
                    toolUseContext.options,
                    attributeMcpUsage,
                  )
                  streamingToolExecutor = new StreamingToolExecutor(
                    toolUseContext.options.tools,
                    canUseTool,
                    toolUseContext,
                  )
                }

                // Thinking signatures are model-bound: replaying thinking blocks
                // from one model to a different fallback model 400s across both
                // internal and external tiers. Always strip before retry.
                messagesForQuery = stripSignatureBlocks(messagesForQuery)

                // Log the fallback event
                const fallbackReason =
                  'reason' in innerError &&
                  typeof (innerError as { reason?: unknown }).reason ===
                    'string'
                    ? (innerError as { reason: string }).reason
                    : 'overloaded'
                logEvent('tengu_model_fallback_triggered', {
                  original_model:
                    innerError.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  fallback_model:
                    switchTo as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  reason:
                    fallbackReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  entrypoint:
                    'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  queryChainId: queryChainIdForAnalytics,
                  queryDepth: queryTracking.depth,
                })

                // Official 2.1.328 (`chunk@305854618.js @280706` & `@271554`):
                // emit `query_model_change` on every model switch, followed by
                // `system/model_fallback` for non-refusal fallbacks (refusal
                // already emitted `model_refusal_fallback` on `fallback_request`).
                yield {
                  type: 'query_model_change' as const,
                  toModel: switchTo,
                } as unknown as Message

                if (
                  fallbackReason === 'model_not_found' ||
                  fallbackReason === 'permission_denied' ||
                  fallbackReason === 'model_blocked'
                ) {
                  // Permanent primary-model failure: rebind session model (official
                  // BD + setAppState mainLoopModel) and emit Host model_fallback.
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { setMainLoopModelOverride } =
                      require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
                    setMainLoopModelOverride(switchTo)
                    toolUseContext.setAppState(prev => ({
                      ...prev,
                      mainLoopModel: switchTo,
                      mainLoopModelForSession: null,
                    }))
                  } catch {
                    // optional
                  }
                  yield {
                    type: 'system' as const,
                    subtype: 'model_fallback' as const,
                    content: `Switched to ${renderModelName(switchTo)} because ${renderModelName(innerError.originalModel)} is not available`,
                    level: 'warning' as const,
                    trigger: fallbackReason,
                    originalModel: innerError.originalModel,
                    fallbackModel: switchTo,
                    isMeta: false as const,
                    timestamp: new Date().toISOString(),
                    uuid: randomUUID(),
                  } as unknown as Message
                } else if (fallbackReason === 'last_resort') {
                  yield {
                    type: 'system' as const,
                    subtype: 'model_fallback' as const,
                    content: `Switched to ${renderModelName(switchTo)} because ${renderModelName(innerError.originalModel)} returned an error that could not be retried`,
                    level: 'warning' as const,
                    trigger: 'last_resort' as const,
                    originalModel: innerError.originalModel,
                    fallbackModel: switchTo,
                    isMeta: false as const,
                    timestamp: new Date().toISOString(),
                    uuid: randomUUID(),
                  } as unknown as Message
                } else if (fallbackReason !== 'refusal') {
                  yield {
                    type: 'system' as const,
                    subtype: 'model_fallback' as const,
                    content: `Switched to ${renderModelName(switchTo)} due to high demand for ${renderModelName(innerError.originalModel)}`,
                    level: 'warning' as const,
                    trigger:
                      fallbackReason === 'server_error'
                        ? ('server_error' as const)
                        : ('overloaded' as const),
                    originalModel: innerError.originalModel,
                    fallbackModel: switchTo,
                    isMeta: false as const,
                    timestamp: new Date().toISOString(),
                    uuid: randomUUID(),
                  } as unknown as Message
                }
              }
            } else {
              // densable multi-exit: En end + convolute_arcades error outcome
              if (convoluteArcadesRetryActive) {
                convoluteArcadesRetryActive = false
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const { resolveConvoluteArcadesRetryOutcome } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  const outcome = resolveConvoluteArcadesRetryOutcome({
                    path: 'error',
                    silentStitchPending,
                  })
                  silentStitchPending = false
                  silentStitchText = undefined
                  partialResponseMetaMessage = undefined
                  exactSalvagePackage = undefined
                  logEvent('tengu_convolute_arcades_retry_outcome', {
                    outcome:
                      outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    queryChainId: queryChainIdForAnalytics,
                    queryDepth: queryTracking.depth,
                    querySource:
                      querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                } catch {
                  silentStitchPending = false
                  silentStitchText = undefined
                  partialResponseMetaMessage = undefined
                  exactSalvagePackage = undefined
                }
                yield {
                  type: 'refusal_continuation' as const,
                  phase: 'end' as const,
                } as unknown as Message
                refusalContinuationActive = false
              } else if (refusalContinuationActive) {
                // densable refusal_no_fallback / chain exhausted → phase end
                refusalContinuationActive = false
                exactSalvagePackage = undefined
                yield {
                  type: 'refusal_continuation' as const,
                  phase: 'end' as const,
                } as unknown as Message
              }
              throw innerError
            }
          }
        }
        // densable: successful serve after refusal_continuation begin → phase end
        // densable or&&!Jt: convolute outcome merged (Gt consumed) / no_text
        if (convoluteArcadesRetryActive) {
          convoluteArcadesRetryActive = false
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { resolveConvoluteArcadesRetryOutcome } =
              require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
            const outcome = resolveConvoluteArcadesRetryOutcome({
              path: 'success',
              silentStitchPending,
            })
            silentStitchPending = false
            silentStitchText = undefined
            partialResponseMetaMessage = undefined
            exactSalvagePackage = undefined
            logEvent('tengu_convolute_arcades_retry_outcome', {
              outcome:
                outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
              querySource:
                querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
          } catch {
            silentStitchPending = false
            silentStitchText = undefined
            partialResponseMetaMessage = undefined
            exactSalvagePackage = undefined
          }
          yield {
            type: 'refusal_continuation' as const,
            phase: 'end' as const,
          } as unknown as Message
          refusalContinuationActive = false
        } else if (refusalContinuationActive) {
          refusalContinuationActive = false
          exactSalvagePackage = undefined
          yield {
            type: 'refusal_continuation' as const,
            phase: 'end' as const,
          } as unknown as Message
        }
      } catch (error) {
        if (convoluteArcadesRetryActive) {
          convoluteArcadesRetryActive = false
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { resolveConvoluteArcadesRetryOutcome } =
              require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
            const outcome = resolveConvoluteArcadesRetryOutcome({
              path: 'error',
              silentStitchPending,
            })
            silentStitchPending = false
            silentStitchText = undefined
            partialResponseMetaMessage = undefined
            exactSalvagePackage = undefined
            logEvent('tengu_convolute_arcades_retry_outcome', {
              outcome:
                outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
              querySource:
                querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
          } catch {
            silentStitchPending = false
            silentStitchText = undefined
            partialResponseMetaMessage = undefined
            exactSalvagePackage = undefined
          }
          yield {
            type: 'refusal_continuation' as const,
            phase: 'end' as const,
          } as unknown as Message
          refusalContinuationActive = false
        } else if (refusalContinuationActive) {
          refusalContinuationActive = false
          yield {
            type: 'refusal_continuation' as const,
            phase: 'end' as const,
          } as unknown as Message
        }
        logError(error)
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        logEvent('tengu_query_error', {
          assistantMessages: assistantMessages.length,
          toolUses: assistantMessages.flatMap(_ =>
            (Array.isArray(_.message?.content)
              ? (_.message.content as Array<{ type: string }>)
              : []
            ).filter(content => content.type === 'tool_use'),
          ).length,

          queryChainId: queryChainIdForAnalytics,
          queryDepth: queryTracking.depth,
        })

        // Handle image size/resize errors with user-friendly messages
        if (
          error instanceof ImageSizeError ||
          error instanceof ImageResizeError
        ) {
          yield createAssistantAPIErrorMessage({
            content: error.message,
          })
          yield* leftoverDrainSpinnerModes()
          return { reason: 'image_error' }
        }

        // Generally queryModelWithStreaming should not throw errors but instead
        // yield them as synthetic assistant messages. However if it does throw
        // due to a bug, we may end up in a state where we have already emitted
        // a tool_use block but will stop before emitting the tool_result.
        yield* yieldMissingToolResultBlocks(assistantMessages, errorMessage)

        // Surface the real error instead of a misleading "[Request interrupted
        // by user]" — this path is a model/runtime failure, not a user action.
        // SDK consumers were seeing phantom interrupts on e.g. Node 18's missing
        // Array.prototype.with(), masking the actual cause.
        yield createAssistantAPIErrorMessage({
          content: errorMessage,
        })

        // To help track down bugs, log loudly for ants
        logAntError('Query error', error)
        yield* leftoverDrainSpinnerModes()
        return { reason: 'model_error', error }
      }

      // Official 2.1.328 (`chunk@305854618.js @281554-281850`): handle mid-turn
      // `safety_monitor_blocked` when `needsFollowUp` is true — drain completed
      // tools, cancel unstarted tools, synthesize `tool_result`s for unanswered
      // tool calls, and yield the withheld safety monitor error.
      const lastStreamedForSafety = assistantMessages.at(-1)
      if (
        needsFollowUp &&
        isSafetyMonitorBlockedMessage(lastStreamedForSafety)
      ) {
        try {
          for (const result of streamingToolExecutor.getCompletedResults()) {
            if (isToolBridgeEvent(result)) {
              yield result
              continue
            }
            if (result.message) {
              yield result.message
              accumulateToolResultForMidTurn(
                result.message,
                toolResults,
                applyPluginToolListFilter(
                  toolUseContext.options.refreshTools?.() ??
                    toolUseContext.options.tools,
                ),
                toolUseContext.options.mainLoopModel,
              )
            }
          }
        } catch (err) {
          logError(err)
        }
        needsFollowUp = false
        streamingToolExecutor.discard()
        const answeredIds = new Set<string>()
        for (const tr of toolResults) {
          if (tr.type === 'user' && Array.isArray(tr.message.content)) {
            for (const block of tr.message.content) {
              if (block.type === 'tool_result') {
                answeredIds.add(block.tool_use_id)
              }
            }
          }
        }
        for (const msg of assistantMessages) {
          if (!Array.isArray(msg.message?.content)) continue
          for (const block of msg.message.content) {
            if (block.type === 'tool_use' && !answeredIds.has(block.id)) {
              const cancelledMsg = createUserMessage({
                content: [
                  {
                    type: 'tool_result',
                    content:
                      '<tool_use_error>Cancelled: safety monitor blocked the response</tool_use_error>',
                    is_error: true,
                    tool_use_id: block.id,
                  },
                ],
                toolUseResult: 'Cancelled: safety monitor blocked the response',
                sourceToolAssistantUUID: msg.uuid,
              })
              yield cancelledMsg
              toolResults.push(cancelledMsg)
            }
          }
        }
        if (withheldSafetyMonitorBlock === lastStreamedForSafety) {
          yield lastStreamedForSafety
          withheldSafetyMonitorBlock = undefined
        }
      }

      // Execute post-sampling hooks after model response is complete
      if (assistantMessages.length > 0) {
        void executePostSamplingHooks(
          messagesForQuery.concat(assistantMessages),
          systemPrompt,
          userContext,
          systemContext,
          toolUseContext,
          querySource,
        )
      }

      // We need to handle a streaming abort before anything else.
      // Official 2.1.328 (`chunk@305854618.js @282000` `zi`): ALWAYS drain
      // `streamingToolExecutor.getRemainingResults()` on streaming abort
      // (including `remote-cancel`) so tool_use blocks always receive matching
      // synthetic tool_result blocks.
      if (toolUseContext.abortController.signal.aborted) {
        for await (const update of streamingToolExecutor.getRemainingResults()) {
          if (isToolBridgeEvent(update)) {
            yield update
            continue
          }
          if (update.message) {
            yield update.message
          }
        }
        if (withheldSameModelRefusal !== undefined) {
          yield withheldSameModelRefusal
          withheldSameModelRefusal = undefined
        }
        // chicago MCP: auto-unhide + lock release on interrupt. Same cleanup
        // as the natural turn-end path in stopHooks.ts. Main thread only —
        // see stopHooks.ts for the subagent-releasing-main's-lock rationale.
        if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
          try {
            const { cleanupComputerUseAfterTurn } = await import(
              './utils/computerUse/cleanup.js'
            )
            await cleanupComputerUseAfterTurn(toolUseContext)
          } catch {
            // Failures are silent — this is dogfooding cleanup, not critical path
          }
        }

        // densable m0e/Cxg: skip interrupt + refusal-fallback-edit (2.1.218 #12)
        if (
          !shouldSuppressInterruptionMessage(
            toolUseContext.abortController.signal.reason,
          )
        ) {
          yield createUserInterruptionMessage({
            toolUse: false,
            interruptedByShutdown: isShutdownAbortReason(
              toolUseContext.abortController.signal.reason,
            )
              ? true
              : undefined,
          })
        }
        yield* leftoverDrainSpinnerModes()
        return { reason: 'aborted_streaming' }
      }

      // Official 2.1.328 (`chunk@305854618.js @283910-285400` `Gia`):
      // same-model `refusal_retry` — retract refused turn, cancel unstarted
      // tools, emit synthetic tool_results + notice + nudge once on the same
      // model before surfacing refusal.
      const lastStreamedForRefusal = assistantMessages.at(-1)
      if (
        sameModelRefusalArmed &&
        isSameModelRefusalMessage(lastStreamedForRefusal) &&
        lastStreamedForRefusal === withheldSameModelRefusal
      ) {
        for (const result of streamingToolExecutor.getCompletedResults()) {
          if (isToolBridgeEvent(result)) {
            yield result
            continue
          }
          if (result.message) {
            yield result.message
            const endTurn = endTurnSourceFromToolResult(result.message)
            if (endTurn) toolRequestedEndTurn = endTurn
            accumulateToolResultForMidTurn(
              result.message,
              toolResults,
              applyPluginToolListFilter(
                toolUseContext.options.refreshTools?.() ??
                  toolUseContext.options.tools,
              ),
              toolUseContext.options.mainLoopModel,
            )
          }
        }
        const alreadyPrevented = toolResults.some(
          r =>
            r.type === 'attachment' &&
            (r.attachment.type === 'hook_deferred_tool' ||
              r.attachment.type === 'hook_stopped_continuation'),
        )
        if (!alreadyPrevented && toolRequestedEndTurn === false) {
          const startedToolUseIds = new Set<string>(
            toolUseContext.getAppState().transcripts?.[
              toolUseContext.agentId ?? ''
            ]?.inProgressToolUseIDs ?? [],
          )
          streamingToolExecutor.discard()
          clearActiveMcpStamps(toolUseContext.options, attributeMcpUsage)
          const kept = assistantMessages.filter(
            m => m !== lastStreamedForRefusal,
          )
          const answeredIds = new Set<string>()
          for (const tr of toolResults) {
            if (tr.type === 'user' && Array.isArray(tr.message.content)) {
              for (const block of tr.message.content) {
                if (block.type === 'tool_result') {
                  answeredIds.add(block.tool_use_id)
                }
              }
            }
          }
          let interruptedCount = 0
          const notRunResults: UserMessage[] = []
          for (const keptMsg of kept) {
            if (!Array.isArray(keptMsg.message?.content)) continue
            for (const block of keptMsg.message.content) {
              if (block.type !== 'tool_use' || answeredIds.has(block.id)) {
                continue
              }
              const wasStarted = startedToolUseIds.has(block.id)
              if (wasStarted) interruptedCount++
              const resultText = wasStarted
                ? 'Interrupted: response stopped by safety classifier'
                : 'Cancelled: response stopped by safety classifier before this tool ran'
              notRunResults.push(
                createUserMessage({
                  content: [
                    {
                      type: 'tool_result',
                      tool_use_id: block.id,
                      is_error: true,
                      content: resultText,
                    },
                  ],
                  toolUseResult: resultText,
                  sourceToolAssistantUUID: keptMsg.uuid,
                }),
              )
            }
          }
          const producedNothing =
            kept.length === 0 && (lastDeltaOutputTokens ?? 0) === 0
          const refusalNotice = createSystemMessage(
            `${renderModelName(currentModel)}'s safeguards stopped the response above · continuing once with that noted`,
            'info',
          )
          const refusalNudge = createUserMessage({
            content:
              interruptedCount > 0
                ? SAME_MODEL_REFUSAL_RETRY_INTERRUPTED_PROMPT
                : SAME_MODEL_REFUSAL_RETRY_PROMPT,
            isMeta: true,
            turnCompanion: true,
            ...(producedNothing ? { isVirtual: true } : {}),
          })
          for (const notRun of notRunResults) {
            yield notRun
          }
          yield refusalNotice
          yield refusalNudge
          state = {
            messages: [
              ...messagesForQuery,
              ...kept,
              ...toolResults,
              ...notRunResults,
              refusalNudge,
            ],
            toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount,
            serverErrorCutRetryCount,
            hasAttemptedReactiveCompact,
            reactiveCompactDeeperPass,
            resumeIncompleteThinking: undefined,
            refusalRetrySpent: true,
            mcpEndTurnOverrideSpent,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive,
            stopHookBlockCount:
              toolUseBlocks.length > 0 ? 0 : stopHookBlockCount,
            turnCount,
            thinkingOnlyNudged,
            emptyCompletionResent,
            transition: { reason: 'refusal_retry', model: currentModel },
          }
          yield* leftoverDrainSpinnerModes()
          continue
        }
        yield lastStreamedForRefusal
        withheldSameModelRefusal = undefined
      } else if (
        withheldSameModelRefusal !== undefined &&
        lastStreamedForRefusal === withheldSameModelRefusal
      ) {
        yield withheldSameModelRefusal
        withheldSameModelRefusal = undefined
      }

      // Yield tool use summary from previous turn — haiku (~1s) resolved during model streaming (5-30s)
      if (pendingToolUseSummary) {
        const summary = await pendingToolUseSummary
        if (summary) {
          yield summary
        }
      }

      if (!needsFollowUp) {
        const lastMessage = assistantMessages.at(-1)

        // Prompt-too-long recovery: the streaming loop withheld the error
        // (see withheldByCollapse / withheldByReactive above). Try collapse
        // drain first (cheap, keeps granular context), then reactive compact
        // (full summary). Single-shot on each — if a retry still 413's,
        // the next stage handles it or the error surfaces.
        // densable cup: e?.type==="assistant" && e8e(e) — optional outer.
        const isWithheldLongContext =
          withheldLongContextRefusal !== undefined &&
          lastMessage === withheldLongContextRefusal
        const isWithheld413 =
          isWithheldLongContext ||
          reactiveCompact?.isWithheldPromptTooLong(lastMessage) === true ||
          (reactiveCompact == null &&
            lastMessage?.type === 'assistant' &&
            lastMessage.isApiErrorMessage &&
            isPromptTooLongMessage(lastMessage))
        // densable r8o: e?.type==="assistant" && l8o(e). Media and PTL both enter
        // n8o/tryReactiveCompact (full summary) — not query-level stripImages.
        // SEA has strippedMedia only inside compact group retries. Collapse drain
        // still PTL-only (media skip collapse). mediaRecoveryEnabled must match
        // stream withhold (module present). Tail-preserved media may re-error once;
        // hasAttemptedReactiveCompact prevents a spiral.
        const isWithheldMedia =
          mediaRecoveryEnabled &&
          reactiveCompact?.isWithheldMediaSizeError(lastMessage) === true
        if (isWithheld413) {
          // First: drain all staged context-collapses. Gated on the PREVIOUS
          // transition not being collapse_drain_retry — if we already drained
          // and the retry still 413'd, fall through to reactive compact.
          if (
            feature('CONTEXT_COLLAPSE') &&
            contextCollapse &&
            state.transition?.reason !== 'collapse_drain_retry'
          ) {
            const drained = contextCollapse.recoverFromOverflow(
              messagesForQuery,
              querySource,
            )
            if (drained.committed > 0) {
              const next: State = {
                messages: drained.messages,
                toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
                autoCompactTracking: tracking,
                maxOutputTokensRecoveryCount,
                hasAttemptedReactiveCompact,
                maxOutputTokensOverride: undefined,
                pendingToolUseSummary: undefined,
                stopHookActive: undefined,
                stopHookBlockCount: 0,
                turnCount,
                thinkingOnlyNudged,
                emptyCompletionResent,
                transition: {
                  reason: 'collapse_drain_retry',
                  committed: drained.committed,
                },
              }
              state = next
              yield* leftoverDrainSpinnerModes()
              continue
            }
          }
        }
        if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
          // Official 2.1.328 (`chunk@305854618.js @286740, @290500`):
          // two-pass `reactiveCompactDeeperPass` (`'none' -> 'available' -> 'spent'`).
          const isDeeperPass =
            isWithheld413 &&
            hasAttemptedReactiveCompact &&
            reactiveCompactDeeperPass === 'available' &&
            state.transition?.reason === 'reactive_compact_retry'
          const effectiveHasAttempted =
            hasAttemptedReactiveCompact && !isDeeperPass
          const reactiveBreaker = isDeeperPass
            ? {
                action: 'proceed' as const,
                consecutiveRapidRefills: tracking?.consecutiveRapidRefills ?? 0,
              }
            : checkRapidRefillBreaker(tracking)
          if (
            !hasAttemptedReactiveCompact &&
            reactiveBreaker.action === 'trip'
          ) {
            if (isWithheldLongContext && lastMessage) {
              yield lastMessage
              void executeStopFailureHooks(lastMessage, toolUseContext)
              yield* leftoverDrainSpinnerModes()
              return { reason: 'model_error' }
            }
            yield createAssistantAPIErrorMessage({
              content: AUTOCOMPACT_THRASHING_MESSAGE,
              error: 'invalid_request',
              apiError: 'autocompact_thrashing',
            })
            yield* leftoverDrainSpinnerModes()
            return { reason: 'rapid_refill_breaker' }
          }
          // Official 2.1.328 (#625): bind PTL recovery compaction to a child
          // AbortController that ALWAYS forwards parent abort (including agent
          // hook timeout aborts) so agent hooks never run past their timeout
          // while compacting after a prompt-too-long refusal.
          const ptlEstimatedTokens = tokenCountWithEstimation(messagesForQuery)
          const ptlRecoveryAbort =
            reactiveCompact.createPtlRecoveryAbortController(
              toolUseContext.abortController,
              {
                timeoutMs:
                  reactiveCompact.computePtlRecoveryTimeoutMs(
                    ptlEstimatedTokens,
                  ),
                querySource,
              },
            )
          const ptlRecoveryToolUseContext: ToolUseContext = {
            ...toolUseContext,
            abortController: ptlRecoveryAbort.controller,
          }
          const ptlTokenGap = lastMessage
            ? getPromptTooLongTokenGap(lastMessage)
            : undefined
          const runReactiveCompact = () =>
            reactiveCompact.tryReactiveCompact({
              hasAttempted: effectiveHasAttempted,
              querySource,
              aborted: ptlRecoveryAbort.controller.signal.aborted,
              messages: messagesForQuery,
              tokenGap: ptlTokenGap,
              cacheSafeParams: {
                systemPrompt,
                userContext,
                systemContext,
                toolUseContext: ptlRecoveryToolUseContext,
                forkContextMessages: messagesForQuery,
              },
            })
          const activeReactiveAgentCtx = getAgentContext()
          let compacted: Awaited<
            ReturnType<typeof runReactiveCompact>
          >['result']
          let compactFailure: Awaited<
            ReturnType<typeof runReactiveCompact>
          >['failure']
          try {
            const outcome =
              toolUseContext.agentId &&
              activeReactiveAgentCtx?.agentId !== toolUseContext.agentId
                ? await runWithAgentContext(
                    {
                      agentId: toolUseContext.agentId,
                      agentType: 'subagent',
                      ...(activeReactiveAgentCtx?.agentType === 'subagent' &&
                      activeReactiveAgentCtx.subagentName
                        ? { subagentName: activeReactiveAgentCtx.subagentName }
                        : querySource?.startsWith('agent:builtin:')
                          ? {
                              subagentName: querySource.slice(
                                'agent:builtin:'.length,
                              ),
                            }
                          : querySource?.startsWith('agent:custom:')
                            ? {
                                subagentName: querySource.slice(
                                  'agent:custom:'.length,
                                ),
                              }
                            : querySource?.startsWith('agent:')
                              ? {
                                  subagentName: querySource.slice(
                                    'agent:'.length,
                                  ),
                                }
                              : {}),
                      isBackgroundAgent: toolUseContext.isBackgroundAgent,
                    },
                    runReactiveCompact,
                  )
                : await runReactiveCompact()
            compacted = outcome.result
            compactFailure = outcome.failure
          } finally {
            ptlRecoveryAbort.cleanup()
          }

          if (compacted) {
            // Official 2.1.328 (#555): rebuild systemPrompt after reactive compact too.
            needsSystemPromptRebuild = true
            // task_budget: same carryover as the proactive path above.
            // messagesForQuery still holds the pre-compact array here (the
            // 413-failed attempt's input).
            if (params.taskBudget) {
              const preCompactContext =
                finalContextTokensFromLastResponse(messagesForQuery)
              taskBudgetRemaining = Math.max(
                0,
                (taskBudgetRemaining ?? params.taskBudget.total) -
                  preCompactContext,
              )
            }

            const postCompactMessages = buildPostCompactMessages(compacted)
            // v2.1.311 (#1230): clear memory/userContext caches and refresh
            // userContext so edited MEMORY.md / CLAUDE.md are seen post-compact.
            runPostCompactCleanup(querySource)
            try {
              const refreshed = await getUserContext()
              if (
                Object.keys(refreshed).length > 0 ||
                Object.keys(userContext).length > 0
              ) {
                userContext = refreshed
              }
            } catch {
              // Keep existing userContext if refresh fails
            }
            for (const msg of postCompactMessages) {
              yield msg
            }
            // Official 2.1.328 (`chunk@305854618.js @290500`): arm a second
            // deeper reactive compact pass when post-compact still retains
            // enough message turns (`>= 3`) or content replacements.
            const postCompactGroups = postCompactMessages.filter(
              m => m.type === 'user' || m.type === 'assistant',
            ).length
            const nextDeeperPass: 'none' | 'available' | 'spent' = isDeeperPass
              ? 'spent'
              : isWithheld413 &&
                  reactiveCompactDeeperPass === 'none' &&
                  (postCompactGroups >= 3 ||
                    (toolUseContext.contentReplacementState?.replacements
                      ?.size ?? 0) > 0)
                ? 'available'
                : reactiveCompactDeeperPass
            const next: State = {
              messages: postCompactMessages,
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: {
                compacted: true,
                turnId: deps.uuid(),
                turnCounter: 0,
                consecutiveFailures: 0,
                consecutiveRapidRefills:
                  reactiveBreaker.consecutiveRapidRefills,
              },
              maxOutputTokensRecoveryCount,
              serverErrorCutRetryCount,
              hasAttemptedReactiveCompact: true,
              reactiveCompactDeeperPass: nextDeeperPass,
              resumeIncompleteThinking,
              refusalRetrySpent,
              mcpEndTurnOverrideSpent,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent,
              transition: { reason: 'reactive_compact_retry' },
            }
            state = next
            yield* leftoverDrainSpinnerModes()
            continue
          }

          // #984: if aborted while compacting a 413 PTL (not withheld media),
          // return aborted_streaming instead of surfacing Prompt is too long.
          if (
            !isWithheldMedia &&
            toolUseContext.abortController.signal.aborted
          ) {
            if (
              !shouldSuppressInterruptionMessage(
                toolUseContext.abortController.signal.reason,
              )
            ) {
              yield createUserInterruptionMessage({
                toolUse: false,
                interruptedByShutdown: isShutdownAbortReason(
                  toolUseContext.abortController.signal.reason,
                )
                  ? true
                  : undefined,
              })
            }
            yield* leftoverDrainSpinnerModes()
            return { reason: 'aborted_streaming' }
          }

          // No recovery — surface the withheld error and exit. Do NOT fall
          // through to stop hooks: the model never produced a valid response,
          // so hooks have nothing meaningful to evaluate. Running stop hooks
          // on prompt-too-long creates a death spiral: error → hook blocking
          // → retry → error → … (the hook injects more tokens each cycle).
          // densable SEA: dl=$n?oaa(ia):void 0 — Ysa only for PTL ($n), never media.
          // oaa only when failure.reason==="error"+detail (aborted keeps bare PTL).
          // Terminal reason is still image_error|prompt_too_long (not aborted_streaming).
          let surfaced: AssistantMessage = lastMessage as AssistantMessage
          if (
            isWithheld413 &&
            lastMessage &&
            lastMessage.type === 'assistant' &&
            lastMessage.isApiErrorMessage &&
            isPromptTooLongMessage(lastMessage)
          ) {
            surfaced = reactiveCompact.annotatePromptTooLongWithCompactFailure(
              lastMessage as AssistantMessage,
              compactFailure,
            )
          }
          yield surfaced
          void executeStopFailureHooks(surfaced, toolUseContext)
          yield* leftoverDrainSpinnerModes()
          return {
            reason: isWithheldMedia
              ? 'image_error'
              : isWithheldLongContext
                ? 'model_error'
                : 'prompt_too_long',
          }
        } else if (
          feature('CONTEXT_COLLAPSE') &&
          isWithheld413 &&
          lastMessage
        ) {
          // reactiveCompact compiled out but contextCollapse withheld and
          // couldn't recover (staged queue empty/stale). Surface. Same
          // early-return rationale — don't fall through to stop hooks.
          yield lastMessage
          void executeStopFailureHooks(lastMessage, toolUseContext)
          yield* leftoverDrainSpinnerModes()
          return { reason: 'prompt_too_long' }
        }

        // Official 2.1.328 (`chunk@305854618.js @166019-169745` `Ym`):
        // Check for max_output_tokens (or refused incomplete-thinking resume)
        // and either resume incomplete thinking without a text nudge, or inject
        // the official recovery nudge (`tool_call_cut` / `reopen_block` / default).
        const thinkingResumeRefused =
          resumeIncompleteThinking === true &&
          lastMessage?.isApiErrorMessage === true &&
          !isWithheldMaxOutputTokens(lastMessage) &&
          !isWithheld413 &&
          !isWithheldMedia
        if (isWithheldMaxOutputTokens(lastMessage) || thinkingResumeRefused) {
          // Escalating retry: if we used the capped 8k default and hit the
          // limit, retry the SAME request at 64k — no meta message, no
          // multi-turn dance. This fires once per turn (guarded by the
          // override check), then falls through to multi-turn recovery if
          // 64k also hits the cap.
          // 3P default: false (not validated on Bedrock/Vertex)
          const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
            'tengu_otk_slot_v1',
            false,
          )
          // Official MAX_OUTPUT_TOKENS densable presence gate.
          let hasMaxOutputTokensEnv =
            !!process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
          try {
            const { resolveMaxOutputTokensOverride } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('./utils/residualFinalEnvGates.js') as typeof import('./utils/residualFinalEnvGates.js')
            hasMaxOutputTokensEnv = resolveMaxOutputTokensOverride() !== null
          } catch {
            // keep raw env fallback
          }
          if (
            !thinkingResumeRefused &&
            capEnabled &&
            maxOutputTokensOverride === undefined &&
            !hasMaxOutputTokensEnv
          ) {
            logEvent('tengu_max_tokens_escalate', {
              escalatedTo: ESCALATED_MAX_TOKENS,
            })
            const next: State = {
              messages: messagesForQuery,
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              serverErrorCutRetryCount,
              hasAttemptedReactiveCompact,
              reactiveCompactDeeperPass,
              refusalRetrySpent,
              mcpEndTurnOverrideSpent,
              maxOutputTokensOverride: ESCALATED_MAX_TOKENS,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent,
              transition: { reason: 'max_output_tokens_escalate' },
            }
            state = next
            yield* leftoverDrainSpinnerModes()
            continue
          }

          const nextCount = thinkingResumeRefused
            ? maxOutputTokensRecoveryCount
            : maxOutputTokensRecoveryCount + 1
          if (nextCount <= MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
            const shouldResumeThinking =
              !thinkingResumeRefused &&
              canResumeIncompleteThinking(assistantMessages)
            const isSubagentQuery =
              toolUseContext.agentId !== undefined ||
              querySourceFamilyOf(querySource) === 'subagent'
            const recoveryMessage = shouldResumeThinking
              ? undefined
              : createUserMessage({
                  content: selectMaxOutputTokensRecoveryPrompt(
                    assistantMessages,
                    isSubagentQuery,
                    nextCount,
                  ),
                  isMeta: true,
                  turnCompanion: true,
                })
            // Official 2.1.328 (`chunk@305854618.js @292000`): yield recovery
            // nudge when present (omitted when resuming incomplete thinking).
            if (recoveryMessage !== undefined) {
              yield recoveryMessage
            }

            const next: State = {
              transition: {
                reason: 'max_output_tokens_recovery',
                attempt: nextCount,
              },
              messages:
                recoveryMessage === undefined
                  ? [
                      ...messagesForQuery,
                      ...assistantMessages.filter(m => !m.isApiErrorMessage),
                    ]
                  : [
                      ...messagesForQuery,
                      ...assistantMessages,
                      recoveryMessage,
                    ],
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount: nextCount,
              serverErrorCutRetryCount,
              hasAttemptedReactiveCompact,
              reactiveCompactDeeperPass,
              resumeIncompleteThinking:
                recoveryMessage === undefined ? true : undefined,
              refusalRetrySpent,
              mcpEndTurnOverrideSpent,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent,
            }
            state = next
            yield* leftoverDrainSpinnerModes()
            continue
          }

          // Recovery exhausted — surface the withheld error now.
          if (lastMessage) {
            yield lastMessage
          }
        }

        // Official 2.1.328 `tp()` (`chunk@305854618.js @169500, @292450`):
        // truncated response recovery — when `streamCutError` is set and
        // `tengu_dreamy_flute` is enabled, use `serverErrorCutRetryCount` with
        // exponential backoff wait; otherwise share `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT`.
        if (
          isTruncatedAfterOutputRecovery(
            lastMessage,
            toolUseContext,
            querySource,
          )
        ) {
          const streamCutErr = (
            lastMessage as AssistantMessage & { streamCutError?: unknown }
          ).streamCutError
          const useServerCutWait =
            streamCutErr !== undefined &&
            getFeatureValue_CACHED_MAY_BE_STALE('tengu_dreamy_flute', false)
          const cutPlan = useServerCutWait
            ? serverErrorCutRetryCount + 1 <= MAX_SERVER_ERROR_CUT_RETRIES
              ? {
                  attempt: serverErrorCutRetryCount + 1,
                  nextServerErrorCutRetryCount: serverErrorCutRetryCount + 1,
                  nextMaxOutputTokensRecoveryCount:
                    maxOutputTokensRecoveryCount,
                  waitMs: getRetryDelay(serverErrorCutRetryCount + 1),
                }
              : undefined
            : maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT
              ? {
                  attempt: maxOutputTokensRecoveryCount + 1,
                  nextServerErrorCutRetryCount: serverErrorCutRetryCount,
                  nextMaxOutputTokensRecoveryCount:
                    maxOutputTokensRecoveryCount + 1,
                  waitMs: undefined,
                }
              : undefined

          if (cutPlan !== undefined) {
            logEvent('query_truncated_response_recovery', {
              status:
                'nudged' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              attempt: cutPlan.attempt,
            })
            const recoveryMessage = createUserMessage({
              content: truncatedRecoveryCopy(querySource),
              isMeta: true,
              turnCompanion: true,
            })
            // Official 2.1.328 (`chunk@305854618.js @292450`): yield recovery
            // nudge so REPL / QueryEngine / JSONL transcript stay in sync.
            yield recoveryMessage
            if (cutPlan.waitMs !== undefined) {
              yield buildCutRetryWaitMessage(
                streamCutErr,
                cutPlan.waitMs,
                cutPlan.attempt,
                deps.uuid,
              )
              await sleep(cutPlan.waitMs, toolUseContext.abortController.signal)
              if (toolUseContext.abortController.signal.aborted) {
                yield* leftoverDrainSpinnerModes()
                return { reason: 'aborted_streaming' }
              }
            }
            const next: State = {
              transition: {
                reason: 'truncated_response_recovery',
                attempt: cutPlan.attempt,
              },
              messages: [
                ...messagesForQuery,
                ...assistantMessages,
                recoveryMessage,
              ],
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount:
                cutPlan.nextMaxOutputTokensRecoveryCount,
              serverErrorCutRetryCount: cutPlan.nextServerErrorCutRetryCount,
              hasAttemptedReactiveCompact,
              reactiveCompactDeeperPass,
              refusalRetrySpent,
              mcpEndTurnOverrideSpent,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent,
            }
            state = next
            yield* leftoverDrainSpinnerModes()
            continue
          }
          logEvent('query_truncated_response_recovery', {
            status:
              'exhausted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          // Recovery exhausted — surface the withheld error now (densable yield h).
          yield lastMessage
        }

        // Official 2.1.328 (`chunk@305854618.js @292900`):
        // `(v?.message.stop_reason ?? zr) === "tool_use" && po.length === 0 && !v?.isApiErrorMessage`.
        const rawStopReason =
          lastMessage?.message.stop_reason ?? lastDeltaStopReason
        const parsedToolUseCount = toolUseBlocks.filter(
          b => !isUnparsedToolInput(b.input),
        ).length
        const malformedToolUse = malformedToolUseRetryAction({
          stopReason:
            typeof rawStopReason === 'string' ? rawStopReason : undefined,
          parsedToolUseCount,
          isApiErrorMessage: lastMessage?.isApiErrorMessage === true,
          previousReason: state.transition?.reason,
          retryCount: malformedToolUseRetryCount,
        })
        const leakedInvoke = assistantTextHasLeakedInvoke(assistantMessages)
        if (malformedToolUse.action !== 'continue') {
          // Gold excerpt: one s("tengu_malformed_tool_use_response",
          // {will_retry:ls,...}) then if(ls) retry else exhausted.
          const malformedModelMeta =
            currentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          logEvent('tengu_malformed_tool_use_response', {
            will_retry: malformedToolUse.action === 'retry',
            model: malformedModelMeta,
            text_has_leaked_invoke: leakedInvoke,
            retry_count: malformedToolUseRetryCount,
          })
          if (malformedToolUse.action === 'retry') {
            for (const msg of assistantMessages) {
              yield { type: 'tombstone' as const, message: msg }
            }
            const retryMessage: UserMessage & {
              retractedMessageUuids?: string[]
              retractedWireUuids?: string[]
            } = createUserMessage({
              content: malformedToolUse.prompt,
              isMeta: true,
              turnCompanion: true,
            })
            const retractedUuids = assistantMessages.map(m => m.uuid)
            retryMessage.retractedMessageUuids = retractedUuids
            if (!toolUseContext.agentId) {
              retryMessage.retractedWireUuids = retractedUuids
            }
            yield retryMessage
            state = {
              messages: [...messagesForQuery, retryMessage],
              transition: { reason: 'malformed_tool_use_retry' },
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount: 0,
              hasAttemptedReactiveCompact: false,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent,
              malformedToolUseRetryCount: malformedToolUseRetryCount + 1,
            }
            yield* leftoverDrainSpinnerModes()
            continue
          }
          if (malformedToolUse.action === 'exhausted') {
            // #1620
            const retractedUuids: string[] = []
            const exhaustedMessage: AssistantMessage & {
              retractedMessageUuids?: string[]
            } = createAssistantAPIErrorMessage({
              content: malformedToolUse.text,
              apiError: 'malformed_tool_use_exhausted',
            })
            exhaustedMessage.retractedMessageUuids = retractedUuids
            yield exhaustedMessage
            // densable: x0e(Li,ct), OS(ct,A,Li)
            void executeStopFailureHooks(exhaustedMessage, toolUseContext)
            OS(toolUseContext, querySource, exhaustedMessage)
            yield* leftoverDrainSpinnerModes()
            return { reason: 'malformed_tool_use_exhausted' }
          }
        }

        // Skip stop hooks when the last message is an API error (rate limit,
        // prompt-too-long, auth failure, etc.). The model never produced a
        // real response — hooks evaluating it create a death spiral:
        // error → hook blocking → retry → error → …
        if (lastMessage?.isApiErrorMessage) {
          void executeStopFailureHooks(lastMessage, toolUseContext)
          // densable 2.1.234: {reason:"api_error",errorKind:Hr.error,isTransient:K1a(Hr)}
          yield* leftoverDrainSpinnerModes()
          return {
            reason: 'api_error',
            errorKind:
              typeof lastMessage.error === 'string' ? lastMessage.error : null,
            isTransient: isTransientApiErrorMessage({
              apiErrorIsTransient: (
                lastMessage as { apiErrorIsTransient?: boolean }
              ).apiErrorIsTransient,
              error:
                typeof lastMessage.error === 'string'
                  ? lastMessage.error
                  : null,
            }),
            error: lastMessage.error ?? lastMessage.apiError ?? 'api_error',
          }
        }

        // Official 2.1.328 `Ff` (`chunk@305854618.js @213650, @293700`):
        // when the model ends the turn with no visible text (including an empty
        // completion with `assistantMessages.length === 0` whose stop_reason
        // arrived on `message_delta`), nudge once, resend once if eligible,
        // then give up with `empty_completion` API error.
        const effectiveStopReason =
          lastMessage?.message?.stop_reason ?? lastDeltaStopReason
        if (
          (effectiveStopReason === 'end_turn' ||
            effectiveStopReason === 'stop_sequence') &&
          !lastMessage?.isApiErrorMessage &&
          querySource !== 'compact' &&
          querySource !== 'prompt_suggestion' &&
          querySource !== 'away_summary' &&
          querySource !== 'agent_summary' &&
          querySource !== 'memdir_aki_extract' &&
          !messagesEndWithSuccessfulTerminalMcpTool(messagesForQuery) &&
          // Official 2.1.328 `Pf(e)` (`tengu_jazzy_wren`): skip thinking-only
          // nudge when the preceding assistant turn already replied via BriefTool.
          (state.transition?.reason !== 'next_turn' ||
            toolUseContext.agentId !== undefined ||
            !hasBriefRepliedInTranscript(messagesForQuery)) &&
          !assistantMessages.some(
            m =>
              Array.isArray(m.message?.content) &&
              m.message.content.some(
                block =>
                  block.type === 'text' &&
                  typeof block.text === 'string' &&
                  block.text.trim().length > 0,
              ),
          )
        ) {
          if (!thinkingOnlyNudged) {
            // densable Pe.thinkingOnlyNudged:!0 on the continue bag
            logForDebugging('query_thinking_only_response: nudged')
            const nudgeMessage = createUserMessage({
              content: THINKING_ONLY_RETRY_PROMPT,
              isMeta: true,
              turnCompanion: true,
            })
            yield nudgeMessage
            state = {
              messages: [...messagesForQuery, nudgeMessage],
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              hasAttemptedReactiveCompact,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged: true,
              emptyCompletionResent,
              transition: { reason: 'thinking_only_retry' },
            }
            yield* leftoverDrainSpinnerModes()
            continue
          }
          const isEmptyCompletion =
            (assistantMessages.length === 0 || emptyCompletionResent) &&
            toolUseContext.agentId === undefined &&
            isRequestEligibleForEmptyCompletionResend(messagesForQuery)
          if (isEmptyCompletion && !emptyCompletionResent) {
            logForDebugging('query_thinking_only_response: empty_resent')
            state = {
              messages: messagesForQuery,
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              hasAttemptedReactiveCompact,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent: true,
              transition: { reason: 'thinking_only_retry' },
            }
            yield* leftoverDrainSpinnerModes()
            continue
          }
          logForDebugging('query_thinking_only_response: nudge_exhausted')
          if (isEmptyCompletion) {
            const emptyError = createAssistantAPIErrorMessage({
              content:
                'The model returned an empty response (retry also failed).',
              apiError: 'empty_completion',
            })
            yield emptyError
            void executeStopFailureHooks(emptyError, toolUseContext)
            OS(toolUseContext, querySource, emptyError)
            yield* leftoverDrainSpinnerModes()
            return { reason: 'api_error', isTransient: false }
          }
        }

        // densable Aa: yield handback bounce (j) + skill_inline not_run BEFORE
        // Stop/goal. Gold stuffs j into Qe so a later preventContinuation can
        // still end the agent, but the meta is already on the stream.
        let handbackBounce: UserMessage | undefined
        {
          const bounce = yield* maybeHandbackBounce(
            params,
            querySource,
            toolUseContext,
          )
          maybeSkillInlineCommandHandoffNotRun(
            messagesForQuery,
            assistantMessages,
            querySource,
            toolUseContext.agentId,
          )
          handbackBounce = bounce
        }

        const stopHookResult = yield* handleStopHooks(
          messagesForQuery,
          assistantMessages,
          systemPrompt,
          userContext,
          systemContext,
          toolUseContext,
          querySource,
          stopHookActive,
        )

        // Official 2.1.328 `Pf(e)` (`tengu_jazzy_wren`): if the transcript shows
        // this turn already sent a visible brief reply, strip any brief-mode
        // enforce retry error so brief-mode sessions do not send a duplicate reply.
        if (
          stopHookResult.blockingErrors.length > 0 &&
          hasBriefRepliedInTranscript(messagesForQuery)
        ) {
          stopHookResult.blockingErrors = stopHookResult.blockingErrors.filter(
            msg => {
              if (msg.type !== 'user') return true
              const content = msg.message?.content
              return !(
                typeof content === 'string' &&
                content.includes(BRIEF_ENFORCE_SENTINEL)
              )
            },
          )
        }

        const stopHookIsSubagent = toolUseContext.agentId !== undefined
        const stopHookGoalActive =
          !stopHookIsSubagent &&
          toolUseContext.getAppState().activeGoal !== undefined
        // densable: recovered log when prior blocks cleared this turn.
        if (
          stopHookBlockCount > 0 &&
          stopHookResult.blockingErrors.length === 0
        ) {
          logEvent('tengu_stop_hook_block_count', {
            count: stopHookBlockCount,
            is_subagent: stopHookIsSubagent,
            hit_max_turns: false,
            hit_cap: false,
            goal_active: stopHookGoalActive,
          })
        }

        if (stopHookResult.preventContinuation) {
          return {
            reason: stopHookResult.aborted
              ? 'aborted_streaming'
              : 'stop_hook_prevented',
          }
        }

        if (stopHookResult.blockingErrors.length > 0) {
          // densable Ra(sessionState, () => blocking.length > 0 || be()).
          // be is () => false here. Drain the transcript queue before
          // max_turns / cap / the next model turn.
          try {
            const { flushSessionStorage } = await import(
              './utils/sessionStorage.js'
            )
            await flushSessionStorage()
          } catch (err) {
            logForDebugging(
              `Stop continuation persist wait failed: ${errorMessage(err)}`,
              { level: 'error' },
            )
          }
          // densable Z=_r+1 includes not_met. Cap fires when ye>0 && Z>ye.
          const nextBlockCount = stopHookBlockCount + 1
          const nextTurnCountOnBlock = turnCount + 1
          if (maxTurns && nextTurnCountOnBlock > maxTurns) {
            logEvent('tengu_stop_hook_block_count', {
              count: nextBlockCount,
              is_subagent: stopHookIsSubagent,
              hit_max_turns: true,
              hit_cap: false,
              goal_active: stopHookGoalActive,
            })
            yield createAttachmentMessage({
              type: 'max_turns_reached',
              maxTurns,
              turnCount: nextTurnCountOnBlock,
            })
            yield* runTurnEndReactions(
              [...messagesForQuery, ...assistantMessages],
              toolUseContext,
              stopHookActive,
            )
            yield* leftoverDrainSpinnerModes()
            return { reason: 'max_turns', turnCount: nextTurnCountOnBlock }
          }
          const cap = resolveStopHookBlockCap()
          if (cap > 0 && nextBlockCount > cap) {
            logEvent('tengu_stop_hook_block_count', {
              count: nextBlockCount,
              is_subagent: stopHookIsSubagent,
              hit_max_turns: false,
              hit_cap: true,
              goal_active: stopHookGoalActive,
            })
            const warning =
              `A hook blocked the turn from ending ${nextBlockCount} consecutive times — overriding and ending turn. ` +
              `For Stop/SubagentStop hooks, check stop_hook_active in the input and return success while it's true. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit.`
            yield createSystemMessage(warning, 'warning')
            if (
              toolUseContext.agentType !== 'teammate' &&
              !stopHookIsSubagent
            ) {
              try {
                // densable xa → Vi (enqueueSdkEvent). Interactive REPL Vi
                // no-ops; addNotification is the toast analog.
                enqueueSdkEvent({
                  type: 'system',
                  subtype: 'notification',
                  key: 'stop-hook-block-cap',
                  text: warning,
                  priority: 'high',
                  color: 'warning',
                })
                toolUseContext.addNotification?.({
                  key: 'stop-hook-block-cap',
                  text: warning,
                  priority: 'high',
                  color: 'warning',
                })
              } catch {
                // densable xa: never fail the turn on toast
              }
            }
            yield* runTurnEndReactions(
              [...messagesForQuery, ...assistantMessages],
              toolUseContext,
              stopHookActive,
            )
            yield* leftoverDrainSpinnerModes()
            return { reason: 'completed' }
          }
          const next: State = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              ...stopHookResult.blockingErrors,
              ...(handbackBounce ? [handbackBounce] : []),
            ],
            toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            // Preserve the reactive compact guard — if compact already ran and
            // couldn't recover from prompt-too-long, retrying after a stop-hook
            // blocking error will produce the same result. Resetting to false
            // here caused an infinite loop: compact → still too long → error →
            // stop hook blocking → compact → … burning thousands of API calls.
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: true,
            stopHookBlockCount: nextBlockCount,
            // Official 2.1.328 (`chunk@305854618.js @297075`): advance `turnCount`
            // on `stop_hook_blocking` retry so repeated blocks hit `maxTurns`.
            turnCount: nextTurnCountOnBlock,
            reactiveCompactDeeperPass: 'none',
            serverErrorCutRetryCount: 0,
            resumeIncompleteThinking: undefined,
            refusalRetrySpent,
            mcpEndTurnOverrideSpent,
            thinkingOnlyNudged,
            emptyCompletionResent,
            transition: { reason: 'stop_hook_blocking' },
          }
          state = next
          yield* leftoverDrainSpinnerModes()
          continue
        }

        if (feature('TOKEN_BUDGET')) {
          const decision = checkTokenBudget(
            budgetTracker!,
            toolUseContext.agentId,
            getCurrentTurnTokenBudget(),
            getTurnOutputTokens(),
          )

          if (decision.action === 'continue') {
            incrementBudgetContinuationCount()
            logForDebugging(
              `Token budget continuation #${decision.continuationCount}: ${decision.pct}% (${decision.turnTokens.toLocaleString()} / ${decision.budget.toLocaleString()})`,
            )
            state = {
              messages: [
                ...messagesForQuery,
                ...assistantMessages,
                createUserMessage({
                  content: decision.nudgeMessage,
                  isMeta: true,
                }),
              ],
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount: 0,
              hasAttemptedReactiveCompact: false,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              thinkingOnlyNudged,
              emptyCompletionResent,
              transition: { reason: 'token_budget_continuation' },
            }
            yield* leftoverDrainSpinnerModes()
            continue
          }

          if (decision.completionEvent) {
            if (decision.completionEvent.diminishingReturns) {
              logForDebugging(
                `Token budget early stop: diminishing returns at ${decision.completionEvent.pct}%`,
              )
            }
            logEvent('tengu_token_budget_completed', {
              ...decision.completionEvent,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })
          }
        }

        if (handbackBounce) {
          state = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              handbackBounce,
            ],
            toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            hasAttemptedReactiveCompact: false,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive,
            stopHookBlockCount: 0,
            turnCount,
            thinkingOnlyNudged,
            emptyCompletionResent: false,
            transition: { reason: 'next_turn' },
          }
          yield* leftoverDrainSpinnerModes()
          continue
        }

        yield* leftoverDrainSpinnerModes()
        return { reason: 'completed' }
      }

      yield* leftoverDrainSpinnerModes()

      let shouldPreventContinuation = false
      let toolWasDeferred = false
      let updatedToolUseContext = toolUseContext

      queryCheckpoint('query_tool_execution_start')

      logEvent('tengu_streaming_tool_execution_used', {
        tool_count: toolUseBlocks.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      const toolUpdates = streamingToolExecutor.getRemainingResults()

      for await (const update of toolUpdates) {
        // densable jR: yield control events (set_expanded_view) onto the query
        // stream. Gold CLI host onQueryEvent drops them; SDK QueryEngine skips.
        if (isToolBridgeEvent(update)) {
          yield update
          continue
        }
        if (update.message) {
          yield update.message

          // densable 2.1.283 lr @ 190733487: smo(g) → ee.toolRequestedEndTurn
          const endTurn = endTurnSourceFromToolResult(update.message)
          if (endTurn) toolRequestedEndTurn = endTurn

          if (update.message.type === 'attachment') {
            if (
              update.message.attachment!.type === 'hook_stopped_continuation'
            ) {
              shouldPreventContinuation = true
            } else if (
              update.message.attachment!.type === 'hook_deferred_tool'
            ) {
              toolWasDeferred = true
            }
          }

          // densable 2.1.228 St (vs 227 only read_truncation_notice): push all
          // tool attachments raw so skill deferred_tools_delta is visible to
          // mid-turn getAttachmentMessages history scan (#11 double-send fix).
          accumulateToolResultForMidTurn(
            update.message,
            toolResults,
            applyPluginToolListFilter(
              updatedToolUseContext.options.refreshTools?.() ??
                updatedToolUseContext.options.tools,
            ),
            updatedToolUseContext.options.mainLoopModel,
          )
        }
        if (update.newContext) {
          updatedToolUseContext = {
            ...update.newContext,
            queryTracking,
          }
        }
      }
      queryCheckpoint('query_tool_execution_end')

      // Generate tool use summary after tool batch completes — passed to next recursive call
      let nextPendingToolUseSummary:
        | Promise<ToolUseSummaryMessage | null>
        | undefined
      if (
        config.gates.emitToolUseSummaries &&
        toolUseBlocks.length > 0 &&
        !toolUseContext.abortController.signal.aborted &&
        !toolUseContext.agentId // subagents don't surface in mobile UI — skip the Haiku call
      ) {
        // Extract the last assistant text block for context
        const lastAssistantMessage = assistantMessages.at(-1)
        let lastAssistantText: string | undefined
        if (lastAssistantMessage) {
          const textBlocks = (
            Array.isArray(lastAssistantMessage.message?.content)
              ? (lastAssistantMessage.message.content as Array<{
                  type: string
                  text?: string
                }>)
              : []
          ).filter(block => block.type === 'text')
          if (textBlocks.length > 0) {
            const lastTextBlock = textBlocks.at(-1)
            if (lastTextBlock && 'text' in lastTextBlock) {
              lastAssistantText = lastTextBlock.text
            }
          }
        }

        // Collect tool info for summary generation
        const toolUseIds = toolUseBlocks.map(block => block.id)
        const toolInfoForSummary = toolUseBlocks.map(block => {
          // Find the corresponding tool result
          const toolResult = toolResults.find(
            result =>
              result.type === 'user' &&
              Array.isArray(result.message.content) &&
              result.message.content.some(
                content =>
                  content.type === 'tool_result' &&
                  content.tool_use_id === block.id,
              ),
          )
          const resultContent =
            toolResult?.type === 'user' &&
            Array.isArray(toolResult.message.content)
              ? toolResult.message.content.find(
                  (c): c is ToolResultBlockParam =>
                    c.type === 'tool_result' && c.tool_use_id === block.id,
                )
              : undefined
          return {
            name: block.name,
            input: block.input,
            output:
              resultContent && 'content' in resultContent
                ? resultContent.content
                : null,
          }
        })

        // Fire off summary generation without blocking the next API call
        nextPendingToolUseSummary = generateToolUseSummary({
          tools: toolInfoForSummary,
          signal: toolUseContext.abortController.signal,
          isNonInteractiveSession:
            toolUseContext.options.isNonInteractiveSession,
          lastAssistantText,
        })
          .then(summary => {
            if (summary) {
              return createToolUseSummaryMessage(summary, toolUseIds)
            }
            return null
          })
          .catch(() => null)
      }

      // We were aborted during tool calls
      if (toolUseContext.abortController.signal.aborted) {
        // chicago MCP: auto-unhide + lock release when aborted mid-tool-call.
        // This is the most likely Ctrl+C path for CU (e.g. slow screenshot).
        // Main thread only — see stopHooks.ts for the subagent rationale.
        if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
          try {
            const { cleanupComputerUseAfterTurn } = await import(
              './utils/computerUse/cleanup.js'
            )
            await cleanupComputerUseAfterTurn(toolUseContext)
          } catch {
            // Failures are silent — this is dogfooding cleanup, not critical path
          }
        }
        // densable m0e/Cxg: skip interrupt + refusal-fallback-edit (2.1.218 #12).
        // Unpaired tool_use is already closed via yieldMissingToolResultBlocks /
        // streamingToolExecutor.getRemainingResults above (or ensureToolResultPairing).
        if (
          !shouldSuppressInterruptionMessage(
            toolUseContext.abortController.signal.reason,
          )
        ) {
          yield createUserInterruptionMessage({
            toolUse: true,
            interruptedByShutdown: isShutdownAbortReason(
              toolUseContext.abortController.signal.reason,
            )
              ? true
              : undefined,
          })
        }
        // densable 2.1.246 #54 query @214424458:
        // abort_tools still yields max_turns_reached when over the limit.
        // runAgent then drops event+yield if the agent abort signal is already set.
        const nextTurnCountOnAbort = turnCount + 1
        if (maxTurns && nextTurnCountOnAbort > maxTurns) {
          yield createAttachmentMessage({
            type: 'max_turns_reached',
            maxTurns,
            turnCount: nextTurnCountOnAbort,
          })
        }
        yield* leftoverDrainSpinnerModes()
        return { reason: 'aborted_tools' }
      }

      // densable: toolWasDeferred before shouldPreventContinuation so a turn
      // with both attachments reports tool_deferred, not hook_stopped.
      if (toolWasDeferred) {
        yield* leftoverDrainSpinnerModes()
        return { reason: 'tool_deferred' }
      }
      if (shouldPreventContinuation) {
        // densable: hook_stopped does not bounce. Ot discards blocks.
        yield* runTurnEndReactions(
          messagesForQuery.concat(assistantMessages, toolResults),
          updatedToolUseContext,
          stopHookActive,
        )
        yield* leftoverDrainSpinnerModes()
        return { reason: 'hook_stopped' }
      }
      // Official 2.1.328 (`chunk@305854618.js @109475, @158337, @301785` `Bm`/`Xc`/`Jc`):
      // StructuredOutput (`tool`) always ends the turn immediately. For MCP `endTurn`
      // (`mcp_meta`), a failed sibling tool (`tengu_cozy_fern`) or a blocking Stop hook
      // (`tengu_glittery_mitten`) may override `endTurn` at most once per turn
      // (`mcpEndTurnOverrideSpent`).
      let mcpEndTurnOverrideMessage: UserMessage | undefined
      if (toolRequestedEndTurn) {
        const isLastIterationForEndTurn = Boolean(
          maxTurns && turnCount + 1 > maxTurns,
        )
        const hasFailedSiblingToolResult =
          toolRequestedEndTurn === 'mcp_meta' &&
          toolResults.some(
            r =>
              r.type === 'user' &&
              Array.isArray(r.message.content) &&
              r.message.content.some(
                b => b.type === 'tool_result' && b.is_error === true,
              ),
          )
        if (
          toolRequestedEndTurn === 'mcp_meta' &&
          !mcpEndTurnOverrideSpent &&
          !isLastIterationForEndTurn &&
          hasFailedSiblingToolResult &&
          getFeatureValue_CACHED_MAY_BE_STALE('tengu_cozy_fern', false)
        ) {
          mcpEndTurnOverrideMessage = createUserMessage({
            content: MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT,
            isMeta: true,
            turnCompanion: true,
          })
          logEvent('tengu_mcp_end_turn_overridden_by_failed_sibling', {
            queryChainId: queryChainIdForAnalytics,
            queryDepth: queryTracking.depth,
          })
        } else if (
          toolRequestedEndTurn === 'mcp_meta' &&
          !mcpEndTurnOverrideSpent &&
          !isLastIterationForEndTurn &&
          getFeatureValue_CACHED_MAY_BE_STALE('tengu_glittery_mitten', true)
        ) {
          const mcpStopResult = yield* handleStopHooks(
            messagesForQuery,
            assistantMessages,
            systemPrompt,
            userContext,
            systemContext,
            updatedToolUseContext,
            querySource,
            stopHookActive,
          )
          if (mcpStopResult.preventContinuation) {
            yield* leftoverDrainSpinnerModes()
            return {
              reason: mcpStopResult.aborted
                ? 'aborted_tools'
                : 'stop_hook_prevented',
            }
          }
          if (mcpStopResult.blockingErrors.length > 0) {
            logEvent('tengu_mcp_end_turn_overridden_by_stop_hook', {
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })
            const nextTurnCountOnMcpStop = turnCount + 1
            state = {
              messages: [
                ...messagesForQuery,
                ...assistantMessages,
                ...toolResults,
                ...mcpStopResult.blockingErrors,
              ],
              toolUseContext: leftoverUnwrapStreamMode(updatedToolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount: 0,
              serverErrorCutRetryCount: 0,
              hasAttemptedReactiveCompact,
              reactiveCompactDeeperPass: 'none',
              resumeIncompleteThinking: undefined,
              refusalRetrySpent,
              mcpEndTurnOverrideSpent: true,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: nextPendingToolUseSummary,
              stopHookActive: true,
              stopHookBlockCount: stopHookBlockCount + 1,
              turnCount: nextTurnCountOnMcpStop,
              thinkingOnlyNudged: false,
              emptyCompletionResent: false,
              transition: { reason: 'stop_hook_blocking' },
            }
            yield* leftoverDrainSpinnerModes()
            continue
          }
          logEvent('tengu_mcp_tool_result_ended_turn', {
            queryChainId: queryChainIdForAnalytics,
            queryDepth: queryTracking.depth,
            source:
              toolRequestedEndTurn as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          yield* leftoverDrainSpinnerModes()
          return { reason: 'completed' }
        } else {
          logEvent('tengu_mcp_tool_result_ended_turn', {
            queryChainId: queryChainIdForAnalytics,
            queryDepth: queryTracking.depth,
            source:
              toolRequestedEndTurn as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          // densable ip @195421735 — Acn; blocking discarded (no model re-invoke).
          try {
            const permissionMode =
              updatedToolUseContext.getAppState().toolPermissionContext.mode
            for await (const result of executePostToolBatchHooks(
              collectPostToolBatchCalls(toolUseBlocks, toolResults),
              `hook-${deps.uuid()}`,
              updatedToolUseContext,
              permissionMode,
              updatedToolUseContext.abortController.signal,
            )) {
              if (result.message) yield result.message
              if (result.blockingError || result.preventContinuation) {
                logForDebugging(
                  `[end-turn] PostToolBatch block discarded (turn ended by ${
                    toolRequestedEndTurn === 'tool'
                      ? 'tool result'
                      : 'MCP end-turn'
                  }, no model re-invoke): ${
                    result.blockingError?.blockingError ??
                    result.stopReason ??
                    'preventContinuation'
                  }`,
                )
              }
            }
          } catch (err) {
            if (!(err instanceof ControlStreamClosedError)) throw err
            logForDebugging(
              'PostToolBatch hooks cancelled (control stream closed)',
            )
          }
          if (updatedToolUseContext.abortController.signal.aborted) {
            if (feature('CHICAGO_MCP') && !updatedToolUseContext.agentId) {
              try {
                const { cleanupComputerUseAfterTurn } = await import(
                  './utils/computerUse/cleanup.js'
                )
                await cleanupComputerUseAfterTurn(updatedToolUseContext)
              } catch {
                // Failures are silent — this is dogfooding cleanup, not critical path
              }
            }
            if (
              !shouldSuppressInterruptionMessage(
                updatedToolUseContext.abortController.signal.reason,
              )
            ) {
              yield createUserInterruptionMessage({
                toolUse: false,
                interruptedByShutdown: isShutdownAbortReason(
                  updatedToolUseContext.abortController.signal.reason,
                )
                  ? true
                  : undefined,
              })
            }
          }
          // densable ip: Stop via gs (endTurnSource); no handback bounce.
          yield* handleStopHooks(
            messagesForQuery,
            assistantMessages,
            systemPrompt,
            userContext,
            systemContext,
            updatedToolUseContext,
            querySource,
            stopHookActive,
            toolRequestedEndTurn,
          )
          yield* leftoverDrainSpinnerModes()
          return { reason: 'completed' }
        }
      }

      if (tracking?.compacted) {
        tracking.turnCounter++
        logEvent('tengu_post_autocompact_turn', {
          turnId:
            tracking.turnId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          turnCounter: tracking.turnCounter,

          queryChainId: queryChainIdForAnalytics,
          queryDepth: queryTracking.depth,
        })
      }

      // Be careful to do this after tool calls are done, because the API
      // will error if we interleave tool_result messages with regular user messages.

      // Instrumentation: Track message count before attachments
      logEvent('tengu_query_before_attachments', {
        messagesForQueryCount: messagesForQuery.length,
        assistantMessagesCount: assistantMessages.length,
        toolResultsCount: toolResults.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      // densable Acn @195489328 — after tengu_query_before_attachments, before
      // refreshTools. Exit 2 / preventContinuation stops the agentic loop.
      {
        const postBatchSessionId =
          updatedToolUseContext.agentId ?? getSessionId()
        if (
          hasHookForEvent(
            'PostToolBatch',
            updatedToolUseContext.getAppState(),
            postBatchSessionId,
          )
        ) {
          const hookId = `hook-${deps.uuid()}`
          const permissionMode =
            updatedToolUseContext.getAppState().toolPermissionContext.mode
          let postBatchStopped = false
          let postBatchStopReason: string | undefined
          try {
            for await (const result of executePostToolBatchHooks(
              collectPostToolBatchCalls(toolUseBlocks, toolResults),
              hookId,
              updatedToolUseContext,
              permissionMode,
              updatedToolUseContext.abortController.signal,
            )) {
              if (
                result.message &&
                !(
                  result.message.type === 'attachment' &&
                  result.message.attachment?.type === 'hook_blocking_error'
                )
              ) {
                yield result.message
              }
              if (
                result.additionalContexts &&
                result.additionalContexts.length > 0
              ) {
                const ctx = createAttachmentMessage({
                  type: 'hook_additional_context',
                  content: result.additionalContexts,
                  hookName: 'PostToolBatch',
                  toolUseID: hookId,
                  hookEvent: 'PostToolBatch',
                })
                yield ctx
                toolResults.push(ctx)
              }
              if (result.blockingError) {
                postBatchStopped = true
                postBatchStopReason ??= result.blockingError.blockingError
              }
              if (result.preventContinuation) {
                postBatchStopped = true
                postBatchStopReason ??= result.stopReason
              }
            }
          } catch (err) {
            if (!(err instanceof ControlStreamClosedError)) throw err
            logForDebugging(
              'PostToolBatch hooks cancelled (control stream closed)',
            )
          }
          if (updatedToolUseContext.abortController.signal.aborted) {
            if (feature('CHICAGO_MCP') && !updatedToolUseContext.agentId) {
              try {
                const { cleanupComputerUseAfterTurn } = await import(
                  './utils/computerUse/cleanup.js'
                )
                await cleanupComputerUseAfterTurn(updatedToolUseContext)
              } catch {
                // Failures are silent — this is dogfooding cleanup, not critical path
              }
            }
            if (
              !shouldSuppressInterruptionMessage(
                updatedToolUseContext.abortController.signal.reason,
              )
            ) {
              yield createUserInterruptionMessage({
                toolUse: false,
                interruptedByShutdown: isShutdownAbortReason(
                  updatedToolUseContext.abortController.signal.reason,
                )
                  ? true
                  : undefined,
              })
            }
            yield* leftoverDrainSpinnerModes()
            return { reason: 'aborted_tools' }
          }
          if (postBatchStopped) {
            yield createAttachmentMessage({
              type: 'hook_stopped_continuation',
              message:
                postBatchStopReason ||
                'Execution stopped by PostToolBatch hook',
              hookName: 'PostToolBatch',
              toolUseID: hookId,
              hookEvent: 'PostToolBatch',
            })
            // Official 2.1.328 (`chunk@305854618.js @302350` `wo`): on
            // PostToolBatch stop, run turn-end reactions (`stopPass: 'turn_end_reactions'`)
            // rather than full `handleStopHooks`.
            yield* runTurnEndReactions(
              messagesForQuery.concat(assistantMessages, toolResults),
              updatedToolUseContext,
              stopHookActive,
            )
            yield* leftoverDrainSpinnerModes()
            return { reason: 'hook_stopped' }
          }
        }
      }

      // densable: refreshTools then refreshMcpClients before attachments.
      if (updatedToolUseContext.options.refreshTools) {
        const refreshedTools = applyPluginToolListFilter(
          updatedToolUseContext.options.refreshTools(),
        )
        if (refreshedTools !== updatedToolUseContext.options.tools) {
          const oldMcpCount = count(
            updatedToolUseContext.options.tools,
            tool => !!tool.mcpInfo,
          )
          const newMcpCount = count(refreshedTools, tool => !!tool.mcpInfo)
          if (oldMcpCount !== newMcpCount) {
            logEvent('tengu_mcp_tools_refreshed_mid_turn', {
              oldMcpCount,
              newMcpCount,
              recovered: oldMcpCount === 0 && newMcpCount > 0,
            })
          }
          updatedToolUseContext = {
            ...updatedToolUseContext,
            options: {
              ...updatedToolUseContext.options,
              tools: refreshedTools,
            },
          }
        }
      }
      if (updatedToolUseContext.options.refreshMcpClients) {
        const refreshedClients =
          updatedToolUseContext.options.refreshMcpClients()
        updatedToolUseContext = {
          ...updatedToolUseContext,
          options: {
            ...updatedToolUseContext.options,
            mcpClients: refreshedClients,
          },
        }
      }

      // Get queued commands snapshot before processing attachments.
      // These will be sent as attachments so Claude can respond to them in the current turn.
      //
      // Drain pending notifications. LocalShellTask completions are 'next'
      // (when MONITOR_TOOL is on) and drain without Sleep. Other task types
      // (agent/workflow/framework) still default to 'later' — the Sleep flush
      // covers those. If all task types move to 'next', this branch could go.
      //
      // Slash commands are excluded from mid-turn drain — they must go through
      // processSlashCommand after the turn ends (via useQueueProcessor), not be
      // sent to the model as text. Bash-mode commands are already excluded by
      // INLINE_NOTIFICATION_MODES in getQueuedCommandAttachments.
      //
      // Agent scoping: densable k7c — main thread drains AL(cmd)=agentId===mi(),
      // subagents drain task-notifications with agentId===currentAgentId.
      // User prompts still go to main only; subagents never see the prompt stream.
      // eslint-disable-next-line custom-rules/require-tool-match-name -- ToolUseBlock.name has no aliases
      const sleepRan = toolUseBlocks.some(b => b.name === SLEEP_TOOL_NAME)
      const isMainThread =
        querySource.startsWith('repl_main_thread') || querySource === 'sdk'
      const currentAgentId = toolUseContext.agentId
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isMainThreadQueuedCommand } =
        require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
      const { keepQueuedCommandsUntilFirstDroppedPrompt, latchPromptScreen } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./utils/processUserInput/promptSubmit.js') as typeof import('./utils/processUserInput/promptSubmit.js')
      // Official 2.1.328 (`chunk@305854618.js @304050`): check `maxTurns`
      // BEFORE snapshotting or consuming mid-turn queued commands so queued
      // user prompts and notifications are NOT silently popped and lost when
      // the turn exits on `max_turns`.
      const nextTurnCount = turnCount + 1
      const maxTurnsReached = Boolean(maxTurns && nextTurnCount > maxTurns)
      const rawQueuedSnapshot =
        isMidTurnFoldSuspended() || maxTurnsReached
          ? []
          : getCommandsByMaxPriority(sleepRan ? 'later' : 'next')
              .filter(cmd => {
                if (cmd.waitsOutStop === true || cmd.passive === true) {
                  return false
                }
                if (isSlashCommand(cmd)) return false
                if (isMainThread) return isMainThreadQueuedCommand(cmd)
                // Subagents drain task-notifications and poll-events addressed to them —
                // never user prompts, even if someone stamps an agentId on one.
                return (
                  (cmd.mode === 'task-notification' ||
                    cmd.mode === 'poll-event') &&
                  cmd.agentId === currentAgentId
                )
              })
              .filter(
                keepQueuedCommandsUntilFirstDroppedPrompt(
                  latchPromptScreen(() => updatedToolUseContext, {
                    latch: true,
                  }),
                ),
              )
      // Official 2.1.328 `wSr` (`chunk@294254613.js:756964`): enforce the
      // 20-event / 32KB chunk cap on mid-turn poll-events too.
      const cappedPollSet = new Set(
        selectPollEventChunk(
          rawQueuedSnapshot.filter(cmd => cmd.mode === 'poll-event'),
        ),
      )
      const queuedCommandsSnapshot = rawQueuedSnapshot.filter(
        cmd => cmd.mode !== 'poll-event' || cappedPollSet.has(cmd),
      )
      const queuedAutonomyClaim = await claimConsumableQueuedAutonomyCommands(
        queuedCommandsSnapshot,
      )
      if (queuedAutonomyClaim.staleCommands.length > 0) {
        removeFromQueue(queuedAutonomyClaim.staleCommands)
      }

      const applyAbsorbedMidTurnEffects = (
        commands: QueuedCommand[],
      ): AttachmentMessage | undefined => {
        updateTurnAttributionFromCommands(commands)
        // Official 2.1.325 #2317: emit OTel `user_prompt` event with
        // `delivery.mode: "mid_turn"` and the running turn's `prompt.id`.
        {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { emitMidTurnUserPromptOTelEvents } =
            require('./utils/processUserInput/processTextPrompt.js') as typeof import('./utils/processUserInput/processTextPrompt.js')
          emitMidTurnUserPromptOTelEvents(commands)
        }
        // Official 2.1.328 `jNe(tt, ..., { armUndo: false })`: flush
        // deferred historyEntry for absorbed mid-turn commands.
        for (const cmd of commands) {
          if (!cmd.historyEntry) continue
          try {
            addToHistory(cmd.historyEntry, { armUndo: false })
          } catch {
            // history persistence is best-effort
          }
        }
        // densable 2.1.246 d9n — main-thread mid-turn human prompt resets the
        // idle check-in burst (Js=isMainThread && OY(origin)).
        if (
          isMainThread &&
          commands.some(
            cmd =>
              cmd.mode === 'prompt' &&
              !cmd.isMeta &&
              (cmd as { shouldQuery?: boolean }).shouldQuery !== false &&
              isHumanLikeOrigin(cmd.origin),
          )
        ) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { clearGoalIdleCheckinCount } =
            require('./services/goal/goalIdleCheckin.js') as typeof import('./services/goal/goalIdleCheckin.js')
          clearGoalIdleCheckinCount(toolUseContext.setAppState)
        }
        // Gold `Vc` / `Wu` (#1287): mid-turn typed `ultrathink` boosts turn effort to xhigh.
        {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { isTypedUltrathinkPrompt } =
            require('./utils/attachments.js') as typeof import('./utils/attachments.js')
          const { canBoostTurnToXhigh } =
            require('./utils/effort.js') as typeof import('./utils/effort.js')
          const { applyContextLayers, getEffortValueFromLayers } =
            require('./engine/permissionLayerReaders.js') as typeof import('./engine/permissionLayerReaders.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          const model = updatedToolUseContext.options.mainLoopModel
          const appEffort = getEffortValueFromLayers(updatedToolUseContext)
          if (
            commands.some(
              cmd =>
                cmd.mode === 'prompt' &&
                !cmd.isMeta &&
                (cmd as { shouldQuery?: boolean }).shouldQuery !== false &&
                isHumanLikeOrigin(cmd.origin) &&
                isTypedUltrathinkPrompt({
                  composerEnter: cmd.composerEnter,
                  preExpansionInput: cmd.preExpansionValue,
                  localStdinOrigin: cmd.localStdinOrigin,
                  input: typeof cmd.value === 'string' ? cmd.value : '',
                }) &&
                canBoostTurnToXhigh(model, appEffort),
            )
          ) {
            logEvent('tengu_ultrathink', {})
            try {
              /* eslint-disable @typescript-eslint/no-require-imports */
              const { leftoverIhrPhn } =
                require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
              const { getMainThreadAgentId } =
                require('./bootstrap/state.js') as typeof import('./bootstrap/state.js')
              /* eslint-enable @typescript-eslint/no-require-imports */
              leftoverIhrPhn(
                updatedToolUseContext.agentId ?? getMainThreadAgentId(),
              ).setTurnEffort('xhigh')
            } catch {
              // isolation — optional
            }
            updatedToolUseContext = applyContextLayers(updatedToolUseContext, [
              { kind: 'effort', effort: 'xhigh' },
            ])
            return createAttachmentMessage({
              type: 'ultrathink_effort',
              level: 'xhigh',
            })
          }
        }
        return undefined
      }

      const claimedConsumedCommands =
        queuedAutonomyClaim.claimedCommands.filter(
          cmd =>
            cmd.mode === 'prompt' ||
            cmd.mode === 'task-notification' ||
            cmd.mode === 'poll-event',
        )
      const foldInFlightCommands = queuedAutonomyClaim.attachmentCommands
      registerFoldInFlight(foldInFlightCommands)
      try {
        if (claimedConsumedCommands.length > 0) {
          if (
            updatedToolUseContext.abortController.signal.aborted ||
            isMidTurnFoldSuspended()
          ) {
            logForDebugging(
              `[query] abort/suspension during mid-turn absorption — leaving ${claimedConsumedCommands.length} command(s) queued`,
            )
          } else {
            consumedAutonomyCommands.push(...claimedConsumedCommands)
            consumeFromQueue(claimedConsumedCommands, {
              reason: 'absorbed_mid_turn',
            })
            const reminder = applyAbsorbedMidTurnEffects(
              claimedConsumedCommands,
            )
            if (reminder) {
              yield reminder
              toolResults.push(reminder)
            }
            for (const cmd of claimedConsumedCommands) {
              if (cmd.uuid && !wasPutBack(cmd.uuid)) {
                consumedCommandUuids.push(cmd.uuid)
                notifyCommandLifecycle(cmd.uuid, 'started')
              }
            }
          }
        }

        let pollEventsBuildAborted = false
        let queuedAttachmentCount = 0
        let pollEventsAttachmentCount = 0
        try {
          for await (const attachment of getAttachmentMessages(
            null,
            updatedToolUseContext,
            null,
            queuedAutonomyClaim.attachmentCommands,
            messagesForQuery.concat(assistantMessages, toolResults),
            querySource,
          )) {
            yield attachment
            toolResults.push(attachment)
            if (attachment.attachment.type === 'queued_command') {
              queuedAttachmentCount++
            } else if (attachment.attachment.type === 'poll_events') {
              pollEventsAttachmentCount++
            }
          }
        } catch (err) {
          if (isAbortError(err)) {
            const { QUERY_TURN_START_POLL_EVENTS_ABORTED } = await import(
              './cli/printControlExtras.js'
            )
            logForDebugging(QUERY_TURN_START_POLL_EVENTS_ABORTED)
          } else {
            logError(err)
          }
          pollEventsBuildAborted = true
        }

        // Remove only commands that were actually consumed as attachments.
        // Official 2.1.328 (`chunk@305854618.js @305650-306200`):
        // - If queued_command attachment building degraded to 0 for non-poll
        //   queued commands, leave them queued instead of silently dropping them.
        // - Only consume poll-events when poll_events attachment was emitted.
        // - Check abort/suspension BEFORE consuming from queue, and pass
        //   `{ reason: 'absorbed_mid_turn' }` to arm `requeueWindow`.
        const claimedCommandSet = new Set(claimedConsumedCommands)
        const nonPollToConsume = queuedAutonomyClaim.attachmentCommands.filter(
          cmd =>
            (cmd.mode === 'prompt' || cmd.mode === 'task-notification') &&
            !claimedCommandSet.has(cmd),
        )
        const pollToConsume = queuedAutonomyClaim.attachmentCommands.filter(
          cmd => cmd.mode === 'poll-event' && !claimedCommandSet.has(cmd),
        )
        const degradedNonPoll =
          nonPollToConsume.length > 0 && queuedAttachmentCount === 0
        if (degradedNonPoll) {
          logForDebugging(
            `[query] queued_command attachments degraded to 0 for ${nonPollToConsume.length} consumed command(s) — leaving them queued instead of dropping them`,
            { level: 'warn' },
          )
        }
        const consumedCommands = [
          ...(degradedNonPoll ? [] : nonPollToConsume),
          ...(!pollEventsBuildAborted && pollEventsAttachmentCount > 0
            ? pollToConsume
            : []),
        ]
        if (consumedCommands.length > 0) {
          if (
            updatedToolUseContext.abortController.signal.aborted ||
            isMidTurnFoldSuspended()
          ) {
            logForDebugging(
              `[query] abort/suspension during mid-turn absorption — leaving ${consumedCommands.length} command(s) queued`,
            )
          } else {
            consumeFromQueue(consumedCommands, {
              reason: 'absorbed_mid_turn',
            })
            const reminder = applyAbsorbedMidTurnEffects(consumedCommands)
            if (reminder) {
              yield reminder
              toolResults.push(reminder)
            }
            for (const cmd of consumedCommands) {
              if (cmd.uuid && !wasPutBack(cmd.uuid)) {
                consumedCommandUuids.push(cmd.uuid)
                notifyCommandLifecycle(cmd.uuid, 'started')
              }
            }
          }
        }
      } finally {
        unregisterFoldInFlight(foldInFlightCommands)
      }

      // Memory prefetch consume: only if settled and not already consumed on
      // an earlier iteration. If not settled yet, skip (zero-wait) and retry
      // next iteration — the prefetch gets as many chances as there are loop
      // iterations before the turn ends. readFileState (cumulative across
      // iterations) filters out memories the model already Read/Wrote/Edited
      // — including in earlier iterations, which the per-iteration
      // toolUseBlocks array would miss.
      if (
        pendingMemoryPrefetch &&
        pendingMemoryPrefetch.settledAt !== null &&
        pendingMemoryPrefetch.consumedOnIteration === -1
      ) {
        const memoryAttachments = filterDuplicateMemoryAttachments(
          await pendingMemoryPrefetch.promise,
          toolUseContext.readFileState,
        )
        for (const memAttachment of memoryAttachments) {
          const msg = createAttachmentMessage(memAttachment)
          yield msg
          toolResults.push(msg)
        }
        pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
      }

      // Inject prefetched skill discovery. collectSkillDiscoveryPrefetch emits
      // hidden_by_main_turn — true when the prefetch resolved before this point
      // (should be >98% at AKI@250ms / Haiku@573ms vs turn durations of 2-30s).
      if (skillPrefetch && pendingSkillPrefetch) {
        const skillAttachments =
          await skillPrefetch.collectSkillDiscoveryPrefetch(
            pendingSkillPrefetch,
          )
        for (const att of skillAttachments) {
          const msg = createAttachmentMessage(att)
          yield msg
          toolResults.push(msg)
        }
      }

      // Inject prefetched tool discovery.
      if (searchExtraToolsPrefetch && pendingToolPrefetch) {
        const toolAttachments =
          await searchExtraToolsPrefetch.collectSearchExtraToolsPrefetch(
            pendingToolPrefetch,
          )
        for (const att of toolAttachments) {
          const msg = createAttachmentMessage(att)
          yield msg
          toolResults.push(msg)
        }
      }

      // Instrumentation: Track file change attachments after they're added
      const fileChangeAttachmentCount = count(
        toolResults,
        tr =>
          tr.type === 'attachment' && tr.attachment.type === 'edited_text_file',
      )

      logEvent('tengu_query_after_attachments', {
        totalToolResultsCount: toolResults.length,
        fileChangeAttachmentCount,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      const toolUseContextWithQueryTracking = {
        ...updatedToolUseContext,
        queryTracking,
      }

      // Periodic task summary for `claude ps` — fires mid-turn so a
      // long-running agent still refreshes what it's working on. Gated
      // only on !agentId so every top-level conversation (REPL, SDK, HFI,
      // remote) generates summaries; subagents/forks don't.
      if (feature('BG_SESSIONS')) {
        if (
          !toolUseContext.agentId &&
          taskSummaryModule!.shouldGenerateTaskSummary()
        ) {
          taskSummaryModule!.maybeGenerateTaskSummary({
            systemPrompt,
            userContext,
            systemContext,
            toolUseContext,
            forkContextMessages: messagesForQuery.concat(
              assistantMessages,
              toolResults,
            ),
          })
        }
      }

      // Check if we've reached the max turns limit
      if (maxTurns && nextTurnCount > maxTurns) {
        yield createAttachmentMessage({
          type: 'max_turns_reached',
          maxTurns,
          turnCount: nextTurnCount,
        })
        yield* runTurnEndReactions(
          messagesForQuery.concat(assistantMessages, toolResults),
          toolUseContextWithQueryTracking,
          stopHookActive,
        )
        yield* leftoverDrainSpinnerModes()
        return { reason: 'max_turns', turnCount: nextTurnCount }
      }

      if (mcpEndTurnOverrideMessage) {
        yield mcpEndTurnOverrideMessage
        toolResults.push(mcpEndTurnOverrideMessage)
      }

      queryCheckpoint('query_recursive_call')
      const next: State = {
        messages: messagesForQuery.concat(assistantMessages, toolResults),
        toolUseContext: leftoverUnwrapStreamMode(
          toolUseContextWithQueryTracking,
        ),
        autoCompactTracking: tracking,
        turnCount: nextTurnCount,
        maxOutputTokensRecoveryCount: 0,
        serverErrorCutRetryCount: 0,
        hasAttemptedReactiveCompact: false,
        reactiveCompactDeeperPass: 'none',
        resumeIncompleteThinking: undefined,
        refusalRetrySpent,
        mcpEndTurnOverrideSpent:
          mcpEndTurnOverrideSpent || mcpEndTurnOverrideMessage !== undefined,
        pendingToolUseSummary: nextPendingToolUseSummary,
        maxOutputTokensOverride: undefined,
        stopHookActive,
        // Official 2.1.328 (`chunk@305854618.js @207056, @308470`): preserve
        // `stopHookBlockCount` when all tool calls in this turn were goal tools.
        stopHookBlockCount: isGoalToolsOnly(toolUseBlocks)
          ? stopHookBlockCount
          : 0,
        // Official 2.1.328 (`chunk@305854618.js @206945, @308470` `gl`):
        // reset `thinkingOnlyNudged` and `malformedToolUseRetryCount` on every `next_turn`.
        thinkingOnlyNudged: false,
        emptyCompletionResent: false,
        malformedToolUseRetryCount: 0,
        transition: { reason: 'next_turn' },
      }
      yield* leftoverDrainSpinnerModes()
      state = next
    } // while (true)
  } finally {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { leftoverIhrStampTurnEffort } =
        require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      leftoverIhrStampTurnEffort(params.toolUseContext.agentId, null, null)
    } catch {
      // isolation — optional
    }
  }
}

/** densable `yk` / `rAn.run` — ALS turnAttributionKey for j6 inherit. */
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage
  | ToolBridgeEvent
  | { type: 'spinner_mode'; mode: SpinnerMode },
  Terminal
> {
  // Official 2.1.326 (#333): release deferred Cowork cloud OpenTelemetry export
  // on the first turn (idle sessions that never run a turn emit nothing).
  if (!params.toolUseContext.agentId) {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { releaseDeferredTelemetryForFirstTurn } =
        require('./entrypoints/init.js') as typeof import('./entrypoints/init.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      releaseDeferredTelemetryForFirstTurn()
    } catch {
      // isolation — optional in unit tests
    }
  }
  // densable `cxr()` — flush pending $.ui.invalidate(...) before turn context loads.
  applyPendingUiInvalidations({
    'prompt.section': clearSystemPromptSections,
    'prompt.context': () => {
      getUserContext.cache.clear?.()
      getSystemContext.cache.clear?.()
    },
  })
  return yield* withTurnAttributionGenerator(queryBody(params))
}
