import { feature } from 'bun:bundle'
import type Anthropic from '@anthropic-ai/sdk'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import type { QuerySource } from 'src/constants/querySource.js'
import type { SystemAPIErrorMessage } from 'src/types/message.js'
import {
  isAwsAuthMaterialError,
  isAwsCredentialsProviderError,
} from 'src/utils/aws.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { createSystemAPIErrorMessage } from 'src/utils/messages.js'
import { getAPIProviderForStatsig } from 'src/utils/model/providers.js'
import {
  isAnthropicAwsProviderEnabled,
  isMantleProviderEnabled,
} from 'src/utils/residualFinalEnvGates.js'
import {
  clearApiKeyHelperCache,
  clearAwsCredentialExportCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
  invalidateDefaultAwsProviderChainDebounced,
  isClaudeAISubscriber,
  isEnterpriseSubscriber,
} from '../../utils/auth.js'
import { getAWSRegion, isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import {
  isHostAuthTokenRefreshAvailable,
  tryHostAuth401Recovery,
} from '../../utils/hostCredsFile.js'
import {
  type CooldownReason,
  handleFastModeOverageRejection,
  handleFastModeRejectedByAPI,
  isFastModeCooldown,
  isFastModeEnabled,
  triggerFastModeCooldown,
} from '../../utils/fastMode.js'
import { handleFoundryCapabilityError } from '../../utils/foundryCapabilities.js'
import { isNonCustomOpusModel } from '../../utils/model/model.js'
import { disableKeepAlive } from '../../utils/proxy.js'
import { sleep } from '../../utils/sleep.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  checkMockRateLimitError,
  isMockRateLimitError,
} from '../rateLimitMocking.js'
import { REPEATED_529_ERROR_MESSAGE } from './errors.js'
import { extractConnectionErrorDetails } from './errorUtils.js'

const abortError = () => new APIUserAbortError()

const DEFAULT_MAX_RETRIES = 10
/** densable rrp — minimum output tokens before overflow retry is viable */
export const FLOOR_OUTPUT_TOKENS = 3000
const MAX_529_RETRIES = 3
export const BASE_DELAY_MS = 500
/**
 * densable 2.1.228 #14 — `x6S=2` / `k6S=2` auth-refresh caps.
 * Without a hard cap, Vertex/GCP (and AWS) credential failures can retry
 * through the full maxRetries budget (seconds→minutes). densable exhausts
 * after 2 cloud-auth attempts and throws CannotRetryError.
 */
export const MAX_CLOUD_AUTH_RETRIES = 2

/**
 * densable 2.1.218 RFo overflow pure decision core.
 * Sets max_tokens to availableContext only (no thinking-budget inflate) and
 * rejects when a prior override would not strictly decrease.
 */
export function decideMaxTokensOverflowAdjustment(
  availableContext: number,
  previousOverride: number | undefined,
  floorOutputTokens: number = FLOOR_OUTPUT_TOKENS,
):
  | { action: 'set'; maxTokens: number }
  | { action: 'throw'; reason: 'below_floor' | 'no_progress' } {
  if (availableContext < floorOutputTokens) {
    return { action: 'throw', reason: 'below_floor' }
  }
  // densable: let W = availableContext (no minRequired / thinking inflate)
  const W = availableContext
  if (previousOverride !== undefined && W >= previousOverride) {
    return { action: 'throw', reason: 'no_progress' }
  }
  return { action: 'set', maxTokens: W }
}

// densable 2.1.212 swh — FOREGROUND_529 set used by O6t(shouldRetry529).
// Web tool side-queries (web_search_tool / web_fetch_apply) MUST be here so
// 529/429 get bounded backoff instead of background-dropped (#35).
const FOREGROUND_529_RETRY_SOURCES = new Set<QuerySource>([
  'repl_main_thread',
  'repl_main_thread:outputStyle:custom',
  'repl_main_thread:outputStyle:Proactive',
  'repl_main_thread:outputStyle:Explanatory',
  'repl_main_thread:outputStyle:Learning',
  'sdk',
  'agent:custom',
  'agent:default',
  'agent:builtin',
  'compact',
  'hook_agent',
  'hook_prompt',
  'side_question',
  'web_search_tool',
  'web_fetch_apply',
  'repl_sampling',
  'auto_mode',
  'compact_fab_check',
  'auto_mode_critique',
  'auto_mode_setup_propose',
  'chrome_mcp',
  // Local extras (not in densable swh; keep for product paths):
  'verification_agent',
  // Security classifiers — must complete for auto-mode correctness.
  // bash_classifier is ant-only; feature-gate so the string tree-shakes out
  // of external builds (excluded-strings.txt).
  ...(feature('BASH_CLASSIFIER') ? (['bash_classifier'] as const) : []),
])

