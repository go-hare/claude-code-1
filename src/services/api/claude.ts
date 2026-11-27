import { APIUserAbortError } from '@anthropic-ai/sdk/error'
import type {
  BetaJSONOutputFormat,
  BetaMessageDeltaUsage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaStopReason,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import { randomUUID } from 'crypto'
import { setLastMainRequestId } from 'src/bootstrap/state.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { isClaudeAISubscriber } from 'src/utils/auth.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import { isFastModeEnabled } from 'src/utils/fastMode.js'
import { headlessProfilerCheckpoint } from 'src/utils/headlessProfiler.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import { queryCheckpoint } from 'src/utils/queryProfiler.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import { getEmptyToolPermissionContext, type Tools } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import {
  clearContext1mBetaRefusedModels,
  isContext1mBetaRefusedForModel,
  markContext1mBetaRefusedForModel,
} from '../../utils/betaRefusals.js'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'
import { checkStreamIdleSuspend } from '../../utils/firstByteWatchdog.js'
import { captureAPIRequest } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import {
  getSmallFastModel,
  isNonCustomOpusModel,
} from '../../utils/model/model.js'
import {
  resolveSessionActivityAgentId,
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { sleep } from '../../utils/sleep.js'
import {
  isStreamPingEvent,
  withStreamKeepAlivePings,
} from '../../utils/streamKeepAlive.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js'
import { getDynamicConfig_BLOCKS_ON_INIT } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
  convertToolsToLangfuse,
} from '../langfuse/convert.js'
import { recordLLMObservation } from '../langfuse/index.js'
import {
  getRefusedToolSchemas,
  RefusedToolSchemaResolver,
} from '../mcp/mcpToolSchema.js'
import { withStreamingVCR, withVCR } from '../vcr.js'
import {
  createApiErrorAdapter,
  handleMidConvCreateError,
} from './claude/apiErrorAdaptation.js'
import {
  addCacheBreakpoints,
  appendSystemReminderToLastUserMessage,
  assistantMessageToMessageParam,
  stripEmptyUserTextBlocks,
  userMessageToMessageParam,
} from './claude/messageParams.js'
import {
  executeNonStreamingRequest,
  handleRetryError,
  handleStreamingError,
  verifyApiKey,
} from './claude/nonStreamingFallback.js'
import {
  getCacheControl,
  getPromptCachingEnabled,
  should1hCacheTTL,
} from './claude/promptCaching.js'
import {
  adjustParamsForNonStreaming,
  configureTaskBudgetParams,
  getAPIMetadata,
  getExtraBodyParams,
  getMaxOutputTokensForModel,
  MAX_NON_STREAMING_TOKENS,
} from './claude/requestParams.js'
import {
  createParamsFromContext,
  logInitialAPIQuery,
} from './claude/requestParamsBuilder.js'
import {
  prepareAnthropicRequestContext,
  prepareNormalizedMessagesAndTools,
} from './claude/requestPrep.js'
import {
  createInitialEnvelopeState,
  finalizeCompletedStream,
  processStreamEvent,
} from './claude/streamEventProcessor.js'
import {
  buildResumptionRequestParams,
  isResumedUsageMessageDelta,
  MAX_STREAM_RESUMPTIONS,
  type ParsedResumptionPause,
  type PausedResponseLimit,
  type PausedResponseRecord,
  parseResumptionPauseDelta,
  RESUMPTION_BETA_HEADER,
  type ResumedMessageDeltaEvent,
  type ResumptionStreamState,
  STREAM_RESUMPTION_FLAG,
  type WrapStreamWithResumptionOptions,
  wrapMidStreamTlsErrorAsTruncated,
  wrapStreamWithResumption,
} from './claude/streamResumption.js'
import {
  buildCutShortErrorForMessage,
  buildCutShortErrorForNonStreamingResponse,
  buildSystemPromptBlocks,
  clearSessionMediaItemCap,
  computeDeferredToolNamesForRequest,
  countStoredMediaItems,
  getHeldInlineTools,
  getLastAnnouncedDeferredTools,
  getSessionMediaItemCap,
  latchDeclaredTools,
  MEDIA_ITEM_LIMIT_STEPS,
  maybeAppendDeferredToolsAnnouncement,
  resetLastAnnouncedDeferredTools,
  resolveCarriedEffortForModel,
  runWithActiveModelRedirectTracking,
  setSessionMediaItemCap,
  shouldTriggerToolSearchRefusal,
  takeCarriedEffortEndForMainQuery,
} from './claude/toolAndMediaHelpers.js'
import {
  type ApiRequestAdaptationState,
  type HaikuOptions,
  type Options,
  OutputFilteredStreamRetryError,
  type QueryModelRuntimeState,
  type QueryWithModelOptions,
  type StreamAttemptLoopState,
  StreamMalformedEventError,
  StreamNoEventsError,
  StreamTruncatedError,
  ToolSearchRefusalError,
} from './claude/types.js'
import { accumulateUsage, cleanupStream, updateUsage } from './claude/usage.js'
import { CLIENT_REQUEST_ID_HEADER, getAnthropicClient } from './client.js'
import {
  CUSTOM_OFF_SWITCH_MESSAGE,
  getAssistantMessageFromError,
} from './errors.js'
import { EMPTY_USAGE, logAPISuccessAndDuration } from './logging.js'
import { getModelRedirectTrackingState } from './modelRedirectGuard.js'
import { recordApiRequestForReplay } from './requestReplay.js'
import { ThinkingOnlyStreamRetryError } from './thinkingOnlyStreamRetry.js'
import { withRetry } from './withRetry.js'

export {
  accumulateUsage,
  addCacheBreakpoints,
  adjustParamsForNonStreaming,
  appendSystemReminderToLastUserMessage,
  assistantMessageToMessageParam,
  buildCutShortErrorForMessage,
  buildCutShortErrorForNonStreamingResponse,
  buildResumptionRequestParams,
  buildSystemPromptBlocks,
  cleanupStream,
  clearContext1mBetaRefusedModels,
  clearSessionMediaItemCap,
  computeDeferredToolNamesForRequest,
  configureTaskBudgetParams,
  countStoredMediaItems,
  executeNonStreamingRequest,
  getAPIMetadata,
  getCacheControl,
  getExtraBodyParams,
  getHeldInlineTools,
  getLastAnnouncedDeferredTools,
  getMaxOutputTokensForModel,
  getPromptCachingEnabled,
  getSessionMediaItemCap,
  isContext1mBetaRefusedForModel,
  isResumedUsageMessageDelta,
  latchDeclaredTools,
  markContext1mBetaRefusedForModel,
  MAX_NON_STREAMING_TOKENS,
  MAX_STREAM_RESUMPTIONS,
  maybeAppendDeferredToolsAnnouncement,
  MEDIA_ITEM_LIMIT_STEPS,
  parseResumptionPauseDelta,
  resetLastAnnouncedDeferredTools,
  resolveCarriedEffortForModel,
  RESUMPTION_BETA_HEADER,
  setSessionMediaItemCap,
  should1hCacheTTL,
  shouldTriggerToolSearchRefusal,
  StreamMalformedEventError,
  StreamNoEventsError,
  StreamTruncatedError,
  stripEmptyUserTextBlocks,
  takeCarriedEffortEndForMainQuery,
  ToolSearchRefusalError,
  updateUsage,
  userMessageToMessageParam,
  verifyApiKey,
  wrapMidStreamTlsErrorAsTruncated,
  wrapStreamWithResumption,
}

export type {
  Options,
  ParsedResumptionPause,
  PausedResponseLimit,
  PausedResponseRecord,
  ResumedMessageDeltaEvent,
  ResumptionStreamState,
  WrapStreamWithResumptionOptions,
}

export async function queryModelWithoutStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  // Store the assistant message but continue consuming the generator to ensure
  // logAPISuccessAndDuration gets called (which happens after all yields)
  let assistantMessage: AssistantMessage | undefined
  for await (const message of withStreamingVCR(messages, async function* () {
    yield* queryModel(
      messages,
      systemPrompt,
      thinkingConfig,
      tools,
      signal,
      options,
    )
  })) {
    if (message.type === 'assistant') {
      assistantMessage = message as AssistantMessage
    }
  }
  if (!assistantMessage) {
    if (signal.aborted) {
      throw new APIUserAbortError()
    }
    throw new Error('No assistant message found')
  }
  return assistantMessage
}

