import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaMessageStreamParams,
  BetaOutputConfig,
  BetaRawMessageStreamEvent,
  BetaStopReason,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
  BetaMessageParam as MessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync } from 'node:fs'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  getModelFacts,
  querySourceSkipsModelFactsReuse,
  type ModelFacts,
} from 'src/utils/model/modelFacts.js'
import {
  getAttributionHeader,
  getCLISyspromptPrefix,
} from '../../constants/system.js'
import {
  getEmptyToolPermissionContext,
  type QueryChainTracking,
  type Tool,
  type ToolPermissionContext,
  type Tools,
  toolMatchesName,
} from '../../Tool.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  type ConnectorTextBlock,
  type ConnectorTextDelta,
  isConnectorTextBlock,
} from '../../types/connectorText.js'
import type {
  AssistantMessage,
  Message,
  MessageContent,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../../types/message.js'
import {
  type CacheScope,
  logAPIPrefix,
  splitSysPromptPrefix,
  toolToAPISchema,
} from '../../utils/api.js'
import {
  announcePrefixLedger,
  prefixLedgerNotice,
} from '../../utils/processUserInput/prefixLedger.js'
import { getOauthAccountInfo } from '../../utils/auth.js'
import {
  clearBetasCaches,
  getBedrockExtraBodyParamsBetas,
  getMergedBetas,
  getModelBetas,
  getSearchExtraToolsBetaHeader,
} from '../../utils/betas.js'
import {
  type ApiSystemMessage,
  isApiSystemCacheControlRejected,
  isApiSystemMessage,
  isMidConvSystemRoleRejected,
  latchMidConvCachePromotionRejected,
  latchMidConvSystemRejected,
  shouldCacheControlOnApiSystem,
} from '../../utils/midConversationSystem.js'
import {
  getServedModelsForRequestedModel,
  getStickyBetas,
  isStickyBetaRejected,
  isStickyBetaSentActive,
  isThirdPartyServerClassifierRefused,
  recordServedModels,
  stickyRejectBeta,
  stickySendBeta,
  markRelayThinkingStripRecorded,
  getRefusalFallbackModelLatch,
  getMainLoopModelOverride,
  takeCarriedEffortEnd,
} from '../../bootstrap/state.js'

const declaredToolsByStickyBetas = new WeakMap<object, ReadonlySet<string>>()

export function getHeldInlineTools(
  stickyBetas: object = getStickyBetas(),
): ReadonlySet<string> | undefined {
  return declaredToolsByStickyBetas.get(stickyBetas)
}

export function latchDeclaredTools(
  stickyBetas: object,
  inlineToolNames: Iterable<string>,
): ReadonlySet<string> {
  const set = new Set(inlineToolNames)
  declaredToolsByStickyBetas.set(stickyBetas, set)
  return set
}

import {
  clearContext1mBetaRefusedModels,
  isContext1mBetaRefusedForModel,
  markContext1mBetaRefusedForModel,
} from '../../utils/betaRefusals.js'

export {
  clearContext1mBetaRefusedModels,
  isContext1mBetaRefusedForModel,
  markContext1mBetaRefusedForModel,
}

export function computeDeferredToolNamesForRequest(
  tools: Tools,
  useSearchExtraTools: boolean,
  heldInlineTools: ReadonlySet<string> | undefined,
  isDeferredFn: (tool: Tool) => boolean = isDeferredTool,
): Set<string> {
  const deferredToolNames = new Set<string>()
  if (!useSearchExtraTools) return deferredToolNames
  if (heldInlineTools === undefined) {
    for (const t of tools) {
      if (isDeferredFn(t)) deferredToolNames.add(t.name)
    }
  } else {
    for (const t of tools) {
      if (
        !heldInlineTools.has(t.name) &&
        !toolMatchesName(t, SEARCH_EXTRA_TOOLS_TOOL_NAME)
      ) {
        deferredToolNames.add(t.name)
      }
    }
  }
  return deferredToolNames
}
import {
  checkStreamIdleSuspend,
  StreamSuspendedError,
} from '../../utils/firstByteWatchdog.js'
import {
  isStreamPingEvent,
  planStreamCloseAfterComplete,
  withStreamKeepAlivePings,
} from '../../utils/streamKeepAlive.js'
import {
  planThinkingOnlyStreamRetry,
  ThinkingOnlyStreamRetryError,
} from './thinkingOnlyStreamRetry.js'
import { sleep } from '../../utils/sleep.js'
import { getOrCreateUserID } from '../../utils/config.js'
import {
  CAPPED_DEFAULT_MAX_TOKENS,
  getModelMaxOutputTokens,
  getSonnet1mExpTreatmentEnabled,
  resolveOutputTokenLimitForContinuation,
} from '../../utils/context.js'
import {
  clampEffortToCap,
  isEffortLevel,
  isInvalidEffortLevelError,
  markOrgEffortCapNotified,
  resolveAppliedEffort,
  stepDownOrgEffortCap,
} from '../../utils/effort.js'
import {
  analyticsQuerySource,
  decideEffortWhenThinkingDisabled,
  formatEffortClampDebugMessage,
  oncePerSession,
  querySourceBucket,
  transcriptEffortWhenMechanicalDisabled,
} from '../../utils/effortThinkingGuard.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import {
  MAIN_PROMPT_CACHE_QUERY_SOURCES,
  querySourceMatchesAllowlist,
  resolvePromptCacheTtlOverride,
  type PromptCacheTtl,
} from '../../utils/promptCacheTtl.js'
import { errorMessage } from '../../utils/errors.js'
import { captureAPIRequest, logError } from '../../utils/log.js'
import { recordApiRequestForReplay } from './requestReplay.js'
import {
  createAssistantAPIErrorMessage,
  createSystemMessage,
  createUserMessage,
  decomposeBatchedToolUses,
  ensureToolResultPairing,
  hideUnderlyingV1Tools,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
  mergeAdvisorStripPlans,
  buildAdvisorStripPlanFromMessages,
  stripAdvisorBlocks,
  stripAdvisorBlocksFromMessageIds,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../utils/messages.js'
import {
  firstPartyNameToCanonical,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getPublicModelDisplayName,
  getSmallFastModel,
  isNonCustomOpusModel,
} from '../../utils/model/model.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
import {
  applyThinkingStripPlanToMessages,
  buildThinkingStripPlanFromMessages,
  type KeepForeignThinkingMode,
  mergeThinkingStripPlans,
  stripForeignThinkingBlocks,
} from '../../utils/thinking.js'
import {
  getBreakCacheMarkerPath,
  getBreakCacheAlwaysPath,
} from '../../commands/break-cache/index.js'
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js'
import { getDynamicConfig_BLOCKS_ON_INIT } from '../analytics/growthbook.js'
import {
  currentLimits,
  extractQuotaStatusFromError,
  extractQuotaStatusFromHeaders,
  type QuotaRejectedQuerySourceBucket,
} from '../claudeAiLimits.js'
import {
  getAPIContextManagement,
  handleClearToolUsesRefusalError,
} from '../compact/apiMicrocompact.js'
import { bedrockAdapter } from '../providerUsage/adapters/bedrock.js'
import { updateProviderBuckets } from '../providerUsage/store.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

import { feature } from 'bun:bundle'
import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk/error'
import {
  getAfkModeHeaderLatched,
  getFastModeHeaderLatched,
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
  getSessionId,
  getThinkingDisplayExplicit,
  getThinkingHighlightsRefused,
  getThinkingResumptionRefused,
  getThinkingTypeOverride,
  isEffortUnsupported,
  markEffortUnsupported,
  setAfkModeHeaderLatched,
  setFastModeHeaderLatched,
  setLastMainRequestId,
  setPromptCache1hAllowlist,
  setPromptCache1hEligible,
} from 'src/bootstrap/state.js'
import {
  AFK_MODE_BETA_HEADER,
  copyBetaHeaderToExtraBody,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  EFFORT_BETA_HEADER,
  FAST_MODE_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  TASK_BUDGETS_BETA_HEADER,
  DANGEROUS_TOOL_USE_BETA_HEADER,
  THINKING_BINDING_CONTROLS_BETA_HEADER,
  THINKING_DISPLAY_UPDATES_BETA_HEADER,
  THINKING_RESUMPTION_BETA_HEADER,
  THINKING_TOKEN_COUNT_BETA_HEADER,
} from 'src/constants/betas.js'
import type { QuerySource } from 'src/constants/querySource.js'
import type { Notification } from 'src/context/notifications.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import {
  onMessageDeltaCostCredit,
  onMessageStopCostCredit,
  onThinkingOnlyRetryCostCredit,
  type StreamCostCreditState,
} from 'src/services/api/streamCostCredit.js'
import {
  filterBetasForClassifierProvider,
  modelAllowsDangerousToolUseBeta,
  serverClassifierBetasEligible,
} from './autoModeClassifierTransport.js'
import {
  composeAutoModeClassifierContext,
  slimClassifierContextForHistory,
  type AutoModeServerContextResolved,
} from './autoModeServerContext.js'
import {
  createServerClassifierRequest,
  recordServerClassifierRequest,
  serverClassifierEnvelope,
  settleSafeguardOnMessage,
  settleServerClassifierStreamEnded,
  type ServerClassifierRequest,
} from './serverClassifier.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { AgentId } from 'src/types/ids.js'
import {
  ADVISOR_TOOL_INSTRUCTIONS,
  getExperimentAdvisorModels,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from 'src/utils/advisor.js'
import { type AgentContext, getAgentContext } from 'src/utils/agentContext.js'
import { getAnthropicApiKey, isClaudeAISubscriber } from 'src/utils/auth.js'
import {
  modelSupportsStructuredOutputs,
  shouldIncludeFirstPartyOnlyBetas,
  shouldUseGlobalCacheScope,
} from 'src/utils/betas.js'
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME } from 'src/utils/claudeInChrome/common.js'
import { CHROME_SEARCH_EXTRA_TOOLS_INSTRUCTIONS } from 'src/utils/claudeInChrome/prompt.js'
import { getMaxThinkingTokensForModel } from 'src/utils/context.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logForDiagnosticsNoPII } from 'src/utils/diagLogs.js'
import {
  filterBetasForSimulateProxyUsage,
  shouldSimulateProxyUsage,
} from 'src/utils/residualFinalEnvGates.js'
import { OAUTH_BETA_HEADER } from 'src/constants/oauth.js'
import {
  type EffortLevel,
  type EffortValue,
  modelSupportsEffort,
  transcriptEffortFromOutputConfig,
} from 'src/utils/effort.js'
import {
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
  isFastModeRefusalError,
  isFastModeSupportedByModel,
} from 'src/utils/fastMode.js'
import { returnValue } from 'src/utils/generators.js'
import { headlessProfilerCheckpoint } from 'src/utils/headlessProfiler.js'
import { isMcpInstructionsDeltaEnabled } from 'src/utils/mcpInstructionsDelta.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import { endQueryProfile, queryCheckpoint } from 'src/utils/queryProfiler.js'
import {
  classifyThinkingDisplayRetry,
  setPendingThinkingStripped,
  densableExperimentalCapabilityBetas,
  isThinkingActiveForToolChoice,
  modelRejectsDisabledThinking,
  modelSupportsThinking,
  resolveAdaptiveThinkingType,
  providerSupportsThinkingBindingOn3P,
  resolveOutgoingThinkingDisplay,
  resolvePrefixMismatchBehavior,
  resolveThinkingDisplayMode,
  shouldSendThinkingBindingControls,
  shouldSendThinkingDisplayUpdates,
  shouldSendThinkingResumptionBeta,
  type PrefixMismatchBehavior,
  type ThinkingApiDisplay,
  type ThinkingConfig,
} from 'src/utils/thinking.js'
import {
  extractDiscoveredToolNames,
  getDeferredToolPlaceholderSchema,
  isDeferredToolsDeltaEnabled,
  isSearchExtraToolsEnabled,
} from 'src/utils/searchExtraTools.js'
import {
  extractFoundryUnsupportedFromError,
  stripFoundryUnsupportedToolFields,
} from 'src/utils/foundryCapabilities.js'
import {
  ADVISOR_BETA_HEADER,
  CACHE_DIAGNOSIS_BETA_HEADER,
  MID_CONVERSATION_SYSTEM_BETA_HEADER,
} from '../../constants/betas.js'
import {
  countStrippedImageBlocks,
  getRequestLimitMediaByteCap,
  getRequestLimitMediaKeepCount,
  HWT_BYTE_PADDING,
  HWT_KEEP_PADDING,
  noteImageMediaStripped,
  shouldTrackImageMediaStripped,
  stripStoredMediaForRequestLimit,
} from '../../utils/subagentCacheEvict.js'
import {
  formatDeferredToolLine,
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { count } from '../../utils/array.js'
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js'
import { safeParseJSON } from '../../utils/json.js'
import { getInferenceProfileBackingModel } from '../../utils/model/bedrock.js'
import {
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../../utils/model/model.js'
import {
  resolveSessionActivityAgentId,
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  isBetaTracingEnabled,
  type LLMRequestNewContext,
  startLLMRequestSpan,
} from '../../utils/telemetry/sessionTracing.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { shouldDeferLspTool } from '../lsp/manager.js'
import { isToolFromMcpServer } from '../mcp/utils.js'
import {
  getRefusedToolSchemas,
  RefusedToolSchemaResolver,
  replaceRefusedToolSchemas,
} from '../mcp/mcpToolSchema.js'
import { recordLLMObservation } from '../langfuse/index.js'
import type { LangfuseSpan } from '../langfuse/index.js'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
  convertToolsToLangfuse,
} from '../langfuse/convert.js'
import { withStreamingVCR, withVCR } from '../vcr.js'
import {
  CLIENT_REQUEST_ID_HEADER,
  getAnthropicClient,
  getBillingGroupRequestTags,
} from './client.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  type Context1mBetaRetryPhase,
  CUSTOM_OFF_SWITCH_MESSAGE,
  decideContext1mBetaRetry,
  findRejectedBetaHeaders,
  getAssistantMessageFromError,
  getErrorMessageIfRefusal,
  isOutputBlockedByContentFilterError,
  isPromptTooLongErrorMessage,
  isUnprocessableMediaError,
  parseMediaErrorLocation,
  stripTargetedMediaBlock,
} from './errors.js'
import { extractConnectionErrorDetails } from './errorUtils.js'
import { sanitizeLoneSurrogatesInPlace } from '../../utils/sanitization.js'
import {
  isAnthropicMessageShape,
  type OriginatingStreamFailure,
  parseAnthropicRequestId,
  UnexpectedApiResponseError,
} from './unexpectedApiResponse.js'
import {
  EMPTY_USAGE,
  type GlobalCacheStrategy,
  logAPIError,
  logAPIQuery,
  logAPISuccessAndDuration,
  type NonNullableUsage,
} from './logging.js'

import {
  checkResponseForCacheBreak,
  recordPromptState,
} from './promptCacheBreakDetection.js'
import {
  CannotRetryError,
  FallbackTriggeredError,
  getCachedModelMaxTokensCeiling,
  is529Error,
  isFastModeNotEnabledError,
  isSpeedParameterUnsupportedError,
  MidConvSystemRetryError,
  parseApiMaxTokensCeilingError,
  parseMaxTokensContextOverflowError,
  type RetryContext,
  withRetry,
} from './withRetry.js'
import {
  addCacheBreakpoints,
  appendSystemReminderToLastUserMessage,
  assistantMessageToMessageParam,
  getPreviousRequestIdFromMessages,
  lastAssistantMessageId,
  stripEmptyUserTextBlocks,
  userMessageToMessageParam,
} from './claude/messageParams.js'
import {
  getCacheControl,
  getPromptCachingEnabled,
  isPromptCacheDiagnosticsEnabled,
  should1hCacheTTL,
} from './claude/promptCaching.js'
import {
  adjustParamsForNonStreaming,
  configureEffortParams,
  configureTaskBudgetParams,
  getAPIMetadata,
  getExtraBodyParams,
  getMaxOutputTokensForModel,
  getNonstreamingFallbackTimeoutMs,
  MAX_NON_STREAMING_TOKENS,
  STREAM_NETWORK_DOWN_CODES,
  STREAM_STALE_CONNECTION_CODES,
  type TaskBudgetParam,
} from './claude/requestParams.js'
import { accumulateUsage, cleanupStream, updateUsage } from './claude/usage.js'

/**
 * Official 2.1.328 `_Os` (`chunk@294254613.js:3482796`) — build system prompt
 * blocks with prompt-caching breakpoints, supporting `scopeRefused` fallback
 * (omits `scope` from `cache_control` when `prompt-caching-scope-2026-01-05`
 * was rejected by the endpoint/proxy).
 */
export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: QuerySource
    agentCacheTtlOverride?: PromptCacheTtl
    scopeRefused?: boolean
  },
): TextBlockParam[] {
  return splitSysPromptPrefix(systemPrompt, {
    skipGlobalCacheForSystemPrompt: options?.skipGlobalCacheForSystemPrompt,
  }).map(block => ({
    type: 'text' as const,
    text: block.text,
    ...(enablePromptCaching &&
      block.cacheScope !== null && {
        cache_control: getCacheControl({
          scope: options?.scopeRefused ? undefined : block.cacheScope,
          querySource: options?.querySource,
          agentCacheTtlOverride: options?.agentCacheTtlOverride,
        }),
      }),
  }))
}

export {
  accumulateUsage,
  addCacheBreakpoints,
  adjustParamsForNonStreaming,
  appendSystemReminderToLastUserMessage,
  assistantMessageToMessageParam,
  cleanupStream,
  configureTaskBudgetParams,
  getAPIMetadata,
  getCacheControl,
  getExtraBodyParams,
  getMaxOutputTokensForModel,
  getPromptCachingEnabled,
  MAX_NON_STREAMING_TOKENS,
  should1hCacheTTL,
  stripEmptyUserTextBlocks,
  updateUsage,
  userMessageToMessageParam,
}

/**
 * Official 2.1.328 `Dpr` (`chunk@286370035.js:315894`) — stream ended cleanly
 * without receiving `message_start` or any completed blocks / stop_reason.
 */
export class StreamNoEventsError extends Error {
  constructor() {
    super('Stream ended without receiving any events')
    this.name = 'StreamNoEventsError'
  }
}

/**
 * Official 2.1.328 `wve` (`chunk@286370035.js:316016`) — malformed or
 * out-of-order SSE event (event on an unstarted or already-closed block).
 */
export class StreamMalformedEventError extends Error {
  readonly blockState: 'unstarted' | 'closed' | 'unreadable'

  constructor(blockState: 'unstarted' | 'closed' | 'unreadable') {
    super(
      blockState === 'closed'
        ? 'Content block already closed'
        : blockState === 'unreadable'
          ? 'Stream event unreadable'
          : 'Content block not found',
    )
    this.name = 'StreamMalformedEventError'
    this.blockState = blockState
  }
}

/**
 * Official 2.1.321 `t7n` (#1878) + 2.1.328 `Lpr` (`chunk@286370035.js:316275`):
 * retryable stream truncation error for clean EOF mid-block / before terminal
 * `message_delta`, or mid-stream `EPROTO` / `ERR_SSL_*` after an SSE event.
 */
export class StreamTruncatedError extends APIConnectionError {
  readonly code = 'StreamTruncated'
  override readonly cause: unknown

  constructor(cause?: unknown) {
    super({
      message:
        cause === undefined
          ? 'Stream ended before the response was complete'
          : 'Stream truncated due to mid-stream TLS error',
      cause: cause instanceof Error ? cause : undefined,
    })
    this.name = 'StreamTruncatedError'
    this.cause = cause
  }
}

/** Official 2.1.328 `drn.header` (`chunk@285257860.js:170477`). */
export const RESUMPTION_BETA_HEADER = 'resumption-2026-10-08'
/** Official 2.1.328 `Exs = 3` (`chunk@294254613.js:3201800`). */
export const MAX_STREAM_RESUMPTIONS = 3
const STREAM_RESUMPTION_FLAG = 'tengu_peaceful_wigderson'

export type PausedResponseLimit = 'pause_turn' | 'max_tokens' | 'server_timeout'

export type PausedResponseRecord = {
  limit: PausedResponseLimit
  usage: NonNullableUsage
  finishedBlocks: number
  requestId?: string
  resumedRequestId?: string
}

export type ResumedMessageDeltaEvent = BetaRawMessageStreamEvent & {
  type: 'message_delta'
  resumed_usage: BetaRawMessageStreamEvent extends { type: 'message_start' }
    ? unknown
    : unknown
  paused_limit: PausedResponseLimit
}

export function isResumedUsageMessageDelta(
  event: unknown,
): event is BetaRawMessageStreamEvent & {
  type: 'message_delta'
  resumed_usage: Partial<NonNullableUsage>
  paused_limit: PausedResponseLimit
} {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as { type?: unknown }).type === 'message_delta' &&
    'resumed_usage' in event
  )
}

export type ParsedResumptionPause = {
  token: string | undefined
  limit: PausedResponseLimit
  frame: BetaRawMessageStreamEvent & { type: 'message_delta' }
}

/**
 * Official 2.1.328 `Pxs` (`chunk@294254613.js:3205504`) — detect a pausable
 * `message_delta` carrying `stop_details.resumption` (`max_tokens`,
 * `server_timeout`, or `pause_turn` with a `resumption.token`), returning a
 * cleaned frame with `resumption` stripped from `stop_details`.
 */
export function parseResumptionPauseDelta(
  event: BetaRawMessageStreamEvent,
): ParsedResumptionPause | undefined {
  if (event.type !== 'message_delta') return undefined
  const delta = event.delta as {
    stop_reason?: string | null
    stop_details?: Record<string, unknown> | null
  }
  const stopReason = delta.stop_reason
  const stopDetails = delta.stop_details
  if (
    stopDetails === null ||
    stopDetails === undefined ||
    typeof stopDetails !== 'object'
  ) {
    return undefined
  }
  const resumption = stopDetails.resumption
  if (
    resumption === null ||
    resumption === undefined ||
    typeof resumption !== 'object'
  ) {
    return undefined
  }
  const rawToken = (resumption as { token?: unknown }).token
  const token = typeof rawToken === 'string' ? rawToken : undefined
  const isResumableLimit =
    stopReason === 'max_tokens' ||
    stopReason === 'server_timeout' ||
    (stopReason === 'pause_turn' && token !== undefined)
  if (!isResumableLimit) return undefined

  const { resumption: _omittedResumption, ...cleanedStopDetails } = stopDetails
  return {
    token,
    limit: stopReason,
    frame: {
      ...event,
      delta: {
        ...event.delta,
        stop_details: cleanedStopDetails,
      } as typeof event.delta,
    },
  }
}

type ResumptionBlockRecord = {
  index: number
  block: Record<string, unknown>
  inputJson: string
  incomplete: boolean
}

export type ResumptionStreamState = {
  complete: ResumptionBlockRecord[]
  open: ResumptionBlockRecord | undefined
  offset: number
  nextIndex: number
  messages: BetaMessageStreamParams['messages']
  replayed?: Omit<BetaMessageStreamParams, 'messages'>
}

/**
 * Official 2.1.328 `Oxs` (`chunk@294254613.js:3206200`) — build the follow-up
 * resumption request payload appending completed assistant blocks and
 * `resumption: { type: 'enabled', token }`.
 */
export function buildResumptionRequestParams(
  state: ResumptionStreamState,
  token: string,
): Record<string, unknown> {
  const completedBlocks = state.complete.map(({ block, inputJson }) => {
    if (inputJson === '') return block
    try {
      return { ...block, input: JSON.parse(inputJson) }
    } catch {
      return block
    }
  })
  return {
    ...(state.replayed ?? {}),
    messages:
      completedBlocks.length === 0
        ? state.messages
        : [
            ...state.messages,
            {
              role: 'assistant' as const,
              content: completedBlocks,
            },
          ],
    resumption: { type: 'enabled', token },
  }
}

/** Official 2.1.328 `Ixs` (`chunk@294254613.js:3206600`) — offset block indices across resumptions. */
function transformResumedStreamEvent(
  state: ResumptionStreamState,
  event: BetaRawMessageStreamEvent,
): BetaRawMessageStreamEvent | undefined {
  switch (event.type) {
    case 'content_block_start': {
      if (state.open?.incomplete) {
        state.open.incomplete = false
        return undefined
      }
      const index = event.index + state.offset
      state.open = {
        index,
        block: {
          ...(event.content_block as unknown as Record<string, unknown>),
        },
        inputJson: '',
        incomplete: false,
      }
      return { ...event, index }
    }
    case 'content_block_delta': {
      if (
        'replayed' in event &&
        (event as { replayed?: unknown }).replayed === true
      ) {
        return undefined
      }
      const open = state.open
      const delta = event.delta as unknown as Record<string, unknown>
      if (open) {
        if (open.block.type === 'text' && delta.type === 'text_delta') {
          open.block.text = `${String(open.block.text ?? '')}${String(delta.text ?? '')}`
        } else if (
          open.block.type === 'text' &&
          delta.type === 'citations_delta'
        ) {
          const existing = Array.isArray(open.block.citations)
            ? open.block.citations
            : []
          open.block.citations = [...existing, delta.citation]
        } else if (
          open.block.type === 'thinking' &&
          delta.type === 'thinking_delta'
        ) {
          open.block.thinking = `${String(open.block.thinking ?? '')}${String(delta.thinking ?? '')}`
        } else if (
          open.block.type === 'thinking' &&
          delta.type === 'signature_delta'
        ) {
          open.block.signature = delta.signature
        } else if (delta.type === 'input_json_delta') {
          open.inputJson += String(delta.partial_json ?? '')
        }
      }
      return { ...event, index: event.index + state.offset }
    }
    case 'content_block_stop': {
      if (
        'incomplete' in event &&
        (event as { incomplete?: unknown }).incomplete === true
      ) {
        if (state.open !== undefined) {
          state.open.incomplete = true
        }
        return undefined
      }
      const index = event.index + state.offset
      if (state.open !== undefined) {
        state.complete.push(state.open)
        state.open = undefined
      }
      state.nextIndex = index + 1
      return { ...event, index }
    }
    default:
      return event
  }
}