/**
 * densable O6t — should this querySource retry 529 with bounded backoff?
 * undefined → true; agent:* → true; else swh.has(source).
 */
export function shouldRetry529(querySource: QuerySource | undefined): boolean {
  if (querySource === undefined) return true
  // densable: all agent: prefixes retry (agent:custom:foo → agent:custom via qb
  // is separate; O6t itself uses startsWith("agent:")).
  if (querySource.startsWith('agent:')) return true
  return FOREGROUND_529_RETRY_SOURCES.has(querySource)
}

// CLAUDE_CODE_UNATTENDED_RETRY: for unattended sessions (ant-only). Retries 429/529
// indefinitely with higher backoff and periodic keep-alive yields so the host
// environment does not mark the session idle mid-wait.
// TODO(ANT-344): the keep-alive via SystemAPIErrorMessage yields is a stopgap
// until there's a dedicated keep-alive channel.
const PERSISTENT_MAX_BACKOFF_MS = 5 * 60 * 1000
const PERSISTENT_RESET_CAP_MS = 6 * 60 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 30_000

function isPersistentRetryEnabled(): boolean {
  if (!feature('UNATTENDED_RETRY')) return false
  // Official UNATTENDED_RETRY densable.
  try {
    const { isUnattendedRetryEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    return isUnattendedRetryEnvEnabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_UNATTENDED_RETRY)
  }
}

function isTransientCapacityError(error: unknown): boolean {
  return (
    is529Error(error) || (error instanceof APIError && error.status === 429)
  )
}

/**
 * densable Cye / Goe base — codes treated as stale keep-alive / dead pooled socket.
 * densable EYy: APIConnectionError + T2(code) ∈ Cye → disableKeepAlive + reconnect.
 */
const STALE_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ConnectionClosed',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ERR_SOCKET_CLOSED',
  'StreamSuspended',
])

/** densable EYy / 2.1.214 #18+#46 */
function isStaleConnectionError(error: unknown): boolean {
  if (!(error instanceof APIConnectionError)) {
    return false
  }
  const details = extractConnectionErrorDetails(error)
  return details !== null && STALE_CONNECTION_CODES.has(details.code)
}

/**
 * densable g3b — TLS/stale connection that may need mTLS cert rotation reload.
 * Cye ∪ {EPROTO, FailedToOpenSocket, ERR_OSSL_*, ERR_SSL_*}.
 */
function isMtlsStaleTlsConnectionError(error: unknown): boolean {
  if (!(error instanceof APIConnectionError)) {
    return false
  }
  const details = extractConnectionErrorDetails(error)
  if (!details) return false
  const code = details.code
  if (STALE_CONNECTION_CODES.has(code)) return true
  if (code === 'EPROTO' || code === 'FailedToOpenSocket') return true
  return code.startsWith('ERR_OSSL_') || code.startsWith('ERR_SSL_')
}

export interface RetryContext {
  maxTokensOverride?: number
  model: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
}

interface RetryOptions {
  maxRetries?: number
  model: string
  fallbackModel?: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
  signal?: AbortSignal
  querySource?: QuerySource
  /**
   * Pre-seed the consecutive 529 counter. Used when this retry loop is a
   * non-streaming fallback after a streaming 529 — the streaming 529 should
   * count toward MAX_529_RETRIES so total 529s-before-fallback is consistent
   * regardless of which request mode hit the overload.
   */
  initialConsecutive529Errors?: number
}

export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    const message = errorMessage(originalError)
    super(message)
    this.name = 'RetryError'

    // Preserve the original stack trace if available
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}

/**
 * Official densable dXH — model switch for query.ts retry.
 * reason defaults to "overloaded" (529 capacity path); "model_not_found"
 * is the permanent primary-model failure that yields system/model_fallback.
 */
export type FallbackTriggeredReason = 'overloaded' | 'model_not_found'

export class FallbackTriggeredError extends Error {
  public readonly reason: FallbackTriggeredReason

  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
    reason: FallbackTriggeredReason = 'overloaded',
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
    this.reason = reason
  }
}

/**
 * Official qF3 — 404 not_found_error whose body mentions model:.
 * Permanent primary-model failure (retired / does not exist).
 */
/**
 * densable vi() → "retry:mid-conv-system" / "retry:api-system-cache-demote".
 * Thrown from the stream create path after latching sticky state so withRetry
 * immediately re-enters with rewritten messages/betas (no delay).
 */
export class MidConvSystemRetryError extends Error {
  constructor(
    public readonly reason: 'mid-conv-system' | 'api-system-cache-demote',
  ) {
    super(`retry:${reason}`)
    this.name = 'MidConvSystemRetryError'
  }
}

