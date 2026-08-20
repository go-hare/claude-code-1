import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaMessageStreamParams,
  BetaOutputConfig,
  BetaRawMessageStreamEvent,
  BetaRequestDocumentBlock,
  BetaStopReason,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolResultBlockParam,
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
import { isStickyBetaRejected } from '../../bootstrap/state.js'
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
} from '../../utils/context.js'
import { resolveAppliedEffort } from '../../utils/effort.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { captureAPIRequest, logError } from '../../utils/log.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  ensureToolResultPairing,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
  stripAdvisorBlocks,
  stripCallerFieldFromAssistantMessage,
  stripToolReferenceBlocksFromUserMessage,
} from '../../utils/messages.js'
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getSmallFastModel,
  isNonCustomOpusModel,
} from '../../utils/model/model.js'
import {
  asSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPromptType.js'
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
import { getAPIContextManagement } from '../compact/apiMicrocompact.js'
import { bedrockAdapter } from '../providerUsage/adapters/bedrock.js'
import { updateProviderBuckets } from '../providerUsage/store.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../utils/permissions/autoModeState.js') as typeof import('../../utils/permissions/autoModeState.js'))
  : null

import { feature } from 'bun:bundle'
import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk/error'
import {
  getAfkModeHeaderLatched,
  getCacheEditingHeaderLatched,
  getFastModeHeaderLatched,
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
  getSessionId,
  setAfkModeHeaderLatched,
  setCacheEditingHeaderLatched,
  setFastModeHeaderLatched,
  setLastMainRequestId,
  setPromptCache1hAllowlist,
  setPromptCache1hEligible,
} from 'src/bootstrap/state.js'
import {
  AFK_MODE_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  EFFORT_BETA_HEADER,
  FAST_MODE_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  TASK_BUDGETS_BETA_HEADER,
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
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { AgentId } from 'src/types/ids.js'
import {
  ADVISOR_TOOL_INSTRUCTIONS,
  getExperimentAdvisorModels,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from 'src/utils/advisor.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { isClaudeAISubscriber } from 'src/utils/auth.js'
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
  isFastModeSupportedByModel,
} from 'src/utils/fastMode.js'
import { returnValue } from 'src/utils/generators.js'
import { headlessProfilerCheckpoint } from 'src/utils/headlessProfiler.js'
import { isMcpInstructionsDeltaEnabled } from 'src/utils/mcpInstructionsDelta.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import { endQueryProfile, queryCheckpoint } from 'src/utils/queryProfiler.js'
import {
  isThinkingActiveForToolChoice,
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
  type ThinkingConfig,
} from 'src/utils/thinking.js'
import {
  extractDiscoveredToolNames,
  getDeferredToolPlaceholderSchema,
  isDeferredToolsDeltaEnabled,
  isSearchExtraToolsEnabled,
} from 'src/utils/searchExtraTools.js'
import { stripFoundryUnsupportedToolFields } from 'src/utils/foundryCapabilities.js'
import { API_MAX_MEDIA_PER_REQUEST } from '../../constants/apiLimits.js'
import {
  ADVISOR_BETA_HEADER,
  MID_CONVERSATION_SYSTEM_BETA_HEADER,
} from '../../constants/betas.js'
import {
  formatDeferredToolLine,
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { count } from '../../utils/array.js'
import { insertBlockAfterToolResults } from '../../utils/contentArray.js'
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
import {
  consumePendingCacheEdits,
  getPinnedCacheEdits,
  markToolsSentToAPIState,
  pinCacheEdits,
} from '../compact/microCompact.js'
import { shouldDeferLspTool } from '../lsp/manager.js'
import { isToolFromMcpServer } from '../mcp/utils.js'
import { recordLLMObservation } from '../langfuse/index.js'
import type { LangfuseSpan } from '../langfuse/index.js'
import {
  convertMessagesToLangfuse,
  convertOutputToLangfuse,
  convertToolsToLangfuse,
} from '../langfuse/convert.js'
import { withStreamingVCR, withVCR } from '../vcr.js'
import { CLIENT_REQUEST_ID_HEADER, getAnthropicClient } from './client.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import {
  API_ERROR_MESSAGE_PREFIX,
  CUSTOM_OFF_SWITCH_MESSAGE,
  getAssistantMessageFromError,
  getErrorMessageIfRefusal,
} from './errors.js'
import { extractConnectionErrorDetails } from './errorUtils.js'
import {
  EMPTY_USAGE,
  type GlobalCacheStrategy,
  logAPIError,
  logAPIQuery,
  logAPISuccessAndDuration,
  type NonNullableUsage,
} from './logging.js'

/**
 * densable 2.1.219 zie — network-down codes (no route / refuse / DNS).
 * Mid-stream: cause=network_down when finalizing partial content.
 */
const STREAM_NETWORK_DOWN_CODES = new Set([
  'ECONNREFUSED',
  'ConnectionRefused',
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'EAI_AGAIN',
  'FailedToOpenSocket',
  'ERR_PROXY_TUNNEL',
])

/**
 * densable 2.1.219 Kie — stale keep-alive / dead pooled socket codes.
 * Mid-stream: cause=stale_connection when not in zie.
 */
const STREAM_STALE_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ConnectionClosed',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ERR_SOCKET_CLOSED',
  'StreamSuspended',
])
import {
  checkResponseForCacheBreak,
  recordPromptState,
} from './promptCacheBreakDetection.js'
import {
  CannotRetryError,
  FallbackTriggeredError,
  is529Error,
  MidConvSystemRetryError,
  type RetryContext,
  withRetry,
} from './withRetry.js'

// Define a type that represents valid JSON values
type JsonValue = string | number | boolean | null | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]

/**
 * Assemble the extra body parameters for the API request, based on the
 * CLAUDE_CODE_EXTRA_BODY environment variable if present and on any beta
 * headers (primarily for Bedrock requests).
 *
 * @param betaHeaders - An array of beta headers to include in the request.
 * @returns A JSON object representing the extra body parameters.
 */
export function getExtraBodyParams(betaHeaders?: string[]): JsonObject {
  // Parse user's extra body parameters first
  const extraBodyStr = process.env.CLAUDE_CODE_EXTRA_BODY
  let result: JsonObject = {}

  if (extraBodyStr) {
    try {
      // Parse as JSON, which can be null, boolean, number, string, array or object
      const parsed = safeParseJSON(extraBodyStr)
      // We expect an object with key-value pairs to spread into API parameters
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Shallow clone — safeParseJSON is LRU-cached and returns the same
        // object reference for the same string. Mutating `result` below
        // would poison the cache, causing stale values to persist.
        result = { ...(parsed as JsonObject) }
      } else {
        logForDebugging(
          `CLAUDE_CODE_EXTRA_BODY env var must be a JSON object, but was given ${extraBodyStr}`,
          { level: 'error' },
        )
      }
    } catch (error) {
      logForDebugging(
        `Error parsing CLAUDE_CODE_EXTRA_BODY: ${errorMessage(error)}`,
        { level: 'error' },
      )
    }
  }

  // Handle beta headers if provided
  if (betaHeaders && betaHeaders.length > 0) {
    if (result.anthropic_beta && Array.isArray(result.anthropic_beta)) {
      // Add to existing array, avoiding duplicates
      const existingHeaders = result.anthropic_beta as string[]
      const newHeaders = betaHeaders.filter(
        header => !existingHeaders.includes(header),
      )
      result.anthropic_beta = [...existingHeaders, ...newHeaders]
    } else {
      // Create new array with the beta headers
      result.anthropic_beta = betaHeaders
    }
  }

  return result
}

export function getPromptCachingEnabled(model: string): boolean {
  // Global disable takes precedence
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING)) return false

  // Check if we should disable for small/fast model
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_HAIKU)) {
    const smallFastModel = getSmallFastModel()
    if (model === smallFastModel) return false
  }

  // Check if we should disable for default Sonnet
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_SONNET)) {
    const defaultSonnet = getDefaultSonnetModel()
    if (model === defaultSonnet) return false
  }

  // Check if we should disable for default Opus
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_OPUS)) {
    const defaultOpus = getDefaultOpusModel()
    if (model === defaultOpus) return false
  }

  return true
}

