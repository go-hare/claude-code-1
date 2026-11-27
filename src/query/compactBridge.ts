import { feature } from 'bun:bundle'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getSdkBetas } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { getUserContext } from '../context.js'
import { getPromptTooLongTokenGap } from '../services/api/errors.js'
import {
  AUTOCOMPACT_THRASHING_MESSAGE,
  type AutoCompactTrackingState,
  checkRapidRefillBreaker,
  isAutoCompactEnabled,
  isPrecomputeCompactionEnabled,
} from '../services/compact/autoCompact.js'
import {
  buildPostCompactMessages,
  compactConversation,
} from '../services/compact/compact.js'
import { runPostCompactCleanup } from '../services/compact/postCompactCleanup.js'
import {
  emitPromptAsFileNotice,
  rewriteOversizedPromptsForApi,
  trySaveOversizedPromptAsFile,
} from '../services/compact/promptAsFile.js'
import type { ToolUseContext } from '../Tool.js'
import type { AssistantMessage, Message } from '../types/message.js'
import {
  isShutdownAbortReason,
  shouldSuppressInterruptionMessage,
} from '../utils/abortController.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { getContextWindowForModel } from '../utils/context.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { executeStopFailureHooks } from '../utils/hooks.js'
import {
  getModelSwitchSession,
  takePostModelSwitchHooks,
} from '../utils/hooks/modelSwitchHooks.js'
import { logError } from '../utils/log.js'
import {
  createAssistantAPIErrorMessage,
  createUserInterruptionMessage,
} from '../utils/messages.js'
import { queryCheckpoint } from '../utils/queryProfiler.js'
import { recordContentReplacement } from '../utils/sessionStorage.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import {
  finalContextTokensFromLastResponse,
  tokenCountWithEstimation,
} from '../utils/tokens.js'
import { applyToolResultBudget } from '../utils/toolResultStorage.js'
import type { QueryDeps } from './deps.js'
import { querySourceFamilyOf } from './queryHelpers.js'
import type { QueryLoopEvent, QueryParams, State } from './queryTypes.js'
import type { Terminal } from './transitions.js'
import {
  getPrecomputeArmThreshold,
  runWithSubagentContextIfNeeded,
} from './turnHelpers.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const snipModule = feature('HISTORY_SNIP')
  ? (require('../services/compact/snipCompact.js') as typeof import('../services/compact/snipCompact.js'))
  : null
