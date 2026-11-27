import { BRIEF_ENFORCE_SENTINEL } from '@claude-code/builtin-tools/tools/BriefTool/BriefTool.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getRetryDelay } from '../services/api/withRetry.js'
import type { StreamingToolExecutor } from '../services/tools/StreamingToolExecutor.js'
import { isToolBridgeEvent } from '../services/tools/toolExecution.js'
import type { ToolUseContext } from '../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  UserMessage,
} from '../types/message.js'
import {
  isShutdownAbortReason,
  shouldSuppressInterruptionMessage,
} from '../utils/abortController.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import {
  createSystemMessage,
  createUserInterruptionMessage,
  createUserMessage,
} from '../utils/messages.js'
import { renderModelName } from '../utils/model/model.js'
import { applyPluginToolListFilter } from '../utils/plugins/pluginToolList.js'
import { resolveStopHookBlockCap } from '../utils/residualMsEnvGates.js'
import { enqueueSdkEvent } from '../utils/sdkEventQueue.js'
import { sleep } from '../utils/sleep.js'
import { accumulateToolResultForMidTurn } from './accumulateToolResultForMidTurn.js'
import {
  endTurnSourceFromToolResult,
  type ToolEndTurnSource,
} from './endTurnFromToolResult.js'
import {
  hasBriefRepliedInTranscript,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
} from './queryHelpers.js'
import type { QueryLoopEvent } from './queryTypes.js'
import { runTurnEndReactions } from './stopHooks.js'
import type { Terminal } from './transitions.js'

export type StopHookOutcomeInput = {
  blockingErrors: Message[]
  preventContinuation: boolean
  aborted?: boolean
}
import {
  buildCutRetryWaitMessage,
  cleanupChicagoMcpIfMainThread,
  MAX_SERVER_ERROR_CUT_RETRIES,
  SAME_MODEL_REFUSAL_RETRY_INTERRUPTED_PROMPT,
  SAME_MODEL_REFUSAL_RETRY_PROMPT,
} from './turnHelpers.js'

/**
 * Official 2.1.328 (`chunk@305854618.js @281554-281850`): handle mid-turn
 * `safety_monitor_blocked` when `needsFollowUp` is true — drain completed
 * tools, cancel unstarted tools, synthesize `tool_result`s for unanswered
 * tool calls, and yield the withheld safety monitor error.
 */
export function* handleSafetyMonitorBlockedTurn(deps: {
  lastStreamedForSafety: AssistantMessage
  withheldSafetyMonitorBlock: AssistantMessage | undefined
  assistantMessages: AssistantMessage[]
  toolResults: (UserMessage | AttachmentMessage)[]
  streamingToolExecutor: StreamingToolExecutor
  toolUseContext: ToolUseContext
}): Generator<QueryLoopEvent, { clearedWithheld: boolean }> {
  const {
    lastStreamedForSafety,
    withheldSafetyMonitorBlock,
    assistantMessages,
    toolResults,
    streamingToolExecutor,
    toolUseContext,
  } = deps
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
    return { clearedWithheld: true }
  }
  return { clearedWithheld: false }
}

/**
 * Official 2.1.328 (`chunk@305854618.js @282000` `zi`): ALWAYS drain
 * `streamingToolExecutor.getRemainingResults()` on streaming abort so
 * tool_use blocks always receive matching synthetic tool_result blocks.
 */
export async function* handleStreamingAbort(deps: {
  streamingToolExecutor: StreamingToolExecutor
  withheldSameModelRefusal: AssistantMessage | undefined
  toolUseContext: ToolUseContext
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<QueryLoopEvent, Terminal> {
  const {
    streamingToolExecutor,
    withheldSameModelRefusal,
    toolUseContext,
    leftoverDrainSpinnerModes,
  } = deps
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
  }
  await cleanupChicagoMcpIfMainThread(toolUseContext)
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

/**
 * Official 2.1.328 (`chunk@305854618.js @283910-285400` `Gia`):
 * same-model `refusal_retry` — retract refused turn, cancel unstarted
 * tools, emit synthetic tool_results + notice + nudge once on the same
 * model before surfacing refusal.
 */
export function* prepareSameModelRefusalRetry(deps: {
  lastStreamedForRefusal: AssistantMessage
  messagesForQuery: Message[]
  assistantMessages: AssistantMessage[]
  toolResults: (UserMessage | AttachmentMessage)[]
  streamingToolExecutor: StreamingToolExecutor
  toolUseContext: ToolUseContext
  toolRequestedEndTurn: ToolEndTurnSource | false
  currentModel: string
  lastDeltaOutputTokens: number | undefined
  attributeMcpUsage: boolean
  clearActiveMcpStamps: (
    opts: ToolUseContext['options'],
    enabled: boolean,
  ) => void
}): Generator<
  QueryLoopEvent,
  | {
      shouldRetry: true
      nextMessages: Message[]
      toolRequestedEndTurn: ToolEndTurnSource | false
    }
  | {
      shouldRetry: false
      toolRequestedEndTurn: ToolEndTurnSource | false
    }
> {
  const {
    lastStreamedForRefusal,
    messagesForQuery,
    assistantMessages,
    toolResults,
    streamingToolExecutor,
    toolUseContext,
    currentModel,
    lastDeltaOutputTokens,
    attributeMcpUsage,
    clearActiveMcpStamps,
  } = deps
  let toolRequestedEndTurn = deps.toolRequestedEndTurn

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
      toolUseContext.getAppState().transcripts?.[toolUseContext.agentId ?? '']
        ?.inProgressToolUseIDs ?? [],
    )
    streamingToolExecutor.discard()
    clearActiveMcpStamps(toolUseContext.options, attributeMcpUsage)
    const kept = assistantMessages.filter(m => m !== lastStreamedForRefusal)
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
    return {
      shouldRetry: true,
      nextMessages: [
        ...messagesForQuery,
        ...kept,
        ...toolResults,
        ...notRunResults,
        refusalNudge,
      ],
      toolRequestedEndTurn,
    }
  }
  yield lastStreamedForRefusal
  return { shouldRetry: false, toolRequestedEndTurn }
}