export function isModelNotFoundAPIError(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 404) {
    return false
  }
  const message = error.message ?? ''
  const body =
    error.error && typeof error.error === 'object'
      ? (error.error as { type?: unknown; message?: unknown })
      : undefined
  const bodyType = typeof body?.type === 'string' ? body.type : undefined
  const bodyMessage =
    typeof body?.message === 'string' ? body.message : undefined
  // Official densable qF3: (type not_found_error OR message embeds it)
  // AND message includes "model:" (API: `model: <name>`).
  const isNotFound =
    bodyType === 'not_found_error' ||
    message.includes('"type":"not_found_error"') ||
    message.includes('"type": "not_found_error"')
  const mentionsModel =
    message.includes('model:') ||
    (bodyMessage !== undefined && bodyMessage.includes('model:'))
  return isNotFound && mentionsModel
}

export async function* withRetry<T>(
  getClient: () => Promise<Anthropic>,
  operation: (
    client: Anthropic,
    attempt: number,
    context: RetryContext,
  ) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T> {
  const maxRetries = getMaxRetries(options)
  const retryContext: RetryContext = {
    model: options.model,
    thinkingConfig: options.thinkingConfig,
    ...(isFastModeEnabled() && { fastMode: options.fastMode }),
  }
  let client: Anthropic | null = null
  let consecutive529Errors = options.initialConsecutive529Errors ?? 0
  let lastError: unknown
  let persistentAttempt = 0
  // densable 2.1.228 #14: cap GCP/AWS auth refresh retries (x6S/k6S = 2)
  let awsAuthRetryCount = 0
  let gcpAuthRetryCount = 0
  // densable y3b `h` — report mTLS material failure analytics at most once
  let mtlsReloadFailureReported = false
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new APIUserAbortError()
    }

    // Capture whether fast mode is active before this attempt
    // (fallback may change the state mid-loop)
    const wasFastModeActive = isFastModeEnabled()
      ? retryContext.fastMode && !isFastModeCooldown()
      : false

    try {
      // Check for mock rate limits (used by /mock-limits command for Ant employees)
      if (process.env.USER_TYPE === 'ant') {
        const mockError = checkMockRateLimitError(
          retryContext.model,
          wasFastModeActive,
        )
        if (mockError) {
          throw mockError
        }
      }

      // Get a fresh client instance on first attempt or after authentication errors
      // - 401 for first-party API authentication failures
      // - 403 "OAuth token has been revoked" (another process refreshed the token)
      // - Bedrock-specific auth errors (403 or CredentialsProviderError)
      // - Vertex-specific auth errors (credential refresh failures, 401)
      // densable 214 #46: always disable keep-alive on stale socket (no GB gate)
      const isStaleConnection = isStaleConnectionError(lastError)
      if (isStaleConnection) {
        logForDebugging('Stale connection — disabling keep-alive for retry')
        disableKeepAlive()
      }

      // densable 2.1.232 #24 / y3b: on TLS stale errors, reload rotated client certs
      let mtlsReloadAttempted = false
      if (isMtlsStaleTlsConnectionError(lastError)) {
        const { tryReloadMtlsOnStaleTlsConnection } = await import(
          '../../utils/mtls.js'
        )
        const mtls = await tryReloadMtlsOnStaleTlsConnection({
          reportFailure: !mtlsReloadFailureReported,
          onMaterialChanged: () => {
            // densable bqe()+ece() — drop pooled agents so new cert is used
            disableKeepAlive()
          },
          logEventOk: () => {
            logEvent(
              'tengu_api_mtls_cert_reload' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              {},
            )
          },
          logEventBad: code => {
            logEvent(
              'tengu_api_mtls_cert_reload_bad' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              {
                error_code:
                  code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              },
            )
          },
        })
        mtlsReloadAttempted = mtls.attempted
        if (mtls.reportedFailure) {
          mtlsReloadFailureReported = true
        }
      }

      if (
        client === null ||
        (lastError instanceof APIError && lastError.status === 401) ||
        isOAuthTokenRevokedError(lastError) ||
        isBedrockAuthError(lastError) ||
        isVertexAuthError(lastError) ||
        isStaleConnection ||
        mtlsReloadAttempted
      ) {
        // On 401 "token expired" or 403 "token revoked", force a token refresh
        if (
          (lastError instanceof APIError && lastError.status === 401) ||
          isOAuthTokenRevokedError(lastError)
        ) {
          const failedAccessToken = getClaudeAIOAuthTokens()?.accessToken
          if (failedAccessToken) {
            await handleOAuth401Error(failedAccessToken)
          } else if (
            lastError instanceof APIError &&
            lastError.status === 401 &&
            isHostAuthTokenRefreshAvailable()
          ) {
            // Official lfa / host_auth_401_recovery — desktop host-creds path.
            const hostResult = await tryHostAuth401Recovery()
            if (hostResult === 'failed' || hostResult === 'exhausted') {
              throw lastError
            }
          }
        }
        client = await getClient()
      }

      return await operation(client, attempt, retryContext)
    } catch (error) {
      lastError = error

      // densable mid-conv sticky retry — already latched; re-enter immediately.
      if (error instanceof MidConvSystemRetryError) {
        logForDebugging(
          `API mid-conv retry (${error.reason}) attempt ${attempt}/${maxRetries + 1}`,
          { level: 'warn' },
        )
        continue
      }

      logForDebugging(
        `API error (attempt ${attempt}/${maxRetries + 1}): ${error instanceof APIError ? `${error.status} ${error.message}` : errorMessage(error)}`,
        { level: 'error' },
      )

      // densable xco/uns — learn Foundry unsupported capabilities from 400s and
      // retry after strip (tool_search / structured_outputs). Empty map → no-op.
      const foundryCapRetry = handleFoundryCapabilityError(error, options.model)
      if (foundryCapRetry?.startsWith('retry:foundry-capability-strip:')) {
        logForDebugging(
          `Foundry capability strip retry (${foundryCapRetry}) attempt ${attempt}/${maxRetries + 1}`,
          { level: 'warn' },
        )
        continue
      }

      // Official densable: permanent model_not_found → FallbackTriggeredError
      // with reason (before capacity/529 retry path). Host gets system/model_fallback.
      if (
        isModelNotFoundAPIError(error) &&
        options.fallbackModel &&
        options.fallbackModel !== options.model
      ) {
        logEvent('tengu_api_model_not_found_fallback_triggered', {
          original_model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fallback_model:
            options.fallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          provider: getAPIProviderForStatsig(),
        })
        throw new FallbackTriggeredError(
          options.model,
          options.fallbackModel,
          'model_not_found',
        )
      }

      // Fast mode fallback: on 429/529, either wait and retry (short delays)
      // or fall back to standard speed (long delays) to avoid cache thrashing.
      // Skip in persistent mode: the short-retry path below loops with fast
      // mode still active, so its `continue` never reaches the attempt clamp
      // and the for-loop terminates. Persistent sessions want the chunked
      // keep-alive path instead of fast-mode cache-preservation anyway.
      if (
        wasFastModeActive &&
        !isPersistentRetryEnabled() &&
        error instanceof APIError &&
        (error.status === 429 || is529Error(error))
      ) {
        // If the 429 is specifically because extra usage (overage) is not
        // available, permanently disable fast mode with a specific message.
        const overageReason = error.headers?.get(
          'anthropic-ratelimit-unified-overage-disabled-reason',
        )
        if (overageReason !== null && overageReason !== undefined) {
          handleFastModeOverageRejection(overageReason)
          retryContext.fastMode = false
          continue
        }

        const retryAfterMs = getRetryAfterMs(error)
        if (retryAfterMs !== null && retryAfterMs < SHORT_RETRY_THRESHOLD_MS) {
          // Short retry-after: wait and retry with fast mode still active
          // to preserve prompt cache (same model name on retry).
          await sleep(retryAfterMs, options.signal, { abortError })
          continue
        }
        // Long or unknown retry-after: enter cooldown (switches to standard
        // speed model), with a minimum floor to avoid flip-flopping.
        const cooldownMs = Math.max(
          retryAfterMs ?? DEFAULT_FAST_MODE_FALLBACK_HOLD_MS,
          MIN_COOLDOWN_MS,
        )
        const cooldownReason: CooldownReason = is529Error(error)
          ? 'overloaded'
          : 'rate_limit'
        triggerFastModeCooldown(Date.now() + cooldownMs, cooldownReason)
        if (isFastModeEnabled()) {
          retryContext.fastMode = false
        }
        continue
      }

      // Fast mode fallback: if the API rejects the fast mode parameter
      // (e.g., org doesn't have fast mode enabled), permanently disable fast
      // mode and retry at standard speed.
      if (wasFastModeActive && isFastModeNotEnabledError(error)) {
        handleFastModeRejectedByAPI()
        retryContext.fastMode = false
        continue
      }

      // Non-foreground sources bail immediately on 529 — no retry amplification
      // during capacity cascades. User never sees these fail.
      if (is529Error(error) && !shouldRetry529(options.querySource)) {
        logEvent('tengu_api_529_background_dropped', {
          query_source:
            options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw new CannotRetryError(error, retryContext)
      }

      // Track consecutive 529 errors
      if (
        is529Error(error) &&
        // If FALLBACK_FOR_ALL_PRIMARY_MODELS is not set, fall through only if the primary model is a non-custom Opus model.
        // TODO: Revisit if the isNonCustomOpusModel check should still exist, or if isNonCustomOpusModel is a stale artifact of when Claude Code was hardcoded on Opus.
        (process.env.FALLBACK_FOR_ALL_PRIMARY_MODELS ||
          (!isClaudeAISubscriber() && isNonCustomOpusModel(options.model)))
      ) {
        consecutive529Errors++
        if (consecutive529Errors >= MAX_529_RETRIES) {
          // Check if fallback model is specified
          if (options.fallbackModel) {
            logEvent('tengu_api_opus_fallback_triggered', {
              original_model:
                options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fallback_model:
                options.fallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              provider: getAPIProviderForStatsig(),
            })

            // Throw special error to indicate fallback was triggered
            throw new FallbackTriggeredError(
              options.model,
              options.fallbackModel,
            )
          }

          if (
            process.env.USER_TYPE === 'external' &&
            !process.env.IS_SANDBOX &&
            !isPersistentRetryEnabled()
          ) {
            logEvent('tengu_api_custom_529_overloaded_error', {})
            throw new CannotRetryError(
              new Error(REPEATED_529_ERROR_MESSAGE),
              retryContext,
            )
          }
        }
      }

      // Only retry if the error indicates we should
      const persistent =
        isPersistentRetryEnabled() && isTransientCapacityError(error)
      if (attempt > maxRetries && !persistent) {
        throw new CannotRetryError(error, retryContext)
      }

      // densable 2.1.228 #14: fail-fast on repeated cloud auth failures.
      // Host-managed auth (`m2r`) can keep refreshing; skip the hard cap then.
      const hostManagedAuth = isHostAuthTokenRefreshAvailable()
      if (!hostManagedAuth && isBedrockAuthError(error)) {
        if (awsAuthRetryCount >= MAX_CLOUD_AUTH_RETRIES) {
          logEvent('api_request_aws_auth_exhausted', {})
          throw new CannotRetryError(error, retryContext)
        }
        awsAuthRetryCount++
      }
      if (!hostManagedAuth && isVertexAuthError(error)) {
        if (gcpAuthRetryCount >= MAX_CLOUD_AUTH_RETRIES) {
          logEvent('api_request_gcp_auth_exhausted', {})
          throw new CannotRetryError(error, retryContext)
        }
        gcpAuthRetryCount++
      }

      // AWS/GCP errors aren't always APIError, but can be retried
      const handledCloudAuthError =
        handleAwsCredentialError(error) || handleGcpCredentialError(error)
      if (
        !handledCloudAuthError &&
        (!(error instanceof APIError) || !shouldRetry(error))
      ) {
        throw new CannotRetryError(error, retryContext)
      }

      // Handle max tokens context overflow errors by adjusting max_tokens for the next attempt
      // NOTE: With extended-context-window beta, this 400 error should not occur.
      // The API now returns 'model_context_window_exceeded' stop_reason instead.
      // Keeping for backward compatibility.
      // densable 2.1.218 RFo: clamp to availableContext ONLY (no thinking inflate)
      // and abort when the adjustment makes no progress (doomed identical re-send).
      if (error instanceof APIError) {
        const overflowData = parseMaxTokensContextOverflowError(error)
        if (overflowData) {
          const { inputTokens, contextLimit } = overflowData

          const safetyBuffer = 1000
          const availableContext = Math.max(
            0,
            contextLimit - inputTokens - safetyBuffer,
          )
          const decision = decideMaxTokensOverflowAdjustment(
            availableContext,
            retryContext.maxTokensOverride,
          )
          if (decision.action === 'throw') {
            if (decision.reason === 'below_floor') {
              logError(
                new Error(
                  `availableContext ${availableContext} is less than FLOOR_OUTPUT_TOKENS ${FLOOR_OUTPUT_TOKENS}`,
                ),
              )
            } else {
              logError(
                new Error('max_tokens overflow adjustment made no progress'),
              )
            }
            throw error
          }
          const adjustedMaxTokens = decision.maxTokens
          retryContext.maxTokensOverride = adjustedMaxTokens

          logEvent('tengu_max_tokens_context_overflow_adjustment', {
            inputTokens,
            contextLimit,
            adjustedMaxTokens,
            attempt,
          })

          continue
        }
      }

      // For other errors, proceed with normal retry logic
      // Get retry-after header if available
      const retryAfter = getRetryAfter(error)
      let delayMs: number
      if (persistent && error instanceof APIError && error.status === 429) {
        persistentAttempt++
        // Window-based limits (e.g. 5hr Max/Pro) include a reset timestamp.
        // Wait until reset rather than polling every 5 min uselessly.
        const resetDelay = getRateLimitResetDelayMs(error)
        delayMs =
          resetDelay ??
          Math.min(
            getRetryDelay(
              persistentAttempt,
              retryAfter,
              PERSISTENT_MAX_BACKOFF_MS,
            ),
            PERSISTENT_RESET_CAP_MS,
          )
      } else if (persistent) {
        persistentAttempt++
        // Retry-After is a server directive and bypasses maxDelayMs inside
        // getRetryDelay (intentional — honoring it is correct). Cap at the
        // 6hr reset-cap here so a pathological header can't wait unbounded.
        delayMs = Math.min(
          getRetryDelay(
            persistentAttempt,
            retryAfter,
            PERSISTENT_MAX_BACKOFF_MS,
          ),
          PERSISTENT_RESET_CAP_MS,
        )
      } else {
        delayMs = getRetryDelay(attempt, retryAfter)
      }

      // In persistent mode the for-loop `attempt` is clamped at maxRetries+1;
      // use persistentAttempt for telemetry/yields so they show the true count.
      const reportedAttempt = persistent ? persistentAttempt : attempt
      logEvent('tengu_api_retry', {
        attempt: reportedAttempt,
        delayMs: delayMs,
        error: (error as APIError)
          .message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        status: (error as APIError).status,
        provider: getAPIProviderForStatsig(),
      })

      if (persistent) {
        if (delayMs > 60_000) {
          logEvent('tengu_api_persistent_retry_wait', {
            status: (error as APIError).status,
            delayMs,
            attempt: reportedAttempt,
            provider: getAPIProviderForStatsig(),
          })
        }
        // Chunk long sleeps so the host sees periodic stdout activity and
        // does not mark the session idle. Each yield surfaces as
        // {type:'system', subtype:'api_retry'} on stdout via QueryEngine.
        let remaining = delayMs
        while (remaining > 0) {
          if (options.signal?.aborted) throw new APIUserAbortError()
          if (error instanceof APIError) {
            yield createSystemAPIErrorMessage(
              error,
              remaining,
              reportedAttempt,
              maxRetries,
            )
          }
          const chunk = Math.min(remaining, HEARTBEAT_INTERVAL_MS)
          await sleep(chunk, options.signal, { abortError })
          remaining -= chunk
        }
        // Clamp so the for-loop never terminates. Backoff uses the separate
        // persistentAttempt counter which keeps growing to the 5-min cap.
        if (attempt >= maxRetries) attempt = maxRetries
      } else {
        if (error instanceof APIError) {
          yield createSystemAPIErrorMessage(error, delayMs, attempt, maxRetries)
        }
        await sleep(delayMs, options.signal, { abortError })
      }
    }
  }

  throw new CannotRetryError(lastError, retryContext)
}

function getRetryAfter(error: unknown): string | null {
  return (
    ((error as { headers?: { 'retry-after'?: string } }).headers?.[
      'retry-after'
    ] ||
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      ((error as APIError).headers as Headers)?.get?.('retry-after')) ??
    null
  )
}

export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }

  const baseDelay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), maxDelayMs)
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

