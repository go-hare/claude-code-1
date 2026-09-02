// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import { FallbackTriggeredError } from './services/api/withRetry.js'
import { randomUUID } from 'crypto'
import {
  calculateTokenWarningState,
  estimateMaxTurnGrowth,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
  type AutoCompactTrackingState,
} from './services/compact/autoCompact.js'
import { buildPostCompactMessages } from './services/compact/compact.js'
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
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isPromptTooLongMessage,
} from './services/api/errors.js'
import { logAntError, logForDebugging } from './utils/debug.js'
import {
  isRemoteCancelAbortReason,
  isShutdownAbortReason,
  shouldSuppressInterruptionMessage,
} from './utils/abortController.js'
import {
  createUserMessage,
  createUserInterruptionMessage,
  normalizeMessagesForAPI,
  createSystemMessage,
  createAssistantAPIErrorMessage,
  getMessagesAfterCompactBoundary,
  createToolUseSummaryMessage,
  createMicrocompactBoundaryMessage,
  stripSignatureBlocks,
} from './utils/messages.js'
import { generateToolUseSummary } from './services/toolUseSummary/toolUseSummaryGenerator.js'
import { prependUserContext, appendSystemContext } from './utils/api.js'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  getAttachmentMessages,
  startRelevantMemoryPrefetch,
} from './utils/attachments.js'
/* eslint-disable @typescript-eslint/no-require-imports */
const skillPrefetch = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('./services/skillSearch/prefetch.js') as typeof import('./services/skillSearch/prefetch.js'))
  : null
const searchExtraToolsPrefetch = feature('EXPERIMENTAL_SEARCH_EXTRA_TOOLS')
  ? (require('./services/searchExtraTools/prefetch.js') as typeof import('./services/searchExtraTools/prefetch.js'))
  : null
const _jobClassifier = feature('TEMPLATES')
  ? (require('./jobs/classifier.js') as typeof import('./jobs/classifier.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
import { resolveStopHookBlockCap } from './utils/residualMsEnvGates.js'
import { messagesEndWithSuccessfulTerminalMcpTool } from './utils/residualUiEnvGates.js'
import {
  enqueue,
  remove as removeFromQueue,
  getCommandsByMaxPriority,
  isSlashCommand,
} from './utils/messageQueueManager.js'
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
  doesMostRecentAssistantMessageExceed200k,
  finalContextTokensFromLastResponse,
  tokenCountWithEstimation,
} from './utils/tokens.js'
import { ESCALATED_MAX_TOKENS } from './utils/context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './services/analytics/growthbook.js'
import { SLEEP_TOOL_NAME } from '@claude-code/builtin-tools/tools/SleepTool/prompt.js'
import { executePostSamplingHooks } from './utils/hooks/postSamplingHooks.js'
import { executeStopFailureHooks } from './utils/hooks.js'
import type { QuerySource } from './constants/querySource.js'
import type { QueuedCommand } from './types/textInputTypes.js'
import { createDumpPromptsFetch } from './services/api/dumpPrompts.js'
import { StreamingToolExecutor } from './services/tools/StreamingToolExecutor.js'
import { queryCheckpoint } from './utils/queryProfiler.js'
import { runTools } from './services/tools/toolOrchestration.js'
import { applyToolResultBudget } from './utils/toolResultStorage.js'
import { recordContentReplacement } from './utils/sessionStorage.js'
import { handleStopHooks } from './query/stopHooks.js'
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
import {
  createCacheWarningMessage,
  getCacheThreshold,
  isCacheWarningEnabled,
  shouldShowCacheWarning,
} from './utils/cacheWarning.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js'))
  : null
const taskSummaryModule = feature('BG_SESSIONS')
  ? (require('./utils/taskSummary.js') as typeof import('./utils/taskSummary.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
) {
  for (const assistantMessage of assistantMessages) {
    // Extract all tool use blocks from this assistant message
    const toolUseBlocks = (
      Array.isArray(assistantMessage.message?.content)
        ? assistantMessage.message.content
        : []
    ).filter(
      (content: { type: string }) => content.type === 'tool_use',
    ) as ToolUseBlock[]

    // Emit an interruption message for each tool use
    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: errorMessage,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: errorMessage,
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
  }
}

/**
 * The rules of thinking are lengthy and fortuitous. They require plenty of thinking
 * of most long duration and deep meditation for a wizard to wrap one's noggin around.
 *
 * The rules follow:
 * 1. A message that contains a thinking or redacted_thinking block must be part of a query whose max_thinking_length > 0
 * 2. A thinking block may not be the last message in a block
 * 3. Thinking blocks must be preserved for the duration of an assistant trajectory (a single turn, or if that turn includes a tool_use block then also its subsequent tool_result and the following assistant message)
 *
 * Heed these rules well, young wizard. For they are the rules of thinking, and
 * the rules of thinking are the rules of the universe. If ye does not heed these
 * rules, ye will be punished with an entire day of debugging and hair pulling.
 */
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3

/**
 * Is this a max_output_tokens error message? If so, the streaming loop should
 * withhold it from SDK callers until we know whether the recovery loop can
 * continue. Yielding early leaks an intermediate error to SDK callers (e.g.
 * cowork/desktop) that terminate the session on any `error` field — the
 * recovery loop keeps running but nobody is listening.
 *
 * Mirrors reactiveCompact.isWithheldPromptTooLong.
 */
function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}