const contextCollapse = feature('CONTEXT_COLLAPSE')
  ? (require('../services/contextCollapse/index.js') as typeof import('../services/contextCollapse/index.js'))
  : null
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('../services/compact/reactiveCompact.js') as typeof import('../services/compact/reactiveCompact.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Runs per-iteration message preprocessing before autocompact:
 * PostModelSwitch pending drain, shallow-copy `toolUseResult` strip,
 * `applyToolResultBudget`, `HISTORY_SNIP`, `microcompact`, `CONTEXT_COLLAPSE`,
 * and pre-compaction oversized prompt-as-file rewrite/save.
 */
export async function* runPreApiMessagePrep(deps: {
  messagesForQuery: Message[]
  params: QueryParams
  state: State
  toolUseContext: ToolUseContext
  querySource: QuerySource
  queryDeps: QueryDeps
  promptAsFileNoticeSent: boolean
}): AsyncGenerator<
  QueryLoopEvent,
  {
    messagesForQuery: Message[]
    snipTokensFreed: number
    promptAsFileContextWindow: number
    promptAsFileNoticeSent: boolean
  }
> {
  const { params, state, toolUseContext, querySource, queryDeps } = deps
  let messagesForQuery = deps.messagesForQuery
  let promptAsFileNoticeSent = deps.promptAsFileNoticeSent

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

  // Shallow-copy strip `toolUseResult` payloads so UI state isn't mutated in place
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

  // Enforce per-message budget on aggregate tool result size BEFORE microcompact
  const persistReplacements =
    querySource.startsWith('agent:') ||
    querySource.startsWith('repl_main_thread')
  messagesForQuery = await applyToolResultBudget(
    messagesForQuery,
    toolUseContext.contentReplacementState,
    persistReplacements
      ? records =>
          void recordContentReplacement(records, toolUseContext.agentId).catch(
            logError,
          )
      : undefined,
    new Set(
      toolUseContext.options.tools
        .filter(t => !Number.isFinite(t.maxResultSizeChars))
        .map(t => t.name),
    ),
  )

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
  const microcompactResult = await queryDeps.microcompact(
    messagesForQuery,
    toolUseContext,
    querySource,
  )
  messagesForQuery = microcompactResult.messages
  if (microcompactResult.clearedToolUseIds?.length) {
    const replacements = toolUseContext?.contentReplacementState?.replacements
    if (replacements) {
      for (const id of microcompactResult.clearedToolUseIds) {
        replacements.delete(id)
      }
    }
  }
  queryCheckpoint('query_microcompact_end')

  if (feature('CONTEXT_COLLAPSE')) {
    if (contextCollapse) {
      const collapseResult = await contextCollapse.applyCollapsesIfNeeded(
        messagesForQuery,
        toolUseContext,
        querySource,
      )
      messagesForQuery = collapseResult.messages
    }
  }

  // Official 2.1.331 `tao` + `Jr(void 0, true, {}, true)`: rewrite any
  // already-saved oversized prompts and save oversized human prompts to a
  // file before autocompact runs.
  const promptAsFileContextWindow = getContextWindowForModel(
    toolUseContext.options.mainLoopModel,
    getSdkBetas(),
  )
  if (querySource !== 'compact') {
    messagesForQuery = rewriteOversizedPromptsForApi(
      messagesForQuery,
      promptAsFileContextWindow,
      {
        recordTelemetry:
          state.transition === undefined &&
          toolUseContext.agentId === undefined,
      },
    )
  }
  if (
    toolUseContext.agentId === undefined &&
    !toolUseContext.abortController.signal.aborted
  ) {
    let promptAsFileNoFile = false
    let hasSavedAtThisTop = false
    while (!promptAsFileNoFile) {
      const savedPromptAttachment = await trySaveOversizedPromptAsFile({
        rows: messagesForQuery,
        contextWindow: promptAsFileContextWindow,
        needsProof: true,
        beforeCompaction: true,
        hasSavedAtThisTop,
        tools: toolUseContext.options.tools,
        signal: toolUseContext.abortController.signal,
      })
      if (
        savedPromptAttachment === undefined ||
        savedPromptAttachment === 'no_file'
      ) {
        promptAsFileNoFile = savedPromptAttachment === 'no_file'
        break
      }
      if (!promptAsFileNoticeSent) {
        promptAsFileNoticeSent = true
        emitPromptAsFileNotice()
      }
      yield savedPromptAttachment
      hasSavedAtThisTop = true
      messagesForQuery = rewriteOversizedPromptsForApi(
        [...messagesForQuery, savedPromptAttachment],
        promptAsFileContextWindow,
      )
    }
  }

  return {
    messagesForQuery,
    snipTokensFreed,
    promptAsFileContextWindow,
    promptAsFileNoticeSent,
  }
}

/**
 * Runs proactive autocompact + #921 classifier overflow compact, yields
 * post-compact messages, updates tracking/userContext/taskBudgetRemaining,
 * and evaluates live precompute arm threshold when autocompact did not run.
 */
export async function* runProactiveCompactionPhase(deps: {
  messages: Message[]
  messagesForQuery: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  querySource: QuerySource
  queryDeps: QueryDeps
  tracking: AutoCompactTrackingState | undefined
  snipTokensFreed: number
  hasAttemptedReactiveCompact: boolean
  taskBudgetTotal: number | undefined
  taskBudgetRemaining: number | undefined
  queryChainIdForAnalytics: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  queryDepth: number
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<
  QueryLoopEvent,
  | {
      action: 'return'
      terminal: Terminal
    }
  | {
      action: 'continue'
      compacted: boolean
      messagesForQuery: Message[]
      tracking: AutoCompactTrackingState | undefined
      userContext: { [k: string]: string }
      taskBudgetRemaining: number | undefined
      needsSystemPromptRebuild: boolean
    }
> {
  const {
    messages,
    systemPrompt,
    systemContext,
    toolUseContext,
    querySource,
    queryDeps,
    snipTokensFreed,
    hasAttemptedReactiveCompact,
    taskBudgetTotal,
    queryChainIdForAnalytics,
    queryDepth,
    leftoverDrainSpinnerModes,
  } = deps
  let messagesForQuery = deps.messagesForQuery
  let tracking = deps.tracking
  let userContext = deps.userContext
  let taskBudgetRemaining = deps.taskBudgetRemaining
  let needsSystemPromptRebuild = false

  queryCheckpoint('query_autocompact_start')
  const autocompactOutcome = await queryDeps.autocompact(
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
    return { action: 'return', terminal: { reason: 'aborted_streaming' } }
  }

  if (rapidRefillBreakerTripped) {
    yield createAssistantAPIErrorMessage({
      content: AUTOCOMPACT_THRASHING_MESSAGE,
      error: 'invalid_request',
      apiError: 'autocompact_thrashing',
    })
    yield* leftoverDrainSpinnerModes()
    return { action: 'return', terminal: { reason: 'rapid_refill_breaker' } }
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
      require('../utils/permissions/permissions.js') as typeof import('../utils/permissions/permissions.js')
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
          compactionResult = await runWithSubagentContextIfNeeded(
            toolUseContext,
            querySource,
            () =>
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
              ),
          )
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
            return {
              action: 'return',
              terminal: { reason: 'aborted_streaming' },
            }
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
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
      compactionTotalTokens: compactionUsage
        ? compactionUsage.input_tokens +
          (compactionUsage.cache_creation_input_tokens ?? 0) +
          (compactionUsage.cache_read_input_tokens ?? 0) +
          compactionUsage.output_tokens
        : 0,
      queryChainId: queryChainIdForAnalytics,
      queryDepth,
    })

    if (taskBudgetTotal !== undefined) {
      const preCompactContext =
        finalContextTokensFromLastResponse(messagesForQuery)
      taskBudgetRemaining = Math.max(
        0,
        (taskBudgetRemaining ?? taskBudgetTotal) - preCompactContext,
      )
    }

    tracking = {
      compacted: true,
      turnId: queryDeps.uuid(),
      turnCounter: 0,
      consecutiveFailures: 0,
      consecutiveRapidRefills: consecutiveRapidRefills ?? 0,
    }

    const postCompactMessages = buildPostCompactMessages(compactionResult)
    for (const message of postCompactMessages) {
      yield message
    }

    messagesForQuery = postCompactMessages
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
    tracking = {
      ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
      consecutiveFailures,
    }
  }

  // Official 2.1.328: evaluate live precompute arm threshold when autocompact did not run
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

  return {
    action: 'continue',
    compacted: Boolean(compactionResult),
    messagesForQuery,
    tracking,
    userContext,
    taskBudgetRemaining,
    needsSystemPromptRebuild,
  }
}