function parseMaxTokensContextOverflowError(error: APIError):
  | {
      inputTokens: number
      maxTokens: number
      contextLimit: number
    }
  | undefined {
  if (error.status !== 400 || !error.message) {
    return undefined
  }

  if (
    !error.message.includes(
      'input length and `max_tokens` exceed context limit',
    )
  ) {
    return undefined
  }

  // Example format: "input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000"
  const regex =
    /input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/
  const match = error.message.match(regex)

  if (!match || match.length !== 4) {
    return undefined
  }

  if (!match[1] || !match[2] || !match[3]) {
    logError(
      new Error(
        'Unable to parse max_tokens from max_tokens exceed context limit error message',
      ),
    )
    return undefined
  }
  const inputTokens = parseInt(match[1], 10)
  const maxTokens = parseInt(match[2], 10)
  const contextLimit = parseInt(match[3], 10)

  if (isNaN(inputTokens) || isNaN(maxTokens) || isNaN(contextLimit)) {
    return undefined
  }

  return { inputTokens, maxTokens, contextLimit }
}

// TODO: Replace with a response header check once the API adds a dedicated
// header for fast-mode rejection (e.g., x-fast-mode-rejected). String-matching
// the error message is fragile and will break if the API wording changes.
function isFastModeNotEnabledError(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }
  return (
    error.status === 400 &&
    (error.message?.includes('Fast mode is not enabled') ?? false)
  )
}

