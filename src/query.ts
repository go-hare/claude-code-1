// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { feature } from 'bun:bundle'
import { randomUUID } from 'crypto'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  getCurrentTurnTokenBudget,
  getPromptRenderEpoch,
  getSessionId,
  getTurnOutputTokens,
  incrementBudgetContinuationCount,
} from './bootstrap/state.js'
import type { SpinnerMode } from './components/Spinner/types.js'
import { clearSystemPromptSections } from './constants/systemPromptSections.js'
import { getSystemContext, getUserContext } from './context.js'
import { accumulateToolResultForMidTurn } from './query/accumulateToolResultForMidTurn.js'
import {
  executeReactiveCompactAttempt,
  runPreApiMessagePrep,
  runProactiveCompactionPhase,
} from './query/compactBridge.js'
import { buildQueryConfig } from './query/config.js'
import { productionDeps } from './query/deps.js'
import { endTurnSourceFromToolResult } from './query/endTurnFromToolResult.js'
import {
  announceOutputLimitRecovery,
  assistantTextHasLeakedInvoke,
  getAutonomyTurnOutcome,
  hasBriefRepliedInTranscript,
  isRequestEligibleForEmptyCompletionResend,
  isTruncatedAfterOutputRecovery,
  isWithheldMaxOutputTokens,
  LEAKED_INVOKE_RE,
  MALFORMED_TOOL_USE_EXHAUSTED_TEXT,
  MALFORMED_TOOL_USE_RETRY_PROMPT,
  type MalformedToolUseRetryAction,
  malformedToolUseRetryAction,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
  maybeHandbackBounce,
  maybeSkillInlineCommandHandoffNotRun,
  querySourceFamilyOf,
  THINKING_ONLY_RETRY_PROMPT,
  truncatedRecoveryCopy,
} from './query/queryHelpers.js'
import type {
  AmberMoleskinEntry,
  AmberMoleskinTable,
  QueryLoopEvent,
  QueryParams,
  State,
} from './query/queryTypes.js'
import {
  evaluateStopHookOutcome,
  handleAbortedToolsExit,
  handleSafetyMonitorBlockedTurn,
  handleStreamingAbort,
  planTruncatedCutRetry,
  prepareSameModelRefusalRetry,
  waitForTruncatedCutRetry,
} from './query/recoveryTransitions.js'
import { handleStopHooks, runTurnEndReactions } from './query/stopHooks.js'
import { runStreamingApiAttemptWithFallbacks } from './query/streamAndFallback.js'
import { checkTokenBudget, createBudgetTracker } from './query/tokenBudget.js'
import {
  drainMidTurnQueuedCommandsAndAttachments,
  handleMcpEndTurnResolution,
  refreshToolsAndMcpClientsMidTurn,
  runPostToolBatchHookPass,
  startToolUseSummaryGeneration,
} from './query/toolRoundHelpers.js'
import type { Terminal } from './query/transitions.js'
import {
  bindPluginDevModsForIteration,
  buildPropagatedToolUseOptions,
  canResumeIncompleteThinking,
  clearNativePerformanceBuffers,
  drainTurnStartPollEvents,
  getPrecomputeArmThreshold,
  getScalarPrecomputeBufferFraction,
  isGoalToolsOnly,
  isSafetyMonitorBlockedMessage,
  isSameModelRefusalMessage,
  isSameModelRefusalRetryArmed,
  MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT,
  OS,
  parseAmberMoleskinTable,
  reconcileCarriedEffortLatch,
  REOPEN_BLOCK_RECOVERY_PROMPT,
  resolveLivePrecomputeBufferFraction,
  resolvePrecomputeBufferFraction,
  runFableOverageConsentGate,
  SAME_MODEL_REFUSAL_RETRY_INTERRUPTED_PROMPT,
  SAME_MODEL_REFUSAL_RETRY_PROMPT,
  selectMaxOutputTokensRecoveryPrompt,
  selectPollEventChunk,
  setupMainSessionObserverAndTap,
  TOOL_CALL_CUT_RECOVERY_PROMPT,
} from './query/turnHelpers.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './services/analytics/growthbook.js'
import { createDumpPromptsFetch } from './services/api/dumpPrompts.js'
import {
  isPromptTooLongMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from './services/api/errors.js'
import {
  armAutoCompactAfterTurn,
  calculateTokenWarningState,
  isAutoCompactAfterTurnEnabled,
  isAutoCompactEnabled,
} from './services/compact/autoCompact.js'
import {
  emitPromptAsFileNotice,
  trySaveOversizedPromptAsFile,
} from './services/compact/promptAsFile.js'
import { isTransientApiErrorMessage } from './services/goal/goalUnrecoverableClear.js'
import {
  createTrace,
  endTrace,
  flushLangfuse,
  isLangfuseEnabled,
} from './services/langfuse/index.js'
import { StreamingToolExecutor } from './services/tools/StreamingToolExecutor.js'
import { isToolBridgeEvent } from './services/tools/toolExecution.js'
import type { ToolUseContext } from './Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  UserMessage,
} from './types/message.js'
import type { QueuedCommand } from './types/textInputTypes.js'
import { appendSystemContext } from './utils/api.js'
import { count } from './utils/array.js'
import {
  createAttachmentMessage,
  startRelevantMemoryPrefetch,
} from './utils/attachments.js'
import { finalizeAutonomyCommandsForTurn } from './utils/autonomyQueueLifecycle.js'
import { notifyCommandLifecycle } from './utils/commandLifecycle.js'
import { ESCALATED_MAX_TOKENS } from './utils/context.js'
import { logForDebugging } from './utils/debug.js'
import { headlessProfilerCheckpoint } from './utils/headlessProfiler.js'
import { executeStopFailureHooks } from './utils/hooks.js'
import { executePostSamplingHooks } from './utils/hooks/postSamplingHooks.js'
import { logError } from './utils/log.js'
import {
  bindMainThreadTurn,
  getMainThreadTurn,
  releaseMainThreadTurn,
} from './utils/mainThreadTurn.js'
import {
  enqueue,
  settleTaken,
  startRequeueWindow,
  wasPutBack,
} from './utils/messageQueueManager.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  getMessagesAfterCompactBoundary,
  isHumanLikeOrigin,
  isUnparsedToolInput,
} from './utils/messages.js'
import { getRuntimeMainLoopModel } from './utils/model/model.js'
import {
  isSmallerContextWindow,
  resolveModelFacts,
} from './utils/model/modelFacts.js'
import { getAPIProvider } from './utils/model/providers.js'
import { applyPendingUiInvalidations } from './utils/plugins/functionHooksModules.js'
import { applyPluginToolListFilter } from './utils/plugins/pluginToolList.js'
import { queryCheckpoint } from './utils/queryProfiler.js'
import { getBootstrapSession } from './utils/sessionRoot.js'
import type { Precompute } from './utils/sessionSlots.js'
import { asSystemPrompt } from './utils/systemPromptType.js'
import {
  doesMostRecentAssistantMessageExceed200k,
  tokenCountWithEstimation,
} from './utils/tokens.js'
import { withTurnAttributionGenerator } from './utils/turnAttribution.js'
import { messagesEndWithSuccessfulTerminalMcpTool } from './utils/residualUiEnvGates.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('./services/compact/reactiveCompact.js') as typeof import('./services/compact/reactiveCompact.js'))
  : null