function getAutonomyTurnOutcome(params: {
  terminal?: Terminal
  thrownError?: unknown
}): AutonomyTurnOutcome {
  if (params.thrownError !== undefined) {
    return { type: 'failed', error: params.thrownError }
  }

  const terminal = params.terminal
  const reason = terminal?.reason
  switch (reason) {
    case 'completed':
      return { type: 'completed' }
    case undefined:
    case 'aborted_streaming':
    case 'aborted_tools':
      return { type: 'cancelled' }
    case 'model_error':
      return { type: 'failed', error: terminal.error }
    case 'api_error':
      return { type: 'failed', error: terminal.error ?? terminal.errorKind }
    default:
      return {
        type: 'failed',
        message: `query ended without successful completion: ${reason}`,
      }
  }
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
  /**
   * Official drain: when the dequeued turn carried stopHookActive (stop-hook
   * continuation / concurrent re-queue), seed the loop so nested stop hooks
   * see stop_hook_active=true. Undefined on normal keyboard turns.
   */
  stopHookActive?: boolean
  // API task_budget (output_config.task_budget, beta task-budgets-2026-03-13).
  // Distinct from the tokenBudget +500k auto-continue feature. `total` is the
  // budget for the whole agentic turn; `remaining` is computed per iteration
  // from cumulative API usage. See configureTaskBudgetParams in claude.ts.
  taskBudget?: { total: number }
  deps?: QueryDeps
}

// -- query loop state

// Mutable state carried between loop iterations
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  stopHookBlockCount: number
  turnCount: number
  // Why the previous iteration continued. Undefined on first iteration.
  // Lets tests assert recovery paths fired without inspecting message contents.
  transition: Continue | undefined
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
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

  // Attach trace to toolUseContext so tool execution can record observations
  const paramsWithTrace: QueryParams = langfuseTrace
    ? {
        ...params,
        toolUseContext: { ...params.toolUseContext, langfuseTrace },
      }
    : params

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
  // both generators). This gives the same asymmetric started-without-completed
  // signal as print.ts's drainCommandQueue when the turn fails.
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
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
  | ToolUseSummaryMessage,
  Terminal
