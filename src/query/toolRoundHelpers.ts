import { feature } from 'bun:bundle'
import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { SLEEP_TOOL_NAME } from '@claude-code/builtin-tools/tools/SleepTool/prompt.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getSessionId } from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import { addToHistory } from '../history.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { generateToolUseSummary } from '../services/toolUseSummary/toolUseSummaryGenerator.js'
import type { ToolUseContext } from '../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ToolUseSummaryMessage,
  UserMessage,
} from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  isShutdownAbortReason,
  shouldSuppressInterruptionMessage,
} from '../utils/abortController.js'
import { count } from '../utils/array.js'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  getAttachmentMessages,
  type startRelevantMemoryPrefetch,
} from '../utils/attachments.js'
import { claimConsumableQueuedAutonomyCommands } from '../utils/autonomyQueueLifecycle.js'
import { notifyCommandLifecycle } from '../utils/commandLifecycle.js'
import { logForDebugging } from '../utils/debug.js'
import { ControlStreamClosedError, isAbortError } from '../utils/errors.js'
import { executePostToolBatchHooks, hasHookForEvent } from '../utils/hooks.js'
import { logError } from '../utils/log.js'
import {
  consume as consumeFromQueue,
  getCommandsByMaxPriority,
  isMidTurnFoldSuspended,
  isSlashCommand,
  registerFoldInFlight,
  remove as removeFromQueue,
  unregisterFoldInFlight,
  wasPutBack,
} from '../utils/messageQueueManager.js'
import {
  createToolUseSummaryMessage,
  createUserInterruptionMessage,
  createUserMessage,
  isHumanLikeOrigin,
} from '../utils/messages.js'
import { applyPluginToolListFilter } from '../utils/plugins/pluginToolList.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import { updateTurnAttributionFromCommands } from '../utils/turnAttribution.js'
import type { QueryDeps } from './deps.js'
import type { ToolEndTurnSource } from './endTurnFromToolResult.js'
import { collectPostToolBatchCalls } from './queryHelpers.js'
import type { QueryLoopEvent } from './queryTypes.js'
import { handleStopHooks, runTurnEndReactions } from './stopHooks.js'
import type { Terminal } from './transitions.js'
import {
  cleanupChicagoMcpIfMainThread,
  MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT,
  selectPollEventChunk,
} from './turnHelpers.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const skillPrefetch = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('../services/skillSearch/prefetch.js') as typeof import('../services/skillSearch/prefetch.js'))
  : null