const contextCollapse = feature('CONTEXT_COLLAPSE')
  ? (require('./services/contextCollapse/index.js') as typeof import('./services/contextCollapse/index.js'))
  : null
const skillPrefetch = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('./services/skillSearch/prefetch.js') as typeof import('./services/skillSearch/prefetch.js'))
  : null
const searchExtraToolsPrefetch = feature('EXPERIMENTAL_SEARCH_EXTRA_TOOLS')
  ? (require('./services/searchExtraTools/prefetch.js') as typeof import('./services/searchExtraTools/prefetch.js'))
  : null
const taskSummaryModule = feature('BG_SESSIONS')
  ? (require('./utils/taskSummary.js') as typeof import('./utils/taskSummary.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

export {
  assistantTextHasLeakedInvoke,
  getPrecomputeArmThreshold,
  getScalarPrecomputeBufferFraction,
  isGoalToolsOnly,
  LEAKED_INVOKE_RE,
  MALFORMED_TOOL_USE_EXHAUSTED_TEXT,
  MALFORMED_TOOL_USE_RETRY_PROMPT,
  malformedToolUseRetryAction,
  MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT,
  OS,
  parseAmberMoleskinTable,
  REOPEN_BLOCK_RECOVERY_PROMPT,
  resolveLivePrecomputeBufferFraction,
  resolvePrecomputeBufferFraction,
  SAME_MODEL_REFUSAL_RETRY_INTERRUPTED_PROMPT,
  SAME_MODEL_REFUSAL_RETRY_PROMPT,
  selectMaxOutputTokensRecoveryPrompt,
  selectPollEventChunk,
  THINKING_ONLY_RETRY_PROMPT,
  TOOL_CALL_CUT_RECOVERY_PROMPT,
}

export type {
  AmberMoleskinEntry,
  AmberMoleskinTable,
  MalformedToolUseRetryAction,
  QueryParams,
}

async function* queryBody(
  params: QueryParams,
): AsyncGenerator<QueryLoopEvent, Terminal> {
  const consumedCommandUuids: string[] = []
  const consumedAutonomyCommands: QueuedCommand[] = []

  // Create Langfuse trace for this query turn (no-op if not configured).
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

  const propagatedOptions = buildPropagatedToolUseOptions(params)
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

  const observerTap = await setupMainSessionObserverAndTap(paramsWithTrace)

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
      let loopDone = false
      let loopErrored = false
      try {
        while (true) {
          const next = await loop.next()
          if (next.done) {
            loopDone = true
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
      } catch (err) {
        loopErrored = true
        throw err
      } finally {
        if (!loopDone) {
          await loop.return(undefined as never).catch(() => {})
          if (!loopErrored) {
            try {
              observerTap.finish('aborted')
            } catch {
              // best-effort
            }
          }
        }
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

    if (ownsTrace) {
      const isAborted =
        terminal?.reason === 'aborted_streaming' ||
        terminal?.reason === 'aborted_tools'
      endTrace(langfuseTrace, undefined, isAborted ? 'interrupted' : undefined)
      await flushLangfuse()
    }

    if (paramsWithTrace !== params) {
      paramsWithTrace.toolUseContext.langfuseTrace = null
      paramsWithTrace.toolUseContext.langfuseRootTrace = null
      paramsWithTrace.toolUseContext.langfuseBatchSpan = null
    }

    clearNativePerformanceBuffers()
  }

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
): AsyncGenerator<QueryLoopEvent, Terminal> {
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

  if (managedInstructionsOnly) {
    params.toolUseContext.options.managedInstructionsOnly = true
  }

  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
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
    thinkingOnlyNudged: false,
    emptyCompletionResent: false,
    malformedToolUseRetryCount: 0,
    transition: undefined,
  }
  const budgetTracker = feature('TOKEN_BUDGET') ? createBudgetTracker() : null
  let taskBudgetRemaining: number | undefined
  const config = buildQueryConfig()

  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages,
    state.toolUseContext,
  )

  // Official 2.1.328 turn-start poll-event fold
  state.messages = yield* drainTurnStartPollEvents({
    querySource,
    toolUseContext: state.toolUseContext,
    messages: state.messages,
    consumedCommandUuids,
  })

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

  let promptAsFileNoticeSent: boolean = false

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let { toolUseContext } = state
      const leftoverSpinnerModes: Array<{
        type: 'spinner_mode'
        mode: SpinnerMode
      }> = []
      const leftoverPrevSetMode = toolUseContext.setStreamMode
      toolUseContext = {
        ...toolUseContext,
        setStreamMode: mode => {
          if (leftoverPrevSetMode) leftoverPrevSetMode(mode)
          else leftoverSpinnerModes.push({ type: 'spinner_mode', mode })
        },
      }
      const leftoverUnwrapStreamMode = (
        ctx: ToolUseContext,
      ): ToolUseContext => ({
        ...ctx,
        setStreamMode: leftoverPrevSetMode,
      })
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

      announceOutputLimitRecovery(
        state.transition?.reason === 'refusal_retry' ||
          state.transition?.reason === 'prompt_as_file'
          ? undefined
          : state.transition,
        toolUseContext,
      )

      bindPluginDevModsForIteration(canUseTool, toolUseContext)

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

      if (
        !toolUseContext.agentId &&
        toolUseContext.shouldStopBeforeNextApiCall?.()
      ) {
        yield* leftoverDrainSpinnerModes()
        return { reason: 'background_requested' }
      }

      if (!toolUseContext.agentId) {
        startRequeueWindow()
      }

      yield { type: 'stream_request_start' }
      yield* leftoverDrainSpinnerModes()

      queryCheckpoint('query_fn_entry')
      if (!toolUseContext.agentId) {
        headlessProfilerCheckpoint('query_started')
      }

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

      const preApiPrep: {
        messagesForQuery: Message[]
        snipTokensFreed: number
        promptAsFileContextWindow: number
        promptAsFileNoticeSent: boolean
      } = yield* runPreApiMessagePrep({
        messagesForQuery: getMessagesAfterCompactBoundary(messages),
        params,
        state,
        toolUseContext,
        querySource,
        queryDeps: deps,
        promptAsFileNoticeSent,
      })
      let messagesForQuery = preApiPrep.messagesForQuery
      const { snipTokensFreed, promptAsFileContextWindow } = preApiPrep
      promptAsFileNoticeSent = preApiPrep.promptAsFileNoticeSent

      let fullSystemPrompt = asSystemPrompt(
        appendSystemContext(systemPrompt, systemContext),
      )

      const compactPhase = yield* runProactiveCompactionPhase({
        messages,
        messagesForQuery,
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
        queryDeps: deps,
        tracking: autoCompactTracking,
        snipTokensFreed,
        hasAttemptedReactiveCompact,
        taskBudgetTotal: params.taskBudget?.total,
        taskBudgetRemaining,
        queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
        leftoverDrainSpinnerModes,
      })
      if (compactPhase.action === 'return') {
        return compactPhase.terminal
      }
      const compactionSucceeded = compactPhase.compacted
      messagesForQuery = compactPhase.messagesForQuery
      const tracking = compactPhase.tracking
      userContext = compactPhase.userContext
      taskBudgetRemaining = compactPhase.taskBudgetRemaining
      if (compactPhase.needsSystemPromptRebuild) {
        needsSystemPromptRebuild = true
      }

      if (needsSystemPromptRebuild && params.renderSystemPrompt !== undefined) {
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

      toolUseContext = {
        ...toolUseContext,
        messages: messagesForQuery,
      }

      const assistantMessages: AssistantMessage[] = []
      const toolResults: (UserMessage | AttachmentMessage)[] = []
      const toolUseBlocks: ToolUseBlock[] = []

      queryCheckpoint('query_setup_start')
      let streamingToolExecutor: StreamingToolExecutor =
        new StreamingToolExecutor(
          toolUseContext.options.tools,
          canUseTool,
          toolUseContext,
        )

      const autoModeServerContextKickoff = (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { kickoffAutoModeServerContext } =
            require('./services/api/autoModeServerContext.js') as typeof import('./services/api/autoModeServerContext.js')
          return kickoffAutoModeServerContext(toolUseContext)
        } catch {
          return undefined
        }
      })()

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
      const layeredEffortValue = getEffortValueFromLayers(toolUseContext)
      const leftoverStampTurnEffort = (model: unknown) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { leftoverIhrStampTurnEffort } =
            require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
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

      const fableGate = yield* runFableOverageConsentGate({
        currentModel,
        modelFacts,
        toolUseContext,
        leftoverStampTurnEffort,
        leftoverDrainSpinnerModes,
      })
      if (fableGate.action === 'return') {
        return fableGate.terminal
      }
      currentModel = fableGate.currentModel
      modelFacts = fableGate.modelFacts
      toolUseContext = fableGate.toolUseContext

      queryCheckpoint('query_setup_end')

      const dumpPromptsFetch = config.gates.isAnt
        ? createDumpPromptsFetch(toolUseContext.agentId ?? config.sessionId)
        : undefined

      let collapseOwnsIt = false
      if (feature('CONTEXT_COLLAPSE')) {
        collapseOwnsIt =
          (contextCollapse?.isContextCollapseEnabled() ?? false) &&
          isAutoCompactEnabled()
      }
      const mediaRecoveryEnabled = reactiveCompact != null
      if (
        !compactionSucceeded &&
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

      reconcileCarriedEffortLatch()

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
      const sameModelRefusalArmed = isSameModelRefusalRetryArmed(
        querySource,
        refusalRetrySpent,
      )

      const streamOutcome = yield* runStreamingApiAttemptWithFallbacks({
        messagesForQuery,
        fullSystemPrompt,
        userContext,
        toolUseContext,
        canUseTool,
        fallbackModel,
        querySource,
        skipCacheWrite,
        agentCacheTtlOverride,
        thinkingStripPlan,
        advisorStripPlan,
        promptRenderEpoch,
        currentModel,
        modelFacts,
        layeredThinkingConfig,
        layeredEffortValue,
        maxOutputTokensOverride,
        maxOutputTokensRecoveryCount,
        resumeIncompleteThinking,
        taskBudgetTotal: params.taskBudget?.total,
        taskBudgetRemaining,
        config,
        queryDeps: deps,
        queryTracking,
        queryChainIdForAnalytics,
        turnStepTurnId,
        nextTurnStepIndex: () => turnStepIndex++,
        dumpPromptsFetch,
        autoModeServerContextKickoff,
        capturedMcpAttribution,
        attributeMcpUsage,
        clearActiveMcpStamps,
        mediaRecoveryEnabled,
        sameModelRefusalArmed,
        assistantMessages,
        toolResults,
        toolUseBlocks,
        streamingToolExecutor,
        leftoverStampTurnEffort,
        leftoverDrainSpinnerModes,
      })
      if (!streamOutcome.ok) {
        return streamOutcome.terminal
      }

      currentModel = streamOutcome.currentModel
      modelFacts = streamOutcome.modelFacts
      toolUseContext = streamOutcome.toolUseContext
      messagesForQuery = streamOutcome.messagesForQuery
      streamingToolExecutor = streamOutcome.streamingToolExecutor
      let needsFollowUp = streamOutcome.needsFollowUp
      let toolRequestedEndTurn = streamOutcome.toolRequestedEndTurn
      const {
        lastDeltaStopReason,
        lastDeltaOutputTokens,
        withheldLongContextRefusal,
      } = streamOutcome
      let { withheldSafetyMonitorBlock, withheldSameModelRefusal } =
        streamOutcome

      // Official 2.1.328: handle mid-turn safety_monitor_blocked
      const lastStreamedForSafety = assistantMessages.at(-1)
      if (
        needsFollowUp &&
        isSafetyMonitorBlockedMessage(lastStreamedForSafety)
      ) {
        const safetyResult = yield* handleSafetyMonitorBlockedTurn({
          lastStreamedForSafety,
          withheldSafetyMonitorBlock,
          assistantMessages,
          toolResults,
          streamingToolExecutor,
          toolUseContext,
        })
        needsFollowUp = false
        if (safetyResult.clearedWithheld) {
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

      // Handle streaming abort before anything else
      if (toolUseContext.abortController.signal.aborted) {
        return yield* handleStreamingAbort({
          streamingToolExecutor,
          withheldSameModelRefusal,
          toolUseContext,
          leftoverDrainSpinnerModes,
        })
      }

      // Official 2.1.328: same-model refusal_retry
      const lastStreamedForRefusal = assistantMessages.at(-1)
      if (
        sameModelRefusalArmed &&
        isSameModelRefusalMessage(lastStreamedForRefusal) &&
        lastStreamedForRefusal === withheldSameModelRefusal
      ) {
        const refusalRetry = yield* prepareSameModelRefusalRetry({
          lastStreamedForRefusal,
          messagesForQuery,
          assistantMessages,
          toolResults,
          streamingToolExecutor,
          toolUseContext,
          toolRequestedEndTurn,
          currentModel,
          lastDeltaOutputTokens,
          attributeMcpUsage,
          clearActiveMcpStamps,
        })
        toolRequestedEndTurn = refusalRetry.toolRequestedEndTurn
        if (refusalRetry.shouldRetry) {
          state = {
            ...state,
            messages: refusalRetry.nextMessages,
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
        withheldSameModelRefusal = undefined
      } else if (
        withheldSameModelRefusal !== undefined &&
        lastStreamedForRefusal === withheldSameModelRefusal
      ) {
        yield withheldSameModelRefusal
        withheldSameModelRefusal = undefined
      }

      // Yield tool use summary from previous turn
      if (pendingToolUseSummary) {
        const summary = await pendingToolUseSummary
        if (summary) {
          yield summary
        }
      }

      if (!needsFollowUp) {
        const lastMessage = assistantMessages.at(-1)

        const isWithheldLongContext =
          withheldLongContextRefusal !== undefined &&
          lastMessage === withheldLongContextRefusal
        const isWithheld413: boolean =
          isWithheldLongContext ||
          reactiveCompact?.isWithheldPromptTooLong(lastMessage) === true ||
          (reactiveCompact == null &&
            lastMessage?.type === 'assistant' &&
            lastMessage.isApiErrorMessage === true &&
            isPromptTooLongMessage(lastMessage))
        const isWithheldMedia =
          mediaRecoveryEnabled &&
          reactiveCompact?.isWithheldMediaSizeError(lastMessage) === true

        if (isWithheld413) {
          if (feature('CONTEXT_COLLAPSE')) {
            if (
              contextCollapse &&
              state.transition?.reason !== 'collapse_drain_retry'
            ) {
              const drained = contextCollapse.recoverFromOverflow(
                messagesForQuery,
                querySource,
              )
              if (drained.committed > 0) {
                const next: State = {
                  ...state,
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
        }

        if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
          const reactiveOutcome = yield* executeReactiveCompactAttempt({
            isWithheld413,
            isWithheldMedia,
            isWithheldLongContext,
            lastMessage,
            messagesForQuery,
            systemPrompt,
            userContext,
            systemContext,
            toolUseContext,
            querySource,
            state,
            tracking,
            taskBudgetTotal: params.taskBudget?.total,
            taskBudgetRemaining,
            leftoverDrainSpinnerModes,
          })
          if (reactiveOutcome.action === 'return') {
            return reactiveOutcome.terminal
          }
          if (reactiveOutcome.action === 'compacted') {
            needsSystemPromptRebuild = true
            userContext = reactiveOutcome.userContext
            taskBudgetRemaining = reactiveOutcome.taskBudgetRemaining
            const next: State = {
              ...state,
              messages: reactiveOutcome.postCompactMessages,
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: {
                compacted: true,
                turnId: deps.uuid(),
                turnCounter: 0,
                consecutiveFailures: 0,
                consecutiveRapidRefills:
                  reactiveOutcome.consecutiveRapidRefills,
              },
              maxOutputTokensRecoveryCount,
              serverErrorCutRetryCount,
              hasAttemptedReactiveCompact: true,
              reactiveCompactDeeperPass: reactiveOutcome.nextDeeperPass,
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

          // Official 2.1.331 `Jr(yt, false)` — if compaction could not recover
          // from PTL, try saving an oversized user prompt to a file and retry.
          if (
            isWithheld413 &&
            !isWithheldLongContext &&
            toolUseContext.agentId === undefined &&
            !toolUseContext.abortController.signal.aborted
          ) {
            const ptlSavedPrompt = await trySaveOversizedPromptAsFile({
              rows: messagesForQuery,
              contextWindow: promptAsFileContextWindow,
              needsProof: false,
              beforeCompaction: false,
              tools: toolUseContext.options.tools,
              signal: toolUseContext.abortController.signal,
            })
            if (ptlSavedPrompt !== undefined && ptlSavedPrompt !== 'no_file') {
              if (!promptAsFileNoticeSent) {
                promptAsFileNoticeSent = true
                emitPromptAsFileNotice()
              }
              yield ptlSavedPrompt
              state = {
                ...state,
                messages: [...messagesForQuery, ptlSavedPrompt],
                toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
                autoCompactTracking: tracking,
                maxOutputTokensRecoveryCount,
                hasAttemptedReactiveCompact,
                reactiveCompactDeeperPass,
                maxOutputTokensOverride: undefined,
                pendingToolUseSummary: undefined,
                stopHookActive: undefined,
                stopHookBlockCount: 0,
                turnCount,
                thinkingOnlyNudged,
                emptyCompletionResent,
                transition: { reason: 'prompt_as_file' },
              }
              yield* leftoverDrainSpinnerModes()
              continue
            }
          }

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
              reactiveOutcome.compactFailure as Parameters<
                typeof reactiveCompact.annotatePromptTooLongWithCompactFailure
              >[1],
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
        } else if (feature('CONTEXT_COLLAPSE')) {
          if (isWithheld413 && lastMessage) {
            yield lastMessage
            void executeStopFailureHooks(lastMessage, toolUseContext)
            yield* leftoverDrainSpinnerModes()
            return { reason: 'prompt_too_long' }
          }
        }

        // Official 2.1.328: max_output_tokens recovery & incomplete thinking resume
        const thinkingResumeRefused =
          resumeIncompleteThinking === true &&
          lastMessage?.isApiErrorMessage === true &&
          !isWithheldMaxOutputTokens(lastMessage) &&
          !isWithheld413 &&
          !isWithheldMedia
        if (isWithheldMaxOutputTokens(lastMessage) || thinkingResumeRefused) {
          const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
            'tengu_otk_slot_v1',
            false,
          )
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
              ...state,
              messages: messagesForQuery,
              toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
              autoCompactTracking: tracking,
              maxOutputTokensRecoveryCount,
              serverErrorCutRetryCount,
              hasAttemptedReactiveCompact,
              reactiveCompactDeeperPass,
              resumeIncompleteThinking: undefined,
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
            if (recoveryMessage !== undefined) {
              yield recoveryMessage
            }

            const next: State = {
              ...state,
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

          if (lastMessage) {
            yield lastMessage
          }
        }

        // Official 2.1.328 `tp()`: truncated response recovery
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
          const cutPlan = planTruncatedCutRetry({
            streamCutErr,
            serverErrorCutRetryCount,
            maxOutputTokensRecoveryCount,
          })
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
            yield recoveryMessage
            if (cutPlan.waitMs !== undefined) {
              const abortedDuringWait = yield* waitForTruncatedCutRetry({
                streamCutErr,
                waitMs: cutPlan.waitMs,
                attempt: cutPlan.attempt,
                uuid: deps.uuid,
                signal: toolUseContext.abortController.signal,
              })
              if (abortedDuringWait) {
                yield* leftoverDrainSpinnerModes()
                return { reason: 'aborted_streaming' }
              }
            }
            const next: State = {
              ...state,
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
              resumeIncompleteThinking: undefined,
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
          yield lastMessage
        }

        // Official 2.1.328: malformed tool_use retry / exhausted
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
              ...state,
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
            const retractedUuids: string[] = []
            const exhaustedMessage: AssistantMessage & {
              retractedMessageUuids?: string[]
            } = createAssistantAPIErrorMessage({
              content: malformedToolUse.text,
              apiError: 'malformed_tool_use_exhausted',
            })
            exhaustedMessage.retractedMessageUuids = retractedUuids
            yield exhaustedMessage
            void executeStopFailureHooks(exhaustedMessage, toolUseContext)
            OS(toolUseContext, querySource, exhaustedMessage)
            yield* leftoverDrainSpinnerModes()
            return { reason: 'malformed_tool_use_exhausted' }
          }
        }

        // Skip stop hooks when the last message is an API error
        if (lastMessage?.isApiErrorMessage) {
          void executeStopFailureHooks(lastMessage, toolUseContext)
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

        // Official 2.1.328 `Ff`: thinking-only nudge & empty completion resend
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
            logForDebugging('query_thinking_only_response: nudged')
            for (const msg of assistantMessages) {
              yield { type: 'tombstone' as const, message: msg }
            }
            const nudgeMessage = createUserMessage({
              content: THINKING_ONLY_RETRY_PROMPT,
              isMeta: true,
              turnCompanion: true,
            })
            yield nudgeMessage
            state = {
              ...state,
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
            for (const msg of assistantMessages) {
              yield { type: 'tombstone' as const, message: msg }
            }
            state = {
              ...state,
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

        // densable Aa: handback bounce + skill_inline not_run before Stop/goal
        const handbackBounce = yield* maybeHandbackBounce(
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
        const stopOutcome = yield* evaluateStopHookOutcome({
          stopHookResult,
          messagesForQuery,
          assistantMessages,
          toolUseContext,
          stopHookActive,
          stopHookBlockCount,
          turnCount,
          maxTurns,
          leftoverDrainSpinnerModes,
        })
        if (stopOutcome.action === 'return') {
          return stopOutcome.terminal
        }
        if (stopOutcome.action === 'retry_blocking') {
          const next: State = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              ...stopOutcome.blockingErrors,
              ...(handbackBounce ? [handbackBounce] : []),
            ],
            toolUseContext: leftoverUnwrapStreamMode(toolUseContext),
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: true,
            stopHookBlockCount: stopOutcome.nextBlockCount,
            turnCount: stopOutcome.nextTurnCountOnBlock,
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

        // Official 2.1.331 `sf()` (`tengu_auto_compact_after_turn`): arm
        // post-turn precompute auto-compact on clean `end_turn` completion.
        if (
          effectiveStopReason === 'end_turn' &&
          isAutoCompactAfterTurnEnabled()
        ) {
          const sessionPrecompute =
            (toolUseContext.session as { precompute?: Precompute } | undefined)
              ?.precompute ?? getBootstrapSession().precompute
          await armAutoCompactAfterTurn({
            messages: [...messagesForQuery, ...assistantMessages],
            model: toolUseContext.options.mainLoopModel,
            precompute: sessionPrecompute,
            querySource,
            agentId: toolUseContext.agentId,
            tracking,
            signal: toolUseContext.abortController.signal,
          })
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

      for await (const update of streamingToolExecutor.getRemainingResults()) {
        if (isToolBridgeEvent(update)) {
          yield update
          continue
        }
        if (update.message) {
          yield update.message
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

      const nextPendingToolUseSummary = startToolUseSummaryGeneration({
        emitToolUseSummaries: config.gates.emitToolUseSummaries,
        toolUseBlocks,
        assistantMessages,
        toolResults,
        toolUseContext,
      })

      if (toolUseContext.abortController.signal.aborted) {
        return yield* handleAbortedToolsExit({
          toolUseContext,
          turnCount,
          maxTurns,
          leftoverDrainSpinnerModes,
        })
      }

      // densable: toolWasDeferred before shouldPreventContinuation so a turn
      // with both attachments reports tool_deferred, not hook_stopped.
      if (toolWasDeferred) {
        yield* leftoverDrainSpinnerModes()
        return { reason: 'tool_deferred' }
      }
      if (shouldPreventContinuation) {
        yield* runTurnEndReactions(
          messagesForQuery.concat(assistantMessages, toolResults),
          updatedToolUseContext,
          stopHookActive,
        )
        yield* leftoverDrainSpinnerModes()
        return { reason: 'hook_stopped' }
      }

      let mcpEndTurnOverrideMessage: UserMessage | undefined
      if (toolRequestedEndTurn) {
        const mcpEndTurnOutcome = yield* handleMcpEndTurnResolution({
          toolRequestedEndTurn,
          mcpEndTurnOverrideSpent,
          turnCount,
          maxTurns,
          toolUseBlocks,
          toolResults,
          messagesForQuery,
          assistantMessages,
          systemPrompt,
          userContext,
          systemContext,
          updatedToolUseContext,
          querySource,
          stopHookActive,
          queryDeps: deps,
          queryChainIdForAnalytics,
          queryDepth: queryTracking.depth,
          leftoverDrainSpinnerModes,
        })
        if (mcpEndTurnOutcome.action === 'return') {
          return mcpEndTurnOutcome.terminal
        }
        if (mcpEndTurnOutcome.action === 'override_with_stop_hook') {
          const nextTurnCountOnMcpStop = turnCount + 1
          state = {
            messages: [
              ...messagesForQuery,
              ...assistantMessages,
              ...toolResults,
              ...mcpEndTurnOutcome.blockingErrors,
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
        mcpEndTurnOverrideMessage = mcpEndTurnOutcome.message
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

      logEvent('tengu_query_before_attachments', {
        messagesForQueryCount: messagesForQuery.length,
        assistantMessagesCount: assistantMessages.length,
        toolResultsCount: toolResults.length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      const postBatchTerminal = yield* runPostToolBatchHookPass({
        toolUseBlocks,
        toolResults,
        messagesForQuery,
        assistantMessages,
        updatedToolUseContext,
        stopHookActive,
        queryDeps: deps,
        leftoverDrainSpinnerModes,
      })
      if (postBatchTerminal) {
        return postBatchTerminal
      }

      updatedToolUseContext = refreshToolsAndMcpClientsMidTurn(
        updatedToolUseContext,
      )

      const nextTurnCount = turnCount + 1
      const maxTurnsReached = Boolean(maxTurns && nextTurnCount > maxTurns)
      updatedToolUseContext = yield* drainMidTurnQueuedCommandsAndAttachments({
        toolUseBlocks,
        toolResults,
        messagesForQuery,
        assistantMessages,
        toolUseContext,
        updatedToolUseContext,
        querySource,
        turnCount,
        maxTurnsReached,
        consumedCommandUuids,
        consumedAutonomyCommands,
        pendingMemoryPrefetch,
        pendingSkillPrefetch,
        pendingToolPrefetch,
      })

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
        stopHookBlockCount: isGoalToolsOnly(toolUseBlocks)
          ? stopHookBlockCount
          : 0,
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { leftoverIhrStampTurnEffort } =
        require('./utils/collapseReadSearch.js') as typeof import('./utils/collapseReadSearch.js')
      leftoverIhrStampTurnEffort(params.toolUseContext.agentId, null, null)
    } catch {
      // isolation — optional
    }
  }
}

/** densable `yk` / `rAn.run` — ALS turnAttributionKey for j6 inherit. */
export async function* query(
  params: QueryParams,
): AsyncGenerator<QueryLoopEvent, Terminal> {
  // Official 2.1.326 (#333): release deferred Cowork cloud OpenTelemetry export
  // on the first turn (idle sessions that never run a turn emit nothing).
  if (!params.toolUseContext.agentId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { releaseDeferredTelemetryForFirstTurn } =
        require('./entrypoints/init.js') as typeof import('./entrypoints/init.js')
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
