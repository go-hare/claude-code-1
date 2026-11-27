import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk/error'
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaUsage,
  BetaMessageParam as MessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import type { QuerySource } from 'src/constants/querySource.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { onThinkingOnlyRetryCostCredit } from 'src/services/api/streamCostCredit.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import { isFastModeEnabled } from 'src/utils/fastMode.js'
import { returnValue } from 'src/utils/generators.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import { NO_CONTENT_MESSAGE } from '../../../constants/messages.js'
import type { Tools } from '../../../Tool.js'
import type {
  AssistantMessage,
  Message,
  MessageContent,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import { getModelBetas } from '../../../utils/betas.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { errorMessage } from '../../../utils/errors.js'
import { captureAPIRequest, logError } from '../../../utils/log.js'
import {
  createAssistantAPIErrorMessage,
  decomposeBatchedToolUses,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import {
  getSmallFastModel,
  normalizeModelStringForAPI,
} from '../../../utils/model/model.js'
import { planStreamCloseAfterComplete } from '../../../utils/streamKeepAlive.js'
import { tokenCountFromLastAPIResponse } from '../../../utils/tokens.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import { extractQuotaStatusFromError } from '../../claudeAiLimits.js'
import { getAnthropicClient } from '../client.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  getAssistantMessageFromError,
  isOutputBlockedByContentFilterError,
} from '../errors.js'
import { extractConnectionErrorDetails } from '../errorUtils.js'
import { logAPIError } from '../logging.js'
import { isRedirectRefusedError } from '../modelRedirectGuard.js'
import {
  serverClassifierEnvelope,
  settleSafeguardOnMessage,
} from '../serverClassifier.js'
import {
  planThinkingOnlyStreamRetry,
  ThinkingOnlyStreamRetryError,
} from '../thinkingOnlyStreamRetry.js'
import {
  isAnthropicMessageShape,
  type OriginatingStreamFailure,
  parseAnthropicRequestId,
  UnexpectedApiResponseError,
} from '../unexpectedApiResponse.js'
import {
  CannotRetryError,
  FallbackTriggeredError,
  is529Error,
  type RetryContext,
  withRetry,
} from '../withRetry.js'
import {
  adjustParamsForNonStreaming,
  getAPIMetadata,
  getExtraBodyParams,
  getNonstreamingFallbackTimeoutMs,
  MAX_NON_STREAMING_TOKENS,
  STREAM_NETWORK_DOWN_CODES,
  STREAM_STALE_CONNECTION_CODES,
} from './requestParams.js'
import { closeAbandonedStreamEnvelope } from './streamEventProcessor.js'
import { wrapMidStreamTlsErrorAsTruncated } from './streamResumption.js'
import {
  buildCutShortErrorForNonStreamingResponse,
  runWithActiveModelRedirectTracking,
} from './toolAndMediaHelpers.js'
import {
  type ApiRequestAdaptationState,
  type Options,
  OUTPUT_FILTERED_RETRY_CAP,
  OutputFilteredStreamRetryError,
  type PreparedAnthropicContext,
  type PreparedMessagesAndTools,
  type QueryModelRuntimeState,
  type ServerFallbackHop,
  type StreamAttemptLoopState,
  StreamTruncatedError,
  ToolSearchRefusalError,
} from './types.js'

export async function verifyApiKey(
  apiKey: string,
  isNonInteractiveSession: boolean,
): Promise<boolean> {
  // Skip API verification if running in print mode (isNonInteractiveSession)
  if (isNonInteractiveSession) {
    return true
  }

  try {
    // WARNING: if you change this to use a non-Haiku model, this request will fail in 1P unless it uses getCLISyspromptPrefix.
    const model = getSmallFastModel()
    const betas = getModelBetas(model)
    return await returnValue(
      withRetry(
        () =>
          getAnthropicClient({
            apiKey,
            maxRetries: 3,
            model,
            source: 'verify_api_key',
          }),
        async anthropic => {
          const messages: MessageParam[] = [{ role: 'user', content: 'test' }]
          await runWithActiveModelRedirectTracking(() =>
            anthropic.beta.messages.create({
              model,
              max_tokens: 1,
              messages,
              temperature: 1,
              ...(betas.length > 0 && { betas: betas.filter(Boolean) }),
              metadata: getAPIMetadata(),
              ...getExtraBodyParams(),
            }),
          )
          return true
        },
        { maxRetries: 2, model, thinkingConfig: { type: 'disabled' } }, // Use fewer retries for API key verification
      ),
    )
  } catch (errorFromRetry) {
    let error = errorFromRetry
    if (errorFromRetry instanceof CannotRetryError) {
      error = errorFromRetry.originalError
    }
    logError(error)
    // Check for authentication error
    if (
      error instanceof Error &&
      error.message.includes(
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      )
    ) {
      return false
    }
    throw error
  }
}

/**
 * Helper generator for non-streaming API requests.
 * Encapsulates the common pattern of creating a withRetry generator,
 * iterating to yield system messages, and returning the final BetaMessage.
 */
export async function* executeNonStreamingRequest(
  clientOptions: {
    model: string
    fetchOverride?: Options['fetchOverride']
    source: string
    agentContext?: Options['agentContext']
    credentials?: Options['credentials']
    storageV5?: Options['storageV5']
  },
  retryOptions: {
    model: string
    fallbackModel?: string
    _availabilityFallbackRetried?: boolean
    thinkingConfig: ThinkingConfig
    fastMode?: boolean
    signal: AbortSignal
    initialConsecutive529Errors?: number
    querySource?: QuerySource
    /** densable `onApiError` / `Kue` @184975200. */
    onError?: (
      error: unknown,
    ) => string | null | undefined | Promise<string | null | undefined>
    onRetryStatus?: Options['onRetryStatus']
  },
  paramsFromContext: (context: RetryContext) => BetaMessageStreamParams,
  onAttempt: (attempt: number, start: number, maxOutputTokens: number) => void,
  captureRequest: (params: BetaMessageStreamParams) => void,
  /**
   * densable 2.1.234 #37 — originating stream-failure diagnostics (requestId /
   * cause / errorName / connectionCode / stall) for UnexpectedApiResponseError.
   * Also used as originating_request_id in tengu_nonstreaming_fallback_error.
   */
  originating?: OriginatingStreamFailure | null,
): AsyncGenerator<SystemAPIErrorMessage, BetaMessage> {
  const fallbackTimeoutMs = getNonstreamingFallbackTimeoutMs()
  const generator = withRetry(
    () =>
      getAnthropicClient({
        maxRetries: 0,
        model: clientOptions.model,
        fetchOverride: clientOptions.fetchOverride,
        source: clientOptions.source,
        agentContext: clientOptions.agentContext,
        credentials: clientOptions.credentials,
        storageV5: clientOptions.storageV5,
      }),
    async (anthropic, attempt, context) => {
      const start = Date.now()
      const retryParams = paramsFromContext(context)
      captureRequest(retryParams)
      onAttempt(attempt, start, retryParams.max_tokens)

      const adjustedParams = adjustParamsForNonStreaming(
        retryParams,
        MAX_NON_STREAMING_TOKENS,
      )

      try {
        // densable Cym: .withResponse() + OUf shape gate → Pai on malformed body
        const withResp = await runWithActiveModelRedirectTracking(() =>
          anthropic.beta.messages
            .create(
              {
                ...adjustedParams,
                model: normalizeModelStringForAPI(adjustedParams.model),
              },
              {
                signal: retryOptions.signal,
                timeout: fallbackTimeoutMs,
              },
            )
            .withResponse(),
        )
        if (!isAnthropicMessageShape(withResp.data)) {
          throw new UnexpectedApiResponseError({
            data: withResp.data,
            status: withResp.response?.status ?? null,
            headers: withResp.response?.headers ?? null,
            originating,
          })
        }
        return withResp.data as BetaMessage
      } catch (err) {
        // User aborts are not errors — re-throw immediately without logging
        if (err instanceof APIUserAbortError) throw err

        logForDiagnosticsNoPII('error', 'cli_nonstreaming_fallback_error')
        logEvent('tengu_nonstreaming_fallback_error', {
          model:
            clientOptions.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error:
            err instanceof Error
              ? (err.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
              : ('unknown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
          attempt,
          timeout_ms: fallbackTimeoutMs,
          request_id: (originating?.requestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw err
      }
    },
    {
      model: retryOptions.model,
      fallbackModel: retryOptions.fallbackModel,
      thinkingConfig: retryOptions.thinkingConfig,
      ...(isFastModeEnabled() && { fastMode: retryOptions.fastMode }),
      signal: retryOptions.signal,
      initialConsecutive529Errors: retryOptions.initialConsecutive529Errors,
      querySource: retryOptions.querySource,
      onError: retryOptions.onError,
      onRetryStatus: retryOptions.onRetryStatus,
      isNonStreamingRequest: true,
    },
  )

  let e
  do {
    e = await generator.next()
    if (!e.done && e.value.type === 'system') {
      yield e.value
    }
  } while (!e.done)

  return e.value as BetaMessage
}

/**
 * Shared materialization pipeline for non-streaming fallback responses
 * (used by both mid-stream error fallback and 404 stream-creation fallback).
 */
async function* materializeNonStreamingResult(deps: {
  result: BetaMessage
  tools: Tools
  options: Options
  prepared: PreparedMessagesAndTools
  adaptation: ApiRequestAdaptationState
  runtime: QueryModelRuntimeState
  fallbackRequestIdForMint: string
  fallbackRequestIdForEvent: string | null | undefined
  logDroppedCount: boolean
}): AsyncGenerator<StreamEvent | AssistantMessage, void> {
  const {
    result,
    tools,
    options,
    prepared,
    adaptation,
    runtime,
    fallbackRequestIdForMint,
    fallbackRequestIdForEvent,
    logDroppedCount,
  } = deps

  let nonStreamContent: unknown[] = Array.isArray(result.content)
    ? [...result.content]
    : []
  let nonStreamLastHop: ServerFallbackHop | undefined

  // densable G2s non-stream: mint from stop_details before fa/wa
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { planFallbackCreditMint } =
      require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
    const stopDetails = (result as { stop_details?: unknown }).stop_details
    if (stopDetails !== undefined) {
      const mint = planFallbackCreditMint({
        stopDetails,
        alreadyMinted: runtime.fallbackCreditMinted,
      })
      if (
        typeof stopDetails === 'object' &&
        stopDetails !== null &&
        'fallback_credit_token' in stopDetails
      ) {
        delete (stopDetails as { fallback_credit_token?: unknown })
          .fallback_credit_token
      }
      if (mint.creditCode !== undefined) {
        runtime.mintedFallbackCreditCode = mint.creditCode
        if (mint.shouldLogMint) {
          runtime.fallbackCreditMinted = true
          logEvent('tengu_fallback_credit_minted', {
            request_id:
              fallbackRequestIdForMint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { materializeNonStreamingServerFallbackContent } =
      require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
    const fa = materializeNonStreamingServerFallbackContent({
      content: nonStreamContent,
      stopReason: result.stop_reason ?? null,
      armed: options.serverRefusalFallback !== undefined,
    })
    nonStreamContent = fa.content
    nonStreamLastHop = fa.lastHop
    for (const idx of fa.malformedIndexes) {
      logEvent('tengu_rotunda_pennant_malformed', {
        block_index: idx,
        non_streaming: true,
      })
    }
    if (fa.lastHop !== undefined) {
      logEvent('tengu_rotunda_pennant_materialized', {
        armed: options.serverRefusalFallback !== undefined,
        block_index: -1,
        non_streaming: true,
      })
    }
    if (logDroppedCount && fa.droppedCount > 0) {
      logEvent('tengu_rotunda_pennant_sync_dropped', {
        dropped_count: fa.droppedCount,
        had_tool_use: fa.droppedHadToolUse,
        chain_exhausted: result.stop_reason === 'refusal',
      })
    }
  } catch {
    // densable optional
  }

  // densable {content,batchToolUses}=qXe(Owe(uY.content,…), r)
  const { content: decomposedContent, batchToolUses } =
    decomposeBatchedToolUses(
      normalizeContentFromAPI(
        nonStreamContent as typeof result.content,
        tools,
        options.agentId,
        {
          requestId: runtime.streamRequestId ?? undefined,
          messageId: result.id,
        },
      ),
      tools,
    )
  if (adaptation.serverClassifierRequest !== undefined) {
    settleSafeguardOnMessage(
      adaptation.serverClassifierRequest,
      result,
      result.content,
    )
  }
  const m: AssistantMessage = {
    message: {
      ...result,
      content: decomposedContent as MessageContent,
    },
    ...(batchToolUses.length > 0 && { batchToolUses }),
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
  runtime.fallbackMessage = m
  yield m
  runtime.stopReason = result.stop_reason ?? null
  const cutShortError = buildCutShortErrorForNonStreamingResponse(
    result,
    runtime.maxOutputTokens,
  )
  if (cutShortError) {
    yield cutShortError
  }
  // densable wa: yield po then yield*wa → server_fallback midStream:!1
  if (
    options.serverRefusalFallback !== undefined &&
    !runtime.serverFallbackEmitted
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { planNonStreamingServerFallbackEvent } =
        require('../../../utils/refusalFallback.js') as typeof import('../../../utils/refusalFallback.js')
      const sfEv = planNonStreamingServerFallbackEvent({
        lastHop: nonStreamLastHop,
        currentModel: options.model,
        requestId: fallbackRequestIdForEvent,
        finalStopReason: result.stop_reason ?? null,
        alreadyEmitted: runtime.serverFallbackEmitted,
      })
      if (sfEv) {
        runtime.serverFallbackEmitted = true
        runtime.lastServerFallbackHop = nonStreamLastHop
        yield sfEv as unknown as StreamEvent
      }
    } catch {
      // densable optional
    }
  }
}

/**
 * Handles errors thrown during SSE stream consumption (mid-stream partial
 * finalization, thinking-only retry, output-filter retry, watchdog/TLS wrap,
 * and fallback to non-streaming mode).
 */
export async function* handleStreamingError(deps: {
  rawStreamingError: unknown
  tools: Tools
  thinkingConfig: ThinkingConfig
  signal: AbortSignal
  options: Options
  prepared: PreparedMessagesAndTools
  anthropicCtx: PreparedAnthropicContext
  adaptation: ApiRequestAdaptationState
  runtime: QueryModelRuntimeState
  attempt: StreamAttemptLoopState
  paramsFromContext: (context: RetryContext) => BetaMessageStreamParams
  onThinkingDisplayApiError: (error: unknown) => string | undefined
  clearStreamIdleTimers: () => void
  releaseStreamResources: () => void
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  const {
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
  } = deps

  // Clear the idle timeout watchdog on error path too
  clearStreamIdleTimers()
  // Official 2.1.328 (`chunk@294254613.js @3469336`): FallbackTriggeredError
  // must propagate immediately out of streaming to query.ts — NEVER fall
  // back to non-streaming against the same refused/failed model.
  if (rawStreamingError instanceof FallbackTriggeredError) {
    yield* closeAbandonedStreamEnvelope(attempt.envelope, {
      responseUnfinished: true,
    })
    throw rawStreamingError
  }
  // Official zC (#89) — substitute StreamSuspendedError when idle timer
  // aborted the stream across sleep/suspend (not a user abort).
  let streamingError: unknown =
    attempt.streamSuspendedError !== undefined &&
    !attempt.streamIdleAborted &&
    !signal.aborted &&
    rawStreamingError instanceof APIUserAbortError
      ? attempt.streamSuspendedError
      : rawStreamingError

  if (attempt.streamIdleAborted && attempt.streamWatchdogFiredAt !== null) {
    const exitDelayMs = Math.round(
      performance.now() - attempt.streamWatchdogFiredAt,
    )
    logForDiagnosticsNoPII(
      'info',
      'cli_stream_loop_exited_after_watchdog_error',
    )
    logEvent('tengu_stream_loop_exited_after_watchdog', {
      request_id: (runtime.streamRequestId ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      exit_delay_ms: exitDelayMs,
      exit_path:
        'error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_name:
        streamingError instanceof Error
          ? (streamingError.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
          : ('unknown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  if (streamingError instanceof APIUserAbortError) {
    if (signal.aborted) {
      logForDebugging(
        `Streaming aborted by user: ${errorMessage(streamingError)}`,
      )
      if (runtime.isAdvisorInProgress) {
        logEvent('tengu_advisor_tool_interrupted', {
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          advisor_model: (prepared.advisorModel ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      yield* closeAbandonedStreamEnvelope(attempt.envelope, {
        responseUnfinished: true,
      })
      throw streamingError
    } else {
      logForDebugging(
        `Streaming timeout (SDK abort): ${streamingError.message}`,
        { level: 'error' },
      )
      throw new APIConnectionTimeoutError({
        message: 'Request timed out',
      })
    }
  }

  // Official 2.1.321 `Mjn` (#1878): mid-stream EPROTO / ERR_SSL_* after
  // an event has arrived is wrapped as a truncated stream.
  {
    const hadStreamEvent =
      attempt.envelope.streamMessageEnvelopeOpen ||
      runtime.newMessages.length > 0
    streamingError = wrapMidStreamTlsErrorAsTruncated(
      streamingError,
      hadStreamEvent,
    )
  }

  // densable 2.1.219 #7 — mid-stream partial finalize:
  // When assistant content was already yielded and the stream dies via
  // watchdog / stale-or-network connection / server api_error, keep the
  // partial text and append an isApiErrorMessage banner instead of
  // discarding it via non-streaming fallback (which would re-run tools).
  {
    const connDetails = extractConnectionErrorDetails(streamingError)
    const connCode = connDetails?.code
    const isStaleConn =
      streamingError instanceof StreamTruncatedError ||
      (connCode !== undefined && STREAM_STALE_CONNECTION_CODES.has(connCode))
    const isNetworkDown =
      connCode !== undefined && STREAM_NETWORK_DOWN_CODES.has(connCode)
    const isStaleOrNetwork = isStaleConn || isNetworkDown
    const isServerApiErrorPartial =
      streamingError instanceof APIError &&
      (streamingError as { type?: string }).type === 'api_error' &&
      runtime.newMessages.length > 0
    const extractMsgBlocks = (
      msg: AssistantMessage,
    ): Array<{ type: string; text?: string }> => {
      const c = msg.message?.content
      return Array.isArray(c)
        ? (c as Array<{ type: string; text?: string }>)
        : []
    }
    const hasYieldedContent = runtime.newMessages.some(msg =>
      extractMsgBlocks(msg).some(
        block =>
          block.type !== 'thinking' &&
          block.type !== 'redacted_thinking' &&
          !(
            block.type === 'text' &&
            (block.text === '' || block.text === NO_CONTENT_MESSAGE)
          ),
      ),
    )
    const hasAnyYieldedBlocks = runtime.newMessages.length > 0
    if (
      (hasAnyYieldedBlocks || hasYieldedContent) &&
      (attempt.streamIdleAborted || isStaleOrNetwork || isServerApiErrorPartial)
    ) {
      const hasToolUse = runtime.newMessages.some(msg =>
        extractMsgBlocks(msg).some(b => b.type === 'tool_use'),
      )
      const hasNonThinkingOutput = runtime.newMessages.some(msg =>
        extractMsgBlocks(msg).some(
          b =>
            b.type !== 'thinking' &&
            b.type !== 'redacted_thinking' &&
            !(
              b.type === 'text' &&
              (b.text === '' || b.text === NO_CONTENT_MESSAGE)
            ),
        ),
      )
      const cause:
        | 'watchdog'
        | 'server_error'
        | 'network_down'
        | 'stale_connection' = attempt.streamIdleAborted
        ? 'watchdog'
        : isServerApiErrorPartial
          ? 'server_error'
          : isNetworkDown
            ? 'network_down'
            : 'stale_connection'

      // densable 2.1.232 #26 / 219+: thinking-only → re-stream under Po/sr
      {
        const thinkingOnlyPlan = planThinkingOnlyStreamRetry({
          streamIdleAborted: attempt.streamIdleAborted,
          isStaleOrNetwork,
          hasNonThinkingOutput,
          stopReason: runtime.stopReason,
          watchdogRetryCount: runtime.thinkingOnlyWatchdogRetryCount,
          staleRetryCount: runtime.thinkingOnlyStaleRetryCount,
          connectionCode: connCode,
        })
        if (thinkingOnlyPlan.shouldRetry) {
          if (thinkingOnlyPlan.kind === 'watchdog') {
            runtime.thinkingOnlyWatchdogRetryCount =
              thinkingOnlyPlan.retryAttempt
          } else {
            runtime.thinkingOnlyStaleRetryCount = thinkingOnlyPlan.retryAttempt
          }
          logForDebugging(thinkingOnlyPlan.debugMessage, {
            level: 'warn',
          })
          logEvent(thinkingOnlyPlan.eventName, {
            model:
              options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            retry_attempt: thinkingOnlyPlan.retryAttempt,
            request_id: (runtime.streamRequestId ??
              'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            after_thinking_only: true,
            ...(thinkingOnlyPlan.kind === 'stale' && {
              error_code: (connCode ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }),
          })
          {
            const credit = onThinkingOnlyRetryCostCredit(
              runtime.streamCostCredit,
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
          yield* closeAbandonedStreamEnvelope(attempt.envelope, {
            responseUnfinished: true,
          })
          releaseStreamResources()
          clearStreamIdleTimers()
          throw new ThinkingOnlyStreamRetryError(thinkingOnlyPlan)
        }
      }

      // densable 2.1.222 #5: La&&To&&at===null → already complete, no truncation
      const closePlan = planStreamCloseAfterComplete({
        stopReason: runtime.stopReason,
        messageDeltaCompleted: attempt.messageDeltaCompleted,
        openContentBlockIndex: attempt.openContentBlockIndex,
      })
      if (closePlan.alreadyComplete) {
        logForDebugging(
          `Stream ${
            attempt.streamIdleAborted
              ? 'stalled'
              : `connection closed (${connCode ?? 'unknown'})`
          } after message_delta (stop_reason=${runtime.stopReason}) — response already complete, no truncation`,
          { level: 'info' },
        )
        logEvent('tengu_streaming_close_after_complete', {
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          blocks_yielded: runtime.newMessages.length,
          cause:
            cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code: (connCode ??
            'none') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          request_id: (runtime.streamRequestId ??
            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        yield* closeAbandonedStreamEnvelope(attempt.envelope, {
          responseUnfinished: false,
        })
        return
      }

      const synthesizedStop = hasToolUse ? 'tool_use' : 'end_turn'
      for (const msg of runtime.newMessages) {
        if (msg.message && msg.message.stop_reason == null) {
          msg.message.stop_reason = synthesizedStop
        }
      }
      const hasOutput = hasNonThinkingOutput || hasYieldedContent
      logForDebugging(
        attempt.streamIdleAborted
          ? `Stream idle timeout after ${runtime.newMessages.length} block(s) yielded — finalizing partial response`
          : isServerApiErrorPartial
            ? `Mid-stream server error after ${runtime.newMessages.length} block(s) yielded — finalizing partial response`
            : `Stream connection closed (${connCode ?? 'unknown'}) after ${runtime.newMessages.length} block(s) yielded — finalizing partial response`,
        { level: 'warn' },
      )
      logEvent('tengu_streaming_partial_finalized', {
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        blocks_yielded: runtime.newMessages.length,
        has_output: hasOutput,
        ...(attempt.thinkingEstimatedTokens > 0 && {
          thinking_estimated_tokens: attempt.thinkingEstimatedTokens,
        }),
        synthesized_stop_reason:
          synthesizedStop as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        cause:
          cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        request_id: (runtime.streamRequestId ??
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      const incompleteBanner = hasOutput
        ? attempt.streamIdleAborted
          ? `${API_ERROR_MESSAGE_PREFIX}: Response stalled mid-stream. The response above may be incomplete.`
          : isServerApiErrorPartial
            ? `${API_ERROR_MESSAGE_PREFIX}: Server error mid-response. The response above may be incomplete.`
            : `${API_ERROR_MESSAGE_PREFIX}: Connection closed mid-response. The response above may be incomplete.`
        : attempt.streamIdleAborted
          ? `${API_ERROR_MESSAGE_PREFIX}: Response stalled while thinking, before producing a response. Try again.`
          : `${API_ERROR_MESSAGE_PREFIX}: Connection closed while thinking, before producing a response. Try again.`
      yield* closeAbandonedStreamEnvelope(attempt.envelope, {
        responseUnfinished: true,
      })
      yield createAssistantAPIErrorMessage({
        content: incompleteBanner,
        apiError: 'server_error',
        error: 'server_error',
        // densable @217050118: yl&&!Xr — output and no tool_use.
        truncatedAfterOutput: hasOutput && !hasToolUse ? true : undefined,
      })
      return
    }
  }

  // Official lg?.cause === "outputFiltered" (#14) — retry streaming once
  // without falling back to non-streaming when output content filter stops
  // the response before any answer was shown.
  if (isOutputBlockedByContentFilterError(streamingError)) {
    if (runtime.outputFilteredRetryCount < OUTPUT_FILTERED_RETRY_CAP) {
      runtime.outputFilteredRetryCount += 1
      logForDebugging(
        `Output content filter stopped the response before any of the answer was shown: retrying streaming (${runtime.outputFilteredRetryCount}/${OUTPUT_FILTERED_RETRY_CAP})`,
        { level: 'warn' },
      )
      logEvent('tengu_streaming_output_filter_retry', {
        model:
          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        retry_attempt: runtime.outputFilteredRetryCount,
        request_id: (runtime.streamRequestId ??
          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      yield* closeAbandonedStreamEnvelope(attempt.envelope, {
        responseUnfinished: true,
      })
      releaseStreamResources()
      clearStreamIdleTimers()
      throw new OutputFilteredStreamRetryError()
    }
    logEvent('tengu_streaming_fallback_to_non_streaming', {
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error:
        'output_content_filtered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      attemptNumber: runtime.attemptNumber,
      maxOutputTokens: runtime.maxOutputTokens,
      thinkingType:
        thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      fallback_disabled: true,
      request_id: (runtime.streamRequestId ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      fallback_cause:
        'output_content_filtered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      any_stream_event_yielded: runtime.partialMessage !== undefined,
    })
    throw streamingError
  }

  // Official DISABLE_NONSTREAMING_FALLBACK densable.
  let nonstreamingFallbackDisabled = isEnvTruthy(
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK,
  )
  try {
    const { isNonstreamingFallbackDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../utils/residualFinalEnvGates.js') as typeof import('../../../utils/residualFinalEnvGates.js')
    nonstreamingFallbackDisabled = isNonstreamingFallbackDisabled()
  } catch {
    // residual helpers optional
  }
  const watchdogSkipNonstreaming =
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_watchdog_skip_nonstreaming_fallback',
      true,
    ) && attempt.streamIdleAborted
  const redirectRefusedSkipNonstreaming =
    runtime.redirectTrackingState.modelCallRefused === true ||
    isRedirectRefusedError(streamingError) ||
    (streamingError instanceof Error &&
      isRedirectRefusedError(streamingError.cause))
  const disableFallback =
    nonstreamingFallbackDisabled ||
    watchdogSkipNonstreaming ||
    redirectRefusedSkipNonstreaming ||
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_disable_streaming_to_non_streaming_fallback',
      false,
    )

  if (disableFallback) {
    logForDebugging(
      `Error streaming (non-streaming fallback disabled): ${errorMessage(streamingError)}`,
      { level: 'error' },
    )
    logEvent('tengu_streaming_fallback_to_non_streaming', {
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error:
        streamingError instanceof Error
          ? (streamingError.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
          : (String(
              streamingError,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
      attemptNumber: runtime.attemptNumber,
      maxOutputTokens: runtime.maxOutputTokens,
      thinkingType:
        thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(thinkingConfig.type === 'enabled' && {
        thinkingBudgetTokens: thinkingConfig.budgetTokens,
      }),
      fallback_disabled: true,
      request_id: (runtime.streamRequestId ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      fallback_cause: (attempt.streamIdleAborted
        ? 'watchdog'
        : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    throw streamingError
  }

  yield* closeAbandonedStreamEnvelope(attempt.envelope, {
    responseUnfinished: true,
  })
  logForDebugging(
    `Error streaming, falling back to non-streaming mode: ${errorMessage(streamingError)}`,
    { level: 'error' },
  )
  runtime.didFallBackToNonStreaming = true
  if (options.onStreamingFallback) {
    options.onStreamingFallback()
  }

  logEvent('tengu_streaming_fallback_to_non_streaming', {
    model:
      options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error:
      streamingError instanceof Error
        ? (streamingError.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        : (String(
            streamingError,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
    attemptNumber: runtime.attemptNumber,
    maxOutputTokens: runtime.maxOutputTokens,
    thinkingType:
      thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(thinkingConfig.type === 'enabled' && {
      thinkingBudgetTokens: thinkingConfig.budgetTokens,
    }),
    fallback_disabled: false,
    request_id: (runtime.streamRequestId ??
      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    fallback_cause: (attempt.streamIdleAborted
      ? 'watchdog'
      : runtime.newMessages.length > 0
        ? 'partial_yield'
        : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  logForDiagnosticsNoPII('info', 'cli_nonstreaming_fallback_started')
  logEvent('tengu_nonstreaming_fallback_started', {
    request_id: (runtime.streamRequestId ??
      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    fallback_cause: (attempt.streamIdleAborted
      ? 'watchdog'
      : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  // densable od + originating for Pai / UnexpectedApiResponseError
  const streamStallSnapshot = {
    events_received: attempt.streamEventsReceived,
    ms_to_first_event: attempt.msToFirstEvent,
    ms_since_last_event:
      attempt.lastEventTime === null
        ? null
        : Date.now() - attempt.lastEventTime,
  }
  const streamConnDetails = extractConnectionErrorDetails(streamingError)
  const originatingFailure: OriginatingStreamFailure = {
    requestId: parseAnthropicRequestId(runtime.streamRequestId),
    cause: attempt.streamIdleAborted
      ? 'watchdog'
      : runtime.newMessages.length > 0
        ? 'partial_yield'
        : 'other',
    errorName: streamingError instanceof Error ? streamingError.message : null,
    connectionCode: streamConnDetails?.code ?? null,
    stall: streamStallSnapshot,
  }
  const result = yield* executeNonStreamingRequest(
    {
      model: options.model,
      fetchOverride: options.fetchOverride,
      source: options.querySource,
      agentContext: options.agentContext ?? getAgentContext(),
      credentials: options.credentials,
      storageV5: options.storageV5,
    },
    {
      model: options.model,
      fallbackModel: options.fallbackModel,
      thinkingConfig,
      ...(isFastModeEnabled() && { fastMode: anthropicCtx.isFastMode }),
      signal,
      initialConsecutive529Errors: is529Error(streamingError) ? 1 : 0,
      querySource: options.querySource,
      onError: onThinkingDisplayApiError,
      onRetryStatus: options.onRetryStatus,
    },
    paramsFromContext,
    (attemptNum, _startTime, tokens) => {
      runtime.attemptNumber = attemptNum
      runtime.maxOutputTokens = tokens
    },
    params => captureAPIRequest(params, options.querySource),
    originatingFailure,
  )

  yield* materializeNonStreamingResult({
    result,
    tools,
    options,
    prepared,
    adaptation,
    runtime,
    fallbackRequestIdForMint: runtime.streamRequestId ?? 'unknown',
    fallbackRequestIdForEvent: runtime.streamRequestId,
    logDroppedCount: true,
  })
}

function logAndExtractTerminalError(deps: {
  rawError: unknown
  options: Options
  prepared: PreparedMessagesAndTools
  anthropicCtx: PreparedAnthropicContext
  adaptation: ApiRequestAdaptationState
  runtime: QueryModelRuntimeState
}): { error: unknown; errorModel: string } {
  const { rawError, options, prepared, anthropicCtx, adaptation, runtime } =
    deps
  let error = rawError
  let errorModel = options.model
  if (rawError instanceof CannotRetryError) {
    error = rawError.originalError
    errorModel = rawError.retryContext.model
  }

  if (error instanceof APIError) {
    extractQuotaStatusFromError(error, prepared.quotaRejectQuerySourceBucket)
  }

  const requestId =
    runtime.streamRequestId ||
    (error instanceof APIError ? error.requestID : undefined) ||
    (error instanceof APIError
      ? (error.error as { request_id?: string })?.request_id
      : undefined)

  logAPIError({
    error,
    model: errorModel,
    messageCount: adaptation.messagesForAPI.length,
    messageTokens: tokenCountFromLastAPIResponse(adaptation.messagesForAPI),
    durationMs: Date.now() - runtime.start,
    durationMsIncludingRetries: Date.now() - runtime.startIncludingRetries,
    attempt: runtime.attemptNumber,
    requestId,
    clientRequestId: runtime.clientRequestId,
    didFallBackToNonStreaming: runtime.didFallBackToNonStreaming,
    queryTracking: options.queryTracking,
    querySource: options.querySource,
    llmSpan: anthropicCtx.llmSpan,
    fastMode: runtime.isFastModeRequest,
    previousRequestId: prepared.previousRequestId,
    promptTooLongIsHandled: options.promptTooLongIsHandled,
    effort:
      adaptation.effortLevelForTranscript ??
      (typeof adaptation.effort === 'string' ? adaptation.effort : undefined),
  })

  return { error, errorModel }
}

/**
 * Handles errors caught at the outer `withRetry` / stream attempt boundary:
 * rethrows control-flow signals, handles Foundry 404 family fallback, 404
 * stream-creation non-streaming fallback, and terminal error formatting.
 */
export async function* handleRetryError(deps: {
  errorFromRetry: unknown
  messages: Message[]
  tools: Tools
  thinkingConfig: ThinkingConfig
  signal: AbortSignal
  options: Options
  prepared: PreparedMessagesAndTools
  anthropicCtx: PreparedAnthropicContext
  adaptation: ApiRequestAdaptationState
  runtime: QueryModelRuntimeState
  paramsFromContext: (context: RetryContext) => BetaMessageStreamParams
  onThinkingDisplayApiError: (error: unknown) => string | undefined
  releaseStreamResources: () => void
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  'continue_to_success' | 'return' | 'retry_without_tool_search'
> {
  const {
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
  } = deps

  if (errorFromRetry instanceof FallbackTriggeredError) {
    throw errorFromRetry
  }
  if (errorFromRetry instanceof ThinkingOnlyStreamRetryError) {
    throw errorFromRetry
  }
  if (errorFromRetry instanceof OutputFilteredStreamRetryError) {
    throw errorFromRetry
  }
  if (errorFromRetry instanceof ToolSearchRefusalError) {
    if (!options._toolSearchRefusalRetried) {
      return 'retry_without_tool_search'
    }
    throw errorFromRetry.cause ?? errorFromRetry
  }

  // Official 2.1.314 (#1361) — Foundry 404 DeploymentNotFound: fall back
  // to an older model of the same family via FallbackTriggeredError.
  if (
    getAPIProvider() === 'foundry' &&
    !options._availabilityFallbackRetried &&
    errorFromRetry instanceof CannotRetryError
  ) {
    const {
      isFoundryDeploymentNotFoundError,
      resolveFoundryFamilyFallbackModel,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../utils/foundryCapabilities.js') as typeof import('../../../utils/foundryCapabilities.js')
    if (isFoundryDeploymentNotFoundError(errorFromRetry.originalError)) {
      const fallbackModel = resolveFoundryFamilyFallbackModel(options.model)
      if (fallbackModel && fallbackModel !== options.model) {
        logForDebugging(
          `[foundry] deployment '${options.model}' not found (DeploymentNotFound); falling back to '${fallbackModel}'`,
          { level: 'warn' },
        )
        throw new FallbackTriggeredError(
          options.model,
          fallbackModel,
          'model_not_found',
        )
      }
    }
  }

  // Check if this is a 404 error during stream creation that should trigger
  // non-streaming fallback (gateways that return 404 for streaming endpoints).
  const is404StreamCreationError =
    !runtime.didFallBackToNonStreaming &&
    errorFromRetry instanceof CannotRetryError &&
    errorFromRetry.originalError instanceof APIError &&
    errorFromRetry.originalError.status === 404

  if (is404StreamCreationError) {
    const failedRequestId =
      (errorFromRetry.originalError as APIError).requestID ?? 'unknown'
    logForDebugging(
      'Streaming endpoint returned 404, falling back to non-streaming mode',
      { level: 'warn' },
    )
    runtime.didFallBackToNonStreaming = true
    if (options.onStreamingFallback) {
      options.onStreamingFallback()
    }

    logEvent('tengu_streaming_fallback_to_non_streaming', {
      model:
        options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error:
        '404_stream_creation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      attemptNumber: runtime.attemptNumber,
      maxOutputTokens: runtime.maxOutputTokens,
      thinkingType:
        thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(thinkingConfig.type === 'enabled' && {
        thinkingBudgetTokens: thinkingConfig.budgetTokens,
      }),
      request_id:
        failedRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      fallback_cause:
        '404_stream_creation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    try {
      const originating404: OriginatingStreamFailure = {
        requestId: parseAnthropicRequestId(failedRequestId),
        cause: '404_stream_creation',
        errorName: null,
        connectionCode: null,
        stall: null,
      }
      const result = yield* executeNonStreamingRequest(
        {
          model: options.model,
          fetchOverride: options.fetchOverride,
          source: options.querySource,
          agentContext: options.agentContext ?? getAgentContext(),
          credentials: options.credentials,
          storageV5: options.storageV5,
        },
        {
          model: options.model,
          fallbackModel: options.fallbackModel,
          thinkingConfig,
          ...(isFastModeEnabled() && { fastMode: anthropicCtx.isFastMode }),
          signal,
          onError: onThinkingDisplayApiError,
          onRetryStatus: options.onRetryStatus,
        },
        paramsFromContext,
        (attemptNum, _startTime, tokens) => {
          runtime.attemptNumber = attemptNum
          runtime.maxOutputTokens = tokens
        },
        params => captureAPIRequest(params, options.querySource),
        originating404,
      )

      yield* materializeNonStreamingResult({
        result,
        tools,
        options,
        prepared,
        adaptation,
        runtime,
        fallbackRequestIdForMint: runtime.streamRequestId ?? failedRequestId,
        fallbackRequestIdForEvent: runtime.streamRequestId ?? failedRequestId,
        logDroppedCount: false,
      })

      return 'continue_to_success'
    } catch (fallbackError) {
      if (fallbackError instanceof FallbackTriggeredError) {
        throw fallbackError
      }

      logForDebugging(
        `Non-streaming fallback also failed: ${errorMessage(fallbackError)}`,
        { level: 'error' },
      )

      const { error, errorModel } = logAndExtractTerminalError({
        rawError: fallbackError,
        options,
        prepared,
        anthropicCtx,
        adaptation,
        runtime,
      })

      if (error instanceof APIUserAbortError) {
        releaseStreamResources()
        return 'return'
      }

      yield getAssistantMessageFromError(error, errorModel, {
        messages,
        messagesForAPI: adaptation.messagesForAPI,
      })
      releaseStreamResources()
      return 'return'
    }
  } else {
    logForDebugging(`Error in API request: ${errorMessage(errorFromRetry)}`, {
      level: 'error',
    })

    const { error, errorModel } = logAndExtractTerminalError({
      rawError: errorFromRetry,
      options,
      prepared,
      anthropicCtx,
      adaptation,
      runtime,
    })

    if (error instanceof APIUserAbortError) {
      releaseStreamResources()
      return 'return'
    }

    yield getAssistantMessageFromError(error, errorModel, {
      messages,
      messagesForAPI: adaptation.messagesForAPI,
    })
    releaseStreamResources()
    return 'return'
  }
}