function* closeIncompleteOpenTextBlock(
  state: ResumptionStreamState,
): Generator<BetaRawMessageStreamEvent> {
  if (state.open?.incomplete && state.open.block.type === 'text') {
    yield {
      type: 'content_block_stop',
      index: state.open.index,
    } as BetaRawMessageStreamEvent
  }
}

export type WrapStreamWithResumptionOptions = {
  messages: BetaMessageStreamParams['messages']
  replayed?: Omit<BetaMessageStreamParams, 'messages'>
  send: (
    params: Record<string, unknown>,
  ) => Promise<AsyncIterable<BetaRawMessageStreamEvent> | undefined>
  isCancelled: () => boolean
  fits?: (usage: unknown) => boolean
  canResume?: () => boolean
  maxResumptions?: number
  onPaused?: () => void
  onAnswered?: () => void
  onCancelledAtPause?: (usage: unknown) => void
}

/**
 * Official 2.1.328 `Wno` (`chunk@294254613.js:3202790-3206600`) — transparent
 * server-side stream resumption for `pause_turn` / `max_tokens` /
 * `server_timeout` responses carrying `stop_details.resumption.token`.
 */
export async function* wrapStreamWithResumption(
  initialStream: AsyncIterable<BetaRawMessageStreamEvent>,
  opts: WrapStreamWithResumptionOptions,
): AsyncGenerator<BetaRawMessageStreamEvent> {
  const state: ResumptionStreamState = {
    complete: [],
    open: undefined,
    offset: 0,
    nextIndex: 0,
    messages: opts.messages,
    replayed: opts.replayed,
  }
  const maxResumptions = opts.maxResumptions ?? MAX_STREAM_RESUMPTIONS
  let activeStream: AsyncIterable<BetaRawMessageStreamEvent> = initialStream
  let paused: ParsedResumptionPause | undefined
  let resumptionCount = 0

  for (;;) {
    let answeredCurrent = paused === undefined
    try {
      for await (const event of activeStream) {
        if (event.type === 'message_start') {
          if (paused !== undefined) {
            answeredCurrent = true
            opts.onAnswered?.()
            const resumedUsage = event.message?.usage
            yield {
              ...paused.frame,
              delta: {
                stop_reason: null,
                stop_sequence: null,
                stop_details: null,
                container: null,
              },
              resumed_usage: resumedUsage,
              paused_limit: paused.limit,
            } as unknown as BetaRawMessageStreamEvent
            paused = undefined
            continue
          }
        }
        if (event.type === 'message_delta') {
          const parsedPause = parseResumptionPauseDelta(event)
          if (parsedPause !== undefined) {
            paused = parsedPause
            continue
          }
          if (typeof event.delta.stop_reason === 'string') {
            yield* closeIncompleteOpenTextBlock(state)
            yield event
            continue
          }
        }
        if (event.type === 'message_stop' && paused !== undefined) {
          break
        }
        const transformed = transformResumedStreamEvent(state, event)
        if (transformed !== undefined) {
          yield transformed
        }
      }
    } catch (err) {
      if (paused === undefined) throw err
      if (opts.isCancelled()) {
        opts.onCancelledAtPause?.(paused.frame.usage)
        throw err
      }
    }

    if (paused === undefined) {
      return
    }
    if (opts.isCancelled()) {
      opts.onCancelledAtPause?.(paused.frame.usage)
      return
    }
    if (answeredCurrent) {
      opts.onPaused?.()
      state.offset = state.nextIndex
      resumptionCount++
    }
    const { token } = paused
    const shouldResume =
      answeredCurrent &&
      token !== undefined &&
      resumptionCount <= maxResumptions &&
      (opts.fits?.(paused.frame.usage) ?? true) &&
      (opts.canResume?.() ?? true)

    let nextStream: AsyncIterable<BetaRawMessageStreamEvent> | undefined
    if (shouldResume && token !== undefined) {
      try {
        nextStream = await opts.send(buildResumptionRequestParams(state, token))
      } catch (err) {
        if (opts.isCancelled()) {
          opts.onCancelledAtPause?.(paused.frame.usage)
          throw err
        }
        nextStream = undefined
      }
    }
    if (nextStream === undefined) {
      yield* closeIncompleteOpenTextBlock(state)
      yield {
        ...paused.frame,
        delta: {
          ...paused.frame.delta,
          stop_reason:
            paused.limit === 'pause_turn' && state.open?.incomplete !== true
              ? 'pause_turn'
              : 'max_tokens',
        },
      } as BetaRawMessageStreamEvent
      yield { type: 'message_stop' } as BetaRawMessageStreamEvent
      return
    }
    activeStream = nextStream
  }
}

/**
 * Official 2.1.321 `Mjn(error, receivedAnyEvent)` (#1878).
 */
export function wrapMidStreamTlsErrorAsTruncated(
  error: unknown,
  receivedAnyEvent: boolean,
): unknown {
  if (!receivedAnyEvent) return error
  try {
    const code = extractConnectionErrorDetails(error)?.code
    if (code === 'EPROTO' || code?.startsWith('ERR_SSL_')) {
      logForDebugging(
        `Stream failed with a TLS error after an event had arrived (${code}) — reading it as a truncated stream`,
        { level: 'error' },
      )
      return new StreamTruncatedError(error)
    }
  } catch (err) {
    logError(err)
  }
  return error
}

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
          await anthropic.beta.messages.create({
            model,
            max_tokens: 1,
            messages,
            temperature: 1,
            ...(betas.length > 0 && { betas: betas.filter(Boolean) }),
            metadata: getAPIMetadata(),
            ...getExtraBodyParams(),
          })
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

export class ToolSearchRefusalError extends Error {
  constructor(cause: unknown) {
    super('the model call is made again', { cause })
    this.name = 'ToolSearchRefusalError'
  }
}

/**
 * Official 2.1.328 `N9e` / `DTe` (`chunk@294254613.js @3354840`, `d4e` in
 * `chunk@288788466.js @1084`): decide whether an HTTP 400/422 error on a
 * request declaring deferred tools should fall back to sending the request
 * again without deferred tools (`ToolSearchRefusalError`).
 *
 * - On direct 1P Anthropic (`isDirectAnthropicProvider`), ONLY fire when
 *   `error.message` explicitly mentions `\bdefer_loading\b` (avoiding cache-
 *   busting retries on unrelated 400s).
 * - Exclude billing errors, prompt-too-long, and errors handled by `withRetry`
 *   (`parseApiMaxTokensCeilingError`, `parseMaxTokensContextOverflowError`,
 *   fast-mode refusal / speed-unsupported errors, Foundry capability errors).
 */
export function shouldTriggerToolSearchRefusal(params: {
  error: unknown
  useSearchExtraTools: boolean
  alreadyRetried: boolean
  isDirectAnthropicProvider: boolean
  provider: string
  model: string
}): boolean {
  const {
    error,
    useSearchExtraTools,
    alreadyRetried,
    isDirectAnthropicProvider,
    provider,
    model,
  } = params
  if (!useSearchExtraTools || alreadyRetried) return false
  if (!(error instanceof APIError)) return false
  if (error.status !== 400 && error.status !== 422) return false
  if (isDirectAnthropicProvider && !/\bdefer_loading\b/.test(error.message)) {
    return false
  }
  if (
    (error.error as { type?: string } | undefined)?.type === 'billing_error'
  ) {
    return false
  }
  if (isPromptTooLongErrorMessage(error.message)) return false

  // Official `wBe($n)`: normalize HTTP 422 to 400 for error-classifier checks.
  const normalizedErr =
    error.status === 422
      ? new APIError(
          400,
          error.error,
          error.message.replace(/^422 /, ''),
          error.headers,
        )
      : error

  if (parseApiMaxTokensCeilingError(normalizedErr) !== null) return false
  if (parseMaxTokensContextOverflowError(normalizedErr) !== undefined) {
    return false
  }
  if (
    isFastModeRefusalError(normalizedErr) ||
    isFastModeNotEnabledError(normalizedErr) ||
    isSpeedParameterUnsupportedError(normalizedErr, model)
  ) {
    return false
  }
  if (
    provider !== 'firstParty' &&
    /fast mode|speed: extra inputs|`speed` parameter/i.test(
      normalizedErr.message ?? '',
    )
  ) {
    return false
  }
  if (
    provider === 'foundry' &&
    (extractFoundryUnsupportedFromError(normalizedErr)?.length ?? 0) > 0
  ) {
    return false
  }
  return true
}

export type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  _availabilityFallbackRetried?: boolean
  _toolSearchRefusalRetried?: boolean
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  /** densable 2.1.248 #2 — Ivt `{agentCacheTtlOverride}` from query. */
  agentCacheTtlOverride?: PromptCacheTtl
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId // Only set for subagents
  /**
   * densable 2.1.222 #6 — one-shot MCP attribution for this API request
   * (captured from tool-use stamps when querySource family is main/subagent).
   */
  activeMcpServer?: string
  activeMcpTool?: string
  /**
   * Official isBackgroundAgent — when true with agentId, session activity
   * does not bump mainLoopRefcount ($Qn second arg via HOn fallback).
   */
  isBackgroundAgent?: boolean
  /**
   * Official requestDialog host (print cvf) — FXl refusal_fallback /
   * X6e fable overage parks. Plumbed from ToolUseContext via query.
   */
  requestDialog?: (
    spec: {
      kind: string
      default: unknown
      result?: () => {
        safeParse: (v: unknown) => { success: boolean; data?: unknown }
      }
    },
    payload: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>
  /**
   * Official refusalFallbackModel — armed fallback for refusal path (visible
   * or silent rearm). When set, takes precedence over generic fallbackModel
   * for the FXl/stream refusal consumer densable.
   */
  refusalFallbackModel?: string
  /**
   * Official refusalFallbackModelLane — "visible" | "silent".
   * Silent lane suppresses the dialog (OXl silent_ab).
   */
  refusalFallbackModelLane?: 'visible' | 'silent'
  /**
   * Official refusalFallbackSilentArmActive — silent rearm armed without
   * visible/server lane (pi densable).
   */
  refusalFallbackSilentArmActive?: boolean
  /**
   * Official refusalFallbackEffort (#36) — loop-level carried effort from a
   * refusal fallback when not latched onto the main session.
   */
  refusalFallbackEffort?: EffortLevel
  /**
   * densable serverRefusalFallback — server-lane arm `{forModel, model}`.
   * When set, stream materializes content_block_start type "fallback" into
   * QueryEvent `server_fallback` (midStream salvage / non-mid end hop).
   * mode drives ekd default vs explicit fallbacks body.
   */
  serverRefusalFallback?: {
    forModel: string
    model: string
    mode?: 'default' | 'explicit'
  }
  /**
   * densable fallbackCreditCode — stamp fallback_credit_token on next request
   * after mint from stop_details (G2s).
   */
  fallbackCreditCode?: string
  /**
   * densable fallbackCreditMintModel — model that minted the credit (optional).
   */
  fallbackCreditMintModel?: string
  /**
   * densable fallbackCreditLaneArmed — visibleModel armed → rkd credit beta.
   */
  fallbackCreditLaneArmed?: boolean
  autoModeServerContext?: AutoModeServerContextResolved
  serverClassifier?: boolean
  /**
   * densable Jn — query armed Ba; stream skips FXl so query qa can ask.
   */
  refusalFallbackPreferencePending?: boolean
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  /**
   * Official 2.1.327 (#481): true when continuing a reply that hit the output
   * token limit; allows unrecognized models cut at 32,000 tokens to continue
   * with a limit of 128,000 tokens.
   */
  continuesCutReply?: boolean
  /**
   * Official 2.1.328 (#570): when true (e.g. subagent progress summaries), an
   * effort rejection retries without effort on this call only, without turning
   * effort off for the model across the session.
   */
  leavesEffortSupportAlone?: boolean
  /** Official 2.1.328 `Yso` `keepForeignThinking` policy (default `'none'`). */
  keepForeignThinking?: KeepForeignThinkingMode
  /** Official 2.1.328 `ie.resumeIncompleteThinking` — suppress blanket thinking strip when resuming incomplete thinking. */
  resumeIncompleteThinking?: boolean
  /**
   * Callback invoked after `message_delta` writes back `usage`, `stop_reason`,
   * `stop_details`, `context_management`, `resumable`, and `pausedResponses`
   * onto `newMessages` so callers holding cloned messages can sync them.
   */
  onMessageDelta?: (messages: AssistantMessage[]) => void
  /**
   * When true, refusal fallback yields `fallback_request` cleanly and returns
   * for caller (`query.ts`) handling instead of running the dialog inside SSE.
   */
  refusalFallbackHandledByCaller?: boolean
  /** Opt-in flag to enable transparent `pause_turn` stream resumption (`Wno`). */
  enableStreamResumption?: boolean
  addNotification?: (notif: Notification) => void
  /**
   * densable 2.1.214 #39 onRetryStatus — stream stall / retry UI status.
   * `null` clears; `{kind:"stalled", deadline}` shows
   * "Waiting for API response · will retry in … · check your network".
   */
  onRetryStatus?: (
    status: import('../../utils/advisorNetworkStall.js').RetryStatus | null,
  ) => void
  // API-side task budget (output_config.task_budget). Distinct from the
  // tokenBudget.ts +500k auto-continue feature — this one is sent to the API
  // so the model can pace itself. `remaining` is computed by the caller
  // (query.ts decrements across the agentic loop).
  taskBudget?: { total: number; remaining?: number }
  /** Langfuse root trace span for observability. No-op if null/undefined. */
  langfuseTrace?: LangfuseSpan | null
  /**
   * densable promptTooLongIsHandled — skip cli_api_error / tengu_api_error
   * when classifyAPIError is prompt_too_long (title / compact / hook_prompt
   * and the main query already recover). Official Options field.
   */
  promptTooLongIsHandled?: boolean
  /**
   * densable qC/Gut `thinkingStripPlan` / `advisorStripPlan` — Lv peels
   * attachments at normalize. Compact qjt threads these through runQuery.
   */
  thinkingStripPlan?: import('../../utils/thinking.js').ThinkingStripPlan
  advisorStripPlan?: import('../../utils/messages.js').AdvisorStripPlan
  toolResultCuts?: ReadonlyMap<string, string>
  /**
   * densable agentContext — official Options field. queryModel falls back
   * to getAgentContext() ALS when omitted. Title `B` passes S() explicitly.
   */
  agentContext?: AgentContext
  /**
   * densable credentials — official Options / fk `i`. Host handle (`Ce`)
   * passed to getAnthropicClient → Op refresh + `_F`/`dl` dead-refresh throw.
   */
  credentials?: unknown
  /**
   * densable storageV5 — official Options / fk `a`. Persist handle for
   * Op refresh (`aO`) and YOo gzip latch. Local `$t()`/`tn()` host is absent;
   * the handle is still threaded (same as saveGlobalConfig 2nd arg).
   * Title `B` does not pass this field.
   */
  storageV5?: unknown
  /**
   * densable `zu` snapshot. queryModel reuses when model matches and
   * querySource is not auto_mode / auto_mode_investigator (`$z`).
   */
  modelFacts?: ModelFacts
  /**
   * densable `tte` epoch. Threaded on Options (gold Uwt `promptEpoch`).
   */
  promptRenderEpoch?: number
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
    // If the signal was aborted, throw APIUserAbortError instead of a generic error
    // This allows callers to handle abort scenarios gracefully
    if (signal.aborted) {
      throw new APIUserAbortError()
    }
    throw new Error('No assistant message found')
  }
  return assistantMessage
}