/**
 * Executes the reactive-compact attempt (with two-pass `reactiveCompactDeeperPass`
 * and child PTL recovery AbortController), returning the structured outcome so
 * `query.ts` can commit the `reactive_compact_retry` state transition or fall
 * through to `prompt_as_file` / error surfacing.
 */
export async function* executeReactiveCompactAttempt(deps: {
  isWithheld413: boolean
  isWithheldMedia: boolean
  isWithheldLongContext: boolean
  lastMessage: AssistantMessage | undefined
  messagesForQuery: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  querySource: QuerySource
  state: State
  tracking: AutoCompactTrackingState | undefined
  taskBudgetTotal: number | undefined
  taskBudgetRemaining: number | undefined
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<
  QueryLoopEvent,
  | { action: 'return'; terminal: Terminal }
  | {
      action: 'compacted'
      postCompactMessages: Message[]
      nextDeeperPass: 'none' | 'available' | 'spent'
      consecutiveRapidRefills: number
      userContext: { [k: string]: string }
      taskBudgetRemaining: number | undefined
    }
  | {
      action: 'failed'
      compactFailure: unknown
    }
> {
  const {
    isWithheld413,
    isWithheldMedia,
    isWithheldLongContext,
    lastMessage,
    messagesForQuery,
    systemPrompt,
    systemContext,
    toolUseContext,
    querySource,
    state,
    tracking,
    taskBudgetTotal,
    leftoverDrainSpinnerModes,
  } = deps
  let userContext = deps.userContext
  let taskBudgetRemaining = deps.taskBudgetRemaining

  if (!reactiveCompact) {
    return { action: 'failed', compactFailure: undefined }
  }

  const hasAttemptedReactiveCompact = state.hasAttemptedReactiveCompact
  const reactiveCompactDeeperPass = state.reactiveCompactDeeperPass ?? 'none'
  const isDeeperPass =
    isWithheld413 &&
    hasAttemptedReactiveCompact &&
    reactiveCompactDeeperPass === 'available' &&
    state.transition?.reason === 'reactive_compact_retry'
  const effectiveHasAttempted = hasAttemptedReactiveCompact && !isDeeperPass
  const reactiveBreaker = isDeeperPass
    ? {
        action: 'proceed' as const,
        consecutiveRapidRefills: tracking?.consecutiveRapidRefills ?? 0,
      }
    : checkRapidRefillBreaker(tracking)

  if (!hasAttemptedReactiveCompact && reactiveBreaker.action === 'trip') {
    if (isWithheldLongContext && lastMessage) {
      yield lastMessage
      void executeStopFailureHooks(lastMessage, toolUseContext)
      yield* leftoverDrainSpinnerModes()
      return { action: 'return', terminal: { reason: 'model_error' } }
    }
    yield createAssistantAPIErrorMessage({
      content: AUTOCOMPACT_THRASHING_MESSAGE,
      error: 'invalid_request',
      apiError: 'autocompact_thrashing',
    })
    yield* leftoverDrainSpinnerModes()
    return { action: 'return', terminal: { reason: 'rapid_refill_breaker' } }
  }

  // Official 2.1.328 (#625): bind PTL recovery compaction to a child AbortController
  const ptlEstimatedTokens = tokenCountWithEstimation(messagesForQuery)
  const ptlRecoveryAbort = reactiveCompact.createPtlRecoveryAbortController(
    toolUseContext.abortController,
    {
      timeoutMs:
        reactiveCompact.computePtlRecoveryTimeoutMs(ptlEstimatedTokens),
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

  let compacted: Awaited<ReturnType<typeof runReactiveCompact>>['result']
  let compactFailure: Awaited<ReturnType<typeof runReactiveCompact>>['failure']
  try {
    const outcome = await runWithSubagentContextIfNeeded(
      toolUseContext,
      querySource,
      runReactiveCompact,
    )
    compacted = outcome.result
    compactFailure = outcome.failure
  } finally {
    ptlRecoveryAbort.cleanup()
  }

  if (compacted) {
    if (taskBudgetTotal !== undefined) {
      const preCompactContext =
        finalContextTokensFromLastResponse(messagesForQuery)
      taskBudgetRemaining = Math.max(
        0,
        (taskBudgetRemaining ?? taskBudgetTotal) - preCompactContext,
      )
    }

    const postCompactMessages = buildPostCompactMessages(compacted)
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
    const postCompactGroups = postCompactMessages.filter(
      m => m.type === 'user' || m.type === 'assistant',
    ).length
    const nextDeeperPass: 'none' | 'available' | 'spent' = isDeeperPass
      ? 'spent'
      : isWithheld413 &&
          reactiveCompactDeeperPass === 'none' &&
          (postCompactGroups >= 3 ||
            (toolUseContext.contentReplacementState?.replacements?.size ?? 0) >
              0)
        ? 'available'
        : reactiveCompactDeeperPass
    return {
      action: 'compacted',
      postCompactMessages,
      nextDeeperPass,
      consecutiveRapidRefills: reactiveBreaker.consecutiveRapidRefills,
      userContext,
      taskBudgetRemaining,
    }
  }

  // #984: if aborted while compacting a 413 PTL (not withheld media),
  // return aborted_streaming instead of surfacing Prompt is too long.
  if (!isWithheldMedia && toolUseContext.abortController.signal.aborted) {
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
    return { action: 'return', terminal: { reason: 'aborted_streaming' } }
  }

  return { action: 'failed', compactFailure }
}
