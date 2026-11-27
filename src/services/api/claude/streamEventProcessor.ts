import { feature } from 'bun:bundle'
import type {
  BetaContentBlock,
  BetaRawMessageStreamEvent,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { CONTEXT_1M_BETA_HEADER } from 'src/constants/betas.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import {
  onMessageDeltaCostCredit,
  onMessageStopCostCredit,
} from 'src/services/api/streamCostCredit.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import { headlessProfilerCheckpoint } from 'src/utils/headlessProfiler.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import { endQueryProfile, queryCheckpoint } from 'src/utils/queryProfiler.js'
import {
  getServedModelsForRequestedModel,
  recordServedModels,
} from '../../../bootstrap/state.js'
import type { Tools } from '../../../Tool.js'
import type { ConnectorTextDelta } from '../../../types/connectorText.js'
import type {
  AssistantMessage,
  Message,
  MessageContent,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import { markContext1mBetaRefusedForModel } from '../../../utils/betaRefusals.js'
import { markOrgEffortCapNotified } from '../../../utils/effort.js'
import {
  createAssistantAPIErrorMessage,
  createSystemMessage,
  decomposeBatchedToolUses,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import {
  getPublicModelDisplayName,
  normalizeModelStringForAPI,
} from '../../../utils/model/model.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import { extractQuotaStatusFromHeaders } from '../../claudeAiLimits.js'
import { bedrockAdapter } from '../../providerUsage/adapters/bedrock.js'
import { updateProviderBuckets } from '../../providerUsage/store.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  type Context1mBetaRetryPhase,
  getErrorMessageIfRefusal,
} from '../errors.js'
import { EMPTY_USAGE } from '../logging.js'
import { checkResponseForCacheBreak } from '../promptCacheBreakDetection.js'
import {
  serverClassifierEnvelope,
  settleSafeguardOnMessage,
} from '../serverClassifier.js'
import { FallbackTriggeredError } from '../withRetry.js'
import { recordMediaItemCapSuccess } from './apiErrorAdaptation.js'
import { lastAssistantMessageId } from './messageParams.js'
import { isResumedUsageMessageDelta } from './streamResumption.js'
import {
  type ApiRequestAdaptationState,
  type Options,
  type PreparedAnthropicContext,
  type PreparedMessagesAndTools,
  type QueryModelRuntimeState,
  type StreamAttemptLoopState,
  type StreamEnvelopeState,
  StreamMalformedEventError,
  StreamNoEventsError,
  StreamTruncatedError,
  SUPPRESS_ABANDONED_BLOCK_STOP_TYPES,
} from './types.js'
import { updateUsage } from './usage.js'

const STALL_THRESHOLD_MS = 30_000 // 30 seconds

export function createInitialEnvelopeState(): StreamEnvelopeState {
  return {
    streamMessageEnvelopeOpen: false,
    openBlockIndexForEnvelope: null,
    openBlockSuppressStop: false,
    currentApiMessageId: null,
    abandonedFromBlockIndex: 0,
  }
}

export function* closeAbandonedStreamEnvelope(
  envelope: StreamEnvelopeState,
  {
    responseUnfinished,
  }: {
    responseUnfinished: boolean
  },
): Generator<StreamEvent, void, unknown> {
  if (!envelope.streamMessageEnvelopeOpen) {
    return
  }
  const blockToClose = envelope.openBlockSuppressStop
    ? null
    : envelope.openBlockIndexForEnvelope
  envelope.streamMessageEnvelopeOpen = false
  envelope.openBlockIndexForEnvelope = null
  envelope.openBlockSuppressStop = false
  const idPart =
    envelope.currentApiMessageId !== null
      ? { apiMessageId: envelope.currentApiMessageId }
      : undefined
  if (blockToClose !== null) {
    yield {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: blockToClose },
      ...idPart,
    } as StreamEvent
  }
  yield {
    type: 'stream_event',
    event: { type: 'message_stop' },
    ...idPart,
    ...(responseUnfinished &&
    envelope.currentApiMessageId !== null &&
    Number.isSafeInteger(envelope.abandonedFromBlockIndex)
      ? {
          abandonedBlocks: {
            apiMessageId: envelope.currentApiMessageId,
            fromBlockIndex: envelope.abandonedFromBlockIndex,
          },
        }
      : undefined),
  } as StreamEvent
}