export function getCacheControl({
  scope,
  querySource,
}: {
  scope?: CacheScope
  querySource?: QuerySource
} = {}): {
  type: 'ephemeral'
  ttl?: '1h'
  scope?: CacheScope
} {
  return {
    type: 'ephemeral',
    ...(should1hCacheTTL(querySource) && { ttl: '1h' }),
    ...(scope === 'global' && { scope }),
  }
}

/**
 * Determines if 1h TTL should be used for prompt caching.
 *
 * Only applied when:
 * 1. User is eligible (ant or subscriber within rate limits)
 * 2. The query source matches a pattern in the GrowthBook allowlist
 *
 * GrowthBook config shape: { allowlist: string[] }
 * Patterns support trailing '*' for prefix matching.
 * Examples:
 * - { allowlist: ["repl_main_thread*", "sdk"] } — main thread + SDK only
 * - { allowlist: ["repl_main_thread*", "sdk", "agent:*"] } — also subagents
 * - { allowlist: ["*"] } — all sources
 *
 * The allowlist is cached in STATE for session stability — prevents mixed
 * TTLs when GrowthBook's disk cache updates mid-request.
 */
function should1hCacheTTL(querySource?: QuerySource): boolean {
  // 3P Bedrock users get 1h TTL when opted in via env var — they manage their own billing
  // No GrowthBook gating needed since 3P users don't have GrowthBook configured
  if (
    getAPIProvider() === 'bedrock' &&
    isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK)
  ) {
    return true
  }

  // Latch eligibility in bootstrap state for session stability — prevents
  // mid-session overage flips from changing the cache_control TTL, which
  // would bust the server-side prompt cache (~20K tokens per flip).
  let userEligible = getPromptCache1hEligible()
  if (userEligible === null) {
    userEligible =
      process.env.USER_TYPE === 'ant' ||
      (isClaudeAISubscriber() && !currentLimits.isUsingOverage)
    setPromptCache1hEligible(userEligible)
  }
  if (!userEligible) return false

  // Cache allowlist in bootstrap state for session stability — prevents mixed
  // TTLs when GrowthBook's disk cache updates mid-request
  let allowlist = getPromptCache1hAllowlist()
  if (allowlist === null) {
    const config = getFeatureValue_CACHED_MAY_BE_STALE<{
      allowlist?: string[]
    }>('tengu_prompt_cache_1h_config', {})
    allowlist = config.allowlist ?? []
    setPromptCache1hAllowlist(allowlist)
  }

  return (
    querySource !== undefined &&
    allowlist.some(pattern =>
      pattern.endsWith('*')
        ? querySource.startsWith(pattern.slice(0, -1))
        : querySource === pattern,
    )
  )
}

/**
 * Configure effort parameters for API request.
 *
 */
function configureEffortParams(
  effortValue: EffortValue | undefined,
  outputConfig: BetaOutputConfig,
  extraBodyParams: Record<string, unknown>,
  betas: string[],
  model: string,
): void {
  if (!modelSupportsEffort(model) || 'effort' in outputConfig) {
    return
  }

  if (effortValue === undefined) {
    betas.push(EFFORT_BETA_HEADER)
  } else if (typeof effortValue === 'string') {
    // densable: string effort levels including xhigh pass through as-is.
    // resolveAppliedEffort already clamped unsupported max/xhigh → high.
    // SDK BetaOutputConfig.effort types lag wire (no xhigh yet) — cast.
    ;(outputConfig as { effort?: EffortValue }).effort = effortValue
    betas.push(EFFORT_BETA_HEADER)
  } else if (process.env.USER_TYPE === 'ant') {
    // Numeric effort override - ant-only (uses anthropic_internal)
    const existingInternal =
      (extraBodyParams.anthropic_internal as Record<string, unknown>) || {}
    extraBodyParams.anthropic_internal = {
      ...existingInternal,
      effort_override: effortValue,
    }
  }
}

// output_config.task_budget — API-side token budget awareness for the model.
// Stainless SDK types don't yet include task_budget on BetaOutputConfig, so we
// define the wire shape locally and cast. The API validates on receipt; see
// api/api/schemas/messages/request/output_config.py:12-39 in the monorepo.
// Beta: task-budgets-2026-03-13 (EAP, claude-strudel-eap only as of Mar 2026).
type TaskBudgetParam = {
  type: 'tokens'
  total: number
  remaining?: number
}

export function configureTaskBudgetParams(
  taskBudget: Options['taskBudget'],
  outputConfig: BetaOutputConfig & { task_budget?: TaskBudgetParam },
  betas: string[],
): void {
  if (
    !taskBudget ||
    'task_budget' in outputConfig ||
    !shouldIncludeFirstPartyOnlyBetas()
  ) {
    return
  }
  outputConfig.task_budget = {
    type: 'tokens',
    total: taskBudget.total,
    ...(taskBudget.remaining !== undefined && {
      remaining: taskBudget.remaining,
    }),
  }
  if (!betas.includes(TASK_BUDGETS_BETA_HEADER)) {
    betas.push(TASK_BUDGETS_BETA_HEADER)
  }
}

export function getAPIMetadata() {
  // https://docs.google.com/document/d/1dURO9ycXXQCBS0V4Vhl4poDBRgkelFc5t2BNPoEgH5Q/edit?tab=t.0#heading=h.5g7nec5b09w5
  let extra: JsonObject = {}
  const extraStr = process.env.CLAUDE_CODE_EXTRA_METADATA
  if (extraStr) {
    const parsed = safeParseJSON(extraStr, false)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      extra = parsed as JsonObject
    } else {
      logForDebugging(
        `CLAUDE_CODE_EXTRA_METADATA env var must be a JSON object, but was given ${extraStr}`,
        { level: 'error' },
      )
    }
  }

  return {
    user_id: jsonStringify({
      ...extra,
      device_id: getOrCreateUserID(),
      // Only include OAuth account UUID when actively using OAuth authentication
      account_uuid: getOauthAccountInfo()?.accountUuid ?? '',
      session_id: getSessionId(),
    }),
  }
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

export function userMessageToMessageParam(
  message: UserMessage,
  addCache = false,
  enablePromptCaching: boolean,
  querySource?: QuerySource,
): MessageParam {
  if (addCache) {
    if (typeof message.message!.content === 'string') {
      return {
        role: 'user',
        content: [
          {
            type: 'text',
            text: message.message!.content,
            ...(enablePromptCaching && {
              cache_control: getCacheControl({ querySource }),
            }),
          },
        ],
      }
    } else {
      return {
        role: 'user',
        content: message.message!.content!.map((_, i) => ({
          ..._,
          ...(i === message.message!.content!.length - 1
            ? enablePromptCaching
              ? { cache_control: getCacheControl({ querySource }) }
              : {}
            : {}),
        })),
      }
    }
  }
  // Clone array content to prevent in-place mutations (e.g., insertCacheEditsBlock's
  // splice) from contaminating the original message. Without cloning, multiple calls
  // to addCacheBreakpoints share the same array and each splices in duplicate cache_edits.
  return {
    role: 'user',
    content: (Array.isArray(message.message!.content)
      ? [...message.message!.content]
      : message.message!
          .content) as import('@anthropic-ai/sdk/resources/beta/messages/messages.js').BetaContentBlockParam[],
  }
}