export function is529Error(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }

  // Check for 529 status code or overloaded error in message
  return (
    error.status === 529 ||
    // See below: the SDK sometimes fails to properly pass the 529 status code during streaming
    (error.message?.includes('"type":"overloaded_error"') ?? false)
  )
}

function isOAuthTokenRevokedError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status === 403 &&
    (error.message?.includes('OAuth token has been revoked') ?? false)
  )
}

function isBedrockAuthError(error: unknown): boolean {
  // Official wLp: Bedrock (and anthropicAws/mantle when present) treat
  // CredentialsProviderError + 403 as auth; 401 only for non-Bedrock AWS hosts.
  // Official USE_BEDROCK densable.
  let useBedrock = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
  try {
    const { isUseBedrockEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    useBedrock = isUseBedrockEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (
    useBedrock ||
    isAnthropicAwsProviderEnabled() ||
    isMantleProviderEnabled()
  ) {
    // AWS libs reject without an API call if .aws holds a past Expiration value
    // otherwise, API calls that receive expired tokens give generic 403
    // "The security token included in the request is invalid"
    if (
      isAwsCredentialsProviderError(error) ||
      (error instanceof APIError && error.status === 403)
    ) {
      return true
    }
  }
  return false
}

/**
 * Clear AWS auth caches if appropriate.
 * Official Pj_ (2.1.207): full wipe on CredentialsProviderError / material
 * errors; otherwise only drop the export memo + debounced default-chain
 * invalidate so a generic 403 does not thrash SSO cooldown.
 * @returns true if action was taken.
 */
function handleAwsCredentialError(error: unknown): boolean {
  if (!isBedrockAuthError(error)) {
    return false
  }
  const materialBad =
    isAwsCredentialsProviderError(error) ||
    (error instanceof APIError &&
      isAwsAuthMaterialError(
        error.headers?.get('x-amzn-errortype') ?? undefined,
        error.message,
      ))
  if (materialBad) {
    clearAwsCredentialsCache()
  } else {
    clearAwsCredentialExportCache()
    invalidateDefaultAwsProviderChainDebounced(getAWSRegion())
  }
  return true
}

// google-auth-library throws plain Error (no typed name like AWS's
// CredentialsProviderError). Match common SDK-level credential-failure messages.
function isGoogleAuthLibraryCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message
  return (
    msg.includes('Could not load the default credentials') ||
    msg.includes('Could not refresh access token') ||
    msg.includes('invalid_grant')
  )
}

function isVertexAuthError(error: unknown): boolean {
  // densable ugi: CLAUDE_CODE_USE_VERTEX || CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD
  let useVertex = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  const useAnthropicGoogleCloud = isEnvTruthy(
    process.env.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD,
  )
  try {
    const { isUseVertexEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    useVertex = isUseVertexEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (useVertex || useAnthropicGoogleCloud) {
    // SDK-level: google-auth-library fails in prepareOptions() before the HTTP call
    if (isGoogleAuthLibraryCredentialError(error)) {
      return true
    }
    // Server-side: Vertex returns 401 for expired/invalid tokens
    if (error instanceof APIError && error.status === 401) {
      return true
    }
  }
  return false
}

/**
 * Clear GCP auth caches if appropriate.
 * @returns true if action was taken.
 */
function handleGcpCredentialError(error: unknown): boolean {
  if (isVertexAuthError(error)) {
    clearGcpCredentialsCache()
    return true
  }
  return false
}

function shouldRetry(error: APIError): boolean {
  // Never retry mock errors - they're from /mock-limits command for testing
  if (isMockRateLimitError(error)) {
    return false
  }

  // Persistent mode: 429/529 always retryable, bypass subscriber gates and
  // x-should-retry header.
  if (isPersistentRetryEnabled() && isTransientCapacityError(error)) {
    return true
  }

  // CCR mode: auth is via infrastructure-provided JWTs, so a 401/403 is a
  // transient blip (auth service flap, network hiccup) rather than bad
  // credentials. Bypass x-should-retry:false — the server assumes we'd retry
  // the same bad key, but our key is fine.
  // Official REMOTE densable.
  let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    isRemote = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (isRemote && (error.status === 401 || error.status === 403)) {
    return true
  }

  // Check for overloaded errors first by examining the message content
  // The SDK sometimes fails to properly pass the 529 status code during streaming,
  // so we need to check the error message directly
  if (error.message?.includes('"type":"overloaded_error"')) {
    return true
  }

  // Check for max tokens context overflow errors that we can handle
  if (parseMaxTokensContextOverflowError(error)) {
    return true
  }

  // Note this is not a standard header.
  const shouldRetryHeader = error.headers?.get('x-should-retry')

  // If the server explicitly says whether or not to retry, obey.
  // For Max and Pro users, should-retry is true, but in several hours, so we shouldn't.
  // Enterprise users can retry because they typically use PAYG instead of rate limits.
  if (
    shouldRetryHeader === 'true' &&
    (!isClaudeAISubscriber() || isEnterpriseSubscriber())
  ) {
    return true
  }

  // Ants can ignore x-should-retry: false for 5xx server errors only.
  // For other status codes (401, 403, 400, 429, etc.), respect the header.
  if (shouldRetryHeader === 'false') {
    const is5xxError = error.status !== undefined && error.status >= 500
    if (!(process.env.USER_TYPE === 'ant' && is5xxError)) {
      return false
    }
  }

  if (error instanceof APIConnectionError) {
    return true
  }

  if (!error.status) return false

  // Retry on request timeouts.
  if (error.status === 408) return true

  // Retry on lock timeouts.
  if (error.status === 409) return true

  // Retry on rate limits, but not for ClaudeAI Subscription users
  // Enterprise users can retry because they typically use PAYG instead of rate limits
  if (error.status === 429) {
    return !isClaudeAISubscriber() || isEnterpriseSubscriber()
  }

  // Clear API key cache on 401 and allow retry.
  // OAuth token handling is done in the main retry loop via handleOAuth401Error.
  // Official lfa: host-managed auth token refresh also retries on 401.
  if (error.status === 401) {
    clearApiKeyHelperCache()
    return true
  }

  // Retry on 403 "token revoked" (same refresh logic as 401, see above)
  if (isOAuthTokenRevokedError(error)) {
    return true
  }

  // Retry internal errors.
  if (error.status && error.status >= 500) return true

  return false
}

/**
 * Official pDs / 2.1.199:
 * - CLAUDE_CODE_MAX_RETRIES wins when set (finite ≥0).
 * - When MAX_RETRIES > 15 and RETRY_WATCHDOG is not active, clamp to 15 (ufa)
 *   with a one-shot warn — official clamp-to-ufa densable branch.
 * - Else RETRY_WATCHDOG raises the default budget (300 when bare-enabled;
 *   numeric >1 honored as-is).
 */
const DEFAULT_RETRY_WATCHDOG_MAX = 300
/** Official ufa — non-watchdog MAX_RETRIES clamp ceiling. */
const MAX_RETRIES_CLAMP = 15
let maxRetriesClampWarned = false

function isRetryWatchdogActive(
  watchdog: string | undefined = process.env.CLAUDE_CODE_RETRY_WATCHDOG,
): boolean {
  if (watchdog === undefined || watchdog === '') return false
  if (watchdog === '0' || watchdog.toLowerCase() === 'false') return false
  const parsed = parseInt(watchdog, 10)
  if (!Number.isNaN(parsed) && parsed > 1) return true
  return isEnvTruthy(watchdog) || Number.isNaN(parsed) || parsed === 1
}

export function getDefaultMaxRetries(): number {
  const watchdogActive = isRetryWatchdogActive()
  // Official MAX_RETRIES densable pure parse; clamp remains denser here.
  let parsed: number | null = null
  try {
    const { resolveMaxRetriesOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    parsed = resolveMaxRetriesOverride()
  } catch {
    if (process.env.CLAUDE_CODE_MAX_RETRIES) {
      const n = parseInt(process.env.CLAUDE_CODE_MAX_RETRIES, 10)
      if (!Number.isNaN(n) && n >= 0) parsed = n
    }
  }
  if (parsed !== null) {
    // Official: if (t > ufa && !oMe()) clamp to ufa
    if (parsed > MAX_RETRIES_CLAMP && !watchdogActive) {
      if (!maxRetriesClampWarned) {
        maxRetriesClampWarned = true
        logForDebugging(
          `CLAUDE_CODE_MAX_RETRIES=${parsed} clamped to ${MAX_RETRIES_CLAMP}`,
          { level: 'warn' },
        )
      }
      return MAX_RETRIES_CLAMP
    }
    return parsed
  }
  // Official 2.1.199 stream-retry budget for transient mid-response drops.
  const watchdog = process.env.CLAUDE_CODE_RETRY_WATCHDOG
  if (watchdog !== undefined && watchdog !== '') {
    if (watchdog === '0' || watchdog.toLowerCase() === 'false') {
      return DEFAULT_MAX_RETRIES
    }
    const parsed = parseInt(watchdog, 10)
    // Explicit high budgets (e.g. 300) are honored as-is; bare enable
    // flags ("1", "true", "yes") map to the official default of 300.
    if (!Number.isNaN(parsed) && parsed > 1) return parsed
    if (isEnvTruthy(watchdog) || Number.isNaN(parsed) || parsed === 1) {
      return DEFAULT_RETRY_WATCHDOG_MAX
    }
  }
  return DEFAULT_MAX_RETRIES
}
function getMaxRetries(options: RetryOptions): number {
  return options.maxRetries ?? getDefaultMaxRetries()
}

const DEFAULT_FAST_MODE_FALLBACK_HOLD_MS = 30 * 60 * 1000 // 30 minutes
const SHORT_RETRY_THRESHOLD_MS = 20 * 1000 // 20 seconds
const MIN_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes

function getRetryAfterMs(error: APIError): number | null {
  const retryAfter = getRetryAfter(error)
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }
  return null
}

function getRateLimitResetDelayMs(error: APIError): number | null {
  const resetHeader = error.headers?.get?.('anthropic-ratelimit-unified-reset')
  if (!resetHeader) return null
  const resetUnixSec = Number(resetHeader)
  if (!Number.isFinite(resetUnixSec)) return null
  const delayMs = resetUnixSec * 1000 - Date.now()
  if (delayMs <= 0) return null
  return Math.min(delayMs, PERSISTENT_RESET_CAP_MS)
}