export async function* processStreamEvent(deps: {
  part: BetaRawMessageStreamEvent
  tools: Tools
  signal: AbortSignal
  options: Options
  prepared: PreparedMessagesAndTools
  anthropicCtx: PreparedAnthropicContext
  adaptation: ApiRequestAdaptationState
  runtime: QueryModelRuntimeState
  attempt: StreamAttemptLoopState
  clearStreamIdleTimers: () => void
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  'continue' | 'return'
> {
  const {
    part,
    tools,
    signal,
    options,
    prepared,
    anthropicCtx,
    adaptation,
    runtime,
    attempt,
    clearStreamIdleTimers,
  } = deps

  // densable 2.1.314 Uqe (#1362) + jLt (#1358) — on first real stream
  // event after retry, latch tool search off and emit org effort cap warning once.
  if (attempt.streamEventsReceived === 0) {
    if (options._toolSearchRefusalRetried) {
      try {
        const { latchToolSearchOffForSession } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../utils/searchExtraTools.js') as typeof import('../../../utils/searchExtraTools.js')
        latchToolSearchOffForSession()
        logForDebugging(
          '[ToolSearch] the endpoint answered the request sent without tool search, so this conversation goes on without it',
        )
      } catch {
        // optional
      }
    }
    if (
      typeof adaptation.effort === 'string' &&
      typeof anthropicCtx.requestedEffort === 'string' &&
      adaptation.effort !== anthropicCtx.requestedEffort &&
      markOrgEffortCapNotified(options.model)
    ) {
      yield createSystemMessage(
        `Your organization limits effort for ${getPublicModelDisplayName(options.model)}, so Claude Code is using '${adaptation.effort}' instead of '${anthropicCtx.requestedEffort}'. Your effort setting is unchanged.`,
        'warning',
      )
    }
  }
  // densable: Cl++; Mc??=Math.round(performance.now()-ve)
  attempt.streamEventsReceived++
  attempt.msToFirstEvent ??= Math.round(
    performance.now() - attempt.streamLoopStartedAt,
  )
  const now = Date.now()

  // Detect and log streaming stalls (only after first event to avoid counting TTFB)
  if (attempt.lastEventTime !== null) {
    const timeSinceLastEvent = now - attempt.lastEventTime
    if (timeSinceLastEvent > STALL_THRESHOLD_MS) {
      attempt.stallCount++
      attempt.totalStallTime += timeSinceLastEvent
      logForDebugging(
        `Streaming stall detected: ${(timeSinceLastEvent / 1000).toFixed(1)}s gap between events (stall #${attempt.stallCount})`,
        { level: 'warn' },
      )
      logEvent('tengu_streaming_stall', {
        stall_duration_ms: timeSinceLastEvent,
        stall_count: attempt.stallCount,
        total_stall_time_ms: attempt.totalStallTime,
        event_type:
          part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        request_id: (runtime.streamRequestId ??
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }
  attempt.lastEventTime = now

  if (attempt.isFirstChunk) {
    logForDebugging('Stream started - received first chunk')
    queryCheckpoint('query_first_chunk_received')
    if (!options.agentId) {
      headlessProfilerCheckpoint('first_chunk')
    }
    endQueryProfile()
    attempt.isFirstChunk = false
  }

  // densable V2s/ikd: materialize server-lane fallback content_block_start
  // into QueryEvent server_fallback (midStream salvage / deferred hd).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      parseServerFallbackContentBlockStart,
      isMalformedServerFallbackBlockStart,
      buildMidStreamServerFallbackEvent,
      isServerFallbackHopReason,
    } =
      require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
    const hop = parseServerFallbackContentBlockStart(part)
    const malformed = !hop && isMalformedServerFallbackBlockStart(part)
    if (hop || malformed) {
      runtime.isAdvisorInProgress = false
    }
    if (hop) {
      logEvent('tengu_rotunda_pennant_materialized', {
        armed: options.serverRefusalFallback !== undefined,
        block_index: hop.index ?? -1,
        non_streaming: false,
      })
      // densable: if not armed, ignore hop (continue without yield)
      if (options.serverRefusalFallback === undefined) {
        return 'continue'
      }
      if (isServerFallbackHopReason(hop.reason)) {
        // hi — server hop served on refusal/sticky
      }
      runtime.lastServerFallbackHop = hop
      // densable: rewrite partial + yielded models to hop.model
      if (runtime.partialMessage !== undefined) {
        runtime.partialMessage = {
          ...(runtime.partialMessage as object),
          model: hop.model,
        } as typeof runtime.partialMessage
      }
      for (const msg of runtime.newMessages) {
        if (msg.message) {
          msg.message.model = hop.model as typeof msg.message.model
        }
      }
      if (runtime.newMessages.length === 0) {
        // densable hd — defer until Xs flush (no partials yet)
        runtime.deferredServerFallbackHop = hop
      } else if (!isServerFallbackHopReason(hop.reason)) {
        runtime.serverFallbackEmitted = true
        runtime.deferredServerFallbackHop = undefined
        yield buildMidStreamServerFallbackEvent({
          hop,
          messages: [],
          requestId: runtime.streamRequestId ?? null,
        }) as unknown as StreamEvent
      } else {
        runtime.serverFallbackEmitted = true
        runtime.deferredServerFallbackHop = undefined
        const sf = buildMidStreamServerFallbackEvent({
          hop,
          messages: runtime.newMessages as unknown as Array<{
            uuid?: string
            isApiErrorMessage?: boolean
            message?: { content?: unknown; model?: string }
          }>,
          requestId: runtime.streamRequestId ?? null,
        })
        // densable: drop discarded (tool-bearing) from Al / He
        if (sf.discardedMessages.length > 0) {
          const drop = new Set(
            sf.discardedMessages.map(m => (m as { uuid?: string }).uuid),
          )
          for (let i = runtime.newMessages.length - 1; i >= 0; i--) {
            if (drop.has(runtime.newMessages[i]!.uuid)) {
              runtime.newMessages.splice(i, 1)
            }
          }
        }
        yield sf as unknown as StreamEvent
      }
      return 'continue'
    }
    if (malformed) {
      const idx =
        typeof (part as { index?: unknown }).index === 'number'
          ? (part as { index: number }).index
          : -1
      if (idx >= 0) runtime.malformedFallbackBlockIndexes.add(idx)
      logForDebugging('cli_malformed_fallback_block', {
        level: 'warn',
      })
      logEvent('tengu_rotunda_pennant_malformed', {
        block_index: idx,
        non_streaming: false,
      })
      return 'continue'
    }
    // densable: skip content_block_stop for malformed fallback indexes
    if (
      part.type === 'content_block_stop' &&
      runtime.malformedFallbackBlockIndexes.has(part.index)
    ) {
      return 'continue'
    }
  } catch {
    // densable optional — production path must not break stream
  }

  switch (part.type) {
    case 'message_start': {
      attempt.streamMessageInProgress = true
      if (runtime.confirmPendingMaxTokensCeiling) {
        runtime.confirmPendingMaxTokensCeiling()
        runtime.confirmPendingMaxTokensCeiling = undefined
      }
      runtime.partialMessage = part.message
      // Official 2.1.328 `Kys` (`chunk@294254613.js:3439150`): latch
      // served model alias so `stripForeignThinkingBlocks` recognizes it.
      if (part.message?.model) {
        const reqModelKey = normalizeModelStringForAPI(options.model)
        if (part.message.model !== reqModelKey) {
          const existingServed = getServedModelsForRequestedModel(reqModelKey)
          if (existingServed instanceof Set) {
            existingServed.add(part.message.model)
          } else {
            recordServedModels(reqModelKey, new Set([part.message.model]))
          }
        }
      }
      runtime.ttftMs = Date.now() - runtime.start
      runtime.usage = updateUsage(runtime.usage, part.message?.usage)
      // Capture research from message_start if available (internal only).
      if (
        process.env.USER_TYPE === 'ant' &&
        'research' in (part.message as unknown as Record<string, unknown>)
      ) {
        runtime.research = (
          part.message as unknown as Record<string, unknown>
        ).research
      }
      break
    }
    case 'content_block_start':
      if (attempt.closedContentBlocks.has(part.index)) {
        logEvent('tengu_streaming_error', {
          error_type:
            'content_block_closed_start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_type:
            part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_index: part.index,
        })
        throw new StreamMalformedEventError('closed')
      }
      // densable: switch(To=!1, us.content_block.type); at=us.index
      attempt.messageDeltaCompleted = false
      attempt.openContentBlockIndex = part.index
      switch (part.content_block.type) {
        case 'tool_use':
          runtime.contentBlocks[part.index] = {
            ...part.content_block,
            input: '',
          }
          break
        case 'server_tool_use':
          runtime.contentBlocks[part.index] = {
            ...part.content_block,
            input: '' as unknown as { [key: string]: unknown },
          }
          if ((part.content_block.name as string) === 'advisor') {
            runtime.isAdvisorInProgress = true
            logForDebugging(`[AdvisorTool] Advisor tool called`)
            logEvent('tengu_advisor_tool_call', {
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              advisor_model: (prepared.advisorModel ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
          }
          break
        case 'text':
          runtime.textDeltas.set(part.index, [])
          runtime.contentBlocks[part.index] = {
            ...part.content_block,
            text: '',
          }
          break
        case 'thinking':
          runtime.contentBlocks[part.index] = {
            ...part.content_block,
            thinking: '',
            signature: '',
          }
          break
        default:
          runtime.contentBlocks[part.index] = { ...part.content_block }
          if ((part.content_block.type as string) === 'advisor_tool_result') {
            runtime.isAdvisorInProgress = false
            logForDebugging(`[AdvisorTool] Advisor tool result received`)
          }
          break
      }
      break
    case 'content_block_delta': {
      const contentBlock = runtime.contentBlocks[part.index]
      const delta = part.delta as typeof part.delta | ConnectorTextDelta
      const blockAlreadyClosed = attempt.closedContentBlocks.has(part.index)
      if (!contentBlock || !blockAlreadyClosed) {
        attempt.messageDeltaCompleted = false
      }
      if (!contentBlock || blockAlreadyClosed) {
        logEvent('tengu_streaming_error', {
          error_type: (contentBlock
            ? 'content_block_closed_delta'
            : 'content_block_not_found_delta') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_type:
            part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_index: part.index,
        })
        throw new StreamMalformedEventError(
          contentBlock ? 'closed' : 'unstarted',
        )
      }
      let handledConnectorText = false
      if (feature('CONNECTOR_TEXT')) {
        if (delta.type === 'connector_text_delta') {
          handledConnectorText = true
          if (contentBlock.type !== 'connector_text') {
            logEvent('tengu_streaming_error', {
              error_type:
                'content_block_type_mismatch_connector_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              expected_type:
                'connector_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              actual_type:
                contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw new Error('Content block is not a connector_text block')
          }
          ;(contentBlock as { connector_text: string }).connector_text +=
            delta.connector_text
        }
      }
      if (!handledConnectorText) {
        switch (delta.type) {
          case 'citations_delta': {
            // Official 2.1.328 (`chunk@294254613.js:3441470`): append
            // delta.citation onto text content block's citations array.
            if (contentBlock.type !== 'text') break
            const citation = (delta as { citation?: unknown }).citation
            if (typeof citation === 'object' && citation !== null) {
              const textBlock = contentBlock as {
                citations?: unknown[]
              }
              textBlock.citations = [...(textBlock.citations ?? []), citation]
            }
            break
          }
          case 'input_json_delta':
            if (
              contentBlock.type !== 'tool_use' &&
              contentBlock.type !== 'server_tool_use'
            ) {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_type_mismatch_input_json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                expected_type:
                  'tool_use' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                actual_type:
                  contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              throw new Error('Content block is not a input_json block')
            }
            if (typeof contentBlock.input !== 'string') {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_input_not_string' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                input_type:
                  typeof contentBlock.input as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              throw new Error('Content block input is not a string')
            }
            contentBlock.input += delta.partial_json
            break
          case 'text_delta':
            if (contentBlock.type !== 'text') {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_type_mismatch_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                expected_type:
                  'text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                actual_type:
                  contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              throw new Error('Content block is not a text block')
            }
            runtime.textDeltas.get(part.index)?.push(delta.text!)
            break
          case 'signature_delta': {
            let handledConnectorSig = false
            if (feature('CONNECTOR_TEXT')) {
              if (contentBlock.type === 'connector_text') {
                contentBlock.signature = delta.signature
                handledConnectorSig = true
              }
            }
            if (handledConnectorSig) {
              break
            }
            if (contentBlock.type !== 'thinking') {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_type_mismatch_thinking_signature' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                expected_type:
                  'thinking' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                actual_type:
                  contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              throw new Error('Content block is not a thinking block')
            }
            contentBlock.signature = delta.signature
            break
          }
          case 'thinking_delta': {
            // Official 2.1.328 (`chunk@294254613.js:3442480`): accumulate
            // estimated_tokens and break cleanly on redacted_thinking.
            const estTokens = (delta as { estimated_tokens?: unknown })
              .estimated_tokens
            if (typeof estTokens === 'number' && Number.isFinite(estTokens)) {
              attempt.thinkingEstimatedTokens += estTokens
            }
            if (contentBlock.type === 'redacted_thinking') {
              break
            }
            if (contentBlock.type !== 'thinking') {
              logEvent('tengu_streaming_error', {
                error_type:
                  'content_block_type_mismatch_thinking_delta' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                expected_type:
                  'thinking' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                actual_type:
                  contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              throw new StreamMalformedEventError('unreadable')
            }
            ;(contentBlock as { thinking: string }).thinking += delta.thinking
            break
          }
        }
      }
      // Capture research from content_block_delta if available (internal only).
      if (process.env.USER_TYPE === 'ant' && 'research' in part) {
        runtime.research = (part as { research: unknown }).research
      }
      break
    }
    case 'content_block_stop': {
      const contentBlock = runtime.contentBlocks[part.index]
      const blockAlreadyClosed = attempt.closedContentBlocks.has(part.index)
      if (!contentBlock || !blockAlreadyClosed) {
        attempt.messageDeltaCompleted = false
      }
      if (!contentBlock || blockAlreadyClosed) {
        logEvent('tengu_streaming_error', {
          error_type: (contentBlock
            ? 'content_block_closed_stop'
            : 'content_block_not_found_stop') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_type:
            part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_index: part.index,
        })
        throw new StreamMalformedEventError(
          contentBlock ? 'closed' : 'unstarted',
        )
      }
      // densable: To=!1, at=null
      attempt.openContentBlockIndex = null
      if (!runtime.partialMessage) {
        logEvent('tengu_streaming_error', {
          error_type:
            'partial_message_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          part_type:
            part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw new Error('Message not found')
      }
      // Merge accumulated text deltas into the content block (O(n) join instead of O(n^2) +=)
      const deltas = runtime.textDeltas.get(part.index)
      if (deltas) {
        ;(contentBlock as { text: string }).text = deltas.join('')
        runtime.textDeltas.delete(part.index)
      }
      // densable {content,batchToolUses}=qXe(Owe([ar],…), r)
      const { content: Co, batchToolUses: Fo } = decomposeBatchedToolUses(
        normalizeContentFromAPI(
          [contentBlock] as BetaContentBlock[],
          tools,
          options.agentId,
          {
            requestId: runtime.streamRequestId ?? undefined,
            messageId: runtime.partialMessage.id,
          },
        ),
        tools,
      )
      const m: AssistantMessage = {
        message: {
          ...runtime.partialMessage,
          usage: { ...runtime.usage },
          content: Co as MessageContent,
        },
        ...(Fo.length > 0 && { batchToolUses: Fo }),
        requestId: runtime.streamRequestId ?? undefined,
        type: 'assistant',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        ...(runtime.research !== undefined && { research: runtime.research }),
        ...(prepared.advisorModel && { advisorModel: prepared.advisorModel }),
        // densable ...Ie!==void 0&&{effort:Ie}
        ...(adaptation.effortLevelForTranscript !== undefined && {
          effort: adaptation.effortLevelForTranscript,
        }),
        ...(adaptation.serverClassifierRequest !== undefined &&
          serverClassifierEnvelope(adaptation.serverClassifierRequest)),
      }
      runtime.newMessages.push(m)
      attempt.closedContentBlocks.add(part.index)
      yield m
      break
    }
    case 'message_delta': {
      runtime.usage = updateUsage(runtime.usage, part.usage)
      if (
        'context_management' in (part as unknown as Record<string, unknown>) &&
        (part as unknown as { context_management?: unknown })
          .context_management !== undefined
      ) {
        attempt.contextManagementResponse = (
          part as unknown as { context_management?: unknown }
        ).context_management
      }
      if (
        adaptation.serverClassifierRequest !== undefined &&
        typeof part.delta === 'object' &&
        part.delta !== null &&
        'safeguard_results' in part.delta
      ) {
        settleSafeguardOnMessage(
          adaptation.serverClassifierRequest,
          part.delta,
          runtime.contentBlocks,
        )
      }
      // Official 2.1.328 `cyt(ml)` (`chunk@294254613.js:3445450`):
      // when `wrapStreamWithResumption` seamlessly resumed a paused
      // stream, record the paused segment in `pausedResponses` and
      // reset per-segment accumulators to the resumed stream's usage.
      if (isResumedUsageMessageDelta(part)) {
        attempt.pausedResponses.push({
          limit: part.paused_limit,
          usage: runtime.usage,
          finishedBlocks: attempt.closedContentBlocks.size,
          requestId: attempt.pausedRequestId ?? undefined,
          resumedRequestId: runtime.streamRequestId ?? undefined,
        })
        attempt.pausedRequestId = runtime.streamRequestId
        runtime.streamCostCredit = 'none'
        attempt.thinkingEstimatedTokens = 0
        runtime.stopReason = null
        runtime.usage = updateUsage(
          EMPTY_USAGE,
          part.resumed_usage as Parameters<typeof updateUsage>[1],
        )
        if (runtime.partialMessage !== undefined) {
          const partialRec = runtime.partialMessage as unknown as Record<
            string,
            unknown
          >
          partialRec.pausedResponses = attempt.pausedResponses
          partialRec.usage = runtime.usage
        }
      }
      // Capture research from message_delta if available (internal only).
      if (
        process.env.USER_TYPE === 'ant' &&
        'research' in (part as unknown as Record<string, unknown>)
      ) {
        runtime.research = (part as unknown as Record<string, unknown>).research
        for (const msg of runtime.newMessages) {
          msg.research = runtime.research
        }
      }

      // densable G2s — mint fallback_credit_token from stop_details once
      // and scrub sensitive/transient fields (`fallback_credit_token`,
      // `resumption`, `resumption_token`) before writing stop_details back.
      const deltaRec = part.delta as unknown as {
        stop_reason?: string | null
        stop_details?: Record<string, unknown> | null
        resumable?: unknown
      }
      try {
        if (
          deltaRec.stop_details !== undefined &&
          deltaRec.stop_details !== null
        ) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { planFallbackCreditMint } =
            require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
          const mint = planFallbackCreditMint({
            stopDetails: deltaRec.stop_details,
            alreadyMinted: runtime.fallbackCreditMinted,
          })
          if (
            typeof deltaRec.stop_details === 'object' &&
            deltaRec.stop_details !== null
          ) {
            if ('fallback_credit_token' in deltaRec.stop_details) {
              delete deltaRec.stop_details.fallback_credit_token
            }
            delete deltaRec.stop_details.resumption
            delete deltaRec.stop_details.resumption_token
          }
          if (mint.creditCode !== undefined) {
            runtime.mintedFallbackCreditCode = mint.creditCode
            if (mint.shouldLogMint) {
              runtime.fallbackCreditMinted = true
              logEvent('tengu_fallback_credit_minted', {
                request_id: (runtime.streamRequestId ??
                  'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                model:
                  options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                fallback_target_model: (options.refusalFallbackModel ??
                  options.serverRefusalFallback?.model ??
                  'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                token_length: mint.creditCode.length,
                query_source:
                  options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
            }
          }
        }
      } catch {
        // densable optional
      }

      // Write final usage, stop_reason, stop_details, context_management,
      // resumable, and pausedResponses back to ALL yielded messages
      // (direct property mutation so lazy transcript flush sees updates).
      const frameStopReason =
        typeof part.delta.stop_reason === 'string'
          ? part.delta.stop_reason
          : null
      if (frameStopReason !== null) {
        runtime.stopReason = frameStopReason
        attempt.messageDeltaCompleted = true
      }
      const partRec = part as unknown as { resumable?: unknown }
      const resumableFlag =
        typeof deltaRec.resumable === 'boolean'
          ? deltaRec.resumable
          : typeof partRec.resumable === 'boolean'
            ? partRec.resumable
            : undefined

      for (const msg of runtime.newMessages) {
        msg.message.usage = runtime.usage
        msg.message.stop_reason = runtime.stopReason
        const msgInner = msg.message as unknown as Record<string, unknown>
        if (frameStopReason !== null || runtime.stopReason === null) {
          msgInner.stop_details = deltaRec.stop_details ?? null
        }
        if (attempt.contextManagementResponse !== undefined) {
          msgInner.context_management = attempt.contextManagementResponse
        }
        if (resumableFlag !== undefined) {
          msgInner.resumable = resumableFlag
        }
        if (attempt.pausedResponses.length > 0) {
          msgInner.pausedResponses = attempt.pausedResponses
        }
      }
      options.onMessageDelta?.(runtime.newMessages)

      // densable non-mid end hop: !ui && di (lastHop / deferred)
      if (
        options.serverRefusalFallback !== undefined &&
        !runtime.serverFallbackEmitted
      ) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const {
            buildNonMidStreamServerFallbackEvent,
            planDeferredServerFallbackFlush,
          } =
            require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
          const hop =
            runtime.lastServerFallbackHop ?? runtime.deferredServerFallbackHop
          if (hop !== undefined) {
            runtime.serverFallbackEmitted = true
            runtime.deferredServerFallbackHop = undefined
            yield buildNonMidStreamServerFallbackEvent({
              fromModel: hop.fromModel,
              toModel: hop.model,
              reason: hop.reason,
              apiRefusalCategory: hop.category,
              requestId: runtime.streamRequestId ?? null,
              finalStopReason: runtime.stopReason,
            }) as unknown as StreamEvent
          } else {
            const deferred = planDeferredServerFallbackFlush({
              deferredHop: runtime.deferredServerFallbackHop,
              alreadyEmitted: runtime.serverFallbackEmitted,
              requestId: runtime.streamRequestId ?? null,
            })
            if (deferred) {
              runtime.serverFallbackEmitted = true
              runtime.deferredServerFallbackHop = undefined
              yield deferred as unknown as StreamEvent
            }
          }
        } catch {
          // densable optional
        }
      }

      // densable #38 cost credit gate (gr) — pure transition in streamCostCredit.ts
      {
        const credit = onMessageDeltaCostCredit(
          runtime.streamCostCredit,
          runtime.stopReason,
        )
        runtime.streamCostCredit = credit.next
        if (credit.shouldCredit) {
          const costUSDForPart = calculateUSDCost(
            prepared.resolvedModel,
            runtime.usage as unknown as BetaUsage,
          )
          runtime.costUSD += addToTotalSessionCost(
            costUSDForPart,
            runtime.usage as unknown as BetaUsage,
            options.model,
            anthropicCtx.sessionCostAttribution,
          )
        }
      }

      const stopDetailsForRefusal = (
        part.delta as {
          stop_details?: {
            category?: string | null
            explanation?: string | null
            cyber_verification?: unknown
          }
        }
      ).stop_details
      const refusalMessage = getErrorMessageIfRefusal(
        part.delta.stop_reason,
        options.model,
        stopDetailsForRefusal,
      )
      if (refusalMessage) {
        let refusalHandledByFallback = false
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const {
            getSwitchModelsOnFlag,
            isRefusalFallbackEnabled,
            runRefusalFallbackDialogFlow,
            getProviderRefusalFallbackGuidanceText,
            resolveStreamRefusalFallbackTarget,
            resolveRefusalSilentAttempt,
            normalizeApiRefusalCategory,
          } =
            require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
          const stopDetails = (
            part.delta as {
              stop_details?: {
                category?: string | null
                explanation?: string | null
              }
            }
          ).stop_details
          const apiRefusalCategory = stopDetails?.category ?? null
          const armedFallback =
            options.refusalFallbackModel ?? options.fallbackModel
          if (
            isRefusalFallbackEnabled() &&
            armedFallback &&
            armedFallback !== options.model
          ) {
            const isMainThread = options.agentId === undefined
            const silentAttempt = resolveRefusalSilentAttempt({
              silentArmActive: options.refusalFallbackSilentArmActive,
              modelLane: options.refusalFallbackModelLane,
            })
            let targetModel: string | undefined = armedFallback
            if (apiRefusalCategory != null) {
              const routed = resolveStreamRefusalFallbackTarget({
                originalModel: options.model,
                armedFallbackModel: armedFallback,
                apiRefusalCategory,
              })
              void normalizeApiRefusalCategory(apiRefusalCategory)
              if (routed.route?.matched === 'none') {
                targetModel = undefined
              } else {
                targetModel = routed.fallbackModel ?? armedFallback
              }
            }
            if (targetModel === undefined) {
              try {
                const { buildRefusalNoFallbackEvent } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
                yield buildRefusalNoFallbackEvent(
                  'route_declined',
                ) as unknown as StreamEvent
              } catch {
                // densable optional
              }
            } else if (options.refusalFallbackHandledByCaller === true) {
              // Official 2.1.328 (`chunk@294254613.js:3449563`):
              // yield `fallback_request` and return cleanly so query.ts
              // owns the multi-hop dialog & retry chain.
              refusalHandledByFallback = true
              clearStreamIdleTimers()
              const { buildFallbackRequestEvent } =
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
              yield buildFallbackRequestEvent({
                originalModel: options.model,
                fallbackModel: targetModel,
                requestId: runtime.streamRequestId ?? null,
                apiRefusalCategory,
                apiRefusalExplanation: stopDetails?.explanation ?? null,
                creditCode: runtime.mintedFallbackCreditCode ?? null,
                silentArmAtTrigger: silentAttempt,
              }) as unknown as StreamEvent
              return 'return'
            } else if (
              options.refusalFallbackPreferencePending === true &&
              silentAttempt !== true
            ) {
              // densable ke=Jn — skip FXl; query.ts qa on fallback_request
              refusalHandledByFallback = true
              try {
                const { buildFallbackRequestEvent } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
                yield buildFallbackRequestEvent({
                  originalModel: options.model,
                  fallbackModel: targetModel,
                  requestId: runtime.streamRequestId ?? null,
                  apiRefusalCategory,
                  apiRefusalExplanation: stopDetails?.explanation ?? null,
                  creditCode: runtime.mintedFallbackCreditCode ?? null,
                  silentArmAtTrigger: silentAttempt,
                }) as unknown as StreamEvent
              } catch (e) {
                if (e instanceof FallbackTriggeredError) throw e
              }
              throw new FallbackTriggeredError(
                options.model,
                targetModel,
                'refusal',
              )
            } else {
              const flow = await runRefusalFallbackDialogFlow({
                decision: {
                  isMainThread,
                  requestDialog: options.requestDialog,
                  silentAttempt,
                  switchModelsOnFlag: getSwitchModelsOnFlag(),
                },
                requestDialog: options.requestDialog,
                signal,
                payload: {
                  originalModel: options.model,
                  fallbackModel: targetModel,
                  apiRefusalCategory,
                  guidanceText: getProviderRefusalFallbackGuidanceText(
                    getAPIProvider() === 'firstParty',
                  ),
                },
              })
              if (flow.shouldSwitchToFallback) {
                refusalHandledByFallback = true
                try {
                  const {
                    buildFallbackRequestEvent,
                    matchRefusalFallbackRoute,
                  } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
                  let routeMatched: 'category' | 'catch_all' | 'none' | null =
                    null
                  if (apiRefusalCategory != null) {
                    const route = matchRefusalFallbackRoute({
                      originalModelCanonical: options.model,
                      armedFallbackModel: targetModel,
                      apiRefusalCategory,
                    })
                    routeMatched =
                      route.matched === 'none'
                        ? 'none'
                        : route.matched === 'category'
                          ? 'category'
                          : route.matched === 'catch_all'
                            ? 'catch_all'
                            : null
                  }
                  yield buildFallbackRequestEvent({
                    originalModel: options.model,
                    fallbackModel: targetModel,
                    requestId: runtime.streamRequestId ?? null,
                    apiRefusalCategory,
                    apiRefusalExplanation: stopDetails?.explanation ?? null,
                    creditCode: runtime.mintedFallbackCreditCode ?? null,
                    silentArmAtTrigger: silentAttempt,
                    routeMatched,
                  }) as unknown as StreamEvent
                } catch (e) {
                  if (e instanceof FallbackTriggeredError) throw e
                  // densable yield optional
                }
                try {
                  const {
                    getMainLoopModelOverride,
                    markRefusalFallbackOccurred,
                    setMainLoopModelOverride,
                    setRefusalFallbackModelLatch,
                  } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('../../../bootstrap/state.js') as typeof import('../../../bootstrap/state.js')
                  const { applyRefusalFallbackLatchArm } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
                  applyRefusalFallbackLatchArm({
                    fallbackModel: targetModel,
                    previousOverride: getMainLoopModelOverride(),
                    setLatch: setRefusalFallbackModelLatch,
                    setMainLoopModelOverride,
                    markOccurred: markRefusalFallbackOccurred,
                  })
                } catch {
                  // bootstrap latch optional
                }
                throw new FallbackTriggeredError(
                  options.model,
                  targetModel,
                  'refusal',
                )
              }
              if (
                !flow.shouldSwitchToFallback &&
                flow.choice !== 'retry_fallback'
              ) {
                try {
                  const { buildRefusalNoFallbackEvent } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
                  const reason =
                    flow.suppressReason === 'no_consumer_capability'
                      ? 'no_consumer_capability'
                      : flow.choice === 'edit_prompt'
                        ? 'dialog_declined'
                        : 'dialog_declined'
                  yield buildRefusalNoFallbackEvent(
                    reason,
                  ) as unknown as StreamEvent
                } catch {
                  // densable optional
                }
              }
            }
          } else if (
            isRefusalFallbackEnabled() &&
            (!armedFallback || armedFallback === options.model)
          ) {
            try {
              const { buildRefusalNoFallbackEvent } =
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
              yield buildRefusalNoFallbackEvent(
                'not_armed',
              ) as unknown as StreamEvent
            } catch {
              // densable optional
            }
          }
        } catch (e) {
          if (e instanceof FallbackTriggeredError) throw e
          // densable optional
        }
        if (!refusalHandledByFallback) {
          yield refusalMessage
        }
      }

      if (runtime.stopReason === 'max_tokens') {
        logEvent('tengu_max_tokens_reached', {
          max_tokens: runtime.maxOutputTokens,
        })
        yield createAssistantAPIErrorMessage({
          content: `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
            runtime.maxOutputTokens
          } output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`,
          apiError: 'max_output_tokens',
          error: 'max_output_tokens',
        })
      }

      if (runtime.stopReason === 'model_context_window_exceeded') {
        logEvent('tengu_context_window_exceeded', {
          max_tokens: runtime.maxOutputTokens,
          output_tokens: runtime.usage.output_tokens,
        })
        yield createAssistantAPIErrorMessage({
          content: `${API_ERROR_MESSAGE_PREFIX}: The model has reached its context window limit.`,
          apiError: 'max_output_tokens',
          error: 'max_output_tokens',
        })
      }
      break
    }
    case 'message_stop':
      attempt.streamMessageInProgress = false
      // densable: if (gr==="pending") gr="credited"; tr+=Zce(...)
      {
        const credit = onMessageStopCostCredit(runtime.streamCostCredit)
        runtime.streamCostCredit = credit.next
        if (credit.shouldCredit) {
          const costUSDForStop = calculateUSDCost(
            prepared.resolvedModel,
            runtime.usage as unknown as BetaUsage,
          )
          runtime.costUSD += addToTotalSessionCost(
            costUSDForStop,
            runtime.usage as unknown as BetaUsage,
            options.model,
            anthropicCtx.sessionCostAttribution,
          )
        }
        if (adaptation.serverClassifierRequest !== undefined) {
          settleSafeguardOnMessage(
            adaptation.serverClassifierRequest,
            {
              ...(runtime.partialMessage ?? {}),
              content: runtime.contentBlocks,
            },
            runtime.contentBlocks,
          )
        }
      }
      break
  }

  const envelope = attempt.envelope
  const includeApiMessageId =
    envelope.streamMessageEnvelopeOpen || part.type === 'message_start'
  if (part.type === 'message_start') {
    envelope.streamMessageEnvelopeOpen = true
    envelope.openBlockIndexForEnvelope = null
    envelope.openBlockSuppressStop = false
    const msgId = (part.message as { id?: unknown }).id
    envelope.currentApiMessageId =
      typeof msgId === 'string' && msgId !== '' ? msgId : null
  } else if (part.type === 'content_block_start') {
    envelope.openBlockIndexForEnvelope = part.index
    envelope.openBlockSuppressStop = SUPPRESS_ABANDONED_BLOCK_STOP_TYPES.has(
      part.content_block.type,
    )
  } else if (part.type === 'content_block_stop') {
    envelope.openBlockIndexForEnvelope = null
    envelope.openBlockSuppressStop = false
    if (Number.isSafeInteger(part.index) && part.index >= 0) {
      envelope.abandonedFromBlockIndex = Math.max(
        envelope.abandonedFromBlockIndex,
        part.index + 1,
      )
    }
  } else if (part.type === 'message_stop') {
    envelope.streamMessageEnvelopeOpen = false
    envelope.openBlockIndexForEnvelope = null
    envelope.openBlockSuppressStop = false
    recordMediaItemCapSuccess({
      options,
      resolvedModel: prepared.resolvedModel,
      sessionIdForMediaCap: prepared.sessionIdForMediaCap,
      mediaTakenOut: prepared.mediaTakenOut,
      state: adaptation,
    })
    // Official GLt (2.1.295 #358) — lock context-1m beta removal on success.
    const active1mPhase =
      adaptation.context1mBetaRetryPhase as Context1mBetaRetryPhase
    if (active1mPhase === 'retrying' || active1mPhase === 'guessing') {
      const unnamed = active1mPhase === 'guessing'
      adaptation.context1mBetaRetryPhase = 'spent'
      adaptation.betas = adaptation.betas.filter(
        b => b !== CONTEXT_1M_BETA_HEADER,
      )
      markContext1mBetaRefusedForModel(options.model)
      logEvent('tengu_beta_400_healed', {
        beta: CONTEXT_1M_BETA_HEADER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        provider:
          getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        status: 400,
        unnamed,
      })
    }
  }

  yield {
    type: 'stream_event',
    event: part,
    ...(part.type === 'message_start' ? { ttftMs: runtime.ttftMs } : undefined),
    ...(includeApiMessageId && envelope.currentApiMessageId !== null
      ? { apiMessageId: envelope.currentApiMessageId }
      : undefined),
  } as StreamEvent

  return 'continue'
}

export async function* finalizeCompletedStream(deps: {
  messages: Message[]
  signal: AbortSignal
  options: Options
  runtime: QueryModelRuntimeState
  attempt: StreamAttemptLoopState
  clearStreamIdleTimers: () => void
}): AsyncGenerator<StreamEvent, 'done' | 'return'> {
  const { messages, signal, options, runtime, attempt, clearStreamIdleTimers } =
    deps

  // densable Xs() — flush deferred server_fallback hop when stream ends
  // without midStream emission (no assistant partials at hop time).
  if (
    options.serverRefusalFallback !== undefined &&
    !runtime.serverFallbackEmitted &&
    runtime.deferredServerFallbackHop !== undefined
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { planDeferredServerFallbackFlush } =
        require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
      const deferred = planDeferredServerFallbackFlush({
        deferredHop: runtime.deferredServerFallbackHop,
        alreadyEmitted: runtime.serverFallbackEmitted,
        requestId: runtime.streamRequestId ?? null,
      })
      if (deferred) {
        runtime.serverFallbackEmitted = true
        runtime.deferredServerFallbackHop = undefined
        yield deferred as unknown as StreamEvent
      }
    } catch {
      // densable optional
    }
  }
  // Clear the idle timeout watchdog now that the stream loop has exited
  clearStreamIdleTimers()

  // Official 2.1.328 (`chunk@294254613.js:3451812-3452600`): check
  // signal.aborted FIRST after clean loop exit so an abort before or
  // during streaming yields envelope cleanup and returns cleanly rather
  // than throwing StreamNoEventsError / StreamTruncatedError.
  if (signal.aborted) {
    yield* closeAbandonedStreamEnvelope(attempt.envelope, {
      responseUnfinished: true,
    })
    return 'return'
  }

  // If the stream was aborted by our idle timeout watchdog, fall back to
  // non-streaming retry rather than treating it as a completed stream.
  if (attempt.streamIdleAborted) {
    const exitDelayMs =
      attempt.streamWatchdogFiredAt !== null
        ? Math.round(performance.now() - attempt.streamWatchdogFiredAt)
        : -1
    logForDiagnosticsNoPII(
      'info',
      'cli_stream_loop_exited_after_watchdog_clean',
    )
    logEvent('tengu_stream_loop_exited_after_watchdog', {
      request_id: (runtime.streamRequestId ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      exit_delay_ms: exitDelayMs,
      exit_path:
        'clean' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    attempt.streamWatchdogFiredAt = null
    throw new Error('Stream idle timeout - no chunks received')
  }
  if (attempt.streamSuspendedError !== undefined) {
    throw attempt.streamSuspendedError
  }

  // Official 2.1.328 `Lpr` (`chunk@294254613.js:3452198`): clean EOF
  // inside an open content block is a dropped connection, not a complete reply.
  if (
    attempt.streamMessageInProgress &&
    attempt.openContentBlockIndex !== null
  ) {
    logForDebugging(
      `Stream ended cleanly inside open block ${attempt.openContentBlockIndex} (stop_reason=${runtime.stopReason}) — treating as a dropped connection`,
      { level: 'error' },
    )
    throw new StreamTruncatedError()
  }

  // Detect when the stream completed without producing any assistant messages (`Dpr`).
  if (
    !runtime.partialMessage ||
    (runtime.newMessages.length === 0 && !runtime.stopReason)
  ) {
    logForDebugging(
      !runtime.partialMessage
        ? 'Stream completed without receiving message_start event - triggering non-streaming fallback'
        : 'Stream completed with message_start but no content blocks completed - triggering non-streaming fallback',
      { level: 'error' },
    )
    logEvent('tengu_stream_no_events', {
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      request_id: (runtime.streamRequestId ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    throw new StreamNoEventsError()
  }

  // Official 2.1.328 `Lpr` (`chunk@294254613.js:3452753`): clean EOF
  // before a terminal message_delta (stop_reason !== null && messageDeltaCompleted)
  // while the message is still open is a truncated stream.
  if (
    attempt.streamMessageInProgress &&
    !(runtime.stopReason !== null && attempt.messageDeltaCompleted)
  ) {
    logForDebugging(
      `Stream ended cleanly mid-response (stop_reason=${runtime.stopReason}, terminal=${attempt.messageDeltaCompleted}) — treating as a dropped connection`,
      { level: 'error' },
    )
    throw new StreamTruncatedError()
  }

  // Log summary if any stalls occurred during streaming
  if (attempt.stallCount > 0) {
    logForDebugging(
      `Streaming completed with ${attempt.stallCount} stall(s), total stall time: ${(attempt.totalStallTime / 1000).toFixed(1)}s`,
      { level: 'warn' },
    )
    logEvent('tengu_streaming_stall_summary', {
      stall_count: attempt.stallCount,
      total_stall_time_ms: attempt.totalStallTime,
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      request_id: (runtime.streamRequestId ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Check if the cache actually broke based on response tokens
  if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
    void checkResponseForCacheBreak(
      options.querySource,
      runtime.usage.cache_read_input_tokens,
      runtime.usage.cache_creation_input_tokens,
      messages,
      options.agentId,
      runtime.streamRequestId,
      lastAssistantMessageId(messages),
    )
  }

  // Process fallback percentage header and quota status if available
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const resp = runtime.streamResponse as unknown as Response | undefined
  if (resp) {
    extractQuotaStatusFromHeaders(resp.headers, Date.now(), {
      querySource: options.querySource,
    })
    if (getAPIProvider() === 'bedrock') {
      updateProviderBuckets(
        'bedrock',
        bedrockAdapter.parseHeaders(resp.headers),
      )
    }
    runtime.responseHeaders = resp.headers
  }

  return 'done'
}