export function assistantMessageToMessageParam(
  message: AssistantMessage,
  addCache = false,
  enablePromptCaching: boolean,
  querySource?: QuerySource,
): MessageParam {
  if (addCache) {
    if (typeof message.message!.content === 'string') {
      return {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: message.message!.content,
            ...(enablePromptCaching && {
              cache_control: getCacheControl({ querySource }),
            }),
          },
        ],
      }
    } else {
      return {
        role: 'assistant',
        content: message.message!.content!.map((_, i) => {
          const contentBlock = stripGeminiProviderMetadata(_)
          return {
            ...contentBlock,
            ...(i === message.message!.content!.length - 1 &&
            contentBlock.type !== 'thinking' &&
            contentBlock.type !== 'redacted_thinking' &&
            (feature('CONNECTOR_TEXT')
              ? !isConnectorTextBlock(contentBlock)
              : true)
              ? enablePromptCaching
                ? { cache_control: getCacheControl({ querySource }) }
                : {}
              : {}),
          }
        }),
      }
    }
  }
  return {
    role: 'assistant',
    content:
      typeof message.message!.content === 'string'
        ? message.message!.content
        : (message.message!.content!.map(
            stripGeminiProviderMetadata,
          ) as BetaContentBlockParam[]),
  }
}

function stripGeminiProviderMetadata<T extends BetaContentBlockParam | string>(
  contentBlock: T,
): T {
  if (
    typeof contentBlock === 'string' ||
    !('_geminiThoughtSignature' in (contentBlock as object))
  ) {
    return contentBlock
  }

  const obj = contentBlock as unknown as Record<string, unknown>
  const { _geminiThoughtSignature: _unusedGeminiThoughtSignature, ...rest } =
    obj
  return rest as unknown as T
}

export type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
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
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
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
 * Per-attempt timeout for non-streaming fallback requests, in milliseconds.
 * Reads API_TIMEOUT_MS when set so slow backends and the streaming path
 * share the same ceiling.
 *
 * Remote sessions default to 120s to stay under CCR's container idle-kill
 * (~5min) so a hung fallback to a wedged backend surfaces a clean
 * APIConnectionTimeoutError instead of stalling past SIGKILL.
 *
 * Otherwise defaults to 300s — long enough for slow backends without
 * approaching the API's 10-minute non-streaming boundary.
 */