const searchExtraToolsPrefetch = feature('EXPERIMENTAL_SEARCH_EXTRA_TOOLS')
  ? (require('../services/searchExtraTools/prefetch.js') as typeof import('../services/searchExtraTools/prefetch.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Generates an async Haiku tool-use summary after a tool batch completes
 * without blocking the next API call.
 */
export function startToolUseSummaryGeneration(deps: {
  emitToolUseSummaries: boolean
  toolUseBlocks: ToolUseBlock[]
  assistantMessages: AssistantMessage[]
  toolResults: (UserMessage | AttachmentMessage)[]
  toolUseContext: ToolUseContext
}): Promise<ToolUseSummaryMessage | null> | undefined {
  const {
    emitToolUseSummaries,
    toolUseBlocks,
    assistantMessages,
    toolResults,
    toolUseContext,
  } = deps
  if (
    !emitToolUseSummaries ||
    toolUseBlocks.length === 0 ||
    toolUseContext.abortController.signal.aborted ||
    toolUseContext.agentId
  ) {
    return undefined
  }
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
  const toolUseIds = toolUseBlocks.map(block => block.id)
  const toolInfoForSummary = toolUseBlocks.map(block => {
    const toolResult = toolResults.find(
      result =>
        result.type === 'user' &&
        Array.isArray(result.message.content) &&
        result.message.content.some(
          content =>
            content.type === 'tool_result' && content.tool_use_id === block.id,
        ),
    )
    const resultContent =
      toolResult?.type === 'user' && Array.isArray(toolResult.message.content)
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

  return generateToolUseSummary({
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

/**
 * Official 2.1.328 (`chunk@305854618.js @109475, @158337, @301785` `Bm`/`Xc`/`Jc`):
 * StructuredOutput (`tool`) always ends the turn immediately. For MCP `endTurn`
 * (`mcp_meta`), a failed sibling tool (`tengu_cozy_fern`) or a blocking Stop hook
 * (`tengu_glittery_mitten`) may override `endTurn` at most once per turn.
 */
export async function* handleMcpEndTurnResolution(deps: {
  toolRequestedEndTurn: ToolEndTurnSource
  mcpEndTurnOverrideSpent: boolean
  turnCount: number
  maxTurns: number | undefined
  toolUseBlocks: ToolUseBlock[]
  toolResults: (UserMessage | AttachmentMessage)[]
  messagesForQuery: Message[]
  assistantMessages: AssistantMessage[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  updatedToolUseContext: ToolUseContext
  querySource: QuerySource
  stopHookActive: boolean | undefined
  queryDeps: QueryDeps
  queryChainIdForAnalytics: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  queryDepth: number
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<
  QueryLoopEvent,
  | { action: 'return'; terminal: Terminal }
  | { action: 'override_with_stop_hook'; blockingErrors: Message[] }
  | { action: 'override_with_message'; message: UserMessage }
> {
  const {
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
    queryDeps,
    queryChainIdForAnalytics,
    queryDepth,
    leftoverDrainSpinnerModes,
  } = deps

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
    const mcpEndTurnOverrideMessage = createUserMessage({
      content: MCP_END_TURN_FAILED_SIBLING_OVERRIDE_PROMPT,
      isMeta: true,
      turnCompanion: true,
    })
    logEvent('tengu_mcp_end_turn_overridden_by_failed_sibling', {
      queryChainId: queryChainIdForAnalytics,
      queryDepth,
    })
    return {
      action: 'override_with_message',
      message: mcpEndTurnOverrideMessage,
    }
  }

  if (
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
        action: 'return',
        terminal: {
          reason: mcpStopResult.aborted
            ? 'aborted_tools'
            : 'stop_hook_prevented',
        },
      }
    }
    if (mcpStopResult.blockingErrors.length > 0) {
      logEvent('tengu_mcp_end_turn_overridden_by_stop_hook', {
        queryChainId: queryChainIdForAnalytics,
        queryDepth,
      })
      return {
        action: 'override_with_stop_hook',
        blockingErrors: mcpStopResult.blockingErrors,
      }
    }
    logEvent('tengu_mcp_tool_result_ended_turn', {
      queryChainId: queryChainIdForAnalytics,
      queryDepth,
      source:
        toolRequestedEndTurn as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    yield* leftoverDrainSpinnerModes()
    return { action: 'return', terminal: { reason: 'completed' } }
  }

  logEvent('tengu_mcp_tool_result_ended_turn', {
    queryChainId: queryChainIdForAnalytics,
    queryDepth,
    source:
      toolRequestedEndTurn as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  // densable ip @195421735 — Acn; blocking discarded (no model re-invoke).
  try {
    const permissionMode =
      updatedToolUseContext.getAppState().toolPermissionContext.mode
    for await (const result of executePostToolBatchHooks(
      collectPostToolBatchCalls(toolUseBlocks, toolResults),
      `hook-${queryDeps.uuid()}`,
      updatedToolUseContext,
      permissionMode,
      updatedToolUseContext.abortController.signal,
    )) {
      if (result.message) yield result.message
      if (result.blockingError || result.preventContinuation) {
        logForDebugging(
          `[end-turn] PostToolBatch block discarded (turn ended by ${
            toolRequestedEndTurn === 'tool' ? 'tool result' : 'MCP end-turn'
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
    logForDebugging('PostToolBatch hooks cancelled (control stream closed)')
  }
  if (updatedToolUseContext.abortController.signal.aborted) {
    await cleanupChicagoMcpIfMainThread(updatedToolUseContext)
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
  return { action: 'return', terminal: { reason: 'completed' } }
}

/**
 * densable Acn @195489328 — PostToolBatch hooks after tool batch completes.
 * Exit 2 / preventContinuation stops the agentic loop and runs turn-end reactions.
 */
export async function* runPostToolBatchHookPass(deps: {
  toolUseBlocks: ToolUseBlock[]
  toolResults: (UserMessage | AttachmentMessage)[]
  messagesForQuery: Message[]
  assistantMessages: AssistantMessage[]
  updatedToolUseContext: ToolUseContext
  stopHookActive: boolean | undefined
  queryDeps: QueryDeps
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<QueryLoopEvent, Terminal | undefined> {
  const {
    toolUseBlocks,
    toolResults,
    messagesForQuery,
    assistantMessages,
    updatedToolUseContext,
    stopHookActive,
    queryDeps,
    leftoverDrainSpinnerModes,
  } = deps
  const postBatchSessionId = updatedToolUseContext.agentId ?? getSessionId()
  if (
    !hasHookForEvent(
      'PostToolBatch',
      updatedToolUseContext.getAppState(),
      postBatchSessionId,
    )
  ) {
    return undefined
  }
  const hookId = `hook-${queryDeps.uuid()}`
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
      if (result.additionalContexts && result.additionalContexts.length > 0) {
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
    logForDebugging('PostToolBatch hooks cancelled (control stream closed)')
  }
  if (updatedToolUseContext.abortController.signal.aborted) {
    await cleanupChicagoMcpIfMainThread(updatedToolUseContext)
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
      message: postBatchStopReason || 'Execution stopped by PostToolBatch hook',
      hookName: 'PostToolBatch',
      toolUseID: hookId,
      hookEvent: 'PostToolBatch',
    })
    yield* runTurnEndReactions(
      messagesForQuery.concat(assistantMessages, toolResults),
      updatedToolUseContext,
      stopHookActive,
    )
    yield* leftoverDrainSpinnerModes()
    return { reason: 'hook_stopped' }
  }
  return undefined
}

/** densable: refreshTools then refreshMcpClients before mid-turn attachments. */
export function refreshToolsAndMcpClientsMidTurn(
  updatedToolUseContext: ToolUseContext,
): ToolUseContext {
  let ctx = updatedToolUseContext
  if (ctx.options.refreshTools) {
    const refreshedTools = applyPluginToolListFilter(ctx.options.refreshTools())
    if (refreshedTools !== ctx.options.tools) {
      const oldMcpCount = count(ctx.options.tools, tool => !!tool.mcpInfo)
      const newMcpCount = count(refreshedTools, tool => !!tool.mcpInfo)
      if (oldMcpCount !== newMcpCount) {
        logEvent('tengu_mcp_tools_refreshed_mid_turn', {
          oldMcpCount,
          newMcpCount,
          recovered: oldMcpCount === 0 && newMcpCount > 0,
        })
      }
      ctx = {
        ...ctx,
        options: {
          ...ctx.options,
          tools: refreshedTools,
        },
      }
    }
  }
  if (ctx.options.refreshMcpClients) {
    const refreshedClients = ctx.options.refreshMcpClients()
    ctx = {
      ...ctx,
      options: {
        ...ctx.options,
        mcpClients: refreshedClients,
      },
    }
  }
  return ctx
}

/**
 * Drains mid-turn queued commands, autonomy claims, attachments, and settled
 * memory/skill/tool prefetches, updating `toolResults` and returning the
 * potentially updated `ToolUseContext` (e.g. after mid-turn ultrathink boost).
 */
export async function* drainMidTurnQueuedCommandsAndAttachments(deps: {
  toolUseBlocks: ToolUseBlock[]
  toolResults: (UserMessage | AttachmentMessage)[]
  messagesForQuery: Message[]
  assistantMessages: AssistantMessage[]
  toolUseContext: ToolUseContext
  updatedToolUseContext: ToolUseContext
  querySource: QuerySource
  turnCount: number
  maxTurnsReached: boolean
  consumedCommandUuids: string[]
  consumedAutonomyCommands: QueuedCommand[]
  pendingMemoryPrefetch: ReturnType<typeof startRelevantMemoryPrefetch>
  pendingSkillPrefetch: unknown
  pendingToolPrefetch: unknown
}): AsyncGenerator<QueryLoopEvent, ToolUseContext> {
  const {
    toolUseBlocks,
    toolResults,
    messagesForQuery,
    assistantMessages,
    toolUseContext,
    querySource,
    turnCount,
    maxTurnsReached,
    consumedCommandUuids,
    consumedAutonomyCommands,
    pendingMemoryPrefetch,
    pendingSkillPrefetch,
    pendingToolPrefetch,
  } = deps
  let updatedToolUseContext = deps.updatedToolUseContext

  // eslint-disable-next-line custom-rules/require-tool-match-name -- ToolUseBlock.name has no aliases
  const sleepRan = toolUseBlocks.some(b => b.name === SLEEP_TOOL_NAME)
  const isMainThread =
    querySource.startsWith('repl_main_thread') || querySource === 'sdk'
  const currentAgentId = toolUseContext.agentId
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isMainThreadQueuedCommand } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  const { keepQueuedCommandsUntilFirstDroppedPrompt, latchPromptScreen } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../utils/processUserInput/promptSubmit.js') as typeof import('../utils/processUserInput/promptSubmit.js')

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
            return (
              (cmd.mode === 'task-notification' || cmd.mode === 'poll-event') &&
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
    {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitMidTurnUserPromptOTelEvents } =
        require('../utils/processUserInput/processTextPrompt.js') as typeof import('../utils/processUserInput/processTextPrompt.js')
      emitMidTurnUserPromptOTelEvents(commands)
    }
    for (const cmd of commands) {
      if (!cmd.historyEntry) continue
      try {
        addToHistory(cmd.historyEntry, { armUndo: false })
      } catch {
        // history persistence is best-effort
      }
    }
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
        require('../services/goal/goalIdleCheckin.js') as typeof import('../services/goal/goalIdleCheckin.js')
      clearGoalIdleCheckinCount(toolUseContext.setAppState)
    }
    {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { isTypedUltrathinkPrompt } =
        require('../utils/attachments.js') as typeof import('../utils/attachments.js')
      const { canBoostTurnToXhigh } =
        require('../utils/effort.js') as typeof import('../utils/effort.js')
      const { applyContextLayers, getEffortValueFromLayers } =
        require('../engine/permissionLayerReaders.js') as typeof import('../engine/permissionLayerReaders.js')
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
            require('../utils/collapseReadSearch.js') as typeof import('../utils/collapseReadSearch.js')
          const { getMainThreadAgentId } =
            require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
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

  const claimedConsumedCommands = queuedAutonomyClaim.claimedCommands.filter(
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
        const reminder = applyAbsorbedMidTurnEffects(claimedConsumedCommands)
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
          '../cli/printControlExtras.js'
        )
        logForDebugging(QUERY_TURN_START_POLL_EVENTS_ABORTED)
      } else {
        logError(err)
      }
      pollEventsBuildAborted = true
    }

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

  if (skillPrefetch && pendingSkillPrefetch) {
    const skillAttachments = await skillPrefetch.collectSkillDiscoveryPrefetch(
      pendingSkillPrefetch as Parameters<
        typeof skillPrefetch.collectSkillDiscoveryPrefetch
      >[0],
    )
    for (const att of skillAttachments) {
      const msg = createAttachmentMessage(att)
      yield msg
      toolResults.push(msg)
    }
  }

  if (searchExtraToolsPrefetch && pendingToolPrefetch) {
    const toolAttachments =
      await searchExtraToolsPrefetch.collectSearchExtraToolsPrefetch(
        pendingToolPrefetch as Parameters<
          typeof searchExtraToolsPrefetch.collectSearchExtraToolsPrefetch
        >[0],
      )
    for (const att of toolAttachments) {
      const msg = createAttachmentMessage(att)
      yield msg
      toolResults.push(msg)
    }
  }

  return updatedToolUseContext
}