export function buildCutShortErrorForMessage(
  stopReason: string | null | undefined,
  maxTokens: number,
  outputTokens: number,
  isNonStreamingCapped = false,
): AssistantMessage | undefined {
  if (stopReason === 'max_tokens') {
    logEvent('tengu_max_tokens_reached', {
      max_tokens: maxTokens,
    })
    return createAssistantAPIErrorMessage({
      content: isNonStreamingCapped
        ? `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
            maxTokens
          } output token maximum for a request sent without streaming. The CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable cannot raise this limit.`
        : `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
            maxTokens
          } output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`,
      apiError: 'max_output_tokens',
      error: 'max_output_tokens',
    })
  }

  if (stopReason === 'model_context_window_exceeded') {
    logEvent('tengu_context_window_exceeded', {
      max_tokens: maxTokens,
      output_tokens: outputTokens,
    })
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: The model has reached its context window limit.`,
      apiError: 'max_output_tokens',
      error: 'max_output_tokens',
    })
  }

  return undefined
}

export function buildCutShortErrorForNonStreamingResponse(
  result: {
    stop_reason?: string | null
    usage?: { output_tokens?: number }
  },
  maxOutputTokens: number,
): AssistantMessage | undefined {
  try {
    if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_vast_sunset', true)) {
      return undefined
    }
    return buildCutShortErrorForMessage(
      result.stop_reason,
      Math.min(maxOutputTokens, MAX_NON_STREAMING_TOKENS),
      result.usage?.output_tokens ?? 0,
      maxOutputTokens >= MAX_NON_STREAMING_TOKENS,
    )
  } catch (err) {
    logError(err)
    return undefined
  }
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
        const withResp = await anthropic.beta.messages
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
          .withResponse()
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

        // Instrumentation: record when the non-streaming request errors (including
        // timeouts). Lets us distinguish "fallback hung past container kill"
        // (no event) from "fallback hit the bounded timeout" (this event).
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
 * Module-level cache of deferred-tool lines that have already been announced
 * via <available-deferred-tools>. Because the injection is ephemeral (appended
 * to a local `messagesForAPI` that is never persisted back into the caller's
 * message history), we cannot scan history to detect prior injections — the
 * injected message is gone after each API call. Instead we keep this Set so we
 * only re-inject when new deferred tools appear (e.g. MCP server connects).
 */
const lastAnnouncedDeferredTools = new Set<string>()

/** Official c0e — output-content-filter streaming retry cap (#14). */
const OUTPUT_FILTERED_RETRY_CAP = 1

class OutputFilteredStreamRetryError extends Error {
  constructor() {
    super('Output content filter retry')
    this.name = 'OutputFilteredStreamRetryError'
  }
}

/** Official Rya — media item limit step-down ladder (#13). */
export const MEDIA_ITEM_LIMIT_STEPS = [510, 255, 127] as const

type MediaItemCapEntry = {
  model: string
  limit?: number
  gaveUp: boolean
}

const mediaItemCapBySession = new Map<string, MediaItemCapEntry>()

export function getSessionMediaItemCap(
  sessionId: string,
  model: string,
): MediaItemCapEntry | undefined {
  const entry = mediaItemCapBySession.get(sessionId)
  return entry?.model === model ? entry : undefined
}

export function setSessionMediaItemCap(
  sessionId: string,
  entry: MediaItemCapEntry,
): void {
  mediaItemCapBySession.set(sessionId, entry)
}

export function clearSessionMediaItemCap(sessionId: string): void {
  mediaItemCapBySession.delete(sessionId)
}

function isMediaBlock(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false
  const b = block as { type?: unknown }
  return b.type === 'image' || b.type === 'document'
}

/** Official ros(messages) — count stored image/document blocks (#13). */
export function countStoredMediaItems(
  messages: readonly (UserMessage | AssistantMessage | ApiSystemMessage)[],
): number {
  let total = 0
  for (const msg of messages) {
    const content = (msg as { message?: { content?: unknown } }).message
      ?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (isMediaBlock(block)) {
        total++
      } else if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'tool_result' &&
        Array.isArray((block as { content?: unknown }).content)
      ) {
        for (const inner of (block as { content: unknown[] }).content) {
          if (isMediaBlock(inner)) total++
        }
      }
    }
  }
  return total
}

/** Official Hqn — block types that suppress synthetic content_block_stop (#121). */
const SUPPRESS_ABANDONED_BLOCK_STOP_TYPES = new Set([
  'tool_use',
  'server_tool_use',
  'mcp_tool_use',
])

/** Official Mjr — resolve carriedEffort from loop override or session latch (#36). */
export function resolveCarriedEffortForModel(
  opts: {
    loopEffort?: EffortLevel
    continuesMainConversation: boolean
  },
  resolvedModel: string,
): EffortLevel | null {
  const killed = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_loggia_passage',
    false,
  )
  if (opts.loopEffort !== undefined) {
    return killed ? null : opts.loopEffort
  }
  if (!opts.continuesMainConversation || killed) {
    return null
  }
  const latch = getRefusalFallbackModelLatch()
  const override = getMainLoopModelOverride()
  if (latch?.carriedEffort === undefined || override == null) {
    return null
  }
  const matches =
    override.toLowerCase() === latch.fallbackModel.toLowerCase() &&
    resolvedModel.toLowerCase() === latch.fallbackModel.toLowerCase()
  return matches ? latch.carriedEffort : null
}

/**
 * Official 2.1.328 `H9o = Ia ? Eji() : void 0` (chunk@294254613.js @3340188,
 * @3474902): consume the one-shot `carriedEffortEnded` reason from the refusal
 * fallback latch only on main-conversation API completions (`repl_main_thread*`
 * or `sdk` outside subagent/background contexts).
 */
export function takeCarriedEffortEndForMainQuery(opts: {
  agentContext?: unknown
  querySource: string
}): string | undefined {
  const isMainConversation =
    !(opts.agentContext ?? getAgentContext()) &&
    (opts.querySource.startsWith('repl_main_thread') ||
      opts.querySource === 'sdk')
  return isMainConversation ? takeCarriedEffortEnd() : undefined
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

  // Derive previous request ID from the last assistant message in this query chain.
  // This is scoped per message array (main thread, subagent, teammate each have their own),
  // so concurrent agents don't clobber each other's request chain tracking.
  // Also naturally handles rollback/undo since removed messages won't be in the array.
  const previousRequestId = getPreviousRequestIdFromMessages(messages)

  const resolvedModel =
    getAPIProvider() === 'bedrock' &&
    options.model.includes('application-inference-profile')
      ? ((await getInferenceProfileBackingModel(options.model)) ??
        options.model)
      : options.model

  // densable jqt yt: reuse h when h.model===qe && !$z(querySource), else zu(qe).
  const modelFacts =
    options.modelFacts?.model === resolvedModel &&
    !querySourceSkipsModelFactsReuse(options.querySource)
      ? options.modelFacts
      : getModelFacts(resolvedModel)
  void modelFacts

  // densable 2.1.233 #16 FRi — print stderr [claude-code:unrecognized_model]
  // once per stripped model id (before tool schema build).
  try {
    const { signalUnrecognizedModel } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/model/unrecognizedModelSignal.js') as typeof import('src/utils/model/unrecognizedModelSignal.js')
    signalUnrecognizedModel(options.model, options.querySource)
  } catch {
    // optional diagnostic
  }

  queryCheckpoint('query_tool_schema_build_start')
  const isAgenticQuery =
    options.querySource.startsWith('repl_main_thread') ||
    options.querySource.startsWith('agent:') ||
    options.querySource === 'sdk' ||
    options.querySource === 'hook_agent' ||
    options.querySource === 'verification_agent'

  /**
   * densable hAm: Hz(agentContext)=agentType==="main" (no ALS store ⇒ main) AND
   * B1(querySource)==="main" (repl_main_thread* | sdk) → main_thread; else other.
   * Passed to extractQuotaStatusFromError → quotaRejected → s0v rearm gate.
   */
  const quotaRejectQuerySourceBucket: QuotaRejectedQuerySourceBucket = (() => {
    // Local ALS has no agentType:"main" object — undefined store ⇒ main (SEA Hz).
    const isMainAgent =
      (options.agentContext ?? getAgentContext()) === undefined
    const qs = options.querySource
    const isMainSource = qs.startsWith('repl_main_thread') || qs === 'sdk'
    return isMainAgent && isMainSource ? 'main_thread' : 'other'
  })()
  // densable mzt → sticky-filter o3: if midConvLatchedOff (Iz sticky reject),
  // drop o3 from the request beta list for the rest of the session.
  let betas = getMergedBetas(options.model, { isAgenticQuery }).filter(
    b =>
      !(
        (b === MID_CONVERSATION_SYSTEM_BETA_HEADER &&
          isStickyBetaRejected(MID_CONVERSATION_SYSTEM_BETA_HEADER)) ||
        (b === THINKING_DISPLAY_UPDATES_BETA_HEADER &&
          isStickyBetaRejected(THINKING_DISPLAY_UPDATES_BETA_HEADER)) ||
        (b === THINKING_BINDING_CONTROLS_BETA_HEADER &&
          isStickyBetaRejected(THINKING_BINDING_CONTROLS_BETA_HEADER)) ||
        (b === THINKING_TOKEN_COUNT_BETA_HEADER &&
          isStickyBetaRejected(THINKING_TOKEN_COUNT_BETA_HEADER)) ||
        (b === THINKING_RESUMPTION_BETA_HEADER &&
          (isStickyBetaRejected(THINKING_RESUMPTION_BETA_HEADER) ||
            getThinkingResumptionRefused())) ||
        (b === DANGEROUS_TOOL_USE_BETA_HEADER &&
          isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER)) ||
        (b === CONTEXT_1M_BETA_HEADER &&
          isContext1mBetaRefusedForModel(options.model))
      ),
  )

  // Always send the advisor beta header when advisor is enabled, so
  // non-agentic queries (compact, side_question, extract_memories, etc.)
  // can parse advisor server_tool_use blocks already in the conversation history.
  if (isAdvisorEnabled()) {
    betas.push(ADVISOR_BETA_HEADER)
  }

  let advisorModel: string | undefined
  if (isAgenticQuery && isAdvisorEnabled()) {
    let advisorOption = options.advisorModel

    const advisorExperiment = getExperimentAdvisorModels()
    if (advisorExperiment !== undefined) {
      if (
        normalizeModelStringForAPI(advisorExperiment.baseModel) ===
        normalizeModelStringForAPI(options.model)
      ) {
        // Override the advisor model if the base model matches. We
        // should only have experiment models if the user cannot
        // configure it themselves.
        advisorOption = advisorExperiment.advisorModel
      }
    }

    if (advisorOption) {
      const normalizedAdvisorModel = normalizeModelStringForAPI(
        parseUserSpecifiedModel(advisorOption),
      )
      if (!modelSupportsAdvisor(options.model)) {
        logForDebugging(
          `[AdvisorTool] Skipping advisor - base model ${options.model} does not support advisor`,
        )
      } else if (!isValidAdvisorModel(normalizedAdvisorModel)) {
        logForDebugging(
          `[AdvisorTool] Skipping advisor - ${normalizedAdvisorModel} is not a valid advisor model`,
        )
      } else {
        advisorModel = normalizedAdvisorModel
        logForDebugging(
          `[AdvisorTool] Server-side tool enabled with ${advisorModel} as the advisor model`,
        )
      }
    }
  }

  // Check if tool search is enabled (checks mode, model support, and threshold for auto mode)
  // This is async because it may need to calculate MCP tool description sizes for TstAuto mode
  let useSearchExtraTools = options._toolSearchRefusalRetried
    ? false
    : await isSearchExtraToolsEnabled(
        options.model,
        tools,
        options.getToolPermissionContext,
        options.agents,
        'query',
      )

  // Precompute once — isDeferredTool does 2 GrowthBook lookups per call
  const stickyBetas = getStickyBetas()
  const heldInlineTools = getHeldInlineTools(stickyBetas)
  const deferredToolNames = computeDeferredToolNamesForRequest(
    tools,
    useSearchExtraTools,
    heldInlineTools,
  )

  // Even if tool search mode is enabled, skip if there are no deferred tools
  // AND no MCP servers are still connecting. When servers are pending, keep
  // SearchExtraTools available so the model can discover tools after they connect.
  if (
    useSearchExtraTools &&
    deferredToolNames.size === 0 &&
    !options.hasPendingMcpServers
  ) {
    logForDebugging(
      'Tool search disabled: no deferred tools available to search',
    )
    useSearchExtraTools = false
  }

  // densable query path: when S (tool search on), keep non-deferred + ToolSearch
  // + tools discovered via Lwe(messages) tool_reference; drop other deferred.
  // When off, exclude ToolSearch from the tools array entirely.
  let filteredTools: Tools
  const discoveredToolNames = useSearchExtraTools
    ? extractDiscoveredToolNames(messages)
    : new Set<string>()

  if (useSearchExtraTools) {
    filteredTools = tools.filter(tool => {
      if (!deferredToolNames.has(tool.name)) return true
      if (toolMatchesName(tool, SEARCH_EXTRA_TOOLS_TOOL_NAME)) return true
      return discoveredToolNames.has(tool.name)
    })
  } else {
    filteredTools = tools.filter(
      t => !toolMatchesName(t, SEARCH_EXTRA_TOOLS_TOOL_NAME),
    )
  }
  // densable v=Qzr(T) — hide v1 tools when a Batch* wrapper is in T
  filteredTools = hideUnderlyingV1Tools(filteredTools)

  // densable: A = S ? Jvu() : null; if A && provider !== bedrock → betas.push(A)
  // Bedrock carries the tool-search beta via extra body params instead.
  if (useSearchExtraTools) {
    const toolSearchBeta = getSearchExtraToolsBetaHeader()
    if (getAPIProvider() !== 'bedrock' && !betas.includes(toolSearchBeta)) {
      betas.push(toolSearchBeta)
    }
  }

  const useGlobalCacheFeature = shouldUseGlobalCacheScope()
  // MCP tools are per-user → dynamic tool section → can't globally cache.
  const needsToolBasedCacheMarker =
    useGlobalCacheFeature && filteredTools.some(t => t.isMcp === true)

  // Ensure prompt_caching_scope beta header is present when global cache is enabled.
  if (
    useGlobalCacheFeature &&
    !betas.includes(PROMPT_CACHING_SCOPE_BETA_HEADER)
  ) {
    betas.push(PROMPT_CACHING_SCOPE_BETA_HEADER)
  }

  // Determine global cache strategy for logging
  const globalCacheStrategy: GlobalCacheStrategy = useGlobalCacheFeature
    ? needsToolBasedCacheMarker
      ? 'none'
      : 'system_prompt'
    : 'none'

  // densable mqo: deferLoading = S && (deferred || WIb LSP-pending)
  // Pass full `tools` into toolToAPISchema so ToolSearch prompt sees all MCP tools.
  const shouldDeferForToolSearch = (tool: Tool): boolean =>
    useSearchExtraTools &&
    (deferredToolNames.has(tool.name) || shouldDeferLspTool(tool))

  if (useSearchExtraTools && heldInlineTools === undefined) {
    latchDeclaredTools(
      stickyBetas,
      filteredTools.filter(t => !shouldDeferForToolSearch(t)).map(t => t.name),
    )
  }

  const toolSchemas = await Promise.all(
    filteredTools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: options.model,
        deferLoading: shouldDeferForToolSearch(tool),
      }),
    ),
  )

  // densable dBp: inject DeferredToolPlaceholder when tool search is on
  if (useSearchExtraTools) {
    const placeholder = getDeferredToolPlaceholderSchema()
    if (
      placeholder &&
      !toolSchemas.some(t => 'name' in t && t.name === placeholder.name)
    ) {
      // Insert before last tool (densable: splice(max(len-1,0), 0, To))
      toolSchemas.splice(Math.max(toolSchemas.length - 1, 0), 0, placeholder)
    }
    const deferredIncluded = filteredTools.filter(t =>
      deferredToolNames.has(t.name),
    ).length
    logForDebugging(
      `Dynamic tool loading: ${deferredIncluded}/${deferredToolNames.size} deferred tools included` +
        (discoveredToolNames.size > 0
          ? ` (${discoveredToolNames.size} discovered)`
          : ''),
    )
  }

  // densable cnu — strip defer_loading / strict when Foundry deployment learned
  // those features are unsupported (from prior 400s via uns/dns).
  const toolSchemasForApi = stripFoundryUnsupportedToolFields(
    toolSchemas,
    options.model,
  )

  queryCheckpoint('query_tool_schema_build_end')

  // Normalize messages before building system prompt (needed for fingerprinting)
  // Instrumentation: Track message count before normalization
  logEvent('tengu_api_before_normalize', {
    preNormalizedMessageCount: messages.length,
  })

  queryCheckpoint('query_message_normalization_start')
  // densable Uwt / ks — empty body; apply overlay if a ledger ever returns one.
  const prefixOverlay = announcePrefixLedger(
    messages,
    { messages, tools: filteredTools },
    {
      querySource: options.querySource,
      promptEpoch: options.promptRenderEpoch,
    },
  )
  if (prefixOverlay?.tools !== undefined) {
    // gold replaces eke / Wn.tools; gZn()==='off' never reaches
    void prefixOverlay.tools
  }
  // densable Ydy / eN: pass model so J8t can inject api_system after user turns.
  // When o3 is sticky-rejected, omit model so mid-conv path stays off.
  const midConvLatchedOff = isStickyBetaRejected(
    MID_CONVERSATION_SYSTEM_BETA_HEADER,
  )
  const normalizeModel = midConvLatchedOff ? undefined : options.model

  // densable post-normalize pipeline shared by primary + midConvFallback.
  const postNormalizeForAPI = (
    normalized: (UserMessage | AssistantMessage | ApiSystemMessage)[],
  ): (UserMessage | AssistantMessage | ApiSystemMessage)[] => {
    let next = normalized
    // Model-specific post-processing: strip tool-search-specific fields if the
    // selected model doesn't support tool search.
    //
    // Why is this needed in addition to normalizeMessagesForAPI?
    // - normalizeMessagesForAPI uses isSearchExtraToolsEnabledNoModelCheck() because it's
    //   called from ~20 places (analytics, feedback, sharing, etc.), many of which
    //   don't have model context. Adding model to its signature would be a large refactor.
    // - This post-processing uses the model-aware isSearchExtraToolsEnabled() check
    // - This handles mid-conversation model switching (e.g., Sonnet → Haiku) where
    //   stale tool-search fields from the previous model would cause 400 errors
    //
    // Note: For assistant messages, normalizeMessagesForAPI already normalized the
    // tool inputs, so stripCallerFieldFromAssistantMessage only needs to remove the
    // 'caller' field (not re-normalize inputs).
    if (!useSearchExtraTools) {
      next = next.map(msg => {
        switch (msg.type) {
          case 'user':
            // Strip tool_reference blocks from tool_result content
            return stripToolReferenceBlocksFromUserMessage(msg)
          case 'assistant':
            // Strip 'caller' field from tool_use blocks
            return stripCallerFieldFromAssistantMessage(msg)
          default:
            return msg
        }
      })
    }

    // Repair tool_use/tool_result pairing mismatches that can occur when resuming
    // remote/teleport sessions. Inserts synthetic error tool_results for orphaned
    // tool_uses and strips orphaned tool_results referencing non-existent tool_uses.
    next = ensureToolResultPairing(next)

    // densable Lv: $Fe(s?.thinkingStripPlan, MY(g)) then BCr.
    const thinkingPlan = mergeThinkingStripPlans(
      options.thinkingStripPlan,
      buildThinkingStripPlanFromMessages(messages),
    )
    if (thinkingPlan.size > 0) {
      next = applyThinkingStripPlanToMessages(
        next as Message[],
        thinkingPlan,
      ) as typeof next
    }

    // densable Lv: FFe(s?.advisorStripPlan, UD(g)) then C_.
    const advisorPlan = mergeAdvisorStripPlans(
      options.advisorStripPlan,
      buildAdvisorStripPlanFromMessages(messages),
    )
    if (advisorPlan.size > 0) {
      next = stripAdvisorBlocksFromMessageIds(
        next as never,
        advisorPlan,
      ) as typeof next
    }

    // Strip advisor blocks — the API rejects them without the beta header.
    if (!betas.includes(ADVISOR_BETA_HEADER)) {
      next = stripAdvisorBlocks(next)
    }

    // Gold `xGt` / `UY` (#1422): substitute `tool_results_cut` stand-ins
    // when `tengu_adaptive_pinwheel` is enabled.
    const { resolveToolResultCutStandIns, applyToolResultCutStandIns } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/attachments.js') as typeof import('../../utils/attachments.js')
    const resolvedToolResultCuts = resolveToolResultCutStandIns(
      messages,
      undefined,
      options.toolResultCuts,
    )
    if (resolvedToolResultCuts && resolvedToolResultCuts.size > 0) {
      next = applyToolResultCutStandIns(
        next,
        resolvedToolResultCuts,
      ) as typeof next
    }

    return next
  }

  // Official 2.1.328 `Yso` / `fio` (`chunk@294254613.js:3319260, 6069470`):
  // strip signed `thinking` and `redacted_thinking` blocks ONLY from assistant
  // messages whose `message.model` is foreign/incompatible with the target model,
  // preserving same-model thinking blocks for prompt cache & multi-turn continuity.
  const messagesWithForeignThinkingStripped = stripForeignThinkingBlocks(
    messages,
    normalizeModelStringForAPI(options.model),
    { keepForeignThinking: options.keepForeignThinking },
  )

  let messagesForAPI = postNormalizeForAPI(
    normalizeMessagesForAPI(
      messagesWithForeignThinkingStripped,
      filteredTools,
      normalizeModel,
    ),
  )
  queryCheckpoint('query_message_normalization_end')
  // densable qWT → HWT after query_message_normalization_end (keep 100/600 +
  // pad 20 + NWT byte cap). Not gated on LWT / tengu_subagent_cache_evict.
  // Does not invent display-window GC of tool results.
  const sessionIdForMediaCap = getSessionId()
  const activeMediaCap = getSessionMediaItemCap(
    sessionIdForMediaCap,
    resolvedModel,
  )
  const hwtKeep = Math.min(
    getRequestLimitMediaKeepCount(options.model, betas),
    activeMediaCap?.limit ?? Infinity,
  )
  const hwtByteCap = getRequestLimitMediaByteCap()
  // Official 2.1.325 #1929 (`La` / `zbn`): track stripped media blocks for main
  // conversation and named subagents so FileReadTool's unchanged-image re-read
  // limiter (`Wit=3`) engages when images are evicted from the request.
  const trackImageMediaStripped = shouldTrackImageMediaStripped(
    options.querySource,
    options.agentId,
  )
  const mediaTakenOut: Array<{ type: string }> | undefined =
    trackImageMediaStripped ? [] : undefined
  const applyHwt = (
    msgs: (UserMessage | AssistantMessage | ApiSystemMessage)[],
    recordStripped = false,
  ): (UserMessage | AssistantMessage | ApiSystemMessage)[] => {
    const collector = recordStripped ? mediaTakenOut : undefined
    if (collector) {
      collector.splice(0)
    }
    const next = stripStoredMediaForRequestLimit(
      msgs,
      hwtKeep,
      HWT_KEEP_PADDING,
      hwtByteCap,
      HWT_BYTE_PADDING,
      collector,
    )
    if (collector && collector.length > 0) {
      const strippedImages = countStrippedImageBlocks(collector)
      if (strippedImages > 0) {
        noteImageMediaStripped(options.agentId, strippedImages)
      }
    }
    return next
  }
  messagesForAPI = applyHwt(messagesForAPI, true)

  // densable qWT midConvFallback: `!midConvLatchedOff && (e8 || fZ)` where
  // e8 = mid-conversation-system beta and fZ = effort beta. Do not invent
  // c8m perTurnEffort (no tip helper).
  let midConvFallback:
    | (() => (UserMessage | AssistantMessage | ApiSystemMessage)[])
    | null = null
  if (
    !midConvLatchedOff &&
    (betas.includes(MID_CONVERSATION_SYSTEM_BETA_HEADER) ||
      betas.includes(EFFORT_BETA_HEADER))
  ) {
    const primary = messagesForAPI
    midConvFallback = primary.some(m => isApiSystemMessage(m))
      ? () =>
          applyHwt(
            postNormalizeForAPI(
              normalizeMessagesForAPI(
                messagesWithForeignThinkingStripped,
                filteredTools,
                undefined,
              ),
            ),
          )
      : () => primary
  }

  // OpenAI-compatible provider: delegate to the OpenAI adapter layer
  // after shared preprocessing (message normalization, tool filtering,
  // media stripping) but before Anthropic-specific logic (betas, thinking, caching).
  // Non-Anthropic adapters re-normalize Message[] themselves and do not use
  // densable api_system wire shape — pass original messages (not mid-conv API list).
  if (getAPIProvider() === 'openai') {
    const { queryModelOpenAI } = await import('./openai/index.js')
    // OpenAI emulates Anthropic's dynamic tool loading client-side. It needs
    // the full tool pool so SearchExtraToolsTool can search deferred MCP tools that
    // were intentionally filtered out of the initial API tool list above.
    yield* queryModelOpenAI(messages, systemPrompt, tools, signal, options)
    return
  }

  if (getAPIProvider() === 'gemini') {
    const { queryModelGemini } = await import('./gemini/index.js')
    yield* queryModelGemini(
      messages,
      systemPrompt,
      filteredTools,
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
      filteredTools,
      signal,
      options,
    )
    return
  }

  // Instrumentation: Track message count after normalization
  logEvent('tengu_api_after_normalize', {
    postNormalizedMessageCount: messagesForAPI.length,
  })

  // When the delta attachment is enabled, deferred tools are announced
  // via persisted deferred_tools_delta attachments instead of this
  // ephemeral prepend (which busts cache whenever the pool changes).
  if (useSearchExtraTools && !isDeferredToolsDeltaEnabled()) {
    // Diff current deferred tools against what's already been announced in
    // prior <available-deferred-tools> injections. Only re-inject when new
    // tools appear (e.g. MCP server connects mid-session).
    const deferredToolList = tools
      .filter(t => deferredToolNames.has(t.name))
      .map(formatDeferredToolLine)
      .sort()
      .join('\n')

    if (deferredToolList) {
      const currentTools = new Set(deferredToolList.split('\n'))
      const hasNewTools = [...currentTools].some(
        t => !lastAnnouncedDeferredTools.has(t),
      )

      if (hasNewTools) {
        lastAnnouncedDeferredTools.clear()
        for (const t of currentTools) lastAnnouncedDeferredTools.add(t)

        messagesForAPI = [
          ...messagesForAPI,
          createUserMessage({
            content: `<system-reminder>\n<available-deferred-tools>\n${deferredToolList}\n</available-deferred-tools>\nDeferred tools appear by name above. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ${SEARCH_EXTRA_TOOLS_TOOL_NAME} with query "select:<name>[,<name>...]" to load tool schemas, then call each tool directly (do not wrap through ExecuteExtraTool).\n</system-reminder>`,
            isMeta: true,
          }),
        ]
      }
    }
  }

  // Chrome tool-search instructions: when the delta attachment is enabled,
  // these are carried as a client-side block in mcp_instructions_delta
  // (attachments.ts) instead of here. This per-request sys-prompt append
  // busts the prompt cache when chrome connects late.
  const hasChromeTools = filteredTools.some(t =>
    isToolFromMcpServer(t.name, CLAUDE_IN_CHROME_MCP_SERVER_NAME),
  )
  const injectChromeHere =
    useSearchExtraTools && hasChromeTools && !isMcpInstructionsDeltaEnabled()

  // filter(Boolean) works by converting each element to a boolean - empty strings become false and are filtered out.
  systemPrompt = asSystemPrompt(
    [
      getAttributionHeader(),
      getCLISyspromptPrefix({
        isNonInteractive: options.isNonInteractiveSession,
        hasAppendSystemPrompt: options.hasAppendSystemPrompt,
      }),
      ...systemPrompt,
      ...(advisorModel ? [ADVISOR_TOOL_INSTRUCTIONS] : []),
      ...(injectChromeHere ? [CHROME_SEARCH_EXTRA_TOOLS_INSTRUCTIONS] : []),
    ].filter(Boolean),
  )

  // ── Break-cache integration ──
  // If a one-time break-cache marker exists, or always-mode is on, append a
  // unique ephemeral nonce comment to the system prompt so the prefix-cache
  // hash changes for this request, forcing a cache miss.
  {
    const onceMarker = getBreakCacheMarkerPath()
    const alwaysFlag = getBreakCacheAlwaysPath()
    const shouldBreak = existsSync(onceMarker) || existsSync(alwaysFlag)
    if (shouldBreak) {
      const nonce = randomUUID()
      systemPrompt = asSystemPrompt([
        ...systemPrompt,
        `<!-- cache-break nonce: ${nonce} -->`,
      ])
      // Only delete the once marker; the always flag persists until /break-cache off
      if (existsSync(onceMarker)) {
        try {
          unlinkSync(onceMarker)
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // Prepend system prompt block for easy API identification
  logAPIPrefix(systemPrompt)

  const enablePromptCaching =
    options.enablePromptCaching ?? getPromptCachingEnabled(options.model)
  const buildSystem = (): TextBlockParam[] =>
    buildSystemPromptBlocks(systemPrompt, enablePromptCaching, {
      skipGlobalCacheForSystemPrompt: needsToolBasedCacheMarker,
      querySource: options.querySource,
      agentCacheTtlOverride: options.agentCacheTtlOverride,
      scopeRefused: isStickyBetaRejected(PROMPT_CACHING_SCOPE_BETA_HEADER),
    })
  let system = buildSystem()
  const useBetas = betas.length > 0

  // densable 2.1.251 D6e — Sr intended TTL + main-thread querySource for xhe
  const intendedPromptCacheTtl = should1hCacheTTL(options.querySource, {
    agentCacheTtlOverride: options.agentCacheTtlOverride,
  })
    ? ('1h' as const)
    : ('5m' as const)
  const sessionCostAttribution = {
    activeMcpServer: options.activeMcpServer,
    activeMcpTool: options.activeMcpTool,
    querySource: options.querySource,
    intendedPromptCacheTtl,
    agentContext: options.agentContext ?? getAgentContext(),
  }

  // Build minimal context for detailed tracing (when beta tracing is enabled)
  // Note: The actual new_context message extraction is done in sessionTracing.ts using
  // hash-based tracking per querySource (agent) from the messagesForAPI array
  const extraToolSchemas = [...(options.extraToolSchemas ?? [])]
  if (advisorModel) {
    // Server tools must be in the tools array by API contract. Appended after
    // toolSchemas (which carries the cache_control marker) so toggling /advisor
    // only churns the small suffix, not the cached prefix.
    extraToolSchemas.push({
      type: 'advisor_20260301',
      name: 'advisor',
      model: advisorModel,
    } as unknown as BetaToolUnion)
  }
  const allTools = [...toolSchemasForApi, ...extraToolSchemas]

  // densable Bwt after assemble. gZn()==='off' returns void — no prefix_delta.
  const prefixNotice = prefixLedgerNotice(
    messages,
    {
      model: options.model,
      tools: allTools,
      system,
      messages: messagesForAPI,
    },
    {
      querySource: options.querySource,
      retryCause: undefined,
      promptEpoch: options.promptRenderEpoch,
    },
  )
  if (prefixNotice !== undefined) {
    // gold yields prefix_delta then re-assembles; off-mode never reaches
    void prefixNotice
  }

  const isFastMode =
    isFastModeEnabled() &&
    isFastModeAvailable() &&
    !isFastModeCooldown() &&
    isFastModeSupportedByModel(options.model) &&
    !!options.fastMode

  // Sticky-on latches for dynamic beta headers. Each header, once first
  // sent, keeps being sent for the rest of the session so mid-session
  // toggles don't change the server-side cache key and bust ~50-70K tokens.
  // Latches are cleared on /clear and /compact via clearBetaHeaderLatches().
  // Per-call gates (isAgenticQuery, querySource===repl_main_thread) stay
  // per-call so non-agentic queries keep their own stable header set.

  let afkHeaderLatched = getAfkModeHeaderLatched() === true
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (
      !afkHeaderLatched &&
      isAgenticQuery &&
      shouldIncludeFirstPartyOnlyBetas() &&
      (autoModeStateModule?.isAutoModeActive() ?? false)
    ) {
      afkHeaderLatched = true
      setAfkModeHeaderLatched(true)
    }
  }

  let fastModeHeaderLatched = getFastModeHeaderLatched() === true
  if (!fastModeHeaderLatched && isFastMode) {
    fastModeHeaderLatched = true
    setFastModeHeaderLatched(true)
  }

  const carriedEffort = resolveCarriedEffortForModel(
    {
      loopEffort: options.refusalFallbackEffort,
      continuesMainConversation: !(options.agentContext ?? getAgentContext()),
    },
    resolvedModel,
  )
  const requestedEffort = resolveAppliedEffort(
    options.model,
    options.effortValue,
    {
      carriedEffort,
      querySource: options.querySource,
    },
  )
  let effort = requestedEffort
  // densable Ie — string effort level from last request's output_config.effort
  // stamped onto every AssistantMessage for transcript persistence (#44).
  // Numeric effort_override (ant-only) is intentionally NOT recorded.
  let effortLevelForTranscript: EffortLevel | undefined

  // densable MWT/pje/a7e — latch cache-diagnosis beta independently of YNe /
  // PROMPT_CACHE_BREAK_DETECTION. SEA still injects Opt when t1f is skipped.
  if (isPromptCacheDiagnosticsEnabled()) {
    stickySendBeta(CACHE_DIAGNOSIS_BETA_HEADER)
  }
  const cacheDiagnosisLatched = isStickyBetaSentActive(
    CACHE_DIAGNOSIS_BETA_HEADER,
  )

  if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
    // Exclude defer_loading tools from the hash -- the API strips them from the
    // prompt, so they never affect the actual cache key. Including them creates
    // false-positive "tool schemas changed" breaks when tools are discovered or
    // MCP servers reconnect.
    const toolsForCacheDetection = allTools.filter(
      t => !('defer_loading' in t && t.defer_loading),
    )
    // Capture everything that could affect the server-side cache key.
    // Pass latched header values (not live state) so break detection
    // reflects what we actually send, not what the user toggled.
    recordPromptState({
      system,
      toolSchemas: toolsForCacheDetection,
      querySource: options.querySource,
      model: options.model,
      agentId: options.agentId,
      fastMode: fastModeHeaderLatched,
      globalCacheStrategy,
      betas,
      autoModeActive: afkHeaderLatched,
      isUsingOverage: currentLimits.isUsingOverage ?? false,
      anyDeferLoading: toolsForCacheDetection.length !== allTools.length,
      is1hCacheTTL: should1hCacheTTL(options.querySource, {
        agentCacheTtlOverride: options.agentCacheTtlOverride,
      }),
      queryDepth: options.queryTracking?.depth,
      cacheDiagnosis: cacheDiagnosisLatched,
      effortValue: effort,
      extraBodyParams: getExtraBodyParams(),
      messagesForAPI,
    })
  }

  const newContext: LLMRequestNewContext | undefined = isBetaTracingEnabled()
    ? {
        systemPrompt: systemPrompt.join('\n\n'),
        querySource: options.querySource,
        tools: jsonStringify(allTools),
      }
    : undefined

  // Capture the span so we can pass it to endLLMRequestSpan later
  // This ensures responses are matched to the correct request when multiple requests run in parallel
  const llmSpan = startLLMRequestSpan(
    options.model,
    newContext,
    messagesForAPI,
    isFastMode,
  )

  const startIncludingRetries = Date.now()
  let start = Date.now()
  let attemptNumber = 0
  const attemptStartTimes: number[] = []
  let stream: Stream<BetaRawMessageStreamEvent> | undefined
  let streamRequestId: string | null | undefined
  let clientRequestId: string | undefined
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins -- Response is available in Node 18+ and is used by the SDK
  let streamResponse: Response | undefined

  // Release all stream resources to prevent native memory leaks.
  // The Response object holds native TLS/socket buffers that live outside the
  // V8 heap (observed on the Node.js/npm path; see GH #32920), so we must
  // explicitly cancel and release it regardless of how the generator exits.
  function releaseStreamResources(): void {
    cleanupStream(stream)
    stream = undefined
    if (streamResponse) {
      streamResponse.body?.cancel().catch(() => {})
      streamResponse = undefined
    }
  }

  // Capture the betas sent in the last API request, including the ones that
  // were dynamically added, so we can log and send it to telemetry.
  let lastRequestBetas: string[] | undefined
  // Official G9e — Bedrock extra body anthropic_beta entries sent on the last request.
  let lastRequestBedrockBetas: string[] = []
  // Per-request Bedrock extra-body beta headers stripped after rejection so
  // paramsFromContext does not re-add them from getBedrockExtraBodyParamsBetas.
  const strippedBedrockBetas = new Set<string>()
  // densable `O1e` @184960115 — last thinking.display actually put on the wire.
  let lastSentThinkingDisplay: string | undefined
  // densable `sT`/`JR` @184946314 — last request carried OL + block_binding.
  let lastSentBindingControls = false
  let lastSentTokenCount = false
  let lastBindingControlsOnThirdParty = false
  let prefixLockStripAttempt = 0
  // Official 2.1.328 `JXo` / `Gjn` (`chunk@294254613.js:2034842, 3401046`):
  // track whether the last request sent `clear_tool_uses_20250919` so HTTP 400
  // refusal strips the edit, latches the model, and retries cleanly.
  let lastSentClearToolUses = false
  let clearToolUsesDisabledForRequest = false
  // Official lM — active media-item-limit retry state (#13)
  let pendingMediaCap:
    | { limit: number; steps: number; refusedAt: number }
    | undefined
  // Official Xc (2.1.295 #358) — context-1m beta fallback state machine.
  let context1mBetaRetryPhase: Context1mBetaRetryPhase = 'idle'
  // Official ALt / class jit (2.1.300 #790) — MCP tool_schema 400 fallback.
  const toolSchemaResolver = new RefusedToolSchemaResolver(
    getRefusedToolSchemas(),
  )
  let lastSentToolSchemas: typeof allTools | undefined

  const recordMediaItemCapSuccess = (): void => {
    try {
      // Official 2.1.325 #1929 (`zbn(agentId, count(La, image))`): report final
      // stripped image count after a successful API response (0 clears state).
      if (mediaTakenOut !== undefined) {
        noteImageMediaStripped(
          options.agentId,
          countStrippedImageBlocks(mediaTakenOut),
        )
      }
      const existing = getSessionMediaItemCap(
        sessionIdForMediaCap,
        resolvedModel,
      )
      if (pendingMediaCap === undefined) {
        if (existing?.gaveUp && existing.limit === undefined) {
          clearSessionMediaItemCap(sessionIdForMediaCap)
        } else if (existing?.gaveUp) {
          setSessionMediaItemCap(sessionIdForMediaCap, {
            ...existing,
            gaveUp: false,
          })
        }
        return
      }
      const { limit, steps, refusedAt } = pendingMediaCap
      pendingMediaCap = undefined
      setSessionMediaItemCap(sessionIdForMediaCap, {
        model: resolvedModel,
        limit: Math.min(limit, existing?.limit ?? Infinity),
        gaveUp: false,
      })
      logEvent('tengu_api_request_media_limit_lowered', {
        query_source:
          options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        media_items_refused: refusedAt,
        media_item_limit: limit,
        steps,
      })
    } catch {
      // ignore media cap telemetry errors
    }
  }

  // Official 2.1.326 (#47): track targeted nested media strips per (msg.content)
  // so a batch PDF rejection removes ONLY the failing PDF (up to 3 individual
  // nested strips before stripping the container content block).
  const targetedMediaStripCounts = new Map<string, number>()

  /**
   * densable aggregator @184994549: zue → Kue → Vue → dY → dGe on unique
   * `r.onError` tokens. Yue `surface:resume-prefill` is not a retry token.
   */
  const onThinkingDisplayApiError = (error: unknown): string | undefined => {
    const lastBetas = lastRequestBetas ?? []
    const token = classifyThinkingDisplayRetry(
      error,
      lastSentThinkingDisplay,
      lastBetas,
      options.model,
      {
        carriedBindingControls: lastSentBindingControls,
        carriedTokenCount: lastSentTokenCount,
        bindingControlsOnThirdParty: lastBindingControlsOnThirdParty,
        messages: messagesForAPI as Message[],
        onMessagesHealed: (next, kind) => {
          // densable od(stripped, "error_recovery", true)
          void kind
          messagesForAPI = next as typeof messagesForAPI
        },
        onThinkingStripped: att => {
          // densable Xue(Ps.from) then Zue() yield after message_stop
          setPendingThinkingStripped(att)
          markRelayThinkingStripRecorded('marker')
        },
        prefixLockAttempt: prefixLockStripAttempt + 1,
        resumeIncompleteThinking: options.resumeIncompleteThinking,
        leavesEffortSupportAlone: options.leavesEffortSupportAlone,
        querySource: options.querySource,
      },
    )
    if (token === 'retry:thinking-display-updates') {
      betas = betas.filter(b => b !== THINKING_DISPLAY_UPDATES_BETA_HEADER)
    }
    if (token === 'retry:thinking-binding-controls') {
      lastSentBindingControls = false
      betas = betas.filter(b => b !== THINKING_BINDING_CONTROLS_BETA_HEADER)
    }
    if (token === 'retry:thinking-token-count-beta') {
      lastSentTokenCount = false
      betas = betas.filter(b => b !== THINKING_TOKEN_COUNT_BETA_HEADER)
    }
    if (token === 'retry:thinking-resumption-beta') {
      betas = betas.filter(b => b !== THINKING_RESUMPTION_BETA_HEADER)
    }
    // densable aQ @184994206 — d3r latch is in classifyThinkingTypeRetry;
    // paramsFromContext reads Lyn(h.model) on the retry.
    if (token === 'retry:thinking-type') {
      void token
    }
    if (token?.startsWith('retry:prefix-lock-strip')) {
      prefixLockStripAttempt += 1
    }
    if (
      token === 'retry:safeguards' ||
      token === 'retry:safeguards-unclaimed'
    ) {
      betas = betas.filter(b => b !== DANGEROUS_TOOL_USE_BETA_HEADER)
    }
    if (token === 'retry:effort-unsupported') {
      betas = betas.filter(b => b !== EFFORT_BETA_HEADER)
      if (options.leavesEffortSupportAlone) {
        effort = undefined
      }
    }
    if (token != null) {
      return token
    }

    // Official 2.1.328 `JXo` / `Gjn` (`chunk@294254613.js:2034842, 3401046`):
    // HTTP 400 refusing `clear_tool_uses_20250919` latches the model for the
    // process, strips the edit for this request, and retries cleanly.
    if (
      lastSentClearToolUses &&
      handleClearToolUsesRefusalError(error, options.model)
    ) {
      clearToolUsesDisabledForRequest = true
      lastSentClearToolUses = false
      return 'retry:tool-result-clearing-edit'
    }

    // Official 2.1.314 k0o — API 400 "Invalid effort level" from org cap:
    // step down one effort level, latch for this session, and retry.
    if (
      isInvalidEffortLevelError(error) &&
      options.querySource !== 'auto_mode' &&
      options.querySource !== 'auto_mode_investigator'
    ) {
      const sentEffort =
        effortLevelForTranscript ??
        (typeof effort === 'string' && isEffortLevel(effort)
          ? effort
          : undefined)
      if (sentEffort !== undefined) {
        const nextCap = stepDownOrgEffortCap(options.model, sentEffort)
        if (nextCap !== undefined) {
          effort = clampEffortToCap(effort, nextCap)
          logForDebugging(
            `[effort] the API refused effort '${sentEffort}' as above the organization's cap for model ${options.model}. Sending the request again at no more than '${nextCap}', as later requests to this model will be.`,
            { level: 'warn' },
          )
          return `retry:org-effort-cap:${nextCap}`
        }
      }
    }

    // Official s9o / nwt (#12 / 2.1.328) — runs BEFORE d9o (decideContext1mBetaRetry)
    // in N9o = [..., s9o, OTe, d9o, ...]. Strip all rejected non-1m beta headers at
    // once (including non-400 statuses such as 422) and log tengu_beta_400_healed.
    // Exclude CONTEXT_1M_BETA_HEADER (official Jcs) so it is exclusively handled
    // by decideContext1mBetaRetry and never silently stripped on direct 1P.
    const nonContext1mSentBetas = [
      ...lastBetas,
      ...lastRequestBedrockBetas,
    ].filter(b => b !== CONTEXT_1M_BETA_HEADER)
    const rejectedBetas = findRejectedBetaHeaders(error, nonContext1mSentBetas)
    if (rejectedBetas.length > 0) {
      const rejectedSet = new Set(rejectedBetas.map(r => r.header))
      betas = betas.filter(b => !rejectedSet.has(b))
      for (const h of rejectedSet) {
        strippedBedrockBetas.add(h)
      }
      if (rejectedSet.has(PROMPT_CACHING_SCOPE_BETA_HEADER)) {
        stickyRejectBeta(PROMPT_CACHING_SCOPE_BETA_HEADER)
        system = buildSystem()
      }
      if (
        rejectedSet.has(EFFORT_BETA_HEADER) &&
        error instanceof APIError &&
        error.status === 400
      ) {
        if (options.leavesEffortSupportAlone) {
          effort = undefined
        } else {
          markEffortUnsupported(options.model)
        }
      }
      for (const match of rejectedBetas) {
        logEvent('tengu_beta_400_healed', {
          beta: match.header as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          provider:
            getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...(error instanceof APIError && { status: error.status }),
          only_mentioned: match.onlyMentioned,
        })
      }
      return `retry:beta-rejected:${rejectedBetas.map(r => r.header).join(',')}`
    }

    // Official d9o / Rve (2.1.295 #358 / 2.1.328) — runs AFTER s9o so dual-beta
    // 400s (e.g. rejecting both effort and context-1m) strip the non-1m beta first,
    // then retry without context-1m on the next attempt and latch
    // markContext1mBetaRefusedForModel on retry success, while direct Anthropic
    // providers (1P or anthropicAws with default base URL) never silently strip
    // context-1m. Check both header betas and Bedrock extra body betas.
    const provider = getAPIProvider()
    const isDirectAnthropicProvider =
      (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()) ||
      (provider === 'anthropicAws' && !process.env.ANTHROPIC_AWS_BASE_URL)
    const hasContext1mBeta =
      lastBetas.includes(CONTEXT_1M_BETA_HEADER) ||
      lastRequestBedrockBetas.includes(CONTEXT_1M_BETA_HEADER)
    const context1mRetry = decideContext1mBetaRetry({
      error,
      phase: context1mBetaRetryPhase,
      context1mBetaSent: hasContext1mBeta,
      isDirectAnthropicProvider,
      isFirstParty: isDirectAnthropicProvider,
    })
    context1mBetaRetryPhase = context1mRetry.nextPhase
    if (context1mRetry.action === 'retry:context-1m-beta') {
      logForDebugging(
        `[betas] an HTTP 400 ${context1mRetry.nextPhase === 'retrying' ? 'reads as the backend rejecting' : 'says "invalid beta flag", which may be about'} ${CONTEXT_1M_BETA_HEADER}; resending once without it`,
        { level: 'warn' },
      )
      return 'retry:context-1m-beta'
    }

    // Official OLt (#13) — strip oldest images/documents on unprocessable
    // media limit rejection and step down through [510, 255, 127].
    const existingCap = getSessionMediaItemCap(
      sessionIdForMediaCap,
      resolvedModel,
    )
    if (isUnprocessableMediaError(error) && !existingCap?.gaveUp) {
      const currentCount = countStoredMediaItems(messagesForAPI)
      const capBound = Math.min(
        currentCount,
        pendingMediaCap?.limit ?? Infinity,
      )
      const nextLimit = MEDIA_ITEM_LIMIT_STEPS.find(step => step < capBound)
      if (nextLimit === undefined) {
        if (pendingMediaCap !== undefined) {
          const { steps, refusedAt } = pendingMediaCap
          pendingMediaCap = undefined
          setSessionMediaItemCap(sessionIdForMediaCap, {
            model: resolvedModel,
            limit: existingCap?.limit,
            gaveUp: true,
          })
          logForDebugging(
            `[media-item-limit] The model still refuses this request as unprocessable with ${currentCount} images and documents left. Not removing any more.`,
            { level: 'warn' },
          )
          logEvent('tengu_api_request_media_limit_gave_up', {
            query_source:
              options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            media_items_refused: refusedAt,
            steps,
          })
        }
        return undefined
      }
      const stripToLimit = (
        msgs: (UserMessage | AssistantMessage | ApiSystemMessage)[],
        recordStripped = false,
      ) => {
        const collector = recordStripped ? mediaTakenOut : undefined
        const next = stripStoredMediaForRequestLimit(
          msgs,
          nextLimit,
          HWT_KEEP_PADDING,
          Number.POSITIVE_INFINITY,
          0,
          collector,
        )
        if (collector && collector.length > 0) {
          const strippedImages = countStrippedImageBlocks(collector)
          if (strippedImages > 0) {
            noteImageMediaStripped(options.agentId, strippedImages)
          }
        }
        return next
      }
      messagesForAPI = stripToLimit(messagesForAPI, true)
      if (midConvFallback) {
        const prevFallback = midConvFallback
        midConvFallback = () => stripToLimit(prevFallback())
      }
      pendingMediaCap = {
        limit: nextLimit,
        steps: (pendingMediaCap?.steps ?? 0) + 1,
        refusedAt: pendingMediaCap?.refusedAt ?? currentCount,
      }
      logForDebugging(
        `[media-item-limit] The model refused this request as unprocessable. It held ${currentCount} images and documents; the oldest were removed to fit a limit of ${nextLimit}, and it is being sent again. If it is answered, this conversation keeps that limit.`,
        { level: 'warn' },
      )
      return `retry:media-item-limit:${nextLimit}`
    }

    // Official 2.1.326 (#47) `F7s` / `qir` / `c9t`: when a 400 error points at
    // a specific message/content(/tool_result.content) image or PDF block,
    // remove ONLY that failing block and retry instead of dropping sibling PDFs
    // or triggering the ToolSearchRefusalError catch-all (which drops deferred
    // tools and busts the prompt cache).
    if (error instanceof APIError && error.status === 400) {
      const mediaLoc = parseMediaErrorLocation(error.message)
      if (
        mediaLoc &&
        mediaLoc.messageIdx !== undefined &&
        mediaLoc.contentIdx !== undefined
      ) {
        const pairKey = `${mediaLoc.messageIdx}.${mediaLoc.contentIdx}`
        const priorNestedCount = targetedMediaStripCounts.get(pairKey) ?? 0
        const effectiveNestedIdx =
          mediaLoc.nestedContentIdx !== undefined && priorNestedCount < 3
            ? mediaLoc.nestedContentIdx
            : undefined
        const stripped = stripTargetedMediaBlock(
          messagesForAPI as Message[],
          {
            messageIdx: mediaLoc.messageIdx,
            contentIdx: mediaLoc.contentIdx,
            nestedContentIdx: effectiveNestedIdx,
            kind: mediaLoc.kind,
          },
          error.message,
        )
        if (stripped.removed) {
          messagesForAPI = stripped.messages as typeof messagesForAPI
          if (effectiveNestedIdx !== undefined) {
            targetedMediaStripCounts.set(pairKey, priorNestedCount + 1)
          }
          const locDesc =
            effectiveNestedIdx !== undefined
              ? `${pairKey}.tool_result.content.${effectiveNestedIdx}`
              : pairKey
          logForDebugging(
            `[media-strip] Removed rejected ${mediaLoc.kind} at messages.${locDesc} and retrying`,
            { level: 'warn' },
          )
          return `retry:targeted-media:${locDesc}`
        }
      }
    }

    // Official jit.resolve (2.1.300 #790) — degrade refused MCP tool schema
    // to { type: 'object' } and retry.
    const toolSchemaRetry = toolSchemaResolver.resolve(
      error,
      lastSentToolSchemas,
      filteredTools,
      options.querySource,
    )
    if (toolSchemaRetry !== undefined) {
      return toolSchemaRetry
    }

    // Official 2.1.323 (#1987): recover from mid-conversation role:"system" and
    // api_system cache_control rejections on non-streaming requests as well as
    // streaming requests via the shared `onError` handler.
    if (error instanceof APIError && error.status === 400) {
      if (midConvFallback && isMidConvSystemRoleRejected(error)) {
        messagesForAPI = midConvFallback()
        midConvFallback = null
        latchMidConvSystemRejected()
        clearBetasCaches()
        betas = betas.filter(b => b !== MID_CONVERSATION_SYSTEM_BETA_HEADER)
        logForDebugging(
          '[mid-conv-system] server rejected role:"system" — falling back to a body with no {role:"system"} turn, sticky-rejecting the beta until /clear or /compact',
          { level: 'warn' },
        )
        return 'retry:mid-conv-system'
      }
      if (
        shouldCacheControlOnApiSystem() &&
        isApiSystemCacheControlRejected(error)
      ) {
        latchMidConvCachePromotionRejected()
        logForDebugging(
          '[mid-conv-system] proxy rejected cache_control on the api_system tail — demoting the breakpoint to the trailing message for this conversation',
          { level: 'warn' },
        )
        return 'retry:api-system-cache-demote'
      }
    }

    // Official 2.1.328 `DTe` / `N9e` (LAST in `N9o`, AFTER mid-conv-system and
    // all targeted error recoveries): retry without deferred tools on 400/422
    // refusal, gated on direct-1P `defer_loading` and excluding withRetry/Foundry
    // errors.
    if (
      shouldTriggerToolSearchRefusal({
        error,
        useSearchExtraTools,
        alreadyRetried: options._toolSearchRefusalRetried === true,
        isDirectAnthropicProvider,
        provider,
        model: options.model,
      })
    ) {
      const apiErr = error as APIError
      logForDebugging(
        `[ToolSearch] HTTP ${apiErr.status}; sending the request again without deferred tools`,
        { level: 'warn' },
      )
      throw new ToolSearchRefusalError(error)
    }

    return undefined
  }

  // densable `n2` — log the effort clamp once per queryModel call (retries
  // reuse paramsFromContext).
  let loggedEffortClamp = false
  let serverClassifierRequest: ServerClassifierRequest | undefined

  const paramsFromContext = (retryContext: RetryContext) => {
    const omitContext1mBeta =
      (context1mBetaRetryPhase !== 'idle' &&
        context1mBetaRetryPhase !== 'spent') ||
      isContext1mBetaRefusedForModel(retryContext.model)
    let betasParams = betas.filter(
      b => b !== CONTEXT_1M_BETA_HEADER || !omitContext1mBeta,
    )

    // Append 1M beta dynamically for the Sonnet 1M experiment.
    if (
      !omitContext1mBeta &&
      context1mBetaRetryPhase === 'idle' &&
      !betasParams.includes(CONTEXT_1M_BETA_HEADER) &&
      getSonnet1mExpTreatmentEnabled(retryContext.model)
    ) {
      betasParams.push(CONTEXT_1M_BETA_HEADER)
    }

    // For Bedrock, include model-based betas (no tool search header — self-built search)
    const bedrockBetas =
      getAPIProvider() === 'bedrock'
        ? getBedrockExtraBodyParamsBetas(retryContext.model).filter(
            b =>
              !strippedBedrockBetas.has(b) &&
              (b !== CONTEXT_1M_BETA_HEADER || !omitContext1mBeta),
          )
        : []
    lastRequestBedrockBetas = bedrockBetas
    const extraBodyParams = getExtraBodyParams(bedrockBetas)
    const provider = getAPIProvider()
    const isBedrock = provider === 'bedrock'
    // densable Joe @184955815 / @184955861 / @184956555 / @184957363
    copyBetaHeaderToExtraBody(
      extraBodyParams,
      THINKING_TOKEN_COUNT_BETA_HEADER,
      isBedrock && betasParams.includes(THINKING_TOKEN_COUNT_BETA_HEADER),
    )
    // densable `$h` — sticky-send Gv when the classifier compositor is on.
    const allowsDangerousToolUseBeta = modelAllowsDangerousToolUseBeta(
      provider,
      resolvedModel,
    )
    const classifierContext =
      options.serverClassifier === true &&
      options.autoModeServerContext !== undefined
        ? composeAutoModeClassifierContext({
            autoModeServerContext: options.autoModeServerContext,
            priorTurnContext: [],
            systemReminders: [],
          })
        : undefined
    const stickySendDangerousToolUse =
      options.serverClassifier === true &&
      classifierContext !== undefined &&
      allowsDangerousToolUseBeta &&
      serverClassifierBetasEligible() &&
      !isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER) &&
      !isThirdPartyServerClassifierRefused()
    if (stickySendDangerousToolUse) {
      stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    }
    if (
      allowsDangerousToolUseBeta &&
      isStickyBetaSentActive(DANGEROUS_TOOL_USE_BETA_HEADER) &&
      !betasParams.includes(DANGEROUS_TOOL_USE_BETA_HEADER)
    ) {
      betasParams.push(DANGEROUS_TOOL_USE_BETA_HEADER)
    }
    copyBetaHeaderToExtraBody(
      extraBodyParams,
      DANGEROUS_TOOL_USE_BETA_HEADER,
      isBedrock && betasParams.includes(DANGEROUS_TOOL_USE_BETA_HEADER),
    )
    copyBetaHeaderToExtraBody(
      extraBodyParams,
      THINKING_BINDING_CONTROLS_BETA_HEADER,
      isBedrock,
    )

    const outputConfig: BetaOutputConfig = {
      ...((extraBodyParams.output_config as BetaOutputConfig) ?? {}),
    }

    configureEffortParams(
      effort,
      outputConfig,
      extraBodyParams,
      betasParams,
      options.model,
    )
    if (isEffortUnsupported(options.model)) {
      delete (outputConfig as { effort?: unknown }).effort
    }

    configureTaskBudgetParams(
      options.taskBudget,
      outputConfig as BetaOutputConfig & { task_budget?: TaskBudgetParam },
      betasParams,
    )

    // densable wGo — attach format only when mCn supports structured outputs
    // (CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS / JK / provider / model gates).
    if (
      options.outputFormat &&
      !('format' in outputConfig) &&
      modelSupportsStructuredOutputs(options.model)
    ) {
      outputConfig.format = options.outputFormat as BetaJSONOutputFormat
      if (!betasParams.includes(STRUCTURED_OUTPUTS_BETA_HEADER)) {
        betasParams.push(STRUCTURED_OUTPUTS_BETA_HEADER)
      }
    }

    // Retry context gets preference because it tries to course correct if we exceed the context window limit.
    // Official 2.1.326 (#51) + 2.1.328 (`Math.min($n?.maxTokensOverride || ie.maxOutputTokensOverride || Infinity, nR.ceiling(dn.maxOutputTokens))`):
    // apply any session-cached model output ceiling AND any retry-lowered
    // max_tokens override as strict upper caps so unknown-model continuation
    // never bumps a server-lowered cap (e.g. 16384) back up to 128000.
    const cachedModelCeiling = getCachedModelMaxTokensCeiling(
      retryContext.model,
    )
    const rawMaxOutputTokens =
      options.maxOutputTokensOverride ||
      getMaxOutputTokensForModel(options.model)
    const maxOutputTokens = resolveOutputTokenLimitForContinuation({
      model: options.model,
      requestedMaxTokens: rawMaxOutputTokens,
      continuesCutReply:
        options.continuesCutReply === true &&
        options.querySource !== 'hook_agent' &&
        !options.maxOutputTokensOverride,
      cachedModelCeiling,
      retryMaxTokensOverride: retryContext?.maxTokensOverride,
      isSecurityControl:
        options.querySource === 'auto_mode' ||
        options.querySource === 'auto_mode_investigator',
    })

    // Official DISABLE_THINKING / DISABLE_ADAPTIVE_THINKING densables.
    let thinkingDisabled = isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_THINKING)
    let adaptiveThinkingDisabled = isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING,
    )
    try {
      const { isThinkingDisabled, isAdaptiveThinkingDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
      thinkingDisabled = isThinkingDisabled()
      adaptiveThinkingDisabled = isAdaptiveThinkingDisabled()
    } catch {
      // residual helpers optional
    }
    // densable Kn = r.type !== "disabled" && !bn
    // Local residual env DISABLE_THINKING still wins (even on HQt models).
    const hasThinking = thinkingConfig.type !== 'disabled' && !thinkingDisabled
    const effortName = typeof effort === 'string' ? effort : undefined
    let thinking:
      | (BetaMessageStreamParams['thinking'] & {
          display?: ThinkingApiDisplay | null
        })
      | undefined
    const extraBodyHasThinking = 'thinking' in extraBodyParams
    const wireDisplay = resolveOutgoingThinkingDisplay(
      thinkingConfig.display,
      options.model,
      getThinkingHighlightsRefused(),
    )

    // IMPORTANT: Do not change the adaptive-vs-budget thinking selection below
    // without notifying the model launch DRI and research. This is a sensitive
    // setting that can greatly affect model quality and bashing.
    //
    // densable HQt (rejects_disabled_thinking): when config is disabled, densable
    // does NOT send {type:'disabled'} for those models (Bo stays undefined;
    // server defaults adaptive). Gold firstParty explicit-disabled branch:
    // `r.type==="disabled" && Ne()==="firstParty" && !Mc && tSn(F) && !NOe(F)`.
    if (hasThinking && modelSupportsThinking(options.model)) {
      // densable `p3n({runtimeOverride:Lyn(h.model), resolvedModel:ye, canonicalModel:Pe})`
      const thinkingType = resolveAdaptiveThinkingType({
        runtimeOverride: getThinkingTypeOverride(options.model),
        resolvedModel,
        canonicalModel: firstPartyNameToCanonical(resolvedModel),
        disableAdaptiveEnv: adaptiveThinkingDisabled,
      })
      if (thinkingType === 'adaptive') {
        // For models that support adaptive thinking, always use adaptive
        // thinking without a budget.
        thinking = {
          type: 'adaptive',
          display: wireDisplay,
        } as BetaMessageStreamParams['thinking']
      } else {
        // For models that do not support adaptive thinking, use the default
        // thinking budget unless explicitly specified.
        let thinkingBudget = getMaxThinkingTokensForModel(options.model)
        if (
          thinkingConfig.type === 'enabled' &&
          thinkingConfig.budgetTokens !== undefined
        ) {
          thinkingBudget = thinkingConfig.budgetTokens
        }
        // Official 2.1.328 (`chunk@294254613.js:3372275`): enforce the 1024-token
        // API floor on thinking.budget_tokens (`Math.max(1024, Math.min(maxOutputTokens - 1, thinkingBudget))`).
        thinkingBudget = Math.max(
          1024,
          Math.min(maxOutputTokens - 1, thinkingBudget),
        )
        thinking = {
          budget_tokens: thinkingBudget,
          type: 'enabled',
          display: wireDisplay,
        } as BetaMessageStreamParams['thinking']
      }
    } else if (
      thinkingConfig.type === 'disabled' &&
      getAPIProvider() === 'firstParty' &&
      !thinkingDisabled &&
      modelSupportsThinking(options.model) &&
      !modelRejectsDisabledThinking(options.model)
    ) {
      thinking = { type: 'disabled' }
    }

    const displayForMode =
      thinkingConfig.type === 'disabled' ? undefined : thinkingConfig.display
    let displayMode: ReturnType<typeof resolveThinkingDisplayMode> = 'none'
    try {
      displayMode = resolveThinkingDisplayMode(
        displayForMode,
        thinkingConfig.displayExplicit ?? getThinkingDisplayExplicit(),
      )
    } catch (err) {
      logError(err)
    }
    const dropRedactThinkingBeta = (): void => {
      const idx = betasParams.indexOf(REDACT_THINKING_BETA_HEADER)
      if (idx !== -1) betasParams.splice(idx, 1)
    }
    // densable `if(Td&&Zg)DT()` — any display on the thinking param drops redact.
    if (thinking && wireDisplay) dropRedactThinkingBeta()
    switch (displayMode) {
      case 'thinking_and_connector_text':
      case 'none':
        break
      case 'connector_text': {
        if (
          shouldSendThinkingDisplayUpdates({
            thinkingType: thinking?.type,
            model: options.model,
            extraBodyHasThinking,
            simulateProxy: shouldSimulateProxyUsage(),
            displayUpdatesRejected: isStickyBetaRejected(
              THINKING_DISPLAY_UPDATES_BETA_HEADER,
            ),
          })
        ) {
          thinking = {
            ...thinking,
            display: 'updates',
          } as typeof thinking
          if (!betasParams.includes(THINKING_DISPLAY_UPDATES_BETA_HEADER)) {
            betasParams.push(THINKING_DISPLAY_UPDATES_BETA_HEADER)
          }
          dropRedactThinkingBeta()
        }
        break
      }
    }

    // densable `sT`/`JR` @184946314 + `Td.block_binding` @184957400.
    lastSentBindingControls = false
    lastBindingControlsOnThirdParty = false
    let prefixMismatchBehavior: PrefixMismatchBehavior | undefined
    try {
      const mechanicalDisabled =
        thinkingConfig.type === 'disabled' && thinkingConfig.mechanical === true
      const bindingEligible =
        !mechanicalDisabled &&
        !shouldSimulateProxyUsage() &&
        (getAnthropicApiKey() !== null ||
          !isClaudeAISubscriber() ||
          process.env.ANTHROPIC_BASE_URL !== undefined)
      const provider = getAPIProvider()
      if (bindingEligible && densableExperimentalCapabilityBetas()) {
        if (thinkingConfig.type !== 'disabled') {
          prefixMismatchBehavior = resolvePrefixMismatchBehavior()
          if (shouldSendThinkingBindingControls(prefixMismatchBehavior)) {
            stickySendBeta(THINKING_BINDING_CONTROLS_BETA_HEADER)
          }
        }
        lastSentBindingControls = isStickyBetaSentActive(
          THINKING_BINDING_CONTROLS_BETA_HEADER,
        )
      } else if (
        bindingEligible &&
        !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)
      ) {
        if (
          (provider === 'bedrock' ||
            provider === 'mantle' ||
            provider === 'vertex') &&
          (provider === 'vertex'
            ? process.env.ANTHROPIC_VERTEX_BASE_URL === undefined
            : provider === 'bedrock'
              ? process.env.ANTHROPIC_BEDROCK_BASE_URL === undefined
              : process.env.ANTHROPIC_BEDROCK_MANTLE_BASE_URL === undefined) &&
          providerSupportsThinkingBindingOn3P(provider, options.model)
        ) {
          if (thinkingConfig.type !== 'disabled') {
            stickySendBeta(THINKING_BINDING_CONTROLS_BETA_HEADER)
          }
          lastSentBindingControls = isStickyBetaSentActive(
            THINKING_BINDING_CONTROLS_BETA_HEADER,
          )
        }
      }
    } catch (err) {
      logError(err)
      prefixMismatchBehavior = undefined
      lastSentBindingControls = false
    }
    if (!lastSentBindingControls && getAPIProvider() !== 'firstParty') {
      betasParams = betasParams.filter(
        b => b !== THINKING_BINDING_CONTROLS_BETA_HEADER,
      )
    }
    if (
      lastSentBindingControls &&
      !isStickyBetaRejected(THINKING_BINDING_CONTROLS_BETA_HEADER)
    ) {
      if (!betasParams.includes(THINKING_BINDING_CONTROLS_BETA_HEADER)) {
        betasParams.push(THINKING_BINDING_CONTROLS_BETA_HEADER)
      }
      if (
        prefixMismatchBehavior !== undefined &&
        (thinking?.type === 'adaptive' || thinking?.type === 'enabled') &&
        !extraBodyHasThinking
      ) {
        thinking = {
          ...thinking,
          block_binding: {
            prefix_mismatch_behavior: prefixMismatchBehavior,
          },
        } as unknown as typeof thinking
      }
    }
    lastBindingControlsOnThirdParty =
      lastSentBindingControls &&
      getAPIProvider() !== 'firstParty' &&
      betasParams.includes(THINKING_BINDING_CONTROLS_BETA_HEADER)

    lastSentTokenCount =
      !isStickyBetaRejected(THINKING_TOKEN_COUNT_BETA_HEADER) &&
      betasParams.includes(THINKING_TOKEN_COUNT_BETA_HEADER)

    // densable `JPe(ye)` @184958046 — thinking-resumption header.
    if (
      shouldSendThinkingResumptionBeta(options.model) &&
      !betasParams.includes(THINKING_RESUMPTION_BETA_HEADER)
    ) {
      betasParams.push(THINKING_RESUMPTION_BETA_HEADER)
    }

    // densable 2.1.251 #13 — `ga.effort=Wht` when outgoing thinking is
    // `{type:"disabled"}` and `bJn` (above high) and (`Vm` mechanical or
    // `SJn`). Gold does not throw. Env DISABLE_THINKING omits the field
    // (`!Mc` fails the firstParty branch) and does not clamp.
    const mechanical =
      thinkingConfig.type === 'disabled' && thinkingConfig.mechanical === true
    const effortDecision = decideEffortWhenThinkingDisabled({
      effort: effortName,
      thinkingOff: thinking?.type === 'disabled',
      model: options.model,
      mechanical,
    })
    if (effortDecision.action === 'clamp') {
      if (!loggedEffortClamp) {
        loggedEffortClamp = true
        logForDebugging(
          formatEffortClampDebugMessage(
            effortDecision.from,
            effortDecision.to,
            mechanical,
          ),
        )
      }
      if (
        !mechanical &&
        querySourceBucket(options.querySource) === 'main' &&
        oncePerSession('effort_thinking_disabled_clamp')
      ) {
        logEvent('tengu_effort_clamped_thinking_disabled', {
          from: effortDecision.from as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          to: effortDecision.to as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          query_source: analyticsQuerySource(
            options.querySource,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      if ('effort' in outputConfig) {
        ;(outputConfig as { effort?: string }).effort = effortDecision.to
      }
    }

    // densable: tool_choice {type:'tool'} demoted to auto when thinking is
    // active — including HQt models with omitted thinking (server-side on).
    let toolChoice = options.toolChoice
    if (
      toolChoice?.type === 'tool' &&
      isThinkingActiveForToolChoice(thinking, options.model)
    ) {
      logForDebugging(
        `tool_choice {type:'tool', name:'${toolChoice.name}'} demoted to auto: extended thinking is active`,
      )
      toolChoice = { type: 'auto' }
    }

    // Get API context management strategies if enabled (official SUn + idle-gated zjn)
    const contextManagement = getAPIContextManagement({
      hasThinking,
      isRedactThinkingActive: betasParams.includes(REDACT_THINKING_BETA_HEADER),
      clearAllThinking: false,
      model: options.model,
      messages,
      disableClearToolUses: clearToolUsesDisabledForRequest,
    })
    lastSentClearToolUses =
      contextManagement?.edits.some(
        edit => edit.type === 'clear_tool_uses_20250919',
      ) === true

    const enablePromptCaching =
      options.enablePromptCaching ?? getPromptCachingEnabled(retryContext.model)

    // Fast mode: header is latched session-stable (cache-safe), but
    // `speed='fast'` stays dynamic so cooldown still suppresses the actual
    // fast-mode request without changing the cache key.
    let speed: BetaMessageStreamParams['speed']
    const isFastModeForRetry =
      isFastModeEnabled() &&
      isFastModeAvailable() &&
      !isFastModeCooldown() &&
      isFastModeSupportedByModel(options.model) &&
      !!retryContext.fastMode
    if (isFastModeForRetry) {
      speed = 'fast'
    }
    if (fastModeHeaderLatched && !betasParams.includes(FAST_MODE_BETA_HEADER)) {
      betasParams.push(FAST_MODE_BETA_HEADER)
    }

    // AFK mode beta: latched once auto mode is first activated. Still gated
    // by isAgenticQuery per-call so classifiers/compaction don't get it.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (
        afkHeaderLatched &&
        shouldIncludeFirstPartyOnlyBetas() &&
        isAgenticQuery &&
        !betasParams.includes(AFK_MODE_BETA_HEADER)
      ) {
        betasParams.push(AFK_MODE_BETA_HEADER)
      }
    }

    // densable `_e&&!yt.includes(Opt))yt.push(Opt)` — send cache-diagnosis when
    // sticky sent&&!rejected (latched above via MWT/pje).
    if (
      isStickyBetaSentActive(CACHE_DIAGNOSIS_BETA_HEADER) &&
      !betasParams.includes(CACHE_DIAGNOSIS_BETA_HEADER)
    ) {
      betasParams.push(CACHE_DIAGNOSIS_BETA_HEADER)
    }

    // Official 2.1.328 (`chunk@294254613.js:3377210`): only send temperature
    // when thinking is disabled AND the model accepts `temperature` (`dn.acceptsTemperature`).
    const modelFacts = getModelFacts(resolvedModel)
    const temperature =
      !hasThinking && modelFacts.acceptsTemperature
        ? (options.temperatureOverride ?? 1)
        : undefined

    // Filter out any empty-string beta headers before sending.
    // Constants like AFK_MODE_BETA_HEADER or CLI_INTERNAL_BETA_HEADER
    // can be '' when their feature gate is off; an empty string in the
    // betas array produces an invalid anthropic-beta header (400 error).
    // Official SIMULATE_PROXY_USAGE: keep only oauth beta (eJe) so requests
    // look like a corporate proxy that strips non-oauth anthropic-beta values.
    const simulateProxy = shouldSimulateProxyUsage()
    let filteredBetas = betasParams.filter(Boolean)
    if (simulateProxy) {
      const before = filteredBetas
      filteredBetas = filterBetasForSimulateProxyUsage(
        filteredBetas,
        OAUTH_BETA_HEADER,
      )
      logForDebugging(
        `[API:client] SIMULATE_PROXY_USAGE: stripping ${before.length - filteredBetas.length} beta headers from request (keeping ${filteredBetas.join(', ') || 'none'}): ${before.join(', ')}`,
      )
    }
    lastRequestBetas = filteredBetas
    // densable rke — classifier request bag; JOe previous on params rebuild.
    const simulateProxyUsageEnv = process.env.CLAUDE_CODE_SIMULATE_PROXY_USAGE
    const toolsPresent = allTools.length > 0
    const sendServerClassifier =
      stickySendDangerousToolUse &&
      toolsPresent &&
      !simulateProxyUsageEnv &&
      filterBetasForClassifierProvider(filteredBetas).includes(
        DANGEROUS_TOOL_USE_BETA_HEADER,
      )
    if (serverClassifierRequest !== undefined) {
      settleServerClassifierStreamEnded(serverClassifierRequest)
    }
    serverClassifierRequest = sendServerClassifier
      ? createServerClassifierRequest(randomUUID(), {
          artifacts: classifierContext?.artifacts,
          thread: false,
          agentId: options.agentId,
        })
      : undefined
    // Official 2.1.304 (#1005): do not store slimmed safety classifier
    // context with every request in serverClassifierHistory.
    lastSentThinkingDisplay =
      thinking !== undefined &&
      thinking !== null &&
      typeof thinking === 'object' &&
      'display' in thinking
        ? ((thinking as { display?: string | null }).display ?? undefined)
        : undefined
    // Official: send betas when useBetas and (!simulate || remaining > 0)
    const sendBetas = useBetas && (!simulateProxy || filteredBetas.length > 0)

    // densable: Ie = typeof ra === "string" && MPe(ra) ? ra : void 0
    // densable Ye: skip transcript effort when thinking is mechanically off.
    effortLevelForTranscript = transcriptEffortWhenMechanicalDisabled(
      thinkingConfig.type === 'disabled' && thinkingConfig.mechanical === true,
      transcriptEffortFromOutputConfig(outputConfig),
    )

    // densable ekd/rkd — server-lane fallbacks body + credit beta/token stamp
    let serverFallbackBody: Record<string, unknown> = {}
    let creditStamp: { fallback_credit_token?: string } = {}
    let requestBetas = filteredBetas
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        planServerRefusalFallbackBetas,
        planFallbackCreditBeta,
        planFallbackCreditStamp,
      } =
        require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
      const ekd = planServerRefusalFallbackBetas({
        serverRefusalFallback: options.serverRefusalFallback,
        requestModel: options.model,
        silentArmActive: options.refusalFallbackSilentArmActive === true,
      })
      serverFallbackBody = ekd.body as Record<string, unknown>
      let betasWithEk = [...requestBetas]
      for (const h of ekd.betas) {
        if (!betasWithEk.includes(h)) betasWithEk.push(h)
      }
      const rkd = planFallbackCreditBeta({
        creditLaneArmed: options.fallbackCreditLaneArmed === true,
        creditCode: options.fallbackCreditCode,
        silentArmActive: options.refusalFallbackSilentArmActive === true,
        betas: betasWithEk,
      })
      requestBetas = rkd.betas
      creditStamp = planFallbackCreditStamp({
        creditCode: options.fallbackCreditCode,
      })
      // refresh lastRequestBetas / sendBetas with ekd+rkd headers
      lastRequestBetas = requestBetas
    } catch {
      // densable optional when helpers unavailable
    }
    const sendBetasWithFallback =
      useBetas && (!simulateProxy || requestBetas.length > 0)

    const resolvedTools = replaceRefusedToolSchemas(
      allTools,
      getRefusedToolSchemas(),
    )
    lastSentToolSchemas = resolvedTools

    const messagesWithBreakpoints = addCacheBreakpoints(
      messagesForAPI,
      enablePromptCaching,
      options.querySource,
      options.skipCacheWrite,
      options.agentCacheTtlOverride,
    )
    // Official 2.1.323 (#2062): sanitize lone UTF-16 surrogates in both string
    // values AND object keys (e.g. broken emoji characters in tool_use input
    // parameter names) before serialization so strict JSON parsers accept them.
    sanitizeLoneSurrogatesInPlace(messagesWithBreakpoints, true)

    return {
      model: normalizeModelStringForAPI(options.model),
      messages: messagesWithBreakpoints,
      system,
      tools: resolvedTools,
      tool_choice: toolChoice,
      ...(sendBetasWithFallback && { betas: requestBetas }),
      metadata: getAPIMetadata(),
      max_tokens: maxOutputTokens,
      thinking,
      ...(temperature !== undefined && { temperature }),
      ...(contextManagement &&
        sendBetasWithFallback &&
        requestBetas.includes(CONTEXT_MANAGEMENT_BETA_HEADER) && {
          context_management: contextManagement,
        }),
      // Official: skip extra body overlays that depend on stripped betas when simulating proxy.
      ...(!simulateProxy ? extraBodyParams : {}),
      ...(Object.keys(outputConfig).length > 0 && {
        output_config: outputConfig,
      }),
      ...(speed !== undefined && { speed }),
      // densable Ht.fallbacks + fallback_credit_token stamp
      ...serverFallbackBody,
      ...creditStamp,
      // Official 2.1.327 (#374) `RQ()`: billing group tag for Claude apps gateways
      ...getBillingGroupRequestTags(),
      ...(sendServerClassifier &&
        classifierContext !== undefined && {
          safeguards: [
            {
              type: 'dangerous_tool_use',
              classifier_context: classifierContext,
            },
          ],
        }),
    }
  }

  // Compute log scalars synchronously so the fire-and-forget .then() closure
  // captures only primitives instead of paramsFromContext's full closure scope
  // (messagesForAPI, system, allTools, betas — the entire request-building
  // context), which would otherwise be pinned until the promise resolves.
  // Also capture thinking params for Langfuse observability.
  // Pass the entire thinking config object so all fields (type, budget_tokens,
  // and any future additions) flow through without cherry-picking.
  let langfuseThinking: BetaMessageStreamParams['thinking'] | undefined
  {
    const queryParams = paramsFromContext({
      model: options.model,
      thinkingConfig,
    })
    const logMessagesLength = queryParams.messages.length
    const logBetas = useBetas ? (queryParams.betas ?? []) : []
    const logEffortValue = queryParams.output_config?.effort
    if (queryParams.thinking && queryParams.thinking.type !== 'disabled') {
      langfuseThinking = queryParams.thinking
    }
    void options.getToolPermissionContext().then(permissionContext => {
      logAPIQuery({
        model: options.model,
        messagesLength: logMessagesLength,
        temperature: options.temperatureOverride ?? 1,
        betas: logBetas,
        permissionMode: permissionContext.mode,
        querySource: options.querySource,
        queryTracking: options.queryTracking,
        thinkingConfig,
        effortValue: logEffortValue,
        fastMode: isFastMode,
        previousRequestId,
      })
    })
  }

  const newMessages: AssistantMessage[] = []
  let ttftMs = 0
  let partialMessage: BetaMessage | undefined
  const contentBlocks: (BetaContentBlock | ConnectorTextBlock)[] = []
  const textDeltas = new Map<number, string[]>()
  let usage: NonNullableUsage = EMPTY_USAGE
  let costUSD = 0
  let stopReason: BetaStopReason | null = null
  // densable 2.1.214 #38: multi-frame message_delta is cumulative — credit
  // session cost only once per stream (gr: none → pending → credited).
  let streamCostCredit: StreamCostCreditState = 'none'
  let didFallBackToNonStreaming = false
  let fallbackMessage: AssistantMessage | undefined
  let maxOutputTokens = 0
  let responseHeaders: globalThis.Headers | undefined
  let research: unknown
  let isFastModeRequest = isFastMode // Keep separate state as it may change if falling back
  let isAdvisorInProgress = false
  // densable server_fallback production state (ui / hd / lastHop)
  let serverFallbackEmitted = false
  // densable Gt credit mint once-per-stream (G2s → tengu_fallback_credit_minted)
  let fallbackCreditMinted = false
  let mintedFallbackCreditCode: string | undefined
  let deferredServerFallbackHop:
    | {
        fromModel: string
        model: string
        reason: string
        category: string | null
      }
    | undefined
  let lastServerFallbackHop:
    | {
        fromModel: string
        model: string
        reason: string
        category: string | null
      }
    | undefined
  const malformedFallbackBlockIndexes = new Set<number>()
  // Official $Qn/$BQn second arg (HOn) — declared outside try so finally can stop.
  const sessionActivityAgentId = resolveSessionActivityAgentId({
    agentContext: options.agentContext ?? getAgentContext(),
    isBackgroundAgent: options.isBackgroundAgent,
    agentId: options.agentId,
  })

  // densable 2.1.232 #26 — Tn/oo thinking-only stream re-loop (Po=1, sr=2)
  let thinkingOnlyWatchdogRetryCount = 0
  let thinkingOnlyStaleRetryCount = 0
  // Official Qc.outputFiltered (#14) — retry streaming once on outputFiltered
  let outputFilteredRetryCount = 0
  // Official 2.1.328 `xCt.onReplyBegun()`: hold retry-lowered max_tokens ceiling
  // until the response stream actually starts (`message_start`).
  let confirmPendingMaxTokensCeiling: (() => void) | undefined
  // Official 2.1.328 `Wno` (`chunk@294254613.js:3202790`): capture client +
  // request params so server-side `pause_turn` / `stop_details.resumption.token`
  // can transparently open a resumed stream.
  let lastStreamClient:
    | Awaited<ReturnType<typeof getAnthropicClient>>
    | undefined
  let lastStreamParams: ReturnType<typeof paramsFromContext> | undefined

  // densable labeled stream loop (`e:`): withRetry + for-await + partial path.
  while (true) {
    try {
      try {
        confirmPendingMaxTokensCeiling = undefined
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
          async (anthropic, attempt, context) => {
            attemptNumber = attempt
            isFastModeRequest = context.fastMode ?? false
            start = Date.now()
            attemptStartTimes.push(start)
            // Client has been created by withRetry's getClient() call. This fires
            // once per attempt; on retries the client is usually cached (withRetry
            // only calls getClient() again after auth errors), so the delta from
            // client_creation_start is meaningful on attempt 1.
            queryCheckpoint('query_client_creation_end')

            const params = paramsFromContext(context)
            lastStreamClient = anthropic
            lastStreamParams = params
            captureAPIRequest(params, options.querySource) // Capture for bug reports
            void recordApiRequestForReplay({
              params: params as unknown as Record<string, unknown>,
              querySource: options.querySource,
              agentId: options.agentId,
            })

            maxOutputTokens = params.max_tokens

            // Fire immediately before the fetch is dispatched. .withResponse() below
            // awaits until response headers arrive, so this MUST be before the await
            // or the "Network TTFB" phase measurement is wrong.
            queryCheckpoint('query_api_request_sent')
            if (!options.agentId) {
              headlessProfilerCheckpoint('api_request_sent')
            }

            // Generate and track client request ID so timeouts (which return no
            // server request ID) can still be correlated with server logs.
            // First-party only — 3P providers don't log it (inc-4029 class).
            clientRequestId =
              getAPIProvider() === 'firstParty' &&
              isFirstPartyAnthropicBaseUrl()
                ? randomUUID()
                : undefined
            // densable 2.1.243 #22 SEn — arm first-byte watchdog for this id.
            if (clientRequestId) {
              const { armStreamFirstByte } = await import(
                'src/utils/firstByteWatchdog.js'
              )
              armStreamFirstByte(clientRequestId)
            }

            // Use raw stream instead of BetaMessageStream to avoid O(n²) partial JSON parsing
            // BetaMessageStream calls partialParse() on every input_json_delta, which we don't need
            // since we handle tool input accumulation ourselves
            try {
              const result = await anthropic.beta.messages
                .create(
                  { ...params, stream: true },
                  {
                    signal,
                    ...(clientRequestId && {
                      headers: { [CLIENT_REQUEST_ID_HEADER]: clientRequestId },
                    }),
                  },
                )
                .withResponse()
              queryCheckpoint('query_response_headers_received')
              streamRequestId = result.request_id
              streamResponse = result.response
              return result.data
            } catch (createError) {
              // densable vi() — sticky mid-conv system / api_system cache demote.
              // Latch + rewrite body/betas, then MidConvSystemRetryError → withRetry continue.
              if (
                createError instanceof APIError &&
                createError.status === 400
              ) {
                const roleRejected = isMidConvSystemRoleRejected(createError)
                if (midConvFallback && roleRejected) {
                  messagesForAPI = midConvFallback()
                  midConvFallback = null
                  latchMidConvSystemRejected()
                  // densable: p = p.filter o3; getAllModelBetas is memoized — clear so
                  // subsequent turns re-run J8t against sticky reject.
                  clearBetasCaches()
                  betas = betas.filter(
                    b => b !== MID_CONVERSATION_SYSTEM_BETA_HEADER,
                  )
                  logForDebugging(
                    '[mid-conv-system] server rejected role:"system" — falling back to a body with no {role:"system"} turn, sticky-rejecting the beta until /clear or /compact',
                    { level: 'warn' },
                  )
                  logEvent('tengu_mid_conv_system_fallback_retry', {
                    per_turn_effort:
                      false as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                  throw new MidConvSystemRetryError('mid-conv-system')
                }
                // densable e9i: proxy rejected cache_control on api_system tail
                // only when we actually promoted cache_control onto a system message.
                // densable Q — last request put cache_control on a role:system block.
                // MessageParam is user|assistant; api_system is cast through as system.
                const requestHasApiSystemCache =
                  shouldCacheControlOnApiSystem() &&
                  (
                    params.messages as Array<{
                      role?: string
                      content?: unknown
                    }>
                  ).some(m => {
                    if (m.role !== 'system' || !Array.isArray(m.content)) {
                      return false
                    }
                    return (m.content as Array<Record<string, unknown>>).some(
                      block =>
                        block &&
                        typeof block === 'object' &&
                        'cache_control' in block &&
                        block.cache_control != null,
                    )
                  })
                if (
                  requestHasApiSystemCache &&
                  isApiSystemCacheControlRejected(createError)
                ) {
                  latchMidConvCachePromotionRejected()
                  logForDebugging(
                    '[mid-conv-system] proxy rejected cache_control on the api_system tail — demoting the breakpoint to the trailing message for this conversation',
                    { level: 'warn' },
                  )
                  logEvent('tengu_mid_conv_system_fallback_retry', {
                    // densable Be("api_midconv_cache_proxy","proxy_rejected")
                    // local analytics: same event family, reason via string field
                    per_turn_effort:
                      false as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                  throw new MidConvSystemRetryError('api-system-cache-demote')
                }
              }
              throw createError
            }
          },
          {
            model: options.model,
            fallbackModel: options.fallbackModel,
            thinkingConfig,
            ...(isFastModeEnabled() ? { fastMode: isFastMode } : false),
            signal,
            querySource: options.querySource,
            onError: onThinkingDisplayApiError,
            onRetryStatus: options.onRetryStatus,
            deferMaxTokensCeilingConfirmation: true,
            onPendingMaxTokensCeiling: pending => {
              confirmPendingMaxTokensCeiling = pending.confirm
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

        // reset state
        newMessages.length = 0
        ttftMs = 0
        partialMessage = undefined
        contentBlocks.length = 0
        textDeltas.clear()
        usage = EMPTY_USAGE
        stopReason = null
        // densable To / at — #5 close-after-complete (Br=stopReason)
        // Official 2.1.328 `mS`, `yx`, `Dc`, `jf`, `SEe`, `qie`, `VU`, `S3`
        let streamMessageInProgress = false
        let messageDeltaCompleted = false
        let openContentBlockIndex: number | null = null
        const closedContentBlocks = new Set<number>()
        let thinkingEstimatedTokens = 0
        let contextManagementResponse: unknown
        const pausedResponses: PausedResponseRecord[] = []
        let pausedRequestId: string | null | undefined = streamRequestId
        // Official Fh, Sb, lE, Aw, _h, QS (#121) — close abandoned stream envelope
        let streamMessageEnvelopeOpen = false
        let openBlockIndexForEnvelope: number | null = null
        let openBlockSuppressStop = false
        let currentApiMessageId: string | null = null
        let abandonedFromBlockIndex = 0
        function* closeAbandonedStreamEnvelope({
          responseUnfinished,
        }: {
          responseUnfinished: boolean
        }): Generator<StreamEvent, void, unknown> {
          if (!streamMessageEnvelopeOpen) {
            return
          }
          const blockToClose = openBlockSuppressStop
            ? null
            : openBlockIndexForEnvelope
          streamMessageEnvelopeOpen = false
          openBlockIndexForEnvelope = null
          openBlockSuppressStop = false
          const idPart =
            currentApiMessageId !== null
              ? { apiMessageId: currentApiMessageId }
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
            currentApiMessageId !== null &&
            Number.isSafeInteger(abandonedFromBlockIndex)
              ? {
                  abandonedBlocks: {
                    apiMessageId: currentApiMessageId,
                    fromBlockIndex: abandonedFromBlockIndex,
                  },
                }
              : undefined),
          } as StreamEvent
        }
        streamCostCredit = 'none'
        isAdvisorInProgress = false

        // Streaming idle timeout watchdog: abort the stream if no chunks arrive
        // for STREAM_IDLE_TIMEOUT_MS. Unlike the stall detection below (which only
        // fires when the *next* chunk arrives), this uses setTimeout to actively
        // kill hung streams. Without this, a silently dropped connection can hang
        // the session indefinitely since the SDK's request timeout only covers the
        // initial fetch(), not the streaming body.
        // Official 2.1.207: STREAM_WATCHDOG default ON (va); IAi floor 5 min.
        // BYTE body idle densable lives in streamWatchdogGates (Zgc/k_h/HAi).
        // densable 2.1.214 #39: Rn = at._chunkTimes; ss poll Avs + advisor Vr/Gt.
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
        // densable: Rn = at?._chunkTimes; la = performance.now()
        // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
        const streamResponseForChunkTimes = streamResponse as
          | Response
          | undefined
        let chunkTimes: { lastAt: number } | undefined
        try {
          const { getResponseChunkTimes } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../utils/bodyIdleWatchdog.js') as typeof import('../../utils/bodyIdleWatchdog.js')
          chunkTimes = getResponseChunkTimes(streamResponseForChunkTimes)
        } catch {
          chunkTimes = undefined
        }
        const streamLoopStartedAt = performance.now()
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
        let streamIdleAborted = false
        // Official zC (#89) — StreamSuspendedError when streamIdleTimer fires across sleep
        let streamSuspendedError: StreamSuspendedError | undefined
        // performance.now() snapshot when watchdog fires, for measuring abort propagation delay
        let streamWatchdogFiredAt: number | null = null
        let streamIdleWarningTimer: ReturnType<typeof setTimeout> | null = null
        let streamIdleTimer: ReturnType<typeof setTimeout> | null = null
        // densable $o — clear stall + stream idle timers; clear stalled UI if shown
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
        // densable ss — schedule Avs poll on Rn.lastAt with advisor Vr grace
        function scheduleNetworkStallPoll(): void {
          if (!options.onRetryStatus || !chunkTimes) return
          const lastAtAtSchedule = chunkTimes.lastAt
          const armedAt = performance.now()
          stallPollTimer = setTimeout(() => {
            // densable: if (performance.now()-sl < Avs/2) return
            if (performance.now() - armedAt < stallPollMs / 2) return
            try {
              const { decideAdvisorNetworkStallPoll } =
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../utils/advisorNetworkStall.js') as typeof import('../../utils/advisorNetworkStall.js')
              const decision = decideAdvisorNetworkStallPoll({
                lastAtAtSchedule,
                lastAtNow: chunkTimes!.lastAt,
                streamStartedAt: streamLoopStartedAt,
                now: performance.now(),
                wallNow: Date.now(),
                isAdvisorInProgress,
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
        // densable ks — $o(); ss(); stream watchdog timers if Te
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
              streamSuspendedError = suspendedErr
              releaseStreamResources()
              return
            }
            streamIdleAborted = true
            streamWatchdogFiredAt = performance.now()
            logForDebugging(
              `Streaming idle timeout: no chunks received for ${STREAM_IDLE_TIMEOUT_MS / 1000}s, aborting stream`,
              { level: 'error' },
            )
            logForDiagnosticsNoPII('error', 'cli_streaming_idle_timeout')
            logEvent('tengu_streaming_idle_timeout', {
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              timeout_ms: STREAM_IDLE_TIMEOUT_MS,
            })
            releaseStreamResources()
          }, STREAM_IDLE_TIMEOUT_MS)
        }
        resetStreamIdleTimer()

        // Official $Qn("api_call", HOn(agentContext) ?? (isBackgroundAgent ? agentId))
        startSessionActivity('api_call', sessionActivityAgentId)
        // densable ts/Cl/Mc — hoist outside try so catch can build Pai stall block
        let lastEventTime: number | null = null
        let streamEventsReceived = 0
        let msToFirstEvent: number | null = null
        try {
          // stream in and accumulate state
          let isFirstChunk = true
          const STALL_THRESHOLD_MS = 30_000 // 30 seconds
          let totalStallTime = 0
          let stallCount = 0

          const CONSECUTIVE_PING_CAP = 30
          let consecutivePingCount = 0

          // Official 2.1.328 `Wno` (`chunk@294254613.js:3202790, 3435194`):
          // wrap stream with transparent server-side `pause_turn` /
          // `stop_details.resumption.token` resumption when enabled.
          const streamResumptionActive =
            lastStreamClient !== undefined &&
            lastStreamParams !== undefined &&
            (options.enableStreamResumption === true ||
              (lastRequestBetas?.includes(RESUMPTION_BETA_HEADER) === true &&
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
                      streamIdleAborted ||
                      streamSuspendedError !== undefined,
                    canResume: () =>
                      options.enableStreamResumption === true ||
                      getFeatureValue_CACHED_MAY_BE_STALE(
                        STREAM_RESUMPTION_FLAG,
                        false,
                      ),
                    send: async resumeParams => {
                      clearStreamIdleTimers()
                      const resumed = await resumptionClient.beta.messages
                        .create(
                          {
                            ...(resumeParams as unknown as BetaMessageStreamParams),
                            stream: true,
                          },
                          {
                            signal,
                            ...(clientRequestId && {
                              headers: {
                                [CLIENT_REQUEST_ID_HEADER]: clientRequestId,
                              },
                            }),
                          },
                        )
                        .withResponse()
                      streamRequestId = resumed.request_id
                      streamResponse = resumed.response
                      resetStreamIdleTimer()
                      return resumed.data
                    },
                    onCancelledAtPause: pausedUsage => {
                      usage = updateUsage(
                        usage,
                        pausedUsage as Parameters<typeof updateUsage>[1],
                      )
                      for (const msg of newMessages) {
                        msg.message.usage = usage
                      }
                      options.onMessageDelta?.(newMessages)
                    },
                  })
                })()
              : stream

          // densable Tfb(Ne, So) — synthetic keep-alive pings when body bytes advance
          // without SSE events (custom gateway / ANTHROPIC_BASE_URL proxies).
          for await (const partOrPing of withStreamKeepAlivePings(
            activeEventStream,
            chunkTimes,
          )) {
            if (isStreamPingEvent(partOrPing)) {
              consecutivePingCount++
              if (consecutivePingCount <= CONSECUTIVE_PING_CAP) {
                resetStreamIdleTimer()
              } else if (
                !streamWatchdogEnabled ||
                streamIdleAborted ||
                streamSuspendedError !== undefined
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
            const part = partOrPing
            // densable 2.1.314 Uqe (#1362) + jLt (#1358) — on first real stream
            // event after retry, latch tool search off and emit org effort cap warning once.
            if (streamEventsReceived === 0) {
              if (options._toolSearchRefusalRetried) {
                try {
                  const { latchToolSearchOffForSession } =
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    require('../../utils/searchExtraTools.js') as typeof import('../../utils/searchExtraTools.js')
                  latchToolSearchOffForSession()
                  logForDebugging(
                    '[ToolSearch] the endpoint answered the request sent without tool search, so this conversation goes on without it',
                  )
                } catch {
                  // optional
                }
              }
              if (
                typeof effort === 'string' &&
                typeof requestedEffort === 'string' &&
                effort !== requestedEffort &&
                markOrgEffortCapNotified(options.model)
              ) {
                yield createSystemMessage(
                  `Your organization limits effort for ${getPublicModelDisplayName(options.model)}, so Claude Code is using '${effort}' instead of '${requestedEffort}'. Your effort setting is unchanged.`,
                  'warning',
                )
              }
            }
            // densable: Cl++; Mc??=Math.round(performance.now()-ve)
            streamEventsReceived++
            msToFirstEvent ??= Math.round(
              performance.now() - streamLoopStartedAt,
            )
            const now = Date.now()

            // Detect and log streaming stalls (only after first event to avoid counting TTFB)
            if (lastEventTime !== null) {
              const timeSinceLastEvent = now - lastEventTime
              if (timeSinceLastEvent > STALL_THRESHOLD_MS) {
                stallCount++
                totalStallTime += timeSinceLastEvent
                logForDebugging(
                  `Streaming stall detected: ${(timeSinceLastEvent / 1000).toFixed(1)}s gap between events (stall #${stallCount})`,
                  { level: 'warn' },
                )
                logEvent('tengu_streaming_stall', {
                  stall_duration_ms: timeSinceLastEvent,
                  stall_count: stallCount,
                  total_stall_time_ms: totalStallTime,
                  event_type:
                    part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  model:
                    options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  request_id: (streamRequestId ??
                    'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
              }
            }
            lastEventTime = now

            if (isFirstChunk) {
              logForDebugging('Stream started - received first chunk')
              queryCheckpoint('query_first_chunk_received')
              if (!options.agentId) {
                headlessProfilerCheckpoint('first_chunk')
              }
              endQueryProfile()
              isFirstChunk = false
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
                require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
              const hop = parseServerFallbackContentBlockStart(part)
              const malformed =
                !hop && isMalformedServerFallbackBlockStart(part)
              if (hop || malformed) {
                isAdvisorInProgress = false
              }
              if (hop) {
                logEvent('tengu_rotunda_pennant_materialized', {
                  armed: options.serverRefusalFallback !== undefined,
                  block_index: hop.index ?? -1,
                  non_streaming: false,
                })
                // densable: if not armed, ignore hop (continue without yield)
                if (options.serverRefusalFallback === undefined) {
                  continue
                }
                if (isServerFallbackHopReason(hop.reason)) {
                  // hi — server hop served on refusal/sticky
                }
                lastServerFallbackHop = hop
                // densable: rewrite partial + yielded models to hop.model
                if (partialMessage !== undefined) {
                  partialMessage = {
                    ...(partialMessage as object),
                    model: hop.model,
                  } as typeof partialMessage
                }
                for (const msg of newMessages) {
                  if (msg.message) {
                    msg.message.model = hop.model as typeof msg.message.model
                  }
                }
                if (newMessages.length === 0) {
                  // densable hd — defer until Xs flush (no partials yet)
                  deferredServerFallbackHop = hop
                } else if (!isServerFallbackHopReason(hop.reason)) {
                  serverFallbackEmitted = true
                  deferredServerFallbackHop = undefined
                  yield buildMidStreamServerFallbackEvent({
                    hop,
                    messages: [],
                    requestId: streamRequestId ?? null,
                  }) as unknown as StreamEvent
                } else {
                  serverFallbackEmitted = true
                  deferredServerFallbackHop = undefined
                  const sf = buildMidStreamServerFallbackEvent({
                    hop,
                    messages: newMessages as unknown as Array<{
                      uuid?: string
                      isApiErrorMessage?: boolean
                      message?: { content?: unknown; model?: string }
                    }>,
                    requestId: streamRequestId ?? null,
                  })
                  // densable: drop discarded (tool-bearing) from Al / He
                  if (sf.discardedMessages.length > 0) {
                    const drop = new Set(
                      sf.discardedMessages.map(
                        m => (m as { uuid?: string }).uuid,
                      ),
                    )
                    for (let i = newMessages.length - 1; i >= 0; i--) {
                      if (drop.has(newMessages[i]!.uuid)) {
                        newMessages.splice(i, 1)
                      }
                    }
                  }
                  yield sf as unknown as StreamEvent
                }
                continue
              }
              if (malformed) {
                const idx =
                  typeof (part as { index?: unknown }).index === 'number'
                    ? (part as { index: number }).index
                    : -1
                if (idx >= 0) malformedFallbackBlockIndexes.add(idx)
                logForDebugging('cli_malformed_fallback_block', {
                  level: 'warn',
                })
                logEvent('tengu_rotunda_pennant_malformed', {
                  block_index: idx,
                  non_streaming: false,
                })
                continue
              }
              // densable: skip content_block_stop for malformed fallback indexes
              if (
                part.type === 'content_block_stop' &&
                malformedFallbackBlockIndexes.has(part.index)
              ) {
                continue
              }
            } catch {
              // densable optional — production path must not break stream
            }

            switch (part.type) {
              case 'message_start': {
                streamMessageInProgress = true
                if (confirmPendingMaxTokensCeiling) {
                  confirmPendingMaxTokensCeiling()
                  confirmPendingMaxTokensCeiling = undefined
                }
                partialMessage = part.message
                // Official 2.1.328 `Kys` (`chunk@294254613.js:3439150`): latch
                // served model alias so `stripForeignThinkingBlocks` recognizes it.
                if (part.message?.model) {
                  const reqModelKey = normalizeModelStringForAPI(options.model)
                  if (part.message.model !== reqModelKey) {
                    const existingServed =
                      getServedModelsForRequestedModel(reqModelKey)
                    if (existingServed instanceof Set) {
                      existingServed.add(part.message.model)
                    } else {
                      recordServedModels(
                        reqModelKey,
                        new Set([part.message.model]),
                      )
                    }
                  }
                }
                ttftMs = Date.now() - start
                usage = updateUsage(usage, part.message?.usage)
                // Capture research from message_start if available (internal only).
                // Always overwrite with the latest value.
                if (
                  process.env.USER_TYPE === 'ant' &&
                  'research' in
                    (part.message as unknown as Record<string, unknown>)
                ) {
                  research = (
                    part.message as unknown as Record<string, unknown>
                  ).research
                }
                break
              }
              case 'content_block_start':
                if (closedContentBlocks.has(part.index)) {
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
                messageDeltaCompleted = false
                openContentBlockIndex = part.index
                switch (part.content_block.type) {
                  case 'tool_use':
                    contentBlocks[part.index] = {
                      ...part.content_block,
                      input: '',
                    }
                    break
                  case 'server_tool_use':
                    contentBlocks[part.index] = {
                      ...part.content_block,
                      input: '' as unknown as { [key: string]: unknown },
                    }
                    if ((part.content_block.name as string) === 'advisor') {
                      isAdvisorInProgress = true
                      logForDebugging(`[AdvisorTool] Advisor tool called`)
                      logEvent('tengu_advisor_tool_call', {
                        model:
                          options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        advisor_model: (advisorModel ??
                          'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      })
                    }
                    break
                  case 'text':
                    textDeltas.set(part.index, [])
                    contentBlocks[part.index] = {
                      ...part.content_block,
                      // awkwardly, the sdk sometimes returns text as part of a
                      // content_block_start message, then returns the same text
                      // again in a content_block_delta message. we ignore it here
                      // since there doesn't seem to be a way to detect when a
                      // content_block_delta message duplicates the text.
                      text: '',
                    }
                    break
                  case 'thinking':
                    contentBlocks[part.index] = {
                      ...part.content_block,
                      // also awkward
                      thinking: '',
                      // initialize signature to ensure field exists even if signature_delta never arrives
                      signature: '',
                    }
                    break
                  default:
                    // even more awkwardly, the sdk mutates the contents of text blocks
                    // as it works. we want the blocks to be immutable, so that we can
                    // accumulate state ourselves.
                    contentBlocks[part.index] = { ...part.content_block }
                    if (
                      (part.content_block.type as string) ===
                      'advisor_tool_result'
                    ) {
                      isAdvisorInProgress = false
                      logForDebugging(
                        `[AdvisorTool] Advisor tool result received`,
                      )
                    }
                    break
                }
                break
              case 'content_block_delta': {
                const contentBlock = contentBlocks[part.index]
                const delta = part.delta as
                  | typeof part.delta
                  | ConnectorTextDelta
                const blockAlreadyClosed = closedContentBlocks.has(part.index)
                if (!contentBlock || !blockAlreadyClosed) {
                  messageDeltaCompleted = false
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
                if (
                  feature('CONNECTOR_TEXT') &&
                  delta.type === 'connector_text_delta'
                ) {
                  if (contentBlock.type !== 'connector_text') {
                    logEvent('tengu_streaming_error', {
                      error_type:
                        'content_block_type_mismatch_connector_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      expected_type:
                        'connector_text' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      actual_type:
                        contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                    throw new Error(
                      'Content block is not a connector_text block',
                    )
                  }
                  ;(
                    contentBlock as { connector_text: string }
                  ).connector_text += delta.connector_text
                } else {
                  switch (delta.type) {
                    case 'citations_delta': {
                      // Official 2.1.328 (`chunk@294254613.js:3441470`): append
                      // delta.citation onto text content block's citations array.
                      if (contentBlock.type !== 'text') break
                      const citation = (delta as { citation?: unknown })
                        .citation
                      if (typeof citation === 'object' && citation !== null) {
                        const textBlock = contentBlock as {
                          citations?: unknown[]
                        }
                        textBlock.citations = [
                          ...(textBlock.citations ?? []),
                          citation,
                        ]
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
                        throw new Error(
                          'Content block is not a input_json block',
                        )
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
                      textDeltas.get(part.index)?.push(delta.text!)
                      break
                    case 'signature_delta':
                      if (
                        feature('CONNECTOR_TEXT') &&
                        contentBlock.type === 'connector_text'
                      ) {
                        contentBlock.signature = delta.signature
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
                    case 'thinking_delta': {
                      // Official 2.1.328 (`chunk@294254613.js:3442480`): accumulate
                      // estimated_tokens and break cleanly on redacted_thinking.
                      const estTokens = (
                        delta as { estimated_tokens?: unknown }
                      ).estimated_tokens
                      if (
                        typeof estTokens === 'number' &&
                        Number.isFinite(estTokens)
                      ) {
                        thinkingEstimatedTokens += estTokens
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
                      ;(contentBlock as { thinking: string }).thinking +=
                        delta.thinking
                      break
                    }
                  }
                }
                // Capture research from content_block_delta if available (internal only).
                // Always overwrite with the latest value.
                if (process.env.USER_TYPE === 'ant' && 'research' in part) {
                  research = (part as { research: unknown }).research
                }
                break
              }
              case 'content_block_stop': {
                const contentBlock = contentBlocks[part.index]
                const blockAlreadyClosed = closedContentBlocks.has(part.index)
                if (!contentBlock || !blockAlreadyClosed) {
                  messageDeltaCompleted = false
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
                openContentBlockIndex = null
                if (!partialMessage) {
                  logEvent('tengu_streaming_error', {
                    error_type:
                      'partial_message_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    part_type:
                      part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                  throw new Error('Message not found')
                }
                // Merge accumulated text deltas into the content block (O(n) join instead of O(n^2) +=)
                const deltas = textDeltas.get(part.index)
                if (deltas) {
                  ;(contentBlock as { text: string }).text = deltas.join('')
                  textDeltas.delete(part.index)
                }
                // Prefer the stream-accumulated `usage` over message_start's partial
                // usage so background-agent progress tracking sees non-zero
                // input tokens as soon as they are known. message_delta still
                // mutates this object in place with final output_tokens later.
                // densable {content,batchToolUses}=qXe(Owe([ar],…), r)
                const { content: Co, batchToolUses: Fo } =
                  decomposeBatchedToolUses(
                    normalizeContentFromAPI(
                      [contentBlock] as BetaContentBlock[],
                      tools,
                      options.agentId,
                      {
                        requestId: streamRequestId ?? undefined,
                        messageId: partialMessage.id,
                      },
                    ),
                    tools,
                  )
                const m: AssistantMessage = {
                  message: {
                    ...partialMessage,
                    usage: { ...usage },
                    content: Co as MessageContent,
                  },
                  ...(Fo.length > 0 && { batchToolUses: Fo }),
                  requestId: streamRequestId ?? undefined,
                  type: 'assistant',
                  uuid: randomUUID(),
                  timestamp: new Date().toISOString(),
                  ...(research !== undefined && { research }),
                  ...(advisorModel && { advisorModel }),
                  // densable ...Ie!==void 0&&{effort:Ie}
                  ...(effortLevelForTranscript !== undefined && {
                    effort: effortLevelForTranscript,
                  }),
                  ...(serverClassifierRequest !== undefined &&
                    serverClassifierEnvelope(serverClassifierRequest)),
                }
                newMessages.push(m)
                closedContentBlocks.add(part.index)
                yield m
                break
              }
              case 'message_delta': {
                usage = updateUsage(usage, part.usage)
                if (
                  'context_management' in
                    (part as unknown as Record<string, unknown>) &&
                  (part as unknown as { context_management?: unknown })
                    .context_management !== undefined
                ) {
                  contextManagementResponse = (
                    part as unknown as { context_management?: unknown }
                  ).context_management
                }
                if (
                  serverClassifierRequest !== undefined &&
                  typeof part.delta === 'object' &&
                  part.delta !== null &&
                  'safeguard_results' in part.delta
                ) {
                  settleSafeguardOnMessage(
                    serverClassifierRequest,
                    part.delta,
                    contentBlocks,
                  )
                }
                // Official 2.1.328 `cyt(ml)` (`chunk@294254613.js:3445450`):
                // when `wrapStreamWithResumption` seamlessly resumed a paused
                // stream, record the paused segment in `pausedResponses` and
                // reset per-segment accumulators to the resumed stream's usage.
                if (isResumedUsageMessageDelta(part)) {
                  pausedResponses.push({
                    limit: part.paused_limit,
                    usage,
                    finishedBlocks: closedContentBlocks.size,
                    requestId: pausedRequestId ?? undefined,
                    resumedRequestId: streamRequestId ?? undefined,
                  })
                  pausedRequestId = streamRequestId
                  streamCostCredit = 'none'
                  thinkingEstimatedTokens = 0
                  stopReason = null
                  usage = updateUsage(
                    EMPTY_USAGE,
                    part.resumed_usage as Parameters<typeof updateUsage>[1],
                  )
                  if (partialMessage !== undefined) {
                    const partialRec = partialMessage as unknown as Record<
                      string,
                      unknown
                    >
                    partialRec.pausedResponses = pausedResponses
                    partialRec.usage = usage
                  }
                }
                // Capture research from message_delta if available (internal only).
                // Always overwrite with the latest value. Also write back to
                // already-yielded messages since message_delta arrives after
                // content_block_stop.
                if (
                  process.env.USER_TYPE === 'ant' &&
                  'research' in (part as unknown as Record<string, unknown>)
                ) {
                  research = (part as unknown as Record<string, unknown>)
                    .research
                  for (const msg of newMessages) {
                    msg.research = research
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
                      require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                    const mint = planFallbackCreditMint({
                      stopDetails: deltaRec.stop_details,
                      alreadyMinted: fallbackCreditMinted,
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
                      mintedFallbackCreditCode = mint.creditCode
                      if (mint.shouldLogMint) {
                        fallbackCreditMinted = true
                        logEvent('tengu_fallback_credit_minted', {
                          request_id: (streamRequestId ??
                            'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          model:
                            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          fallback_target_model:
                            (options.refusalFallbackModel ??
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
                // (official 2.1.328 `chunk@294254613.js:3446500-3447500`).
                //
                // IMPORTANT: Use direct property mutation, not object replacement.
                // The transcript write queue holds a reference to message.message
                // and serializes it lazily (100ms flush interval).
                const frameStopReason =
                  typeof part.delta.stop_reason === 'string'
                    ? part.delta.stop_reason
                    : null
                if (frameStopReason !== null) {
                  stopReason = frameStopReason
                  messageDeltaCompleted = true
                }
                const partRec = part as unknown as { resumable?: unknown }
                const resumableFlag =
                  typeof deltaRec.resumable === 'boolean'
                    ? deltaRec.resumable
                    : typeof partRec.resumable === 'boolean'
                      ? partRec.resumable
                      : undefined

                for (const msg of newMessages) {
                  msg.message.usage = usage
                  msg.message.stop_reason = stopReason
                  const msgInner = msg.message as unknown as Record<
                    string,
                    unknown
                  >
                  if (frameStopReason !== null || stopReason === null) {
                    msgInner.stop_details = deltaRec.stop_details ?? null
                  }
                  if (contextManagementResponse !== undefined) {
                    msgInner.context_management = contextManagementResponse
                  }
                  if (resumableFlag !== undefined) {
                    msgInner.resumable = resumableFlag
                  }
                  if (pausedResponses.length > 0) {
                    msgInner.pausedResponses = pausedResponses
                  }
                }
                options.onMessageDelta?.(newMessages)

                // densable non-mid end hop: !ui && di (lastHop / deferred)
                if (
                  options.serverRefusalFallback !== undefined &&
                  !serverFallbackEmitted
                ) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const {
                      buildNonMidStreamServerFallbackEvent,
                      planDeferredServerFallbackFlush,
                    } =
                      require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                    const hop =
                      lastServerFallbackHop ?? deferredServerFallbackHop
                    if (hop !== undefined) {
                      serverFallbackEmitted = true
                      deferredServerFallbackHop = undefined
                      yield buildNonMidStreamServerFallbackEvent({
                        fromModel: hop.fromModel,
                        toModel: hop.model,
                        reason: hop.reason,
                        apiRefusalCategory: hop.category,
                        requestId: streamRequestId ?? null,
                        finalStopReason: stopReason,
                      }) as unknown as StreamEvent
                    } else {
                      const deferred = planDeferredServerFallbackFlush({
                        deferredHop: deferredServerFallbackHop,
                        alreadyEmitted: serverFallbackEmitted,
                        requestId: streamRequestId ?? null,
                      })
                      if (deferred) {
                        serverFallbackEmitted = true
                        deferredServerFallbackHop = undefined
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
                    streamCostCredit,
                    stopReason,
                  )
                  streamCostCredit = credit.next
                  if (credit.shouldCredit) {
                    const costUSDForPart = calculateUSDCost(
                      resolvedModel,
                      usage as unknown as BetaUsage,
                    )
                    costUSD += addToTotalSessionCost(
                      costUSDForPart,
                      usage as unknown as BetaUsage,
                      options.model,
                      sessionCostAttribution,
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
                  // Official FXl + silent-arm densable consumer: when refusal
                  // fallback is on and an armed model is available (refusal
                  // lane or generic fallbackModel), park dialog (or silent
                  // auto-switch) and throw FallbackTriggeredError so query.ts
                  // retries on fallback. Full rewind/latch/session supersede
                  // and stream fallback_request yield remain denser.
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
                      require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
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
                      // Official g_i when category present; without category keep
                      // the armed model (partial densable — full stream path
                      // always runs g_i and may decline unmapped).
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
                        // densable: route declined / not armed → refusal_no_fallback
                        try {
                          const { buildRefusalNoFallbackEvent } =
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                          yield buildRefusalNoFallbackEvent(
                            'route_declined',
                          ) as unknown as StreamEvent
                        } catch {
                          // densable optional
                        }
                      } else if (
                        options.refusalFallbackHandledByCaller === true
                      ) {
                        // Official 2.1.328 (`chunk@294254613.js:3449563`):
                        // yield `fallback_request` and return cleanly so query.ts
                        // owns the multi-hop dialog & retry chain.
                        refusalHandledByFallback = true
                        clearStreamIdleTimers()
                        const { buildFallbackRequestEvent } =
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                        yield buildFallbackRequestEvent({
                          originalModel: options.model,
                          fallbackModel: targetModel,
                          requestId: streamRequestId ?? null,
                          apiRefusalCategory,
                          apiRefusalExplanation:
                            stopDetails?.explanation ?? null,
                          creditCode: mintedFallbackCreditCode ?? null,
                          silentArmAtTrigger: silentAttempt,
                        }) as unknown as StreamEvent
                        return
                      } else if (
                        options.refusalFallbackPreferencePending === true &&
                        silentAttempt !== true
                      ) {
                        // densable ke=Jn — skip FXl; query.ts qa on fallback_request
                        refusalHandledByFallback = true
                        try {
                          const { buildFallbackRequestEvent } =
                            // eslint-disable-next-line @typescript-eslint/no-require-imports
                            require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                          yield buildFallbackRequestEvent({
                            originalModel: options.model,
                            fallbackModel: targetModel,
                            requestId: streamRequestId ?? null,
                            apiRefusalCategory,
                            apiRefusalExplanation:
                              stopDetails?.explanation ?? null,
                            creditCode: mintedFallbackCreditCode ?? null,
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
                            guidanceText:
                              getProviderRefusalFallbackGuidanceText(
                                getAPIProvider() === 'firstParty',
                              ),
                          },
                        })
                        if (flow.shouldSwitchToFallback) {
                          refusalHandledByFallback = true
                          // Official stream fallback_request yield densable (query
                          // consumer handles dialog telemetry / salvage denser).
                          try {
                            const {
                              buildFallbackRequestEvent,
                              matchRefusalFallbackRoute,
                            } =
                              // eslint-disable-next-line @typescript-eslint/no-require-imports
                              require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                            let routeMatched:
                              | 'category'
                              | 'catch_all'
                              | 'none'
                              | null = null
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
                              requestId: streamRequestId ?? null,
                              apiRefusalCategory,
                              apiRefusalExplanation:
                                stopDetails?.explanation ?? null,
                              creditCode: mintedFallbackCreditCode ?? null,
                              silentArmAtTrigger: silentAttempt,
                              routeMatched,
                            }) as unknown as StreamEvent
                          } catch (e) {
                            if (e instanceof FallbackTriggeredError) throw e
                            // densable yield optional
                          }
                          // Official Ryn + b$t latch densable (session restore denser)
                          try {
                            const {
                              getMainLoopModelOverride,
                              markRefusalFallbackOccurred,
                              setMainLoopModelOverride,
                              setRefusalFallbackModelLatch,
                            } =
                              // eslint-disable-next-line @typescript-eslint/no-require-imports
                              require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
                            const { applyRefusalFallbackLatchArm } =
                              // already loaded densables above; re-require for latch arm
                              // eslint-disable-next-line @typescript-eslint/no-require-imports
                              require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
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
                        // densable: dialog declined / cancelled → refusal_no_fallback
                        if (
                          !flow.shouldSwitchToFallback &&
                          flow.choice !== 'retry_fallback'
                        ) {
                          try {
                            const { buildRefusalNoFallbackEvent } =
                              // eslint-disable-next-line @typescript-eslint/no-require-imports
                              require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
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
                      // densable: not_armed / client_chain_exhausted
                      try {
                        const { buildRefusalNoFallbackEvent } =
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
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

                if (stopReason === 'max_tokens') {
                  logEvent('tengu_max_tokens_reached', {
                    max_tokens: maxOutputTokens,
                  })
                  yield createAssistantAPIErrorMessage({
                    content: `${API_ERROR_MESSAGE_PREFIX}: Claude's response exceeded the ${
                      maxOutputTokens
                    } output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.`,
                    apiError: 'max_output_tokens',
                    error: 'max_output_tokens',
                  })
                }

                if (stopReason === 'model_context_window_exceeded') {
                  logEvent('tengu_context_window_exceeded', {
                    max_tokens: maxOutputTokens,
                    output_tokens: usage.output_tokens,
                  })
                  // Reuse the max_output_tokens recovery path — from the model's
                  // perspective, both mean "response was cut off, continue from
                  // where you left off."
                  yield createAssistantAPIErrorMessage({
                    content: `${API_ERROR_MESSAGE_PREFIX}: The model has reached its context window limit.`,
                    apiError: 'max_output_tokens',
                    error: 'max_output_tokens',
                  })
                }
                break
              }
              case 'message_stop':
                streamMessageInProgress = false
                // densable: if (gr==="pending") gr="credited"; tr+=Zce(...)
                {
                  const credit = onMessageStopCostCredit(streamCostCredit)
                  streamCostCredit = credit.next
                  if (credit.shouldCredit) {
                    const costUSDForStop = calculateUSDCost(
                      resolvedModel,
                      usage as unknown as BetaUsage,
                    )
                    costUSD += addToTotalSessionCost(
                      costUSDForStop,
                      usage as unknown as BetaUsage,
                      options.model,
                      sessionCostAttribution,
                    )
                  }
                  if (serverClassifierRequest !== undefined) {
                    settleSafeguardOnMessage(
                      serverClassifierRequest,
                      {
                        ...(partialMessage ?? {}),
                        content: contentBlocks,
                      },
                      contentBlocks,
                    )
                  }
                }
                break
            }

            const includeApiMessageId =
              streamMessageEnvelopeOpen || part.type === 'message_start'
            if (part.type === 'message_start') {
              streamMessageEnvelopeOpen = true
              openBlockIndexForEnvelope = null
              openBlockSuppressStop = false
              const msgId = (part.message as { id?: unknown }).id
              currentApiMessageId =
                typeof msgId === 'string' && msgId !== '' ? msgId : null
            } else if (part.type === 'content_block_start') {
              openBlockIndexForEnvelope = part.index
              openBlockSuppressStop = SUPPRESS_ABANDONED_BLOCK_STOP_TYPES.has(
                part.content_block.type,
              )
            } else if (part.type === 'content_block_stop') {
              openBlockIndexForEnvelope = null
              openBlockSuppressStop = false
              if (Number.isSafeInteger(part.index) && part.index >= 0) {
                abandonedFromBlockIndex = Math.max(
                  abandonedFromBlockIndex,
                  part.index + 1,
                )
              }
            } else if (part.type === 'message_stop') {
              streamMessageEnvelopeOpen = false
              openBlockIndexForEnvelope = null
              openBlockSuppressStop = false
              recordMediaItemCapSuccess()
              // Official GLt (2.1.295 #358) — lock context-1m beta removal on success.
              const active1mPhase =
                context1mBetaRetryPhase as Context1mBetaRetryPhase
              if (
                active1mPhase === 'retrying' ||
                active1mPhase === 'guessing'
              ) {
                const unnamed = active1mPhase === 'guessing'
                context1mBetaRetryPhase = 'spent'
                betas = betas.filter(b => b !== CONTEXT_1M_BETA_HEADER)
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
              ...(part.type === 'message_start' ? { ttftMs } : undefined),
              ...(includeApiMessageId && currentApiMessageId !== null
                ? { apiMessageId: currentApiMessageId }
                : undefined),
            } as StreamEvent
          }
          // densable Xs() — flush deferred server_fallback hop when stream ends
          // without midStream emission (no assistant partials at hop time).
          if (
            options.serverRefusalFallback !== undefined &&
            !serverFallbackEmitted &&
            deferredServerFallbackHop !== undefined
          ) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { planDeferredServerFallbackFlush } =
                require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
              const deferred = planDeferredServerFallbackFlush({
                deferredHop: deferredServerFallbackHop,
                alreadyEmitted: serverFallbackEmitted,
                requestId: streamRequestId ?? null,
              })
              if (deferred) {
                serverFallbackEmitted = true
                deferredServerFallbackHop = undefined
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
            yield* closeAbandonedStreamEnvelope({ responseUnfinished: true })
            return
          }

          // If the stream was aborted by our idle timeout watchdog, fall back to
          // non-streaming retry rather than treating it as a completed stream.
          if (streamIdleAborted) {
            // Instrumentation: proves the for-await exited after the watchdog fired
            // (vs. hung forever). exit_delay_ms measures abort propagation latency:
            // 0-10ms = abort worked; >>1000ms = something else woke the loop.
            const exitDelayMs =
              streamWatchdogFiredAt !== null
                ? Math.round(performance.now() - streamWatchdogFiredAt)
                : -1
            logForDiagnosticsNoPII(
              'info',
              'cli_stream_loop_exited_after_watchdog_clean',
            )
            logEvent('tengu_stream_loop_exited_after_watchdog', {
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              exit_delay_ms: exitDelayMs,
              exit_path:
                'clean' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            // Prevent double-emit: this throw lands in the catch block below,
            // whose exit_path='error' probe guards on streamWatchdogFiredAt.
            streamWatchdogFiredAt = null
            throw new Error('Stream idle timeout - no chunks received')
          }
          if (streamSuspendedError !== undefined) {
            throw streamSuspendedError
          }

          // Official 2.1.328 `Lpr` (`chunk@294254613.js:3452198`): clean EOF
          // inside an open content block is a dropped connection, not a complete reply.
          if (streamMessageInProgress && openContentBlockIndex !== null) {
            logForDebugging(
              `Stream ended cleanly inside open block ${openContentBlockIndex} (stop_reason=${stopReason}) — treating as a dropped connection`,
              { level: 'error' },
            )
            throw new StreamTruncatedError()
          }

          // Detect when the stream completed without producing any assistant messages (`Dpr`).
          if (!partialMessage || (newMessages.length === 0 && !stopReason)) {
            logForDebugging(
              !partialMessage
                ? 'Stream completed without receiving message_start event - triggering non-streaming fallback'
                : 'Stream completed with message_start but no content blocks completed - triggering non-streaming fallback',
              { level: 'error' },
            )
            logEvent('tengu_stream_no_events', {
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw new StreamNoEventsError()
          }

          // Official 2.1.328 `Lpr` (`chunk@294254613.js:3452753`): clean EOF
          // before a terminal message_delta (stop_reason !== null && messageDeltaCompleted)
          // while the message is still open is a truncated stream.
          if (
            streamMessageInProgress &&
            !(stopReason !== null && messageDeltaCompleted)
          ) {
            logForDebugging(
              `Stream ended cleanly mid-response (stop_reason=${stopReason}, terminal=${messageDeltaCompleted}) — treating as a dropped connection`,
              { level: 'error' },
            )
            throw new StreamTruncatedError()
          }

          // Log summary if any stalls occurred during streaming
          if (stallCount > 0) {
            logForDebugging(
              `Streaming completed with ${stallCount} stall(s), total stall time: ${(totalStallTime / 1000).toFixed(1)}s`,
              { level: 'warn' },
            )
            logEvent('tengu_streaming_stall_summary', {
              stall_count: stallCount,
              total_stall_time_ms: totalStallTime,
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
          }

          // Check if the cache actually broke based on response tokens
          if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
            void checkResponseForCacheBreak(
              options.querySource,
              usage.cache_read_input_tokens,
              usage.cache_creation_input_tokens,
              messages,
              options.agentId,
              streamRequestId,
              lastAssistantMessageId(messages),
            )
          }

          // Process fallback percentage header and quota status if available
          // streamResponse is set when the stream is created in the withRetry callback above
          // TypeScript's control flow analysis can't track that streamResponse is set in the callback
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          const resp = streamResponse as unknown as Response | undefined
          if (resp) {
            extractQuotaStatusFromHeaders(resp.headers, Date.now(), {
              querySource: options.querySource,
            })
            // Non-Anthropic providers that flow through this same client path
            // (Bedrock) expose their own throttle headers — let their adapter
            // overwrite the store with its bucket(s). Anthropic's adapter runs
            // inside extractQuotaStatusFromHeaders.
            if (getAPIProvider() === 'bedrock') {
              updateProviderBuckets(
                'bedrock',
                bedrockAdapter.parseHeaders(resp.headers),
              )
            }
            // Store headers for gateway detection
            responseHeaders = resp.headers
          }
        } catch (rawStreamingError) {
          // Clear the idle timeout watchdog on error path too
          clearStreamIdleTimers()
          // Official 2.1.328 (`chunk@294254613.js @3469336`): FallbackTriggeredError
          // must propagate immediately out of streaming to query.ts — NEVER fall
          // back to non-streaming against the same refused/failed model.
          if (rawStreamingError instanceof FallbackTriggeredError) {
            yield* closeAbandonedStreamEnvelope({ responseUnfinished: true })
            throw rawStreamingError
          }
          // Official zC (#89) — substitute StreamSuspendedError when idle timer
          // aborted the stream across sleep/suspend (not a user abort).
          let streamingError: unknown =
            streamSuspendedError !== undefined &&
            !streamIdleAborted &&
            !signal.aborted &&
            rawStreamingError instanceof APIUserAbortError
              ? streamSuspendedError
              : rawStreamingError

          // Instrumentation: if the watchdog had already fired and the for-await
          // threw (rather than exiting cleanly), record that the loop DID exit and
          // how long after the watchdog. Distinguishes true hangs from error exits.
          if (streamIdleAborted && streamWatchdogFiredAt !== null) {
            const exitDelayMs = Math.round(
              performance.now() - streamWatchdogFiredAt,
            )
            logForDiagnosticsNoPII(
              'info',
              'cli_stream_loop_exited_after_watchdog_error',
            )
            logEvent('tengu_stream_loop_exited_after_watchdog', {
              request_id: (streamRequestId ??
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
            // Check if the abort signal was triggered by the user (ESC key)
            // If the signal is aborted, it's a user-initiated abort
            // If not, it's likely a timeout from the SDK
            if (signal.aborted) {
              // This is a real user abort (ESC key was pressed)
              logForDebugging(
                `Streaming aborted by user: ${errorMessage(streamingError)}`,
              )
              if (isAdvisorInProgress) {
                logEvent('tengu_advisor_tool_interrupted', {
                  model:
                    options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  advisor_model: (advisorModel ??
                    'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
              }
              yield* closeAbandonedStreamEnvelope({ responseUnfinished: true })
              throw streamingError
            } else {
              // The SDK threw APIUserAbortError but our signal wasn't aborted
              // This means it's a timeout from the SDK's internal timeout
              logForDebugging(
                `Streaming timeout (SDK abort): ${streamingError.message}`,
                { level: 'error' },
              )
              // Throw a more specific error for timeout
              throw new APIConnectionTimeoutError({
                message: 'Request timed out',
              })
            }
          }

          // Official 2.1.321 `Mjn` (#1878): mid-stream EPROTO / ERR_SSL_* after
          // an event has arrived is wrapped as a truncated stream so partial
          // output is kept or the request is retried cleanly instead of crashing
          // with "API Error: EPROTO: The TLS handshake failed".
          {
            const hadStreamEvent =
              streamMessageEnvelopeOpen || newMessages.length > 0
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
              (connCode !== undefined &&
                STREAM_STALE_CONNECTION_CODES.has(connCode))
            const isNetworkDown =
              connCode !== undefined && STREAM_NETWORK_DOWN_CODES.has(connCode)
            const isStaleOrNetwork = isStaleConn || isNetworkDown
            const isServerApiErrorPartial =
              streamingError instanceof APIError &&
              (streamingError as { type?: string }).type === 'api_error' &&
              newMessages.length > 0
            const contentBlocks = (
              msg: (typeof newMessages)[number],
            ): Array<{ type: string; text?: string }> => {
              const c = msg.message?.content
              return Array.isArray(c)
                ? (c as Array<{ type: string; text?: string }>)
                : []
            }
            const hasYieldedContent = newMessages.some(msg =>
              contentBlocks(msg).some(
                block =>
                  block.type !== 'thinking' &&
                  block.type !== 'redacted_thinking' &&
                  !(
                    block.type === 'text' &&
                    (block.text === '' || block.text === NO_CONTENT_MESSAGE)
                  ),
              ),
            )
            const hasAnyYieldedBlocks = newMessages.length > 0
            if (
              (hasAnyYieldedBlocks || hasYieldedContent) &&
              (streamIdleAborted || isStaleOrNetwork || isServerApiErrorPartial)
            ) {
              const hasToolUse = newMessages.some(msg =>
                contentBlocks(msg).some(b => b.type === 'tool_use'),
              )
              const hasNonThinkingOutput = newMessages.some(msg =>
                contentBlocks(msg).some(
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
                | 'stale_connection' = streamIdleAborted
                ? 'watchdog'
                : isServerApiErrorPartial
                  ? 'server_error'
                  : isNetworkDown
                    ? 'network_down'
                    : 'stale_connection'

              // densable 2.1.232 #26 / 219+: thinking-only → re-stream under Po/sr
              // if (!ke && Br === null && (xo ? Tn < Po : oo < sr)) continue e
              {
                const thinkingOnlyPlan = planThinkingOnlyStreamRetry({
                  streamIdleAborted,
                  isStaleOrNetwork,
                  hasNonThinkingOutput,
                  stopReason,
                  watchdogRetryCount: thinkingOnlyWatchdogRetryCount,
                  staleRetryCount: thinkingOnlyStaleRetryCount,
                  connectionCode: connCode,
                })
                if (thinkingOnlyPlan.shouldRetry) {
                  if (thinkingOnlyPlan.kind === 'watchdog') {
                    thinkingOnlyWatchdogRetryCount =
                      thinkingOnlyPlan.retryAttempt
                  } else {
                    thinkingOnlyStaleRetryCount = thinkingOnlyPlan.retryAttempt
                  }
                  logForDebugging(thinkingOnlyPlan.debugMessage, {
                    level: 'warn',
                  })
                  logEvent(thinkingOnlyPlan.eventName, {
                    model:
                      options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    retry_attempt: thinkingOnlyPlan.retryAttempt,
                    request_id: (streamRequestId ??
                      'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    after_thinking_only: true,
                    ...(thinkingOnlyPlan.kind === 'stale' && {
                      error_code: (connCode ??
                        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    }),
                  })
                  // densable: if (eo !== "credited") eo="credited"; dr+=sge(...)
                  // before continue e — credit aborted thinking-only attempt.
                  {
                    const credit =
                      onThinkingOnlyRetryCostCredit(streamCostCredit)
                    streamCostCredit = credit.next
                    if (credit.shouldCredit) {
                      const costUSDForPart = calculateUSDCost(
                        resolvedModel,
                        usage as unknown as BetaUsage,
                      )
                      costUSD += addToTotalSessionCost(
                        costUSDForPart,
                        usage as unknown as BetaUsage,
                        options.model,
                        sessionCostAttribution,
                      )
                    }
                  }
                  yield* closeAbandonedStreamEnvelope({
                    responseUnfinished: true,
                  })
                  releaseStreamResources()
                  clearStreamIdleTimers()
                  // densable continue e — outer catch rethrows ThinkingOnlyStreamRetryError
                  throw new ThinkingOnlyStreamRetryError(thinkingOnlyPlan)
                }
              }

              // densable 2.1.222 #5: La&&To&&at===null → already complete, no truncation
              // if(La&&To&&at===null){ T(...response already complete...);
              //   N("tengu_streaming_close_after_complete",...); break e }
              const closePlan = planStreamCloseAfterComplete({
                stopReason,
                messageDeltaCompleted,
                openContentBlockIndex,
              })
              if (closePlan.alreadyComplete) {
                logForDebugging(
                  `Stream ${
                    streamIdleAborted
                      ? 'stalled'
                      : `connection closed (${connCode ?? 'unknown'})`
                  } after message_delta (stop_reason=${stopReason}) — response already complete, no truncation`,
                  { level: 'info' },
                )
                logEvent('tengu_streaming_close_after_complete', {
                  model:
                    options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  blocks_yielded: newMessages.length,
                  cause:
                    cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  error_code: (connCode ??
                    'none') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  request_id: (streamRequestId ??
                    'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                // densable break e — success exit, no mid-response banner
                yield* closeAbandonedStreamEnvelope({
                  responseUnfinished: false,
                })
                break
              }

              const synthesizedStop = hasToolUse ? 'tool_use' : 'end_turn'
              // densable: if stop_reason not already set on yielded messages, stamp it
              for (const msg of newMessages) {
                if (msg.message && msg.message.stop_reason == null) {
                  msg.message.stop_reason = synthesizedStop
                }
              }
              const hasOutput = hasNonThinkingOutput || hasYieldedContent
              logForDebugging(
                streamIdleAborted
                  ? `Stream idle timeout after ${newMessages.length} block(s) yielded — finalizing partial response`
                  : isServerApiErrorPartial
                    ? `Mid-stream server error after ${newMessages.length} block(s) yielded — finalizing partial response`
                    : `Stream connection closed (${connCode ?? 'unknown'}) after ${newMessages.length} block(s) yielded — finalizing partial response`,
                { level: 'warn' },
              )
              logEvent('tengu_streaming_partial_finalized', {
                model:
                  options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                blocks_yielded: newMessages.length,
                has_output: hasOutput,
                ...(thinkingEstimatedTokens > 0 && {
                  thinking_estimated_tokens: thinkingEstimatedTokens,
                }),
                synthesized_stop_reason:
                  synthesizedStop as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                cause:
                  cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                request_id: (streamRequestId ??
                  'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              const incompleteBanner = hasOutput
                ? streamIdleAborted
                  ? `${API_ERROR_MESSAGE_PREFIX}: Response stalled mid-stream. The response above may be incomplete.`
                  : isServerApiErrorPartial
                    ? `${API_ERROR_MESSAGE_PREFIX}: Server error mid-response. The response above may be incomplete.`
                    : `${API_ERROR_MESSAGE_PREFIX}: Connection closed mid-response. The response above may be incomplete.`
                : streamIdleAborted
                  ? `${API_ERROR_MESSAGE_PREFIX}: Response stalled while thinking, before producing a response. Try again.`
                  : `${API_ERROR_MESSAGE_PREFIX}: Connection closed while thinking, before producing a response. Try again.`
              yield* closeAbandonedStreamEnvelope({ responseUnfinished: true })
              yield createAssistantAPIErrorMessage({
                content: incompleteBanner,
                apiError: 'server_error',
                error: 'server_error',
                // densable @217050118: yl&&!Xr — output and no tool_use.
                truncatedAfterOutput:
                  hasOutput && !hasToolUse ? true : undefined,
              })
              // densable `break e` — exit streaming successfully with partial kept
              break
            }
          }

          // Official lg?.cause === "outputFiltered" (#14) — retry streaming once
          // without falling back to non-streaming when output content filter stops
          // the response before any answer was shown.
          if (isOutputBlockedByContentFilterError(streamingError)) {
            if (outputFilteredRetryCount < OUTPUT_FILTERED_RETRY_CAP) {
              outputFilteredRetryCount += 1
              logForDebugging(
                `Output content filter stopped the response before any of the answer was shown: retrying streaming (${outputFilteredRetryCount}/${OUTPUT_FILTERED_RETRY_CAP})`,
                { level: 'warn' },
              )
              logEvent('tengu_streaming_output_filter_retry', {
                model:
                  options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                retry_attempt: outputFilteredRetryCount,
                request_id: (streamRequestId ??
                  'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              yield* closeAbandonedStreamEnvelope({ responseUnfinished: true })
              releaseStreamResources()
              clearStreamIdleTimers()
              throw new OutputFilteredStreamRetryError()
            }
            logEvent('tengu_streaming_fallback_to_non_streaming', {
              model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              error:
                'output_content_filtered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              attemptNumber,
              maxOutputTokens,
              thinkingType:
                thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_disabled: true,
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_cause:
                'output_content_filtered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              any_stream_event_yielded: partialMessage !== undefined,
            })
            throw streamingError
          }

          // When the flag is enabled, skip the non-streaming fallback and let the
          // error propagate to withRetry. The mid-stream fallback causes double tool
          // execution when streaming tool execution is active: the partial stream
          // starts a tool, then the non-streaming retry produces the same tool_use
          // and runs it again. See inc-4258.
          // Official DISABLE_NONSTREAMING_FALLBACK densable.
          let nonstreamingFallbackDisabled = isEnvTruthy(
            process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK,
          )
          try {
            const { isNonstreamingFallbackDisabled } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
            nonstreamingFallbackDisabled = isNonstreamingFallbackDisabled()
          } catch {
            // residual helpers optional
          }
          // densable: also skip non-streaming when watchdog fired under GB flag
          const watchdogSkipNonstreaming =
            getFeatureValue_CACHED_MAY_BE_STALE(
              'tengu_watchdog_skip_nonstreaming_fallback',
              true,
            ) && streamIdleAborted
          const disableFallback =
            nonstreamingFallbackDisabled ||
            watchdogSkipNonstreaming ||
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
              attemptNumber,
              maxOutputTokens,
              thinkingType:
                thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              ...(thinkingConfig.type === 'enabled' && {
                thinkingBudgetTokens: thinkingConfig.budgetTokens,
              }),
              fallback_disabled: true,
              request_id: (streamRequestId ??
                'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_cause: (streamIdleAborted
                ? 'watchdog'
                : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw streamingError
          }

          yield* closeAbandonedStreamEnvelope({ responseUnfinished: true })
          logForDebugging(
            `Error streaming, falling back to non-streaming mode: ${errorMessage(streamingError)}`,
            { level: 'error' },
          )
          didFallBackToNonStreaming = true
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
            attemptNumber,
            maxOutputTokens,
            thinkingType:
              thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ...(thinkingConfig.type === 'enabled' && {
              thinkingBudgetTokens: thinkingConfig.budgetTokens,
            }),
            fallback_disabled: false,
            request_id: (streamRequestId ??
              'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            fallback_cause: (streamIdleAborted
              ? 'watchdog'
              : newMessages.length > 0
                ? 'partial_yield'
                : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })

          // Fall back to non-streaming mode with retries.
          // If the streaming failure was itself a 529, count it toward the
          // consecutive-529 budget so total 529s-before-model-fallback is the
          // same whether the overload was hit in streaming or non-streaming mode.
          // This is a speculative fix for https://github.com/anthropics/claude-code/issues/1513
          // Instrumentation: proves executeNonStreamingRequest was entered (vs. the
          // fallback event firing but the call itself hanging at dispatch).
          logForDiagnosticsNoPII('info', 'cli_nonstreaming_fallback_started')
          logEvent('tengu_nonstreaming_fallback_started', {
            request_id: (streamRequestId ??
              'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            model:
              options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            fallback_cause: (streamIdleAborted
              ? 'watchdog'
              : 'other') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          // densable od + originating for Pai / UnexpectedApiResponseError
          const streamStallSnapshot = {
            events_received: streamEventsReceived,
            ms_to_first_event: msToFirstEvent,
            ms_since_last_event:
              lastEventTime === null ? null : Date.now() - lastEventTime,
          }
          const streamConnDetails =
            extractConnectionErrorDetails(streamingError)
          const originatingFailure: OriginatingStreamFailure = {
            requestId: parseAnthropicRequestId(streamRequestId),
            cause: streamIdleAborted
              ? 'watchdog'
              : newMessages.length > 0
                ? 'partial_yield'
                : 'other',
            errorName:
              streamingError instanceof Error ? streamingError.message : null,
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
              ...(isFastModeEnabled() && { fastMode: isFastMode }),
              signal,
              initialConsecutive529Errors: is529Error(streamingError) ? 1 : 0,
              querySource: options.querySource,
              onError: onThinkingDisplayApiError,
              onRetryStatus: options.onRetryStatus,
            },
            paramsFromContext,
            (attempt, _startTime, tokens) => {
              attemptNumber = attempt
              maxOutputTokens = tokens
            },
            params => captureAPIRequest(params, options.querySource),
            originatingFailure,
          )

          // densable fa — materialize non-streaming fallback content blocks
          // then yield assistant, then wa() server_fallback (order matches densable)
          let nonStreamContent: unknown[] = Array.isArray(result.content)
            ? [...result.content]
            : []
          let nonStreamLastHop:
            | {
                fromModel: string
                model: string
                reason: string
                category: string | null
              }
            | undefined
          // densable G2s non-stream: mint from stop_details before fa/wa
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { planFallbackCreditMint } =
              require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
            const stopDetails = (result as { stop_details?: unknown })
              .stop_details
            if (stopDetails !== undefined) {
              const mint = planFallbackCreditMint({
                stopDetails,
                alreadyMinted: fallbackCreditMinted,
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
                mintedFallbackCreditCode = mint.creditCode
                if (mint.shouldLogMint) {
                  fallbackCreditMinted = true
                  logEvent('tengu_fallback_credit_minted', {
                    request_id: (streamRequestId ??
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
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { materializeNonStreamingServerFallbackContent } =
              require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
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
            if (fa.droppedCount > 0) {
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
          const { content: Pve, batchToolUses: Le } = decomposeBatchedToolUses(
            normalizeContentFromAPI(
              nonStreamContent as typeof result.content,
              tools,
              options.agentId,
              {
                requestId: streamRequestId ?? undefined,
                messageId: result.id,
              },
            ),
            tools,
          )
          if (serverClassifierRequest !== undefined) {
            settleSafeguardOnMessage(
              serverClassifierRequest,
              result,
              result.content,
            )
          }
          const m: AssistantMessage = {
            message: {
              ...result,
              content: Pve as MessageContent,
            },
            ...(Le.length > 0 && { batchToolUses: Le }),
            requestId: streamRequestId ?? undefined,
            type: 'assistant',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
            ...(research !== undefined && {
              research,
            }),
            ...(advisorModel && {
              advisorModel,
            }),
            // densable ...Ie!==void 0&&{effort:Ie}
            ...(effortLevelForTranscript !== undefined && {
              effort: effortLevelForTranscript,
            }),
            ...(serverClassifierRequest !== undefined &&
              serverClassifierEnvelope(serverClassifierRequest)),
          }
          newMessages.push(m)
          fallbackMessage = m
          yield m
          stopReason = result.stop_reason ?? null
          const cutShortError = buildCutShortErrorForNonStreamingResponse(
            result,
            maxOutputTokens,
          )
          if (cutShortError) {
            yield cutShortError
          }
          // densable wa: yield po then yield*wa → server_fallback midStream:!1
          if (
            options.serverRefusalFallback !== undefined &&
            !serverFallbackEmitted
          ) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { planNonStreamingServerFallbackEvent } =
                require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
              const sfEv = planNonStreamingServerFallbackEvent({
                lastHop: nonStreamLastHop,
                currentModel: options.model,
                requestId: streamRequestId,
                finalStopReason: result.stop_reason ?? null,
                alreadyEmitted: serverFallbackEmitted,
              })
              if (sfEv) {
                serverFallbackEmitted = true
                lastServerFallbackHop = nonStreamLastHop
                yield sfEv as unknown as StreamEvent
              }
            } catch {
              // densable optional
            }
          }
        } finally {
          clearStreamIdleTimers()
        }
      } catch (errorFromRetry) {
        // Official 2.1.328 (`chunk@294254613.js @3469336`): FallbackTriggeredError
        // MUST immediately propagate to query.ts so query.ts performs the model
        // switch, thinking-block strip, streamingToolExecutor discard, mainLoopModel
        // update, system/model_fallback + query_model_change emission, and cancel/edit
        // dialog handling. Never recursively call queryModelWithStreaming here.
        if (errorFromRetry instanceof FallbackTriggeredError) {
          throw errorFromRetry
        }
        // densable #26 thinking-only re-stream — bubble to streamAttempt loop.
        if (errorFromRetry instanceof ThinkingOnlyStreamRetryError) {
          throw errorFromRetry
        }
        if (errorFromRetry instanceof OutputFilteredStreamRetryError) {
          throw errorFromRetry
        }
        if (errorFromRetry instanceof ToolSearchRefusalError) {
          if (!options._toolSearchRefusalRetried) {
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
          throw errorFromRetry.cause ?? errorFromRetry
        }

        // Official 2.1.314 (#1361) — Foundry 404 DeploymentNotFound: fall back
        // to an older model of the same family via FallbackTriggeredError so
        // query.ts handles the switch cleanly (thinking strip, executor reset,
        // model_fallback notice).
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
            require('../../utils/foundryCapabilities.js') as typeof import('../../utils/foundryCapabilities.js')
          if (isFoundryDeploymentNotFoundError(errorFromRetry.originalError)) {
            const fallbackModel = resolveFoundryFamilyFallbackModel(
              options.model,
            )
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
        // non-streaming fallback. This handles gateways that return 404 for streaming
        // endpoints but work fine with non-streaming. Before v2.1.8, BetaMessageStream
        // threw 404s during iteration (caught by inner catch with fallback), but now
        // with raw streams, 404s are thrown during creation (caught here).
        const is404StreamCreationError =
          !didFallBackToNonStreaming &&
          errorFromRetry instanceof CannotRetryError &&
          errorFromRetry.originalError instanceof APIError &&
          errorFromRetry.originalError.status === 404

        if (is404StreamCreationError) {
          // 404 is thrown at .withResponse() before streamRequestId is assigned,
          // and CannotRetryError means every retry failed — so grab the failed
          // request's ID from the error header instead.
          const failedRequestId =
            (errorFromRetry.originalError as APIError).requestID ?? 'unknown'
          logForDebugging(
            'Streaming endpoint returned 404, falling back to non-streaming mode',
            { level: 'warn' },
          )
          didFallBackToNonStreaming = true
          if (options.onStreamingFallback) {
            options.onStreamingFallback()
          }

          logEvent('tengu_streaming_fallback_to_non_streaming', {
            model:
              options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            error:
              '404_stream_creation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            attemptNumber,
            maxOutputTokens,
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
            // Fall back to non-streaming mode
            // densable 404 path: cause=404_stream_creation, no stall block
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
                ...(isFastModeEnabled() && { fastMode: isFastMode }),
                signal,
                onError: onThinkingDisplayApiError,
                onRetryStatus: options.onRetryStatus,
              },
              paramsFromContext,
              (attempt, _startTime, tokens) => {
                attemptNumber = attempt
                maxOutputTokens = tokens
              },
              params => captureAPIRequest(params, options.querySource),
              originating404,
            )

            // densable fa + wa on 404 non-streaming path (same as idle fallback)
            let nonStreamContent404: unknown[] = Array.isArray(result.content)
              ? [...result.content]
              : []
            let nonStreamLastHop404:
              | {
                  fromModel: string
                  model: string
                  reason: string
                  category: string | null
                }
              | undefined
            // densable G2s on 404 non-stream path
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { planFallbackCreditMint } =
                require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
              const stopDetails404 = (result as { stop_details?: unknown })
                .stop_details
              if (stopDetails404 !== undefined) {
                const mint = planFallbackCreditMint({
                  stopDetails: stopDetails404,
                  alreadyMinted: fallbackCreditMinted,
                })
                if (
                  typeof stopDetails404 === 'object' &&
                  stopDetails404 !== null &&
                  'fallback_credit_token' in stopDetails404
                ) {
                  delete (stopDetails404 as { fallback_credit_token?: unknown })
                    .fallback_credit_token
                }
                if (mint.creditCode !== undefined) {
                  mintedFallbackCreditCode = mint.creditCode
                  if (mint.shouldLogMint) {
                    fallbackCreditMinted = true
                    logEvent('tengu_fallback_credit_minted', {
                      request_id: (streamRequestId ??
                        failedRequestId) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
                require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
              const fa = materializeNonStreamingServerFallbackContent({
                content: nonStreamContent404,
                stopReason: result.stop_reason ?? null,
                armed: options.serverRefusalFallback !== undefined,
              })
              nonStreamContent404 = fa.content
              nonStreamLastHop404 = fa.lastHop
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
            } catch {
              // densable optional
            }

            // densable {content,batchToolUses}=qXe(Owe(Kr.content,…), r)
            const { content: Br, batchToolUses: Eo } = decomposeBatchedToolUses(
              normalizeContentFromAPI(
                nonStreamContent404 as typeof result.content,
                tools,
                options.agentId,
                {
                  requestId: streamRequestId ?? undefined,
                  messageId: result.id,
                },
              ),
              tools,
            )
            if (serverClassifierRequest !== undefined) {
              settleSafeguardOnMessage(
                serverClassifierRequest,
                result,
                result.content,
              )
            }
            const m: AssistantMessage = {
              message: {
                ...result,
                content: Br as MessageContent,
              },
              ...(Eo.length > 0 && { batchToolUses: Eo }),
              requestId: streamRequestId ?? undefined,
              type: 'assistant',
              uuid: randomUUID(),
              timestamp: new Date().toISOString(),
              ...(research !== undefined && { research }),
              ...(advisorModel && { advisorModel }),
              // densable ...Ie!==void 0&&{effort:Ie}
              ...(effortLevelForTranscript !== undefined && {
                effort: effortLevelForTranscript,
              }),
              ...(serverClassifierRequest !== undefined &&
                serverClassifierEnvelope(serverClassifierRequest)),
            }
            newMessages.push(m)
            fallbackMessage = m
            yield m
            stopReason = result.stop_reason ?? null
            const cutShortError = buildCutShortErrorForNonStreamingResponse(
              result,
              maxOutputTokens,
            )
            if (cutShortError) {
              yield cutShortError
            }
            if (
              options.serverRefusalFallback !== undefined &&
              !serverFallbackEmitted
            ) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { planNonStreamingServerFallbackEvent } =
                  require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                const sfEv = planNonStreamingServerFallbackEvent({
                  lastHop: nonStreamLastHop404,
                  currentModel: options.model,
                  requestId: streamRequestId ?? failedRequestId,
                  finalStopReason: result.stop_reason ?? null,
                  alreadyEmitted: serverFallbackEmitted,
                })
                if (sfEv) {
                  serverFallbackEmitted = true
                  lastServerFallbackHop = nonStreamLastHop404
                  yield sfEv as unknown as StreamEvent
                }
              } catch {
                // densable optional
              }
            }

            // Continue to success logging below
          } catch (fallbackError) {
            // Propagate model-fallback signal to query.ts (see comment above).
            if (fallbackError instanceof FallbackTriggeredError) {
              throw fallbackError
            }

            // Fallback also failed, handle as normal error
            logForDebugging(
              `Non-streaming fallback also failed: ${errorMessage(fallbackError)}`,
              { level: 'error' },
            )

            let error = fallbackError
            let errorModel = options.model
            if (fallbackError instanceof CannotRetryError) {
              error = fallbackError.originalError
              errorModel = fallbackError.retryContext.model
            }

            if (error instanceof APIError) {
              extractQuotaStatusFromError(error, quotaRejectQuerySourceBucket)
            }

            const requestId =
              streamRequestId ||
              (error instanceof APIError ? error.requestID : undefined) ||
              (error instanceof APIError
                ? (error.error as { request_id?: string })?.request_id
                : undefined)

            logAPIError({
              error,
              model: errorModel,
              messageCount: messagesForAPI.length,
              messageTokens: tokenCountFromLastAPIResponse(messagesForAPI),
              durationMs: Date.now() - start,
              durationMsIncludingRetries: Date.now() - startIncludingRetries,
              attempt: attemptNumber,
              requestId,
              clientRequestId,
              didFallBackToNonStreaming,
              queryTracking: options.queryTracking,
              querySource: options.querySource,
              llmSpan,
              fastMode: isFastModeRequest,
              previousRequestId,
              promptTooLongIsHandled: options.promptTooLongIsHandled,
              effort:
                effortLevelForTranscript ??
                (typeof effort === 'string' ? effort : undefined),
            })

            if (error instanceof APIUserAbortError) {
              releaseStreamResources()
              return
            }

            yield getAssistantMessageFromError(error, errorModel, {
              messages,
              messagesForAPI,
            })
            releaseStreamResources()
            return
          }
        } else {
          // Original error handling for non-404 errors
          logForDebugging(
            `Error in API request: ${errorMessage(errorFromRetry)}`,
            {
              level: 'error',
            },
          )

          let error = errorFromRetry
          let errorModel = options.model
          if (errorFromRetry instanceof CannotRetryError) {
            error = errorFromRetry.originalError
            errorModel = errorFromRetry.retryContext.model
          }

          // Extract quota status from error headers if it's a rate limit error
          if (error instanceof APIError) {
            extractQuotaStatusFromError(error, quotaRejectQuerySourceBucket)
          }

          // Extract requestId from stream, error header, or error body
          const requestId =
            streamRequestId ||
            (error instanceof APIError ? error.requestID : undefined) ||
            (error instanceof APIError
              ? (error.error as { request_id?: string })?.request_id
              : undefined)

          logAPIError({
            error,
            model: errorModel,
            messageCount: messagesForAPI.length,
            messageTokens: tokenCountFromLastAPIResponse(messagesForAPI),
            durationMs: Date.now() - start,
            durationMsIncludingRetries: Date.now() - startIncludingRetries,
            attempt: attemptNumber,
            requestId,
            clientRequestId,
            didFallBackToNonStreaming,
            queryTracking: options.queryTracking,
            querySource: options.querySource,
            llmSpan,
            fastMode: isFastModeRequest,
            previousRequestId,
            promptTooLongIsHandled: options.promptTooLongIsHandled,
            effort:
              effortLevelForTranscript ??
              (typeof effort === 'string' ? effort : undefined),
          })

          // Don't yield an assistant error message for user aborts
          // The interruption message is handled in query.ts
          if (error instanceof APIUserAbortError) {
            releaseStreamResources()
            return
          }

          yield getAssistantMessageFromError(error, errorModel, {
            messages,
            messagesForAPI,
          })
          releaseStreamResources()
          return
        }
      } finally {
        stopSessionActivity('api_call', sessionActivityAgentId)
        // Must be in the finally block: if the generator is terminated early
        // via .return() (e.g. consumer breaks out of for-await-of, or query.ts
        // encounters an abort), code after the try/finally never executes.
        // Without this, the Response object's native TLS/socket buffers leak
        // until the generator itself is GC'd (see GH #32920).
        releaseStreamResources()

        // Non-streaming fallback cost: the streaming path tracks cost in the
        // message_delta handler before any yield. Fallback pushes to newMessages
        // then yields, so tracking must be here to survive .return() at the yield.
        if (fallbackMessage) {
          const fallbackUsage = fallbackMessage.message
            .usage as BetaMessageDeltaUsage
          usage = updateUsage(EMPTY_USAGE, fallbackUsage)
          stopReason = fallbackMessage.message.stop_reason as BetaStopReason
          const fallbackCost = calculateUSDCost(
            resolvedModel,
            fallbackUsage as unknown as BetaUsage,
          )
          costUSD += addToTotalSessionCost(
            fallbackCost,
            fallbackUsage as unknown as BetaUsage,
            options.model,
            sessionCostAttribution,
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

  // Track the last requestId for the main conversation chain so shutdown
  // can send a cache eviction hint to inference. Exclude backgrounded
  // sessions (Ctrl+B) which share the repl_main_thread querySource but
  // run inside an agent context — they are independent conversation chains
  // whose cache should not be evicted when the foreground session clears.
  if (
    streamRequestId &&
    !(options.agentContext ?? getAgentContext()) &&
    (options.querySource.startsWith('repl_main_thread') ||
      options.querySource === 'sdk')
  ) {
    setLastMainRequestId(streamRequestId)
  }

  // Precompute scalars so the fire-and-forget .then() closure doesn't pin the
  // full messagesForAPI array (the entire conversation up to the context window
  // limit) until getToolPermissionContext() resolves.
  const logMessageCount = messagesForAPI.length
  const logMessageTokens = tokenCountFromLastAPIResponse(messagesForAPI)

  // Record LLM observation in Langfuse (no-op if not configured)
  recordLLMObservation(options.langfuseTrace ?? null, {
    model: resolvedModel,
    provider: getAPIProvider(),
    input: convertMessagesToLangfuse(messagesForAPI, systemPrompt),
    output: convertOutputToLangfuse(newMessages),
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
    },
    startTime: new Date(startIncludingRetries),
    endTime: new Date(),
    completionStartTime: ttftMs > 0 ? new Date(start + ttftMs) : undefined,
    tools: convertToolsToLangfuse(toolSchemas as unknown[]),
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
        (newMessages[0]?.message.model as string | undefined) ??
        partialMessage?.model ??
        options.model,
      preNormalizedModel: options.model,
      usage,
      start,
      startIncludingRetries,
      attempt: attemptNumber,
      messageCount: logMessageCount,
      messageTokens: logMessageTokens,
      requestId: streamRequestId ?? null,
      clientRequestId,
      stopReason,
      ttftMs,
      didFallBackToNonStreaming,
      querySource: options.querySource,
      headers: responseHeaders,
      costUSD,
      queryTracking: options.queryTracking,
      permissionMode: permissionContext.mode,
      // Pass newMessages for beta tracing - extraction happens in logging.ts
      // only when beta tracing is enabled
      newMessages,
      llmSpan,
      globalCacheStrategy,
      requestSetupMs: start - startIncludingRetries,
      attemptStartTimes,
      fastMode: isFastModeRequest,
      previousRequestId,
      betas: lastRequestBetas,
      effort:
        effortLevelForTranscript ??
        (typeof effort === 'string' ? effort : undefined),
      ...(carriedEffortEnded !== undefined ? { carriedEffortEnded } : {}),
    }
    logAPISuccessAndDuration(apiSuccessLogArgs)
  })

  // Defensive: also release on normal completion (no-op if finally already ran).
  releaseStreamResources()
}

type HaikuOptions = Omit<Options, 'model' | 'getToolPermissionContext'>

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

type QueryWithModelOptions = Omit<Options, 'getToolPermissionContext'>

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