export type TruncatedCutPlan = {
  attempt: number
  nextServerErrorCutRetryCount: number
  nextMaxOutputTokensRecoveryCount: number
  waitMs: number | undefined
}

export function planTruncatedCutRetry(deps: {
  streamCutErr: unknown
  serverErrorCutRetryCount: number
  maxOutputTokensRecoveryCount: number
}): TruncatedCutPlan | undefined {
  const {
    streamCutErr,
    serverErrorCutRetryCount,
    maxOutputTokensRecoveryCount,
  } = deps
  const useServerCutWait =
    streamCutErr !== undefined &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_dreamy_flute', false)
  if (useServerCutWait) {
    return serverErrorCutRetryCount + 1 <= MAX_SERVER_ERROR_CUT_RETRIES
      ? {
          attempt: serverErrorCutRetryCount + 1,
          nextServerErrorCutRetryCount: serverErrorCutRetryCount + 1,
          nextMaxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount,
          waitMs: getRetryDelay(serverErrorCutRetryCount + 1),
        }
      : undefined
  }
  return maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT
    ? {
        attempt: maxOutputTokensRecoveryCount + 1,
        nextServerErrorCutRetryCount: serverErrorCutRetryCount,
        nextMaxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
        waitMs: undefined,
      }
    : undefined
}

export async function* waitForTruncatedCutRetry(deps: {
  streamCutErr: unknown
  waitMs: number
  attempt: number
  uuid: () => string
  signal: AbortSignal
}): AsyncGenerator<QueryLoopEvent, boolean> {
  yield buildCutRetryWaitMessage(
    deps.streamCutErr,
    deps.waitMs,
    deps.attempt,
    deps.uuid,
  )
  await sleep(deps.waitMs, deps.signal)
  return deps.signal.aborted
}

/**
 * Evaluates post-stop-hook filters (BriefTool enforce filter, recovery log,
 * preventContinuation, storage flush, maxTurns, stop-hook block cap).
 */
export async function* evaluateStopHookOutcome(deps: {
  stopHookResult: StopHookOutcomeInput
  messagesForQuery: Message[]
  assistantMessages: AssistantMessage[]
  toolUseContext: ToolUseContext
  stopHookActive: boolean | undefined
  stopHookBlockCount: number
  turnCount: number
  maxTurns: number | undefined
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<
  QueryLoopEvent,
  | { action: 'return'; terminal: Terminal }
  | {
      action: 'retry_blocking'
      blockingErrors: Message[]
      nextBlockCount: number
      nextTurnCountOnBlock: number
    }
  | { action: 'proceed' }
> {
  const {
    stopHookResult,
    messagesForQuery,
    assistantMessages,
    toolUseContext,
    stopHookActive,
    stopHookBlockCount,
    turnCount,
    maxTurns,
    leftoverDrainSpinnerModes,
  } = deps

  let blockingErrors = stopHookResult.blockingErrors
  if (
    blockingErrors.length > 0 &&
    hasBriefRepliedInTranscript(messagesForQuery)
  ) {
    blockingErrors = blockingErrors.filter(msg => {
      if (msg.type !== 'user') return true
      const content = msg.message?.content
      return !(
        typeof content === 'string' && content.includes(BRIEF_ENFORCE_SENTINEL)
      )
    })
  }

  const stopHookIsSubagent = toolUseContext.agentId !== undefined
  const stopHookGoalActive =
    !stopHookIsSubagent && toolUseContext.getAppState().activeGoal !== undefined
  if (stopHookBlockCount > 0 && blockingErrors.length === 0) {
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
      action: 'return',
      terminal: {
        reason: stopHookResult.aborted
          ? 'aborted_streaming'
          : 'stop_hook_prevented',
      },
    }
  }

  if (blockingErrors.length > 0) {
    try {
      const { flushSessionStorage } = await import('../utils/sessionStorage.js')
      await flushSessionStorage()
    } catch (err) {
      logForDebugging(
        `Stop continuation persist wait failed: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }
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
      return {
        action: 'return',
        terminal: { reason: 'max_turns', turnCount: nextTurnCountOnBlock },
      }
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
      if (toolUseContext.agentType !== 'teammate' && !stopHookIsSubagent) {
        try {
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
          // never fail the turn on toast
        }
      }
      yield* runTurnEndReactions(
        [...messagesForQuery, ...assistantMessages],
        toolUseContext,
        stopHookActive,
      )
      yield* leftoverDrainSpinnerModes()
      return { action: 'return', terminal: { reason: 'completed' } }
    }
    return {
      action: 'retry_blocking',
      blockingErrors,
      nextBlockCount,
      nextTurnCountOnBlock,
    }
  }

  return { action: 'proceed' }
}

/**
 * Handles tool-phase abort cleanup: Chicago MCP release, interruption message
 * (unless suppressed), max_turns_reached attachment if over limit, spinner drain.
 */
export async function* handleAbortedToolsExit(deps: {
  toolUseContext: ToolUseContext
  turnCount: number
  maxTurns: number | undefined
  leftoverDrainSpinnerModes: () => Generator<QueryLoopEvent>
}): AsyncGenerator<QueryLoopEvent, Terminal> {
  const { toolUseContext, turnCount, maxTurns, leftoverDrainSpinnerModes } =
    deps
  await cleanupChicagoMcpIfMainThread(toolUseContext)
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