> {
  // Immutable params — never reassigned during the query loop.
  const {
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    fallbackModel,
    querySource,
    maxTurns,
    skipCacheWrite,
  } = params
  const deps = params.deps ?? productionDeps()

  // Mutable cross-iteration state. The loop body destructures this at the top
  // of each iteration so reads stay bare-name (`messages`, `toolUseContext`).
  // Continue sites write `state = { ... }` instead of 9 separate assignments.
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
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
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

  // Official thinking-only nudge: one retry when end_turn has no visible text
  // and the turn was not a successful terminal-MCP tool result (C1u).
  // Loop-local like taskBudgetRemaining so continue sites stay untouched.
  let thinkingOnlyNudged = false

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

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Destructure state at the top of each iteration. toolUseContext alone
    // is reassigned within an iteration (queryTracking, messages updates);
    // the rest are read-only between continue sites.
    let { toolUseContext } = state
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
    } = state

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
      return { reason: 'background_requested' }
    }

    yield { type: 'stream_request_start' }

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

    // Strip thinking-block signatures proactively when the model has changed.
    // Signatures are bound to the API key + model — replaying a protected-thinking
    // block to a different model causes 400 errors. This covers /model switches
    // mid-session (login switches are handled in login.tsx).
    if (
      messagesForQuery.some(m => {
        if (m.type !== 'assistant') return false
        const content = m.message?.content
        if (!Array.isArray(content)) return false
        return (content as unknown[]).some(
          b =>
            typeof b === 'object' &&
            b !== null &&
            (b as Record<string, unknown>).type === 'thinking' &&
            (b as Record<string, unknown>).signature,
        )
      })
    ) {
      messagesForQuery = stripSignatureBlocks(messagesForQuery)
    }
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
      const replacements = toolUseContext?.contentReplacementState?.replacements
      if (replacements) {
        for (const id of microcompactResult.clearedToolUseIds) {
          replacements.delete(id)
        }
      }
    }
    // For cached microcompact (cache editing), defer boundary message until after
    // the API response so we can use actual cache_deleted_input_tokens.
    // Gated behind feature() so the string is eliminated from external builds.
    const pendingCacheEdits = feature('CACHED_MICROCOMPACT')
      ? microcompactResult.compactionInfo?.pendingCacheEdits
      : undefined
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

    const fullSystemPrompt = asSystemPrompt(
      appendSystemContext(systemPrompt, systemContext),
    )

    queryCheckpoint('query_autocompact_start')
    const { compactionResult, consecutiveFailures } = await deps.autocompact(
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
    queryCheckpoint('query_autocompact_end')

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
          (taskBudgetRemaining ?? params.taskBudget.total) - preCompactContext,
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
      }

      const postCompactMessages = buildPostCompactMessages(compactionResult)

      for (const message of postCompactMessages) {
        yield message
      }

      // Continue on with the current query call using the post compact messages
      messagesForQuery = postCompactMessages
    } else if (consecutiveFailures !== undefined) {
      // Autocompact failed — propagate failure count so the circuit breaker
      // can stop retrying on the next iteration.
      tracking = {
        ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
        consecutiveFailures,
      }
    }

    //TODO: no need to set toolUseContext.messages during set-up since it is updated here
    toolUseContext = {
      ...toolUseContext,
      messages: messagesForQuery,
    }

    const assistantMessages: AssistantMessage[] = []
    const toolResults: (UserMessage | AttachmentMessage)[] = []
    // @see https://docs.claude.com/en/docs/build-with-claude/tool-use
    // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly.
    // Set during streaming whenever a tool_use block arrives — the sole
    // loop-exit signal. If false after streaming, we're done (modulo stop-hook retry).
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    queryCheckpoint('query_setup_start')
    const useStreamingToolExecution = config.gates.streamingToolExecution
    let streamingToolExecutor = useStreamingToolExecution
      ? new StreamingToolExecutor(
          toolUseContext.options.tools,
          canUseTool,
          toolUseContext,
        )
      : null

    const appState = toolUseContext.getAppState()
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
    const permissionMode = layeredPermissionContext.mode
    let currentModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel: layeredMainLoopModel,
      exceeds200kTokens:
        permissionMode === 'plan' &&
        doesMostRecentAssistantMessageExceed200k(messagesForQuery),
    })

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
          return { reason: 'aborted_streaming' }
        }
        if (flow.shouldAbort) {
          yield createAssistantAPIErrorMessage({
            content:
              flow.errorMessage ??
              'Your model policy only allows Fable 5, which requires usage credits — /model to set it up',
            error: 'billing_error',
          })
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
          toolUseContext = {
            ...toolUseContext,
            options: {
              ...toolUseContext.options,
              mainLoopModel: flow.fallbackModel,
            },
          }
        }
        // Official purchase-intent densable after consent — ExtraUsageDialog
        // 3DS remains denser; open_purchase surfaces /usage-credits hint.
        if (
          flow.choice === 'consent' &&
          flow.purchaseIntent?.next === 'open_purchase'
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
        return { reason: 'blocking_limit' }
      }
    }

    // Predictive autocompact: estimate if this turn's growth will push
    // us past the context window. Uses effectiveContextWindow directly
    // (without the autocompact buffer) to avoid double-reserving with
    // getAutoCompactThreshold which already subtracts buffer.
    if (!compactionResult && isAutoCompactEnabled()) {
      const model = layeredMainLoopModel
      const currentTokens =
        tokenCountWithEstimation(messagesForQuery) - snipTokensFreed
      const estimatedGrowth = estimateMaxTurnGrowth(model)
      const predictiveThreshold =
        getEffectiveContextWindowSize(model) - estimatedGrowth
      if (currentTokens > predictiveThreshold) {
        const predictiveResult = await deps.autocompact(
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
        if (predictiveResult.compactionResult) {
          messagesForQuery = buildPostCompactMessages(
            predictiveResult.compactionResult,
          )
          snipTokensFreed = 0
          tracking = tracking
            ? {
                ...tracking,
                compacted: true,
                consecutiveFailures: predictiveResult.consecutiveFailures ?? 0,
              }
            : tracking
        }
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
    try {
      while (attemptWithFallback) {
        attemptWithFallback = false
        try {
          let streamingFallbackOccured = false
          // densable Ji — media-size (EFi) withheld AND buffered; flushed on
          // next !Gm only. Stream end does not drain leftover Ji.
          const withheldMediaBuffer: Array<
            StreamEvent | AssistantMessage | SystemAPIErrorMessage
          > = []
          queryCheckpoint('query_api_streaming_start')
          // densable: messages = kRd(wr!==void 0 ? [...pe,wr] : pe, n)
          const callMessages =
            partialResponseMetaMessage !== undefined
              ? [...messagesForQuery, partialResponseMetaMessage]
              : messagesForQuery
          // consume credit stamp for this attempt only (re-arm on next hop)
          const creditCodeForAttempt = pendingFallbackCreditCode
          const creditMintModelForAttempt = pendingFallbackCreditMintModel
          // densable clears kr after pass; re-set if hop yields new token
          pendingFallbackCreditCode = undefined
          pendingFallbackCreditMintModel = undefined
          for await (const message of deps.callModel({
            messages: prependUserContext(callMessages, userContext),
            systemPrompt: fullSystemPrompt,
            thinkingConfig: layeredThinkingConfig,
            tools: toolUseContext.options.tools,
            signal: toolUseContext.abortController.signal,
            options: {
              async getToolPermissionContext() {
                // densable bn — sticky layers on each permission re-read
                return getToolPermissionContextFromLayers(toolUseContext)
              },
              model: currentModel,
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
                  } =
                    require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                  if (!isRefusalFallbackEnabled()) return {}
                  const isMainThread = toolUseContext.agentId === undefined
                  // densable lkd: serverLane via dkd() (vK && $c("switchModelsOnFlag", true))
                  const arm = planRefusalFallbackArm({
                    currentModel,
                    alreadyUsed: false,
                    declined: false,
                    requestDialog: toolUseContext.requestDialog,
                    isMainThread,
                    switchModelsOnFlag: getSwitchModelsOnFlag(),
                    resolveArmedFallbackModel: () => {
                      // densable y$c arm → _$c: when entitlement overlay is
                      // unavailable and target is opus-5, substitute opus-4-8.
                      const raw =
                        fallbackModel && fallbackModel !== currentModel
                          ? fallbackModel
                          : undefined
                      if (raw === undefined) return undefined
                      try {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const { applyEntitlementBlindFallbackTarget } =
                          require('./utils/model/entitlementOverlay.js') as typeof import('./utils/model/entitlementOverlay.js')
                        return applyEntitlementBlindFallbackTarget(raw)
                      } catch {
                        return raw
                      }
                    },
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
                  }
                } catch {
                  return {}
                }
              })(),
              onStreamingFallback: () => {
                streamingFallbackOccured = true
              },
              querySource,
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
              queryTracking,
              effortValue: layeredEffortValue,
              advisorModel: appState.advisorModel,
              skipCacheWrite,
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
          })) {
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
                  discardedMessages: assistantMessages as unknown as readonly {
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
                          const { buildPartialResponseSalvageMetaContent } =
                            require('./utils/refusalFallback.js') as typeof import('./utils/refusalFallback.js')
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          const { createUserMessage } =
                            require('./utils/messages.js') as typeof import('./utils/messages.js')
                          partialResponseMetaMessage = createUserMessage({
                            content: buildPartialResponseSalvageMetaContent(
                              beginPlan.event.salvageText,
                            ),
                            isMeta: true,
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
              // Do not push into assistantMessages; stream will throw
              // FallbackTriggeredError for the actual model switch retry.
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

              // Discard pending results from the failed streaming attempt and create
              // a fresh executor. This prevents orphan tool_results (with old tool_use_ids)
              // from being yielded after the fallback response arrives.
              if (streamingToolExecutor) {
                streamingToolExecutor.discard()
                // densable XId onReset → ARd(U.options,V) — drop mid-stream stamps
                clearActiveMcpStamps(toolUseContext.options, attributeMcpUsage)
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
                    const originalInput = block.input as Record<string, unknown>
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
              }
            }
            // Withhold recoverable errors (prompt-too-long, media-size,
            // max-output-tokens) until we know whether recovery (collapse
            // drain / reactive compact / truncation retry) can succeed.
            // Still pushed to assistantMessages so recovery finds them.
            // Media (EFi) is also buffered in Ji and replayed on the next
            // non-withheld message; leftover Ji is not flushed at stream end.
            // Either subsystem's withhold is sufficient — they're
            // independent so turning one off doesn't break the other's
            // recovery path.
            //
            // feature() only works in if/ternary conditions (bun:bundle
            // tree-shaking constraint), so the collapse check is nested
            // rather than composed.
            // densable Gm/Ji: ztm/EFi/Jsm withhold; only EFi pushes Co.
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
            if (reactiveCompact?.isWithheldPromptTooLong(message as Message)) {
              withholdPtl = true
            }
            const { withheld, replay: withheldMediaReplay } =
              applyStreamMediaReplay(withheldMediaBuffer, message, {
                ptl: withholdPtl,
                media:
                  mediaRecoveryEnabled &&
                  reactiveCompact?.isWithheldMediaSizeError(
                    message as Message,
                  ) === true,
                maxOutputTokens: isWithheldMaxOutputTokens(message),
              })
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

            if (
              streamingToolExecutor &&
              !toolUseContext.abortController.signal.aborted
            ) {
              for (const result of streamingToolExecutor.getCompletedResults()) {
                if (result.message) {
                  yield result.message
                  // densable 2.1.228 St: keep tool attachments (e.g. skill
                  // deferred_tools_delta) in toolResults for mid-turn scan.
                  accumulateToolResultForMidTurn(
                    result.message,
                    toolResults,
                    toolUseContext.options.refreshTools?.() ??
                      toolUseContext.options.tools,
                    toolUseContext.options.mainLoopModel,
                  )
                }
              }
            }
          }
          queryCheckpoint('query_api_streaming_end')

          // Yield deferred microcompact boundary message using actual API-reported
          // token deletion count instead of client-side estimates.
          // Entire block gated behind feature() so the excluded string
          // is eliminated from external builds.
          if (feature('CACHED_MICROCOMPACT') && pendingCacheEdits) {
            const lastAssistant = assistantMessages.at(-1)
            // The API field is cumulative/sticky across requests, so we
            // subtract the baseline captured before this request to get the delta.
            const usage = lastAssistant?.message.usage
            const cumulativeDeleted = usage
              ? ((usage as unknown as Record<string, number>)
                  .cache_deleted_input_tokens ?? 0)
              : 0
            const deletedTokens = Math.max(
              0,
              cumulativeDeleted - pendingCacheEdits.baselineCacheDeletedTokens,
            )
            if (deletedTokens > 0) {
              yield createMicrocompactBoundaryMessage(
                pendingCacheEdits.trigger,
                0,
                deletedTokens,
                pendingCacheEdits.deletedToolIds,
                [],
              )
            }
          }
        } catch (innerError) {
          if (innerError instanceof FallbackTriggeredError && fallbackModel) {
            // Fallback was triggered - switch model and retry
            // Prefer the error's fallback model (refusal path may route via g_i).
            const switchTo =
              innerError.fallbackModel &&
              typeof innerError.fallbackModel === 'string'
                ? innerError.fallbackModel
                : fallbackModel
            currentModel = switchTo
            attemptWithFallback = true

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
                setLatch: setRefusalFallbackModelLatch,
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

            // Discard pending results from the failed attempt and create a
            // fresh executor. This prevents orphan tool_results (with old
            // tool_use_ids) from leaking into the retry.
            if (streamingToolExecutor) {
              streamingToolExecutor.discard()
              // densable XId onReset → ARd(U.options,V)
              clearActiveMcpStamps(toolUseContext.options, attributeMcpUsage)
              streamingToolExecutor = new StreamingToolExecutor(
                toolUseContext.options.tools,
                canUseTool,
                toolUseContext,
              )
            }

            // Update tool use context with new model
            toolUseContext.options.mainLoopModel = switchTo

            // Thinking signatures are model-bound: replaying a protected-thinking
            // block (e.g. capybara) to an unprotected fallback (e.g. opus) 400s.
            // Strip before retry so the fallback model gets clean history.
            if (process.env.USER_TYPE === 'ant') {
              messagesForQuery = stripSignatureBlocks(messagesForQuery)
            }

            // Log the fallback event
            logEvent('tengu_model_fallback_triggered', {
              original_model:
                innerError.originalModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_model:
                switchTo as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              entrypoint:
                'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })

            // Official densable (2.1.x): reason discriminates Host stream.
            // - model_not_found → system/model_fallback (permanent switch)
            // - overloaded / default → warning only (capacity 529 path)
            const fallbackReason =
              'reason' in innerError &&
              typeof (innerError as { reason?: unknown }).reason === 'string'
                ? (innerError as { reason: string }).reason
                : 'overloaded'
            if (fallbackReason === 'model_not_found') {
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
              // Official yields system/model_fallback once; QueryEngine maps
              // camelCase → snake_case Host wire. Do not also
              // emitModelFallbackSdk (would double on stream-json drain).
              yield {
                type: 'system' as const,
                subtype: 'model_fallback' as const,
                content: `Switched to ${renderModelName(switchTo)} because ${renderModelName(innerError.originalModel)} is not available`,
                level: 'warning' as const,
                trigger: 'model_not_found' as const,
                originalModel: innerError.originalModel,
                fallbackModel: switchTo,
                isMeta: false as const,
                timestamp: new Date().toISOString(),
                uuid: randomUUID(),
              }
            } else {
              yield createSystemMessage(
                `Switched to ${renderModelName(switchTo)} due to high demand for ${renderModelName(innerError.originalModel)}`,
                'warning',
              )
            }

            continue
          }
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
      return { reason: 'model_error', error }
    }

    // 检测缓存命中率并在需要时 yield 警告消息
    // 必须在 executePostSamplingHooks 之前执行，确保警告消息在工具结果之前显示
    if (
      assistantMessages.length > 0 &&
      !toolUseContext.options.isNonInteractiveSession
    ) {
      const lastAssistant = assistantMessages.at(-1)
      const usage = lastAssistant?.message?.usage as
        | {
            input_tokens: number
            cache_creation_input_tokens: number
            cache_read_input_tokens: number
          }
        | undefined
      if (usage && isCacheWarningEnabled()) {
        const warningInfo = shouldShowCacheWarning(
          usage,
          querySource,
          getCacheThreshold(),
        )
        if (warningInfo) {
          yield createCacheWarningMessage(warningInfo)
        }
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
    // When using streamingToolExecutor, we must consume getRemainingResults() so the
    // executor can generate synthetic tool_result blocks for queued/in-progress tools.
    // Without this, tool_use blocks would lack matching tool_result blocks.
    if (toolUseContext.abortController.signal.aborted) {
      // densable 2.1.236 #27: remote-cancel (print/SDK SIGTERM) skips
      // Interrupted / REJECT synthetics on both streaming and pairing arms.
      if (
        !isRemoteCancelAbortReason(toolUseContext.abortController.signal.reason)
      ) {
        if (streamingToolExecutor) {
          // Consume remaining results - executor generates synthetic tool_results for
          // aborted tools since it checks the abort signal in executeTool()
          for await (const update of streamingToolExecutor.getRemainingResults()) {
            if (update.message) {
              yield update.message
            }
          }
        } else {
          yield* yieldMissingToolResultBlocks(
            assistantMessages,
            'Interrupted by user',
          )
        }
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
      return { reason: 'aborted_streaming' }
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
      const isWithheld413 =
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
              toolUseContext,
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              hasAttemptedReactiveCompact,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              transition: {
                reason: 'collapse_drain_retry',
                committed: drained.committed,
              },
            }
            state = next
            continue
          }
        }
      }
      if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
        const { result: compacted, failure: compactFailure } =
          await reactiveCompact.tryReactiveCompact({
            hasAttempted: hasAttemptedReactiveCompact,
            querySource,
            aborted: toolUseContext.abortController.signal.aborted,
            messages: messagesForQuery,
            cacheSafeParams: {
              systemPrompt,
              userContext,
              systemContext,
              toolUseContext,
              forkContextMessages: messagesForQuery,
            },
          })

        if (compacted) {
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
          for (const msg of postCompactMessages) {
            yield msg
          }
          const next: State = {
            messages: postCompactMessages,
            toolUseContext,
            autoCompactTracking: undefined,
            maxOutputTokensRecoveryCount,
            hasAttemptedReactiveCompact: true,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            stopHookBlockCount: 0,
            turnCount,
            transition: { reason: 'reactive_compact_retry' },
          }
          state = next
          continue
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
        return { reason: isWithheldMedia ? 'image_error' : 'prompt_too_long' }
      } else if (feature('CONTEXT_COLLAPSE') && isWithheld413 && lastMessage) {
        // reactiveCompact compiled out but contextCollapse withheld and
        // couldn't recover (staged queue empty/stale). Surface. Same
        // early-return rationale — don't fall through to stop hooks.
        yield lastMessage
        void executeStopFailureHooks(lastMessage, toolUseContext)
        return { reason: 'prompt_too_long' }
      }

      // Check for max_output_tokens and inject recovery message. The error
      // was withheld from the stream above; only surface it if recovery
      // exhausts.
      if (isWithheldMaxOutputTokens(lastMessage)) {
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
        let hasMaxOutputTokensEnv = !!process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
        try {
          const { resolveMaxOutputTokensOverride } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('./utils/residualFinalEnvGates.js') as typeof import('./utils/residualFinalEnvGates.js')
          hasMaxOutputTokensEnv = resolveMaxOutputTokensOverride() !== null
        } catch {
          // keep raw env fallback
        }
        if (
          capEnabled &&
          maxOutputTokensOverride === undefined &&
          !hasMaxOutputTokensEnv
        ) {
          logEvent('tengu_max_tokens_escalate', {
            escalatedTo: ESCALATED_MAX_TOKENS,
          })
          const next: State = {
            messages: messagesForQuery,
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: ESCALATED_MAX_TOKENS,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            stopHookBlockCount: 0,
            turnCount,
            transition: { reason: 'max_output_tokens_escalate' },
          }
          state = next
          continue
        }

        if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          const recoveryMessage = createUserMessage({
            content:
              `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
              `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`,
            isMeta: true,
          })

          const next: State = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              recoveryMessage,
            ],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            stopHookBlockCount: 0,
            turnCount,
            transition: {
              reason: 'max_output_tokens_recovery',
              attempt: maxOutputTokensRecoveryCount + 1,
            },
          }
          state = next
          continue
        }

        // Recovery exhausted — surface the withheld error now.
        yield lastMessage
      }

      // Skip stop hooks when the last message is an API error (rate limit,
      // prompt-too-long, auth failure, etc.). The model never produced a
      // real response — hooks evaluating it create a death spiral:
      // error → hook blocking → retry → error → …
      if (lastMessage?.isApiErrorMessage) {
        void executeStopFailureHooks(lastMessage, toolUseContext)
        // densable 2.1.234: {reason:"api_error",errorKind:Hr.error,isTransient:K1a(Hr)}
        return {
          reason: 'api_error',
          errorKind:
            typeof lastMessage.error === 'string' ? lastMessage.error : null,
          isTransient: isTransientApiErrorMessage({
            apiErrorIsTransient: (
              lastMessage as { apiErrorIsTransient?: boolean }
            ).apiErrorIsTransient,
            error:
              typeof lastMessage.error === 'string' ? lastMessage.error : null,
          }),
          error: lastMessage.error ?? lastMessage.apiError ?? 'api_error',
        }
      }

      // Official thinking-only densable: when the model ends the turn with no
      // visible text (and not after a successful terminal-MCP tool), nudge once.
      // Skip for compact / internal query sources that are not user-facing.
      if (
        lastMessage?.type === 'assistant' &&
        !lastMessage.isApiErrorMessage &&
        querySource !== 'compact' &&
        querySource !== 'prompt_suggestion' &&
        querySource !== 'away_summary' &&
        querySource !== 'agent_summary' &&
        querySource !== 'memdir_aki_extract' &&
        !messagesEndWithSuccessfulTerminalMcpTool(messagesForQuery) &&
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
        const stopReason = lastMessage.message?.stop_reason
        // Official: only end_turn | stop_sequence (not tool_use / max_tokens).
        if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
          if (!thinkingOnlyNudged) {
            thinkingOnlyNudged = true
            logForDebugging('query_thinking_only_response: nudged')
            const nudgeMessage = createUserMessage({
              content:
                '[Your previous response had no visible output. Please continue and produce a user-visible response.]',
              isMeta: true,
            })
            state = {
              messages: [...messagesForQuery, nudgeMessage],
              toolUseContext,
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              hasAttemptedReactiveCompact,
              maxOutputTokensOverride: undefined,
              pendingToolUseSummary: undefined,
              stopHookActive: undefined,
              stopHookBlockCount: 0,
              turnCount,
              transition: { reason: 'thinking_only_retry' },
            }
            continue
          }
          logForDebugging('query_thinking_only_response: nudge_exhausted')
        }
      } else if (thinkingOnlyNudged) {
        // Successful visible turn after a nudge — clear for subsequent turns.
        thinkingOnlyNudged = false
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

      if (stopHookResult.preventContinuation) {
        return { reason: 'stop_hook_prevented' }
      }

      if (stopHookResult.blockingErrors.length > 0) {
        const MAX_CONSECUTIVE_STOP_HOOK_BLOCKS = resolveStopHookBlockCap()
        if (stopHookBlockCount + 1 >= MAX_CONSECUTIVE_STOP_HOOK_BLOCKS) {
          yield createSystemMessage(
            `Stop hook blocked ${MAX_CONSECUTIVE_STOP_HOOK_BLOCKS} consecutive times. Ending turn to prevent infinite loop.`,
            'warning',
          )
          return { reason: 'stop_hook_prevented' }
        }
        const next: State = {
          messages: [
            ...messagesForQuery,
            ...assistantMessages,
            ...stopHookResult.blockingErrors,
          ],
          toolUseContext,
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
          stopHookBlockCount: stopHookBlockCount + 1,
          turnCount,
          transition: { reason: 'stop_hook_blocking' },
        }
        state = next
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
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            hasAttemptedReactiveCompact: false,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            stopHookBlockCount: 0,
            turnCount,
            transition: { reason: 'token_budget_continuation' },
          }
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

      return { reason: 'completed' }
    }

    let shouldPreventContinuation = false
    let toolWasDeferred = false
    let updatedToolUseContext = toolUseContext

    queryCheckpoint('query_tool_execution_start')

    if (streamingToolExecutor) {
      logEvent('tengu_streaming_tool_execution_used', {
        tool_count: toolUseBlocks.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })
    } else {
      logEvent('tengu_streaming_tool_execution_not_used', {
        tool_count: toolUseBlocks.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })
    }

    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message

        if (update.message.type === 'attachment') {
          if (update.message.attachment!.type === 'hook_stopped_continuation') {
            shouldPreventContinuation = true
          } else if (update.message.attachment!.type === 'hook_deferred_tool') {
            toolWasDeferred = true
          }
        }

        // densable 2.1.228 St (vs 227 only read_truncation_notice): push all
        // tool attachments raw so skill deferred_tools_delta is visible to
        // mid-turn getAttachmentMessages history scan (#11 double-send fix).
        accumulateToolResultForMidTurn(
          update.message,
          toolResults,
          updatedToolUseContext.options.refreshTools?.() ??
            updatedToolUseContext.options.tools,
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
        isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
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
      // Check maxTurns before returning when aborted
      const nextTurnCountOnAbort = turnCount + 1
      if (maxTurns && nextTurnCountOnAbort > maxTurns) {
        yield createAttachmentMessage({
          type: 'max_turns_reached',
          maxTurns,
          turnCount: nextTurnCountOnAbort,
        })
      }
      return { reason: 'aborted_tools' }
    }

    // densable: toolWasDeferred before shouldPreventContinuation so a turn
    // with both attachments reports tool_deferred, not hook_stopped.
    if (toolWasDeferred) {
      return { reason: 'tool_deferred' }
    }
    if (shouldPreventContinuation) {
      return { reason: 'hook_stopped' }
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
    const queuedCommandsSnapshot = getCommandsByMaxPriority(
      sleepRan ? 'later' : 'next',
    ).filter(cmd => {
      if (isSlashCommand(cmd)) return false
      if (isMainThread) return isMainThreadQueuedCommand(cmd)
      // Subagents only drain task-notifications addressed to them — never
      // user prompts, even if someone stamps an agentId on one.
      return cmd.mode === 'task-notification' && cmd.agentId === currentAgentId
    })
    const queuedAutonomyClaim = await claimConsumableQueuedAutonomyCommands(
      queuedCommandsSnapshot,
    )
    if (queuedAutonomyClaim.staleCommands.length > 0) {
      removeFromQueue(queuedAutonomyClaim.staleCommands)
    }

    const claimedConsumedCommands = queuedAutonomyClaim.claimedCommands.filter(
      cmd => cmd.mode === 'prompt' || cmd.mode === 'task-notification',
    )
    if (claimedConsumedCommands.length > 0) {
      consumedAutonomyCommands.push(...claimedConsumedCommands)
      for (const cmd of claimedConsumedCommands) {
        if (cmd.uuid) {
          consumedCommandUuids.push(cmd.uuid)
          notifyCommandLifecycle(cmd.uuid, 'started')
        }
      }
      removeFromQueue(claimedConsumedCommands)
    }

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
        await skillPrefetch.collectSkillDiscoveryPrefetch(pendingSkillPrefetch)
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

    // Remove only commands that were actually consumed as attachments.
    // Prompt and task-notification commands are converted to attachments above.
    const claimedCommandSet = new Set(claimedConsumedCommands)
    const consumedCommands = queuedAutonomyClaim.attachmentCommands.filter(
      cmd =>
        (cmd.mode === 'prompt' || cmd.mode === 'task-notification') &&
        !claimedCommandSet.has(cmd),
    )
    if (consumedCommands.length > 0) {
      for (const cmd of consumedCommands) {
        if (cmd.uuid) {
          consumedCommandUuids.push(cmd.uuid)
          notifyCommandLifecycle(cmd.uuid, 'started')
        }
      }
      removeFromQueue(consumedCommands)
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

    // Refresh tools between turns so newly-connected MCP servers become available
    if (updatedToolUseContext.options.refreshTools) {
      const refreshedTools = updatedToolUseContext.options.refreshTools()
      if (refreshedTools !== updatedToolUseContext.options.tools) {
        updatedToolUseContext = {
          ...updatedToolUseContext,
          options: {
            ...updatedToolUseContext.options,
            tools: refreshedTools,
          },
        }
      }
    }

    const toolUseContextWithQueryTracking = {
      ...updatedToolUseContext,
      queryTracking,
    }

    // Each time we have tool results and are about to recurse, that's a turn
    const nextTurnCount = turnCount + 1

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
      return { reason: 'max_turns', turnCount: nextTurnCount }
    }

    queryCheckpoint('query_recursive_call')
    const next: State = {
      messages: messagesForQuery.concat(assistantMessages, toolResults),
      toolUseContext: toolUseContextWithQueryTracking,
      autoCompactTracking: tracking,
      turnCount: nextTurnCount,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: nextPendingToolUseSummary,
      maxOutputTokensOverride: undefined,
      stopHookActive,
      stopHookBlockCount: 0,
      transition: { reason: 'next_turn' },
    }
    state = next
  } // while (true)
}