function getNonstreamingFallbackTimeoutMs(): number {
  const override = parseInt(process.env.API_TIMEOUT_MS || '', 10)
  if (override) return override
  // Official REMOTE densable — shorter non-streaming timeout under CCR.
  let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    isRemote = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return isRemote ? 120_000 : 300_000
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
  },
  retryOptions: {
    model: string
    fallbackModel?: string
    thinkingConfig: ThinkingConfig
    fastMode?: boolean
    signal: AbortSignal
    initialConsecutive529Errors?: number
    querySource?: QuerySource
  },
  paramsFromContext: (context: RetryContext) => BetaMessageStreamParams,
  onAttempt: (attempt: number, start: number, maxOutputTokens: number) => void,
  captureRequest: (params: BetaMessageStreamParams) => void,
  /**
   * Request ID of the failed streaming attempt this fallback is recovering
   * from. Emitted in tengu_nonstreaming_fallback_error for funnel correlation.
   */
  originatingRequestId?: string | null,
): AsyncGenerator<SystemAPIErrorMessage, BetaMessage> {
  const fallbackTimeoutMs = getNonstreamingFallbackTimeoutMs()
  const generator = withRetry(
    () =>
      getAnthropicClient({
        maxRetries: 0,
        model: clientOptions.model,
        fetchOverride: clientOptions.fetchOverride,
        source: clientOptions.source,
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
        return await anthropic.beta.messages.create(
          {
            ...adjustedParams,
            model: normalizeModelStringForAPI(adjustedParams.model),
          },
          {
            signal: retryOptions.signal,
            timeout: fallbackTimeoutMs,
          },
        )
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
          request_id: (originatingRequestId ??
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
 * Extracts the request ID from the most recent assistant message in the
 * conversation. Used to link consecutive API requests in analytics so we can
 * join them for cache-hit-rate analysis and incremental token tracking.
 *
 * Deriving this from the message array (rather than global state) ensures each
 * query chain (main thread, subagent, teammate) tracks its own request chain
 * independently, and rollback/undo naturally updates the value.
 */
function getPreviousRequestIdFromMessages(
  messages: Message[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && msg.requestId) {
      return msg.requestId as string
    }
  }
  return undefined
}

function isMedia(
  block: BetaContentBlockParam,
): block is BetaImageBlockParam | BetaRequestDocumentBlock {
  return block.type === 'image' || block.type === 'document'
}

function isToolResult(
  block: BetaContentBlockParam,
): block is BetaToolResultBlockParam {
  return block.type === 'tool_result'
}

/**
 * Append a `<system-reminder>` text block to the last user message in the
 * batch instead of creating a standalone user message.
 *
 * Why this exists — bug background:
 * A standalone SR-only user message at the end of the request triggers a
 * known bare-ack failure mode: the model emits a single "OK" / "Got it."
 * because the last user-role turn carries no real user text, just an
 * instruction-shaped reminder. Wrapping the reminder onto a real user turn
 * keeps the conversation from ever ending on a "fake" user message.
 *
 * Behavior:
 * - Tail is a user message → append the SR text as a content block.
 *   - String content: hoist to a 2-block array (original text + SR block).
 *   - Array content: append the SR block. If the array contains a
 *     tool_result, smooshSystemReminderSiblings (utils/messages.ts) will
 *     later fold this SR text into that tool_result. Otherwise it lands
 *     as a sibling text block on the same user turn. Either way, it is
 *     not a turn of its own.
 * - Tail is an assistant message (e.g. mid tool_use) or list is empty →
 *   skip. The next user turn will re-enter the inject branch and attach
 *   correctly.
 */
export function appendSystemReminderToLastUserMessage(
  messages: (UserMessage | AssistantMessage)[],
  srText: string,
): (UserMessage | AssistantMessage)[] {
  const lastIdx = messages.length - 1
  const last = lastIdx >= 0 ? messages[lastIdx] : undefined
  if (!last || last.message.role !== 'user') return messages
  const existing = last.message.content
  const srBlock: TextBlockParam = { type: 'text', text: srText }
  const newContent: ContentBlockParam[] = Array.isArray(existing)
    ? [...(existing as ContentBlockParam[]), srBlock]
    : [{ type: 'text', text: existing ?? '' }, srBlock]
  return [
    ...messages.slice(0, lastIdx),
    {
      ...last,
      message: { ...last.message, content: newContent },
    },
  ]
}

/**
 * Ensures messages contain at most `limit` media items (images + documents).
 * Strips oldest media first to preserve the most recent.
 */
export function stripExcessMediaItems<
  T extends {
    type: string
    message?: { content?: unknown }
  },
>(messages: T[], limit: number): T[] {
  let toRemove = 0
  for (const msg of messages) {
    if (msg.type === 'api_system') continue
    if (!Array.isArray(msg.message!.content)) continue
    for (const block of msg.message!.content) {
      if (isMedia(block)) toRemove++
      if (isToolResult(block) && Array.isArray(block.content)) {
        for (const nested of block.content) {
          if (isMedia(nested as BetaContentBlockParam)) toRemove++
        }
      }
    }
  }
  toRemove -= limit
  if (toRemove <= 0) return messages

  return messages.map(msg => {
    if (msg.type === 'api_system') return msg
    if (toRemove <= 0) return msg
    const content = msg.message!.content
    if (!Array.isArray(content)) return msg

    const before = toRemove
    const stripped = content
      .map(block => {
        if (
          toRemove <= 0 ||
          !isToolResult(block) ||
          !Array.isArray(block.content)
        )
          return block
        const filtered = block.content.filter(n => {
          if (toRemove > 0 && isMedia(n as BetaContentBlockParam)) {
            toRemove--
            return false
          }
          return true
        })
        return filtered.length === block.content.length
          ? block
          : { ...block, content: filtered }
      })
      .filter(block => {
        if (toRemove > 0 && isMedia(block)) {
          toRemove--
          return false
        }
        return true
      })

    return before === toRemove
      ? msg
      : ({
          ...msg,
          message: { ...msg.message, content: stripped },
        } as T)
  })
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
    const isMainAgent = getAgentContext() === undefined
    const qs = options.querySource
    const isMainSource = qs.startsWith('repl_main_thread') || qs === 'sdk'
    return isMainAgent && isMainSource ? 'main_thread' : 'other'
  })()
  // densable mzt → sticky-filter o3: if midConvLatchedOff (Iz sticky reject),
  // drop o3 from the request beta list for the rest of the session.
  let betas = getMergedBetas(options.model, { isAgenticQuery }).filter(
    b =>
      !(
        b === MID_CONVERSATION_SYSTEM_BETA_HEADER &&
        isStickyBetaRejected(MID_CONVERSATION_SYSTEM_BETA_HEADER)
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
  let useSearchExtraTools = await isSearchExtraToolsEnabled(
    options.model,
    tools,
    options.getToolPermissionContext,
    options.agents,
    'query',
  )

  // Precompute once — isDeferredTool does 2 GrowthBook lookups per call
  const deferredToolNames = new Set<string>()
  if (useSearchExtraTools) {
    for (const t of tools) {
      if (isDeferredTool(t)) deferredToolNames.add(t.name)
    }
  }

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

  // densable: A = S ? Jvu() : null; if A && provider !== bedrock → betas.push(A)
  // Bedrock carries the tool-search beta via extra body params instead.
  if (useSearchExtraTools) {
    const toolSearchBeta = getSearchExtraToolsBetaHeader()
    if (getAPIProvider() !== 'bedrock' && !betas.includes(toolSearchBeta)) {
      betas.push(toolSearchBeta)
    }
  }

  // Determine if cached microcompact is enabled for this model.
  // Computed once here (in async context) and captured by paramsFromContext.
  // The beta header is also captured here to avoid a top-level import of the
  // ant-only CACHE_EDITING_BETA_HEADER constant.
  let cachedMCEnabled = false
  let cacheEditingBetaHeader = ''
  if (feature('CACHED_MICROCOMPACT')) {
    const {
      isCachedMicrocompactEnabled,
      isModelSupportedForCacheEditing,
      getCachedMCConfig,
    } = await import('../compact/cachedMicrocompact.js')
    const betas = await import('src/constants/betas.js')
    cacheEditingBetaHeader = betas.CACHE_EDITING_BETA_HEADER
    const featureEnabled = isCachedMicrocompactEnabled()
    const modelSupported = isModelSupportedForCacheEditing(options.model)
    // cachedMC requires a non-empty beta header; the CACHE_EDITING_BETA_HEADER
    // constant is '' in this fork (upstream hasn't published the real value).
    // Without it, cache_reference and cache_edits in the request body cause
    // API 400: "tool_result.cache_reference: Extra inputs are not permitted".
    const headerAvailable = !!cacheEditingBetaHeader
    cachedMCEnabled = featureEnabled && modelSupported && headerAvailable
    const config = getCachedMCConfig()
    logForDebugging(
      `Cached MC gate: enabled=${featureEnabled} modelSupported=${modelSupported} headerAvailable=${headerAvailable} model=${options.model} supportedModels=${jsonStringify((config as Record<string, unknown>).supportedModels)}`,
    )
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

    // Strip advisor blocks — the API rejects them without the beta header.
    if (!betas.includes(ADVISOR_BETA_HEADER)) {
      next = stripAdvisorBlocks(next)
    }

    // Strip excess media items before making the API call.
    // The API rejects requests with >100 media items but returns a confusing error.
    // Rather than erroring (which is hard to recover from in Cowork/CCD), we
    // silently drop the oldest media items to stay within the limit.
    next = stripExcessMediaItems(next, API_MAX_MEDIA_PER_REQUEST)
    return next
  }

  let messagesForAPI = postNormalizeForAPI(
    normalizeMessagesForAPI(messages, filteredTools, normalizeModel),
  )
  queryCheckpoint('query_message_normalization_end')

  // densable Ydy midConvFallback: if primary path emitted api_system and o3 is
  // live, precompute a demoted re-normalize (model omitted) so KQn can swap
  // bodies without another full turn setup.
  let midConvFallback:
    | (() => (UserMessage | AssistantMessage | ApiSystemMessage)[])
    | null = null
  if (
    !midConvLatchedOff &&
    betas.includes(MID_CONVERSATION_SYSTEM_BETA_HEADER)
  ) {
    const primary = messagesForAPI
    midConvFallback = primary.some(m => isApiSystemMessage(m))
      ? () =>
          postNormalizeForAPI(
            normalizeMessagesForAPI(messages, filteredTools, undefined),
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
  const system = buildSystemPromptBlocks(systemPrompt, enablePromptCaching, {
    skipGlobalCacheForSystemPrompt: needsToolBasedCacheMarker,
    querySource: options.querySource,
  })
  const useBetas = betas.length > 0

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

  let cacheEditingHeaderLatched = getCacheEditingHeaderLatched() === true
  if (feature('CACHED_MICROCOMPACT')) {
    if (
      !cacheEditingHeaderLatched &&
      cachedMCEnabled &&
      getAPIProvider() === 'firstParty' &&
      options.querySource === 'repl_main_thread'
    ) {
      cacheEditingHeaderLatched = true
      setCacheEditingHeaderLatched(true)
    }
  }

  const effort = resolveAppliedEffort(options.model, options.effortValue)
  // densable Ie — string effort level from last request's output_config.effort
  // stamped onto every AssistantMessage for transcript persistence (#44).
  // Numeric effort_override (ant-only) is intentionally NOT recorded.
  let effortLevelForTranscript: EffortLevel | undefined

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
      cachedMCEnabled: cacheEditingHeaderLatched,
      effortValue: effort,
      extraBodyParams: getExtraBodyParams(),
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

  // Consume pending cache edits ONCE before paramsFromContext is defined.
  // paramsFromContext is called multiple times (logging, retries), so consuming
  // inside it would cause the first call to steal edits from subsequent calls.
  const consumedCacheEdits = cachedMCEnabled ? consumePendingCacheEdits() : null
  const consumedPinnedEdits = cachedMCEnabled ? getPinnedCacheEdits() : []

  // Capture the betas sent in the last API request, including the ones that
  // were dynamically added, so we can log and send it to telemetry.
  let lastRequestBetas: string[] | undefined

  const paramsFromContext = (retryContext: RetryContext) => {
    const betasParams = [...betas]

    // Append 1M beta dynamically for the Sonnet 1M experiment.
    if (
      !betasParams.includes(CONTEXT_1M_BETA_HEADER) &&
      getSonnet1mExpTreatmentEnabled(retryContext.model)
    ) {
      betasParams.push(CONTEXT_1M_BETA_HEADER)
    }

    // For Bedrock, include model-based betas (no tool search header — self-built search)
    const bedrockBetas =
      getAPIProvider() === 'bedrock'
        ? [...getBedrockExtraBodyParamsBetas(retryContext.model)]
        : []
    const extraBodyParams = getExtraBodyParams(bedrockBetas)

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

    configureTaskBudgetParams(
      options.taskBudget,
      outputConfig as BetaOutputConfig & { task_budget?: TaskBudgetParam },
      betasParams,
    )

    // Merge outputFormat into extraBodyParams.output_config alongside effort
    // Requires structured-outputs beta header per SDK (see parse() in messages.mjs)
    if (options.outputFormat && !('format' in outputConfig)) {
      outputConfig.format = options.outputFormat as BetaJSONOutputFormat
      // Add beta header if not already present and provider supports it
      if (
        modelSupportsStructuredOutputs(options.model) &&
        !betasParams.includes(STRUCTURED_OUTPUTS_BETA_HEADER)
      ) {
        betasParams.push(STRUCTURED_OUTPUTS_BETA_HEADER)
      }
    }

    // Retry context gets preference because it tries to course correct if we exceed the context window limit
    const maxOutputTokens =
      retryContext?.maxTokensOverride ||
      options.maxOutputTokensOverride ||
      getMaxOutputTokensForModel(options.model)

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
    let thinking: BetaMessageStreamParams['thinking'] | undefined

    // IMPORTANT: Do not change the adaptive-vs-budget thinking selection below
    // without notifying the model launch DRI and research. This is a sensitive
    // setting that can greatly affect model quality and bashing.
    //
    // densable HQt (rejects_disabled_thinking): when config is disabled, densable
    // does NOT send {type:'disabled'} for those models (Bo stays undefined;
    // server defaults adaptive). Local historically omits the field whenever
    // hasThinking is false (no densable firstParty explicit-disabled branch) —
    // keep that shape. HQt is enforced on sideQuery/classifier paths that
    // would otherwise send disabled, and on tool_choice demotion below.
    if (hasThinking && modelSupportsThinking(options.model)) {
      if (
        !adaptiveThinkingDisabled &&
        modelSupportsAdaptiveThinking(options.model)
      ) {
        // For models that support adaptive thinking, always use adaptive
        // thinking without a budget.
        thinking = {
          type: 'adaptive',
        } satisfies BetaMessageStreamParams['thinking']
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
        thinkingBudget = Math.min(maxOutputTokens - 1, thinkingBudget)
        thinking = {
          budget_tokens: thinkingBudget,
          type: 'enabled',
        } satisfies BetaMessageStreamParams['thinking']
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

    // Get API context management strategies if enabled
    const contextManagement = getAPIContextManagement({
      hasThinking,
      isRedactThinkingActive: betasParams.includes(REDACT_THINKING_BETA_HEADER),
      clearAllThinking: false,
    })

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

    // Cache editing beta: header is latched session-stable; useCachedMC
    // (controls cache_edits body behavior) stays live so edits stop when
    // the feature disables but the header doesn't flip.
    const useCachedMC =
      cachedMCEnabled &&
      getAPIProvider() === 'firstParty' &&
      options.querySource === 'repl_main_thread'
    if (
      cacheEditingHeaderLatched &&
      cacheEditingBetaHeader &&
      getAPIProvider() === 'firstParty' &&
      options.querySource === 'repl_main_thread' &&
      !betasParams.includes(cacheEditingBetaHeader)
    ) {
      betasParams.push(cacheEditingBetaHeader)
      logForDebugging(
        'Cache editing beta header enabled for cached microcompact',
      )
    }

    // Only send temperature when thinking is disabled — the API requires
    // temperature: 1 when thinking is enabled, which is already the default.
    const temperature = !hasThinking
      ? (options.temperatureOverride ?? 1)
      : undefined

    // Filter out any empty-string beta headers before sending.
    // Constants like CACHE_EDITING_BETA_HEADER or AFK_MODE_BETA_HEADER
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
    // Official: send betas when useBetas and (!simulate || remaining > 0)
    const sendBetas = useBetas && (!simulateProxy || filteredBetas.length > 0)

    // densable: Ie = typeof ra === "string" && MPe(ra) ? ra : void 0
    // Capture wire string effort for transcript stamping on assistant msgs.
    effortLevelForTranscript = transcriptEffortFromOutputConfig(outputConfig)

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

    return {
      model: normalizeModelStringForAPI(options.model),
      messages: addCacheBreakpoints(
        messagesForAPI,
        enablePromptCaching,
        options.querySource,
        useCachedMC,
        consumedCacheEdits as any,
        consumedPinnedEdits as any,
        options.skipCacheWrite,
      ),
      system,
      tools: allTools,
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
    agentContext: getAgentContext(),
    isBackgroundAgent: options.isBackgroundAgent,
    agentId: options.agentId,
  })

  // densable 2.1.232 #26 — Tn/oo thinking-only stream re-loop (Po=1, sr=2)
  let thinkingOnlyWatchdogRetryCount = 0
  let thinkingOnlyStaleRetryCount = 0

  // densable labeled stream loop (`e:`): withRetry + for-await + partial path.
  while (true) {
    try {
      try {
        queryCheckpoint('query_client_creation_start')
        const generator = withRetry(
          () =>
            getAnthropicClient({
              maxRetries: 0, // Disabled auto-retry in favor of manual implementation
              model: options.model,
              fetchOverride: options.fetchOverride,
              source: options.querySource,
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
            captureAPIRequest(params, options.querySource) // Capture for bug reports

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
        let messageDeltaCompleted = false
        let openContentBlockIndex: number | null = null
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
          const { ADVISOR_STALL_POLL_MS, resolveAdvisorStallGraceMs } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../utils/advisorNetworkStall.js') as typeof import('../../utils/advisorNetworkStall.js')
          stallPollMs = ADVISOR_STALL_POLL_MS
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
          streamIdleTimer = setTimeout(() => {
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
        try {
          // stream in and accumulate state
          let isFirstChunk = true
          let lastEventTime: number | null = null // Set after first chunk to avoid measuring TTFB as a stall
          const STALL_THRESHOLD_MS = 30_000 // 30 seconds
          let totalStallTime = 0
          let stallCount = 0

          // densable Tfb(Ne, So) — synthetic keep-alive pings when body bytes advance
          // without SSE events (custom gateway / ANTHROPIC_BASE_URL proxies).
          for await (const partOrPing of withStreamKeepAlivePings(
            stream,
            chunkTimes,
          )) {
            // densable Gi() then _0r(us) → yield stream_event + continue
            resetStreamIdleTimer()
            if (isStreamPingEvent(partOrPing)) {
              yield {
                type: 'stream_event',
                event: partOrPing,
              } as StreamEvent
              continue
            }
            const part = partOrPing
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
                partialMessage = part.message
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
                if (!contentBlock) {
                  logEvent('tengu_streaming_error', {
                    error_type:
                      'content_block_not_found_delta' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    part_type:
                      part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    part_index: part.index,
                  })
                  throw new RangeError('Content block not found')
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
                    case 'citations_delta':
                      // TODO: handle citations
                      break
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
                    case 'thinking_delta':
                      if (contentBlock.type !== 'thinking') {
                        logEvent('tengu_streaming_error', {
                          error_type:
                            'content_block_type_mismatch_thinking_delta' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          expected_type:
                            'thinking' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          actual_type:
                            contentBlock.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        })
                        throw new Error('Content block is not a thinking block')
                      }
                      ;(contentBlock as { thinking: string }).thinking +=
                        delta.thinking
                      break
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
                // densable: To=!1, at=null
                messageDeltaCompleted = false
                openContentBlockIndex = null
                const contentBlock = contentBlocks[part.index]
                if (!contentBlock) {
                  logEvent('tengu_streaming_error', {
                    error_type:
                      'content_block_not_found_stop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    part_type:
                      part.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    part_index: part.index,
                  })
                  throw new RangeError('Content block not found')
                }
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
                const m: AssistantMessage = {
                  message: {
                    ...partialMessage,
                    usage: { ...usage },
                    content: normalizeContentFromAPI(
                      [contentBlock] as BetaContentBlock[],
                      tools,
                      options.agentId,
                    ) as MessageContent,
                  },
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
                }
                newMessages.push(m)
                yield m
                break
              }
              case 'message_delta': {
                usage = updateUsage(usage, part.usage)
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

                // Write final usage and stop_reason back to ALL yielded messages.
                // densable: for (let Qo of ve) Qo.message.usage=tt, stop_reason=wt
                // Messages are created at content_block_stop from partialMessage
                // (output_tokens: 0, stop_reason: null). message_delta arrives
                // after with the real cumulative values.
                //
                // IMPORTANT: Use direct property mutation, not object replacement.
                // The transcript write queue holds a reference to message.message
                // and serializes it lazily (100ms flush interval). Object
                // replacement ({ ...lastMsg.message, usage }) would disconnect
                // the queued reference; direct mutation ensures the transcript
                // captures the final values.
                stopReason = part.delta.stop_reason
                // densable: if(Br=us.delta.stop_reason, Br!==null) To=!0
                if (stopReason != null) {
                  messageDeltaCompleted = true
                }

                for (const msg of newMessages) {
                  msg.message.usage = usage
                  msg.message.stop_reason = stopReason
                }

                // densable G2s — mint fallback_credit_token from stop_details once
                try {
                  const delta = part.delta as {
                    stop_details?: unknown & {
                      fallback_credit_token?: unknown
                    }
                  }
                  if (delta.stop_details !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { planFallbackCreditMint } =
                      require('../../utils/refusalFallback.js') as typeof import('../../utils/refusalFallback.js')
                    const mint = planFallbackCreditMint({
                      stopDetails: delta.stop_details,
                      alreadyMinted: fallbackCreditMinted,
                    })
                    // scrub token from live delta (privacy; densable deletes in place)
                    if (
                      typeof delta.stop_details === 'object' &&
                      delta.stop_details !== null &&
                      'fallback_credit_token' in delta.stop_details
                    ) {
                      delete (
                        delta.stop_details as {
                          fallback_credit_token?: unknown
                        }
                      ).fallback_credit_token
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
                      {
                        activeMcpServer: options.activeMcpServer,
                        activeMcpTool: options.activeMcpTool,
                      },
                    )
                  }
                }

                const refusalMessage = getErrorMessageIfRefusal(
                  part.delta.stop_reason,
                  options.model,
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
                      } else {
                        const flow = await runRefusalFallbackDialogFlow({
                          decision: {
                            isMainThread,
                            requestDialog: options.requestDialog,
                            silentAttempt,
                            // Setting not fully plumbed; silentAttempt drives OXl silent_ab.
                            // No-dialog-host still auto-switches via Gi default.
                            switchModelsOnFlag: false,
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
                      {
                        activeMcpServer: options.activeMcpServer,
                        activeMcpTool: options.activeMcpTool,
                      },
                    )
                  }
                }
                break
            }

            yield {
              type: 'stream_event',
              event: part,
              ...(part.type === 'message_start' ? { ttftMs } : undefined),
            }
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

          // Detect when the stream completed without producing any assistant messages.
          // This covers two proxy failure modes:
          // 1. No events at all (!partialMessage): proxy returned 200 with non-SSE body
          // 2. Partial events (partialMessage set but no content blocks completed AND
          //    no stop_reason received): proxy returned message_start but stream ended
          //    before content_block_stop and before message_delta with stop_reason
          // BetaMessageStream had the first check in _endRequest() but the raw Stream
          // does not - without it the generator silently returns no assistant messages,
          // causing "Execution error" in -p mode.
          // Note: We must check stopReason to avoid false positives. For example, with
          // structured output (--json-schema), the model calls a StructuredOutput tool
          // on turn 1, then on turn 2 responds with end_turn and no content blocks.
          // That's a legitimate empty response, not an incomplete stream.
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
            throw new Error('Stream ended without receiving any events')
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
            )
          }

          // Process fallback percentage header and quota status if available
          // streamResponse is set when the stream is created in the withRetry callback above
          // TypeScript's control flow analysis can't track that streamResponse is set in the callback
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          const resp = streamResponse as unknown as Response | undefined
          if (resp) {
            extractQuotaStatusFromHeaders(resp.headers)
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
        } catch (streamingError) {
          // Clear the idle timeout watchdog on error path too
          clearStreamIdleTimers()

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

          // densable 2.1.219 #7 — mid-stream partial finalize:
          // When assistant content was already yielded and the stream dies via
          // watchdog / stale-or-network connection / server api_error, keep the
          // partial text and append an isApiErrorMessage banner instead of
          // discarding it via non-streaming fallback (which would re-run tools).
          {
            const connDetails = extractConnectionErrorDetails(streamingError)
            const connCode = connDetails?.code
            const isStaleConn =
              connCode !== undefined &&
              STREAM_STALE_CONNECTION_CODES.has(connCode)
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
                        {
                          activeMcpServer: options.activeMcpServer,
                          activeMcpTool: options.activeMcpTool,
                        },
                      )
                    }
                  }
                  if (openContentBlockIndex !== null) {
                    yield {
                      type: 'stream_event',
                      event: {
                        type: 'content_block_stop',
                        index: openContentBlockIndex,
                      },
                    } as StreamEvent
                    openContentBlockIndex = null
                  }
                  yield {
                    type: 'stream_event',
                    event: { type: 'message_stop' },
                  } as StreamEvent
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
                return
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
              yield createAssistantAPIErrorMessage({
                content: incompleteBanner,
                apiError: 'server_error',
                error: 'server_error',
              })
              // densable `break e` — exit streaming successfully with partial kept
              return
            }
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
          const result = yield* executeNonStreamingRequest(
            { model: options.model, source: options.querySource },
            {
              model: options.model,
              fallbackModel: options.fallbackModel,
              thinkingConfig,
              ...(isFastModeEnabled() && { fastMode: isFastMode }),
              signal,
              initialConsecutive529Errors: is529Error(streamingError) ? 1 : 0,
              querySource: options.querySource,
            },
            paramsFromContext,
            (attempt, _startTime, tokens) => {
              attemptNumber = attempt
              maxOutputTokens = tokens
            },
            params => captureAPIRequest(params, options.querySource),
            streamRequestId,
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

          const m: AssistantMessage = {
            message: {
              ...result,
              content: normalizeContentFromAPI(
                nonStreamContent as typeof result.content,
                tools,
                options.agentId,
              ) as MessageContent,
            },
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
          }
          newMessages.push(m)
          fallbackMessage = m
          yield m
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
        // densable #26 thinking-only re-stream — bubble to streamAttempt loop.
        if (errorFromRetry instanceof ThinkingOnlyStreamRetryError) {
          throw errorFromRetry
        }
        // FallbackTriggeredError must propagate to query.ts, which performs the
        // actual model switch. Swallowing it here would turn the fallback into a
        // no-op — the user would just see "Model fallback triggered: X -> Y" as
        // an error message with no actual retry on the fallback model.
        if (errorFromRetry instanceof FallbackTriggeredError) {
          throw errorFromRetry
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
            const result = yield* executeNonStreamingRequest(
              { model: options.model, source: options.querySource },
              {
                model: options.model,
                fallbackModel: options.fallbackModel,
                thinkingConfig,
                ...(isFastModeEnabled() && { fastMode: isFastMode }),
                signal,
              },
              paramsFromContext,
              (attempt, _startTime, tokens) => {
                attemptNumber = attempt
                maxOutputTokens = tokens
              },
              params => captureAPIRequest(params, options.querySource),
              failedRequestId,
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

            const m: AssistantMessage = {
              message: {
                ...result,
                content: normalizeContentFromAPI(
                  nonStreamContent404 as typeof result.content,
                  tools,
                  options.agentId,
                ) as MessageContent,
              },
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
            }
            newMessages.push(m)
            fallbackMessage = m
            yield m
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
            {
              activeMcpServer: options.activeMcpServer,
              activeMcpTool: options.activeMcpTool,
            },
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
      throw streamAttemptError
    }
  } // streamAttempt

  // Mark all registered tools as sent to API so they become eligible for deletion
  if (feature('CACHED_MICROCOMPACT') && cachedMCEnabled) {
    markToolsSentToAPIState()
  }

  // Track the last requestId for the main conversation chain so shutdown
  // can send a cache eviction hint to inference. Exclude backgrounded
  // sessions (Ctrl+B) which share the repl_main_thread querySource but
  // run inside an agent context — they are independent conversation chains
  // whose cache should not be evicted when the foreground session clears.
  if (
    streamRequestId &&
    !getAgentContext() &&
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

  void options.getToolPermissionContext().then(permissionContext => {
    logAPISuccessAndDuration({
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
    })
  })

  // Defensive: also release on normal completion (no-op if finally already ran).
  releaseStreamResources()
}

/**
 * Cleans up stream resources to prevent memory leaks.
 * @internal Exported for testing
 */
export function cleanupStream(
  stream: Stream<BetaRawMessageStreamEvent> | undefined,
): void {
  if (!stream) {
    return
  }
  try {
    // Abort the stream via its controller if not already aborted
    if (!stream.controller.signal.aborted) {
      stream.controller.abort()
    }
  } catch {
    // Ignore - stream may already be closed
  }
}

/**
 * Updates usage statistics with new values from streaming API events.
 * Note: Anthropic's streaming API provides cumulative usage totals, not incremental deltas.
 * Each event contains the complete usage up to that point in the stream.
 *
 * Input-related tokens (input_tokens, cache_creation_input_tokens, cache_read_input_tokens)
 * are typically set in message_start and remain constant. message_delta events may send
 * explicit 0 values for these fields, which should not overwrite the values from message_start.
 * We only update these fields if they have a non-null, non-zero value.
 */
export function updateUsage(
  usage: Readonly<NonNullableUsage>,
  partUsage: BetaMessageDeltaUsage | undefined,
): NonNullableUsage {
  if (!partUsage) {
    return { ...usage }
  }
  return {
    input_tokens:
      partUsage.input_tokens !== null && partUsage.input_tokens > 0
        ? partUsage.input_tokens
        : usage.input_tokens,
    cache_creation_input_tokens:
      partUsage.cache_creation_input_tokens !== null &&
      partUsage.cache_creation_input_tokens > 0
        ? partUsage.cache_creation_input_tokens
        : usage.cache_creation_input_tokens,
    cache_read_input_tokens:
      partUsage.cache_read_input_tokens !== null &&
      partUsage.cache_read_input_tokens > 0
        ? partUsage.cache_read_input_tokens
        : usage.cache_read_input_tokens,
    output_tokens: partUsage.output_tokens ?? usage.output_tokens,
    server_tool_use: {
      web_search_requests:
        partUsage.server_tool_use?.web_search_requests ??
        usage.server_tool_use.web_search_requests,
      web_fetch_requests:
        partUsage.server_tool_use?.web_fetch_requests ??
        usage.server_tool_use.web_fetch_requests,
    },
    service_tier: usage.service_tier,
    cache_creation: {
      // SDK type BetaMessageDeltaUsage is missing cache_creation, but it's real!
      ephemeral_1h_input_tokens:
        (partUsage as BetaUsage).cache_creation?.ephemeral_1h_input_tokens ??
        usage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        (partUsage as BetaUsage).cache_creation?.ephemeral_5m_input_tokens ??
        usage.cache_creation.ephemeral_5m_input_tokens,
    },
    // cache_deleted_input_tokens: returned by the API when cache editing
    // deletes KV cache content, but not in SDK types. Kept off NonNullableUsage
    // so the string is eliminated from external builds by dead code elimination.
    // Uses the same > 0 guard as other token fields to prevent message_delta
    // from overwriting the real value with 0.
    ...(feature('CACHED_MICROCOMPACT')
      ? {
          cache_deleted_input_tokens:
            (partUsage as unknown as { cache_deleted_input_tokens?: number })
              .cache_deleted_input_tokens != null &&
            (partUsage as unknown as { cache_deleted_input_tokens: number })
              .cache_deleted_input_tokens > 0
              ? (partUsage as unknown as { cache_deleted_input_tokens: number })
                  .cache_deleted_input_tokens
              : ((usage as unknown as { cache_deleted_input_tokens?: number })
                  .cache_deleted_input_tokens ?? 0),
        }
      : {}),
    inference_geo: usage.inference_geo,
    iterations: partUsage.iterations ?? usage.iterations,
    speed: (partUsage as BetaUsage).speed ?? usage.speed,
  }
}

/**
 * Accumulates usage from one message into a total usage object.
 * Used to track cumulative usage across multiple assistant turns.
 */
export function accumulateUsage(
  totalUsage: Readonly<NonNullableUsage>,
  messageUsage: Readonly<NonNullableUsage>,
): NonNullableUsage {
  return {
    input_tokens: totalUsage.input_tokens + messageUsage.input_tokens,
    cache_creation_input_tokens:
      totalUsage.cache_creation_input_tokens +
      messageUsage.cache_creation_input_tokens,
    cache_read_input_tokens:
      totalUsage.cache_read_input_tokens + messageUsage.cache_read_input_tokens,
    output_tokens: totalUsage.output_tokens + messageUsage.output_tokens,
    server_tool_use: {
      web_search_requests:
        totalUsage.server_tool_use.web_search_requests +
        messageUsage.server_tool_use.web_search_requests,
      web_fetch_requests:
        totalUsage.server_tool_use.web_fetch_requests +
        messageUsage.server_tool_use.web_fetch_requests,
    },
    service_tier: messageUsage.service_tier, // Use the most recent service tier
    cache_creation: {
      ephemeral_1h_input_tokens:
        totalUsage.cache_creation.ephemeral_1h_input_tokens +
        messageUsage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens:
        totalUsage.cache_creation.ephemeral_5m_input_tokens +
        messageUsage.cache_creation.ephemeral_5m_input_tokens,
    },
    // See comment in updateUsage — field is not on NonNullableUsage to keep
    // the string out of external builds.
    ...(feature('CACHED_MICROCOMPACT')
      ? {
          cache_deleted_input_tokens:
            ((totalUsage as unknown as { cache_deleted_input_tokens?: number })
              .cache_deleted_input_tokens ?? 0) +
            ((
              messageUsage as unknown as { cache_deleted_input_tokens?: number }
            ).cache_deleted_input_tokens ?? 0),
        }
      : {}),
    inference_geo: messageUsage.inference_geo, // Use the most recent
    iterations: messageUsage.iterations, // Use the most recent
    speed: messageUsage.speed, // Use the most recent
  }
}

function isToolResultBlock(
  block: unknown,
): block is { type: 'tool_result'; tool_use_id: string } {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as { type: string }).type === 'tool_result' &&
    'tool_use_id' in block
  )
}

type CachedMCEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

type CachedMCPinnedEdits = {
  userMessageIndex: number
  block: CachedMCEditsBlock
}

// Exported for testing cache_reference placement constraints
export function addCacheBreakpoints(
  messages: (UserMessage | AssistantMessage | ApiSystemMessage)[],
  enablePromptCaching: boolean,
  querySource?: QuerySource,
  useCachedMC = false,
  newCacheEdits?: CachedMCEditsBlock | null,
  pinnedEdits?: CachedMCPinnedEdits[],
  skipCacheWrite = false,
): MessageParam[] {
  // densable Jdy: prefer cache_control on trailing nonempty api_system when
  // experimental betas live and promotion not demoted (Gri/Vme).
  const allowApiSystemCache = shouldCacheControlOnApiSystem()

  const isCacheableAssistant = (m: (typeof messages)[number]): boolean => {
    if (m.type !== 'assistant') return true
    const v = m.message.content
    if (typeof v === 'string') return true
    const last = Array.isArray(v) ? v.at(-1) : undefined
    return (
      last !== undefined &&
      last.type !== 'thinking' &&
      last.type !== 'redacted_thinking'
    )
  }
  const findCacheableIndex = (from: number): number => {
    let v = from
    while (
      v >= 0 &&
      (isApiSystemMessage(messages[v]!) || !isCacheableAssistant(messages[v]!))
    ) {
      v--
    }
    return v
  }
  let markerIndex = findCacheableIndex(messages.length - 1)
  if (skipCacheWrite) {
    markerIndex = findCacheableIndex(markerIndex - 1)
  }
  const last = messages[messages.length - 1]
  const trailingApiSystem =
    last !== undefined &&
    isApiSystemMessage(last) &&
    typeof last.message.content === 'string' &&
    last.message.content.trim() !== ''
  // densable: c && t && !n && l>=0 && p → prefer last index (api_system)
  if (
    allowApiSystemCache &&
    enablePromptCaching &&
    !skipCacheWrite &&
    markerIndex >= 0 &&
    trailingApiSystem
  ) {
    markerIndex = messages.length - 1
  }

  logEvent('tengu_api_cache_breakpoints', {
    totalMessageCount: messages.length,
    cachingEnabled: enablePromptCaching,
    skipCacheWrite,
  })

  const result = messages.map((msg, index) => {
    const addCache = index === markerIndex
    if (isApiSystemMessage(msg)) {
      // densable: role:"system" + optional cache_control on text block
      const text = msg.message.content
      if (addCache && enablePromptCaching && allowApiSystemCache) {
        return {
          role: 'system' as const,
          content: [
            {
              type: 'text' as const,
              text,
              cache_control: getCacheControl({ querySource }),
            },
          ],
        } as unknown as MessageParam
      }
      return {
        role: 'system' as const,
        content: text || [],
      } as unknown as MessageParam
    }
    if (msg.type === 'user') {
      return userMessageToMessageParam(
        msg,
        addCache,
        enablePromptCaching,
        querySource,
      )
    }
    return assistantMessageToMessageParam(
      msg,
      addCache,
      enablePromptCaching,
      querySource,
    )
  })

  if (!useCachedMC) {
    return result
  }

  // Track all cache_references being deleted to prevent duplicates across blocks.
  const seenDeleteRefs = new Set<string>()

  // Helper to deduplicate a cache_edits block against already-seen deletions
  const deduplicateEdits = (block: CachedMCEditsBlock): CachedMCEditsBlock => {
    const uniqueEdits = block.edits.filter(edit => {
      if (seenDeleteRefs.has(edit.cache_reference)) {
        return false
      }
      seenDeleteRefs.add(edit.cache_reference)
      return true
    })
    return { ...block, edits: uniqueEdits }
  }

  // Re-insert all previously-pinned cache_edits at their original positions
  for (const pinned of pinnedEdits ?? []) {
    const msg = result[pinned.userMessageIndex]
    if (msg && msg.role === 'user') {
      if (!Array.isArray(msg.content)) {
        msg.content = [{ type: 'text', text: msg.content as string }]
      }
      const dedupedBlock = deduplicateEdits(pinned.block)
      if (dedupedBlock.edits.length > 0) {
        insertBlockAfterToolResults(msg.content, dedupedBlock)
      }
    }
  }

  // Insert new cache_edits into the last user message and pin them
  if (newCacheEdits && result.length > 0) {
    const dedupedNewEdits = deduplicateEdits(newCacheEdits)
    if (dedupedNewEdits.edits.length > 0) {
      for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i]
        if (msg && msg.role === 'user') {
          if (!Array.isArray(msg.content)) {
            msg.content = [{ type: 'text', text: msg.content as string }]
          }
          insertBlockAfterToolResults(msg.content, dedupedNewEdits)
          // Pin so this block is re-sent at the same position in future calls
          pinCacheEdits(i, newCacheEdits as any)

          logForDebugging(
            `Added cache_edits block with ${dedupedNewEdits.edits.length} deletion(s) to message[${i}]: ${dedupedNewEdits.edits.map(e => e.cache_reference).join(', ')}`,
          )
          break
        }
      }
    }
  }

  // Add cache_reference to tool_result blocks that are within the cached prefix.
  // Must be done AFTER cache_edits insertion since that modifies content arrays.
  // Note: this code only runs when useCachedMC=true (early return at line ~3202).
  if (enablePromptCaching) {
    // Find the last message containing a cache_control marker
    let lastCCMsg = -1
    for (let i = 0; i < result.length; i++) {
      const msg = result[i]!
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === 'object' && 'cache_control' in block) {
            lastCCMsg = i
          }
        }
      }
    }

    // Add cache_reference to tool_result blocks that are strictly before
    // the last cache_control marker. The API requires cache_reference to
    // appear "before or on" the last cache_control — we use strict "before"
    // to avoid edge cases where cache_edits splicing shifts block indices.
    //
    // Create new objects instead of mutating in-place to avoid contaminating
    // blocks reused by secondary queries that use models without cache_editing support.
    if (lastCCMsg >= 0) {
      for (let i = 0; i < lastCCMsg; i++) {
        const msg = result[i]!
        if (msg.role !== 'user' || !Array.isArray(msg.content)) {
          continue
        }
        let cloned = false
        for (let j = 0; j < msg.content.length; j++) {
          const block = msg.content[j]
          if (block && isToolResultBlock(block)) {
            if (!cloned) {
              msg.content = [...msg.content]
              cloned = true
            }
            msg.content[j] = Object.assign({}, block, {
              cache_reference: block.tool_use_id,
            })
          }
        }
      }
    }
  }

  return result
}

export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: QuerySource
  },
): TextBlockParam[] {
  // IMPORTANT: Do not add any more blocks for caching or you will get a 400
  return splitSysPromptPrefix(systemPrompt, {
    skipGlobalCacheForSystemPrompt: options?.skipGlobalCacheForSystemPrompt,
  }).map(block => {
    return {
      type: 'text' as const,
      text: block.text,
      ...(enablePromptCaching &&
        block.cacheScope !== null && {
          cache_control: getCacheControl({
            scope: block.cacheScope,
            querySource: options?.querySource,
          }),
        }),
    }
  })
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
        thinkingConfig: { type: 'disabled' },
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
        thinkingConfig: { type: 'disabled' },
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

// Non-streaming requests have a 10min max per the docs:
// https://platform.claude.com/docs/en/api/errors#long-requests
// The SDK's 21333-token cap is derived from 10min × 128k tokens/hour, but we
// bypass it by setting a client-level timeout, so we can cap higher.
export const MAX_NON_STREAMING_TOKENS = 64_000

/**
 * Adjusts thinking budget when max_tokens is capped for non-streaming fallback.
 * Ensures the API constraint: max_tokens > thinking.budget_tokens
 *
 * @param params - The parameters that will be sent to the API
 * @param maxTokensCap - The maximum allowed tokens (MAX_NON_STREAMING_TOKENS)
 * @returns Adjusted parameters with thinking budget capped if needed
 */
export function adjustParamsForNonStreaming<
  T extends {
    max_tokens: number
    thinking?: BetaMessageStreamParams['thinking']
  },
>(params: T, maxTokensCap: number): T {
  const cappedMaxTokens = Math.min(params.max_tokens, maxTokensCap)

  // Adjust thinking budget if it would exceed capped max_tokens
  // to maintain the constraint: max_tokens > thinking.budget_tokens
  const adjustedParams = { ...params }
  if (
    adjustedParams.thinking?.type === 'enabled' &&
    adjustedParams.thinking.budget_tokens
  ) {
    adjustedParams.thinking = {
      ...adjustedParams.thinking,
      budget_tokens: Math.min(
        adjustedParams.thinking.budget_tokens,
        cappedMaxTokens - 1, // Must be at least 1 less than max_tokens
      ),
    }
  }

  return {
    ...adjustedParams,
    max_tokens: cappedMaxTokens,
  }
}

function isMaxTokensCapEnabled(): boolean {
  // 3P default: false (not validated on Bedrock/Vertex)
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_otk_slot_v1', false)
}

export function getMaxOutputTokensForModel(model: string): number {
  const maxOutputTokens = getModelMaxOutputTokens(model)

  // Slot-reservation cap: drop default to 8k for all models. BQ p99 output
  // = 4,911 tokens; 32k/64k defaults over-reserve 8-16× slot capacity.
  // Requests hitting the cap get one clean retry at 64k (query.ts
  // max_output_tokens_escalate). Math.min keeps models with lower native
  // defaults (e.g. claude-3-opus at 4k) at their native value. Applied
  // before the env-var override so CLAUDE_CODE_MAX_OUTPUT_TOKENS still wins.
  const defaultTokens = isMaxTokensCapEnabled()
    ? Math.min(maxOutputTokens.default, CAPPED_DEFAULT_MAX_TOKENS)
    : maxOutputTokens.default

  // Official MAX_OUTPUT_TOKENS densable: pure parse + bounded clamp, with
  // validateBoundedIntEnvVar fallback for logging side effects.
  try {
    const { resolveMaxOutputTokensOverride, clampMaxOutputTokensOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    const override = resolveMaxOutputTokensOverride()
    if (override === null) {
      return defaultTokens
    }
    return clampMaxOutputTokensOverride(
      override,
      defaultTokens,
      maxOutputTokens.upperLimit,
    ).effective
  } catch {
    const result = validateBoundedIntEnvVar(
      'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
      process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
      defaultTokens,
      maxOutputTokens.upperLimit,
    )
    return result.effective
  }
}