export async function* queryModelWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  return yield* withStreamingVCR(messages, async function* () {
    yield* queryModel(
      messages,
      systemPrompt,
      thinkingConfig,
      tools,
      signal,
      options,
    )
  })
}

async function* queryModel(
  messages: Message[],
  systemPrompt: SystemPrompt,
  thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  // Check cheap conditions first — the off-switch await blocks on GrowthBook
  // init (~10ms). For non-Opus models (haiku, sonnet) this skips the await
  // entirely. Subscribers don't hit this path at all.
  if (
    !isClaudeAISubscriber() &&
    isNonCustomOpusModel(options.model) &&
    (
      await getDynamicConfig_BLOCKS_ON_INIT<{ activated: boolean }>(
        'tengu-off-switch',
        {
          activated: false,
        },
      )
    ).activated
  ) {
    logEvent('tengu_off_switch_query', {})
    yield getAssistantMessageFromError(
      new Error(CUSTOM_OFF_SWITCH_MESSAGE),
      options.model,
    )
    return
  }

  const prepared = await prepareNormalizedMessagesAndTools(
    messages,
    tools,
    options,
  )

  // OpenAI-compatible provider: delegate to the OpenAI adapter layer
  // after shared preprocessing (message normalization, tool filtering,
  // media stripping) but before Anthropic-specific logic (betas, thinking, caching).
  if (getAPIProvider() === 'openai') {
    const { queryModelOpenAI } = await import('./openai/index.js')
    yield* queryModelOpenAI(messages, systemPrompt, tools, signal, options)
    return
  }

  if (getAPIProvider() === 'gemini') {
    const { queryModelGemini } = await import('./gemini/index.js')
    yield* queryModelGemini(
      messages,
      systemPrompt,
      prepared.filteredTools,
      signal,
      options,
      thinkingConfig,
    )
    return
  }

  if (getAPIProvider() === 'grok') {
    const { queryModelGrok } = await import('./grok/index.js')
    yield* queryModelGrok(
      messages,
      systemPrompt,
      prepared.filteredTools,
      signal,
      options,
    )
    return
  }

  const anthropicCtx = prepareAnthropicRequestContext({
    messages,
    systemPrompt,
    tools,
    options,
    prepared,
  })

  const adaptation: ApiRequestAdaptationState = {
    betas: prepared.betas,
    messagesForAPI: prepared.messagesForAPI,
    midConvFallback: prepared.midConvFallback,
    system: anthropicCtx.system,
    effort: anthropicCtx.effort,
    effortLevelForTranscript: undefined,
    lastRequestBetas: undefined,
    lastRequestBedrockBetas: [],
    strippedBedrockBetas: new Set<string>(),
    lastSentThinkingDisplay: undefined,
    lastSentBindingControls: false,
    lastSentTokenCount: false,
    lastBindingControlsOnThirdParty: false,
    prefixLockStripAttempt: 0,
    lastSentClearToolUses: false,
    clearToolUsesDisabledForRequest: false,
    pendingMediaCap: undefined,
    context1mBetaRetryPhase: 'idle',
    toolSchemaResolver: new RefusedToolSchemaResolver(getRefusedToolSchemas()),
    lastSentToolSchemas: undefined,
    targetedMediaStripCounts: new Map<string, number>(),
    loggedEffortClamp: false,
    serverClassifierRequest: undefined,
  }

  const runtime: QueryModelRuntimeState = {
    startIncludingRetries: Date.now(),
    start: Date.now(),
    attemptNumber: 0,
    attemptStartTimes: [],
    streamRequestId: undefined,
    clientRequestId: undefined,
    streamResponse: undefined,
    redirectTrackingState: getModelRedirectTrackingState() ?? {},
    newMessages: [],
    ttftMs: 0,
    partialMessage: undefined,
    contentBlocks: [],
    textDeltas: new Map<number, string[]>(),
    usage: EMPTY_USAGE,
    costUSD: 0,
    stopReason: null,
    streamCostCredit: 'none',
    didFallBackToNonStreaming: false,
    fallbackMessage: undefined,
    maxOutputTokens: 0,
    responseHeaders: undefined,
    research: undefined,
    isFastModeRequest: anthropicCtx.isFastMode,
    isAdvisorInProgress: false,
    serverFallbackEmitted: false,
    fallbackCreditMinted: false,
    mintedFallbackCreditCode: undefined,
    deferredServerFallbackHop: undefined,
    lastServerFallbackHop: undefined,
    malformedFallbackBlockIndexes: new Set<number>(),
    thinkingOnlyWatchdogRetryCount: 0,
    thinkingOnlyStaleRetryCount: 0,
    outputFilteredRetryCount: 0,
    confirmPendingMaxTokensCeiling: undefined,
  }

  let stream: Stream<BetaRawMessageStreamEvent> | undefined
  let activeResumptionAbortController: AbortController | undefined
  let releaseResumptionAbortListener: (() => void) | undefined

  // Release all stream resources to prevent native memory leaks.
  // The Response object holds native TLS/socket buffers that live outside the
  // V8 heap (observed on the Node.js/npm path; see GH #32920), so we must
  // explicitly cancel and release it regardless of how the generator exits.
  function releaseStreamResources(): void {
    releaseResumptionAbortListener?.()
    releaseResumptionAbortListener = undefined
    if (activeResumptionAbortController) {
      activeResumptionAbortController.abort()
      activeResumptionAbortController = undefined
    }
    cleanupStream(stream)
    stream = undefined
    if (runtime.streamResponse) {
      runtime.streamResponse.body?.cancel().catch(() => {})
      runtime.streamResponse = undefined
    }
  }

  const onThinkingDisplayApiError = createApiErrorAdapter({
    options,
    resolvedModel: prepared.resolvedModel,
    sessionIdForMediaCap: prepared.sessionIdForMediaCap,
    mediaTakenOut: prepared.mediaTakenOut,
    useSearchExtraTools: prepared.useSearchExtraTools,
    filteredTools: prepared.filteredTools,
    buildSystem: anthropicCtx.buildSystem,
    state: adaptation,
  })

  const paramsFromContext = createParamsFromContext({
    messages,
    thinkingConfig,
    options,
    resolvedModel: prepared.resolvedModel,
    isAgenticQuery: prepared.isAgenticQuery,
    useBetas: anthropicCtx.useBetas,
    allTools: anthropicCtx.allTools,
    afkHeaderLatched: anthropicCtx.afkHeaderLatched,
    fastModeHeaderLatched: anthropicCtx.fastModeHeaderLatched,
    state: adaptation,
  })

  const langfuseThinking = logInitialAPIQuery({
    paramsFromContext,
    options,
    thinkingConfig,
    useBetas: anthropicCtx.useBetas,
    isFastMode: anthropicCtx.isFastMode,
    previousRequestId: prepared.previousRequestId,
  })

  // Official $Qn/$BQn second arg (HOn) — declared outside try so finally can stop.
  const sessionActivityAgentId = resolveSessionActivityAgentId({
    agentContext: options.agentContext ?? getAgentContext(),
    isBackgroundAgent: options.isBackgroundAgent,
    agentId: options.agentId,
  })

  // Official 2.1.328 `Wno` (`chunk@294254613.js:3202790`): capture client +
  // request params so server-side `pause_turn` / `stop_details.resumption.token`
  // can transparently open a resumed stream.
  let lastStreamClient:
    | Awaited<ReturnType<typeof getAnthropicClient>>
    | undefined
  let lastStreamParams: BetaMessageStreamParams | undefined

  // densable labeled stream loop (`e:`): withRetry + for-await + partial path.
  while (true) {
    try {
      try {
        runtime.confirmPendingMaxTokensCeiling = undefined
        queryCheckpoint('query_client_creation_start')
        const generator = withRetry(
          () =>
            getAnthropicClient({
              maxRetries: 0, // Disabled auto-retry in favor of manual implementation
              model: options.model,
              fetchOverride: options.fetchOverride,
              source: options.querySource,
              agentContext: options.agentContext ?? getAgentContext(),
              credentials: options.credentials,
              storageV5: options.storageV5,
            }),
          async (anthropic, attemptNum, context) => {
            runtime.attemptNumber = attemptNum
            runtime.isFastModeRequest = context.fastMode ?? false
            runtime.start = Date.now()
            runtime.attemptStartTimes.push(runtime.start)
            queryCheckpoint('query_client_creation_end')

            const params = paramsFromContext(context)
            lastStreamClient = anthropic
            lastStreamParams = params
            captureAPIRequest(params, options.querySource)
            void recordApiRequestForReplay({
              params: params as unknown as Record<string, unknown>,
              querySource: options.querySource,
              agentId: options.agentId,
            })

            runtime.maxOutputTokens = params.max_tokens

            queryCheckpoint('query_api_request_sent')
            if (!options.agentId) {
              headlessProfilerCheckpoint('api_request_sent')
            }

            runtime.clientRequestId =
              getAPIProvider() === 'firstParty' &&
              isFirstPartyAnthropicBaseUrl()
                ? randomUUID()
                : undefined
            if (runtime.clientRequestId) {
              const { armStreamFirstByte } = await import(
                'src/utils/firstByteWatchdog.js'
              )
              armStreamFirstByte(runtime.clientRequestId)
            }

            try {
              const result = await runWithActiveModelRedirectTracking(
                () =>
                  anthropic.beta.messages
                    .create(
                      { ...params, stream: true },
                      {
                        signal,
                        ...(runtime.clientRequestId && {
                          headers: {
                            [CLIENT_REQUEST_ID_HEADER]: runtime.clientRequestId,
                          },
                        }),
                      },
                    )
                    .withResponse(),
                runtime.redirectTrackingState,
              )
              queryCheckpoint('query_response_headers_received')
              runtime.streamRequestId = result.request_id
              runtime.streamResponse = result.response
              return result.data
            } catch (createError) {
              handleMidConvCreateError(createError, params, adaptation)
            }
          },
          {
            model: options.model,
            fallbackModel: options.fallbackModel,
            thinkingConfig,
            ...(isFastModeEnabled()
              ? { fastMode: anthropicCtx.isFastMode }
              : false),
            signal,
            querySource: options.querySource,
            onError: onThinkingDisplayApiError,
            onRetryStatus: options.onRetryStatus,
            deferMaxTokensCeilingConfirmation: true,
            onPendingMaxTokensCeiling: pending => {
              runtime.confirmPendingMaxTokensCeiling = pending.confirm
            },
          },
        )

        let e
        do {
          e = await generator.next()

          // yield API error messages (the stream has a 'controller' property, error messages don't)
          if (!('controller' in e.value)) {
            yield e.value
          }
        } while (!e.done)
        stream = e.value as Stream<BetaRawMessageStreamEvent>

        // reset per-attempt state
        runtime.newMessages.length = 0
        runtime.ttftMs = 0
        runtime.partialMessage = undefined
        runtime.contentBlocks.length = 0
        runtime.textDeltas.clear()
        runtime.usage = EMPTY_USAGE
        runtime.stopReason = null
        runtime.streamCostCredit = 'none'
        runtime.isAdvisorInProgress = false

        const attempt: StreamAttemptLoopState = {
          streamMessageInProgress: false,
          messageDeltaCompleted: false,
          openContentBlockIndex: null,
          closedContentBlocks: new Set<number>(),
          thinkingEstimatedTokens: 0,
          contextManagementResponse: undefined,
          pausedResponses: [],
          pausedRequestId: runtime.streamRequestId,
          envelope: createInitialEnvelopeState(),
          streamIdleAborted: false,
          streamSuspendedError: undefined,
          streamWatchdogFiredAt: null,
          streamLoopStartedAt: performance.now(),
          lastEventTime: null,
          streamEventsReceived: 0,
          msToFirstEvent: null,
          isFirstChunk: true,
          totalStallTime: 0,
          stallCount: 0,
        }

        let streamWatchdogEnabled = !isEnvDefinedFalsy(
          process.env.CLAUDE_ENABLE_STREAM_WATCHDOG,
        )
        let STREAM_IDLE_TIMEOUT_MS = Math.max(
          parseInt(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS || '', 10) || 0,
          300_000,
        )
        let byteStreamIdleTimeoutMs = STREAM_IDLE_TIMEOUT_MS
        try {
          const {
            isStreamWatchdogEnabled,
            resolveStreamIdleTimeoutMs,
            resolveByteStreamIdleTimeoutMs,
          } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../utils/streamWatchdogGates.js') as typeof import('../../utils/streamWatchdogGates.js')
          streamWatchdogEnabled = isStreamWatchdogEnabled()
          STREAM_IDLE_TIMEOUT_MS = resolveStreamIdleTimeoutMs()
          byteStreamIdleTimeoutMs = resolveByteStreamIdleTimeoutMs({
            provider: getAPIProvider(),
          })
        } catch {
          // densable optional — keep inline fallbacks above
        }
        const STREAM_IDLE_WARNING_MS = STREAM_IDLE_TIMEOUT_MS / 2
        // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
        const streamResponseForChunkTimes = runtime.streamResponse as
          | Response
          | undefined
        const readResponseChunkTimes = (
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          res: Response | undefined,
        ): { lastAt: number } | undefined => {
          try {
            const { getResponseChunkTimes } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../../utils/bodyIdleWatchdog.js') as typeof import('../../utils/bodyIdleWatchdog.js')
            return getResponseChunkTimes(res)
          } catch {
            return undefined
          }
        }
        const chunkTimesRef: { current: { lastAt: number } | undefined } = {
          current: readResponseChunkTimes(streamResponseForChunkTimes),
        }
        let stallPollTimer: ReturnType<typeof setTimeout> | null = null
        let stallStatusActive = false
        let stallPollMs = 20_000
        let stallDt = byteStreamIdleTimeoutMs
        let stallGraceMs = 0
        try {
          const { getAdvisorStallPollMs, resolveAdvisorStallGraceMs } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../utils/advisorNetworkStall.js') as typeof import('../../utils/advisorNetworkStall.js')
          stallPollMs = getAdvisorStallPollMs()
          const grace = resolveAdvisorStallGraceMs({
            byteIdleTimeoutMs: byteStreamIdleTimeoutMs,
            streamWatchdogEnabled,
            streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
            pollMs: stallPollMs,
          })
          stallDt = grace.dt
          stallGraceMs = grace.graceMs
        } catch {
          // pure helper optional
        }
        let streamIdleWarningTimer: ReturnType<typeof setTimeout> | null = null
        let streamIdleTimer: ReturnType<typeof setTimeout> | null = null
        function clearStreamIdleTimers(): void {
          if (stallPollTimer !== null) {
            clearTimeout(stallPollTimer)
            stallPollTimer = null
          }
          if (stallStatusActive) {
            stallStatusActive = false
            options.onRetryStatus?.(null)
          }
          if (streamIdleWarningTimer !== null) {
            clearTimeout(streamIdleWarningTimer)
            streamIdleWarningTimer = null
          }
          if (streamIdleTimer !== null) {
            clearTimeout(streamIdleTimer)
            streamIdleTimer = null
          }
        }
        function scheduleNetworkStallPoll(): void {
          const activeChunkTimes = chunkTimesRef.current
          if (!options.onRetryStatus || !activeChunkTimes) return
          const lastAtAtSchedule = activeChunkTimes.lastAt
          const armedAt = performance.now()
          stallPollTimer = setTimeout(() => {
            if (performance.now() - armedAt < stallPollMs / 2) return
            const currentChunkTimes = chunkTimesRef.current
            if (!currentChunkTimes) return
            try {
              const { decideAdvisorNetworkStallPoll } =
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../utils/advisorNetworkStall.js') as typeof import('../../utils/advisorNetworkStall.js')
              const decision = decideAdvisorNetworkStallPoll({
                lastAtAtSchedule,
                lastAtNow: currentChunkTimes.lastAt,
                streamStartedAt: attempt.streamLoopStartedAt,
                now: performance.now(),
                wallNow: Date.now(),
                isAdvisorInProgress: runtime.isAdvisorInProgress,
                graceMs: stallGraceMs,
                dt: stallDt,
              })
              if (decision.action === 'reschedule') {
                scheduleNetworkStallPoll()
                return
              }
              stallStatusActive = true
              options.onRetryStatus?.(decision.status)
            } catch {
              // helper unavailable — skip UI
            }
          }, stallPollMs)
          stallPollTimer.unref?.()
        }
        function resetStreamIdleTimer(): void {
          clearStreamIdleTimers()
          scheduleNetworkStallPoll()
          if (!streamWatchdogEnabled) {
            return
          }
          streamIdleWarningTimer = setTimeout(
            warnMs => {
              logForDebugging(
                `Streaming idle warning: no chunks received for ${warnMs / 1000}s`,
                { level: 'warn' },
              )
              logForDiagnosticsNoPII('warn', 'cli_streaming_idle_warning')
            },
            STREAM_IDLE_WARNING_MS,
            STREAM_IDLE_WARNING_MS,
          )
          const armedAt = performance.now()
          const wallArmedAt = Date.now()
          streamIdleTimer = setTimeout(() => {
            const suspendedErr = checkStreamIdleSuspend(
              {
                monotonicNow: () => performance.now(),
                now: () => Date.now(),
              },
              { armedAt, wallArmedAt, idleMs: STREAM_IDLE_TIMEOUT_MS },
            )
            if (suspendedErr !== undefined) {
              attempt.streamSuspendedError = suspendedErr
              releaseStreamResources()
              return
            }
            attempt.streamIdleAborted = true
            attempt.streamWatchdogFiredAt = performance.now()
            logForDebugging(
              `Streaming idle timeout: no chunks received for ${STREAM_IDLE_TIMEOUT_MS / 1000}s, aborting stream`,
              { level: 'error' },
            )
            logForDiagnosticsNoPII('error', 'cli_streaming_idle_timeout')
            logEvent('tengu_streaming_idle_timeout', {
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              request_id: (runtime.streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              timeout_ms: STREAM_IDLE_TIMEOUT_MS,
            })
            releaseStreamResources()
          }, STREAM_IDLE_TIMEOUT_MS)
        }
        resetStreamIdleTimer()

        // Official $Qn("api_call", HOn(agentContext) ?? (isBackgroundAgent ? agentId))
        startSessionActivity('api_call', sessionActivityAgentId)
        try {
          const CONSECUTIVE_PING_CAP = 30
          let consecutivePingCount = 0

          // Official 2.1.328 `Wno` (`chunk@294254613.js:3202790, 3435194`):
          // wrap stream with transparent server-side `pause_turn` /
          // `stop_details.resumption.token` resumption when enabled.
          const streamResumptionActive =
            lastStreamClient !== undefined &&
            lastStreamParams !== undefined &&
            (options.enableStreamResumption === true ||
              (adaptation.lastRequestBetas?.includes(RESUMPTION_BETA_HEADER) ===
                true &&
                getFeatureValue_CACHED_MAY_BE_STALE(
                  STREAM_RESUMPTION_FLAG,
                  false,
                )))
          const activeEventStream: AsyncIterable<BetaRawMessageStreamEvent> =
            streamResumptionActive && lastStreamClient && lastStreamParams
              ? (() => {
                  const resumptionClient = lastStreamClient
                  const { messages: initialWireMessages, ...replayedParams } =
                    lastStreamParams
                  return wrapStreamWithResumption(stream, {
                    messages: initialWireMessages,
                    replayed: replayedParams,
                    isCancelled: () =>
                      signal.aborted ||
                      attempt.streamIdleAborted ||
                      attempt.streamSuspendedError !== undefined,
                    canResume: () =>
                      options.enableStreamResumption === true ||
                      getFeatureValue_CACHED_MAY_BE_STALE(
                        STREAM_RESUMPTION_FLAG,
                        false,
                      ),
                    send: async resumeParams => {
                      // Keep watchdog armed across resumption create() handshake.
                      chunkTimesRef.current = undefined
                      resetStreamIdleTimer()
                      releaseResumptionAbortListener?.()
                      releaseResumptionAbortListener = undefined
                      const resumeController = new AbortController()
                      activeResumptionAbortController = resumeController
                      const onOuterAbort = (): void => {
                        resumeController.abort(signal.reason)
                      }
                      const detachOuterAbort = (): void => {
                        signal.removeEventListener('abort', onOuterAbort)
                        if (
                          releaseResumptionAbortListener === detachOuterAbort
                        ) {
                          releaseResumptionAbortListener = undefined
                        }
                      }
                      if (signal.aborted) {
                        resumeController.abort(signal.reason)
                      } else {
                        signal.addEventListener('abort', onOuterAbort, {
                          once: true,
                        })
                        releaseResumptionAbortListener = detachOuterAbort
                      }
                      try {
                        const resumed =
                          await runWithActiveModelRedirectTracking(
                            () =>
                              resumptionClient.beta.messages
                                .create(
                                  {
                                    ...(resumeParams as unknown as BetaMessageStreamParams),
                                    stream: true,
                                  },
                                  {
                                    signal: resumeController.signal,
                                    ...(runtime.clientRequestId && {
                                      headers: {
                                        [CLIENT_REQUEST_ID_HEADER]:
                                          runtime.clientRequestId,
                                      },
                                    }),
                                  },
                                )
                                .withResponse(),
                            runtime.redirectTrackingState,
                          )
                        if (resumeController.signal.aborted) {
                          detachOuterAbort()
                          if (
                            activeResumptionAbortController === resumeController
                          ) {
                            activeResumptionAbortController = undefined
                          }
                          cleanupStream(
                            resumed.data as Stream<BetaRawMessageStreamEvent>,
                          )
                          resumed.response?.body?.cancel().catch(() => {})
                          throw new APIUserAbortError()
                        }
                        const prevStream = stream
                        const prevResponse = runtime.streamResponse
                        stream =
                          resumed.data as Stream<BetaRawMessageStreamEvent>
                        runtime.streamRequestId = resumed.request_id
                        runtime.streamResponse = resumed.response
                        chunkTimesRef.current = readResponseChunkTimes(
                          resumed.response,
                        )
                        if (prevStream && prevStream !== stream) {
                          cleanupStream(prevStream)
                        }
                        if (
                          prevResponse &&
                          prevResponse !== runtime.streamResponse
                        ) {
                          prevResponse.body?.cancel().catch(() => {})
                        }
                        resetStreamIdleTimer()
                        return resumed.data
                      } catch (err) {
                        detachOuterAbort()
                        if (
                          activeResumptionAbortController === resumeController
                        ) {
                          activeResumptionAbortController = undefined
                        }
                        throw err
                      }
                    },
                    onCancelledAtPause: pausedUsage => {
                      runtime.usage = updateUsage(
                        runtime.usage,
                        pausedUsage as Parameters<typeof updateUsage>[1],
                      )
                      for (const msg of runtime.newMessages) {
                        msg.message.usage = runtime.usage
                      }
                      options.onMessageDelta?.(runtime.newMessages)
                    },
                  })
                })()
              : stream

          // densable Tfb(Ne, So) — synthetic keep-alive pings when body bytes advance
          // without SSE events (custom gateway / ANTHROPIC_BASE_URL proxies).
          for await (const partOrPing of withStreamKeepAlivePings(
            activeEventStream,
            streamResumptionActive || chunkTimesRef.current !== undefined
              ? chunkTimesRef
              : undefined,
          )) {
            if (isStreamPingEvent(partOrPing)) {
              consecutivePingCount++
              if (consecutivePingCount <= CONSECUTIVE_PING_CAP) {
                resetStreamIdleTimer()
              } else if (
                !streamWatchdogEnabled ||
                attempt.streamIdleAborted ||
                attempt.streamSuspendedError !== undefined
              ) {
                continue
              }
              yield {
                type: 'stream_event',
                event: partOrPing,
              } as StreamEvent
              continue
            }
            consecutivePingCount = 0
            resetStreamIdleTimer()
            const action = yield* processStreamEvent({
              part: partOrPing,
              tools,
              signal,
              options,
              prepared,
              anthropicCtx,
              adaptation,
              runtime,
              attempt,
              clearStreamIdleTimers,
            })
            if (action === 'return') {
              return
            }
          }

          const finalAction = yield* finalizeCompletedStream({
            messages,
            signal,
            options,
            runtime,
            attempt,
            clearStreamIdleTimers,
          })
          if (finalAction === 'return') {
            return
          }
        } catch (rawStreamingError) {
          yield* handleStreamingError({
            rawStreamingError,
            tools,
            thinkingConfig,
            signal,
            options,
            prepared,
            anthropicCtx,
            adaptation,
            runtime,
            attempt,
            paramsFromContext,
            onThinkingDisplayApiError,
            clearStreamIdleTimers,
            releaseStreamResources,
          })
        } finally {
          clearStreamIdleTimers()
        }
      } catch (errorFromRetry) {
        const retryAction = yield* handleRetryError({
          errorFromRetry,
          messages,
          tools,
          thinkingConfig,
          signal,
          options,
          prepared,
          anthropicCtx,
          adaptation,
          runtime,
          paramsFromContext,
          onThinkingDisplayApiError,
          releaseStreamResources,
        })
        if (retryAction === 'retry_without_tool_search') {
          yield* queryModelWithStreaming({
            messages,
            systemPrompt,
            thinkingConfig,
            tools,
            signal,
            options: {
              ...options,
              _toolSearchRefusalRetried: true,
            },
          })
          return
        }
        if (retryAction === 'return') {
          return
        }
      } finally {
        stopSessionActivity('api_call', sessionActivityAgentId)
        releaseStreamResources()

        if (runtime.fallbackMessage) {
          const fallbackUsage = runtime.fallbackMessage.message
            .usage as BetaMessageDeltaUsage
          runtime.usage = updateUsage(EMPTY_USAGE, fallbackUsage)
          runtime.stopReason = runtime.fallbackMessage.message
            .stop_reason as BetaStopReason
          const fallbackCost = calculateUSDCost(
            prepared.resolvedModel,
            fallbackUsage as unknown as BetaUsage,
          )
          runtime.costUSD += addToTotalSessionCost(
            fallbackCost,
            fallbackUsage as unknown as BetaUsage,
            options.model,
            anthropicCtx.sessionCostAttribution,
          )
        }
      }
      break
    } catch (streamAttemptError) {
      if (streamAttemptError instanceof ThinkingOnlyStreamRetryError) {
        if (streamAttemptError.backoffMs > 0) {
          await sleep(streamAttemptError.backoffMs, signal)
        }
        if (signal.aborted) {
          return
        }
        continue
      }
      if (streamAttemptError instanceof OutputFilteredStreamRetryError) {
        if (signal.aborted) {
          return
        }
        continue
      }
      throw streamAttemptError
    }
  } // streamAttempt

  if (
    runtime.streamRequestId &&
    !(options.agentContext ?? getAgentContext()) &&
    (options.querySource.startsWith('repl_main_thread') ||
      options.querySource === 'sdk')
  ) {
    setLastMainRequestId(runtime.streamRequestId)
  }

  const logMessageCount = adaptation.messagesForAPI.length
  const logMessageTokens = tokenCountFromLastAPIResponse(
    adaptation.messagesForAPI,
  )

  recordLLMObservation(options.langfuseTrace ?? null, {
    model: prepared.resolvedModel,
    provider: getAPIProvider(),
    input: convertMessagesToLangfuse(
      adaptation.messagesForAPI,
      anthropicCtx.systemPrompt,
    ),
    output: convertOutputToLangfuse(runtime.newMessages),
    usage: {
      input_tokens: runtime.usage.input_tokens,
      output_tokens: runtime.usage.output_tokens,
      cache_creation_input_tokens: runtime.usage.cache_creation_input_tokens,
      cache_read_input_tokens: runtime.usage.cache_read_input_tokens,
    },
    startTime: new Date(runtime.startIncludingRetries),
    endTime: new Date(),
    completionStartTime:
      runtime.ttftMs > 0 ? new Date(runtime.start + runtime.ttftMs) : undefined,
    tools: convertToolsToLangfuse(prepared.toolSchemas as unknown[]),
    thinking: langfuseThinking,
  })

  const carriedEffortEnded = takeCarriedEffortEndForMainQuery({
    agentContext: options.agentContext,
    querySource: options.querySource,
  })

  void options.getToolPermissionContext().then(permissionContext => {
    const apiSuccessLogArgs: Parameters<typeof logAPISuccessAndDuration>[0] & {
      carriedEffortEnded?: string
    } = {
      model:
        (runtime.newMessages[0]?.message.model as string | undefined) ??
        runtime.partialMessage?.model ??
        options.model,
      preNormalizedModel: options.model,
      usage: runtime.usage,
      start: runtime.start,
      startIncludingRetries: runtime.startIncludingRetries,
      attempt: runtime.attemptNumber,
      messageCount: logMessageCount,
      messageTokens: logMessageTokens,
      requestId: runtime.streamRequestId ?? null,
      clientRequestId: runtime.clientRequestId,
      stopReason: runtime.stopReason,
      ttftMs: runtime.ttftMs,
      didFallBackToNonStreaming: runtime.didFallBackToNonStreaming,
      querySource: options.querySource,
      headers: runtime.responseHeaders,
      costUSD: runtime.costUSD,
      queryTracking: options.queryTracking,
      permissionMode: permissionContext.mode,
      newMessages: runtime.newMessages,
      llmSpan: anthropicCtx.llmSpan,
      globalCacheStrategy: prepared.globalCacheStrategy,
      requestSetupMs: runtime.start - runtime.startIncludingRetries,
      attemptStartTimes: runtime.attemptStartTimes,
      fastMode: runtime.isFastModeRequest,
      previousRequestId: prepared.previousRequestId,
      betas: adaptation.lastRequestBetas,
      effort:
        adaptation.effortLevelForTranscript ??
        (typeof adaptation.effort === 'string' ? adaptation.effort : undefined),
      ...(carriedEffortEnded !== undefined ? { carriedEffortEnded } : {}),
    }
    logAPISuccessAndDuration(apiSuccessLogArgs)
  })

  // Defensive: also release on normal completion (no-op if finally already ran).
  releaseStreamResources()
}

export async function queryHaiku({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: HaikuOptions
}): Promise<AssistantMessage> {
  const result = await withVCR(
    [
      createUserMessage({
        content: systemPrompt.map(text => ({ type: 'text', text })),
      }),
      createUserMessage({
        content: userPrompt,
      }),
    ],
    async () => {
      const messages = [
        createUserMessage({
          content: userPrompt,
        }),
      ]

      const result = await queryModelWithoutStreaming({
        messages,
        systemPrompt,
        thinkingConfig: { type: 'disabled', mechanical: true },
        tools: [],
        signal,
        options: {
          ...options,
          model: getSmallFastModel(),
          enablePromptCaching: options.enablePromptCaching ?? false,
          outputFormat,
          async getToolPermissionContext() {
            return getEmptyToolPermissionContext()
          },
        },
      })
      return [result]
    },
  )
  // We don't use streaming for Haiku so this is safe
  return result[0]! as AssistantMessage
}

/**
 * Query a specific model through the Claude Code infrastructure.
 * This goes through the full query pipeline including proper authentication,
 * betas, and headers - unlike direct API calls.
 */
export async function queryWithModel({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: QueryWithModelOptions
}): Promise<AssistantMessage> {
  const result = await withVCR(
    [
      createUserMessage({
        content: systemPrompt.map(text => ({ type: 'text', text })),
      }),
      createUserMessage({
        content: userPrompt,
      }),
    ],
    async () => {
      const messages = [
        createUserMessage({
          content: userPrompt,
        }),
      ]

      const result = await queryModelWithoutStreaming({
        messages,
        systemPrompt,
        thinkingConfig: { type: 'disabled', mechanical: true },
        tools: [],
        signal,
        options: {
          ...options,
          enablePromptCaching: options.enablePromptCaching ?? false,
          outputFormat,
          async getToolPermissionContext() {
            return getEmptyToolPermissionContext()
          },
        },
      })
      return [result]
    },
  )
  return result[0]! as AssistantMessage
}
