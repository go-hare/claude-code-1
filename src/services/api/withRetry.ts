import { feature } from 'bun:bundle'
import type Anthropic from '@anthropic-ai/sdk'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import {
  getSessionId,
  getStickyBetas,
  onSessionSwitch,
} from 'src/bootstrap/state.js'
import { getBootstrapSessionHost, HostSlot } from 'src/utils/sessionRoot.js'
import type { QuerySource } from 'src/constants/querySource.js'
import type { SystemAPIErrorMessage } from 'src/types/message.js'
import {
  isAwsAuthMaterialError,
  isAwsCredentialsProviderError,
} from 'src/utils/aws.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { createSystemAPIErrorMessage } from 'src/utils/messages.js'
import {
  getAPIProvider,
  getAPIProviderForStatsig,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  getDensableCatalogModel,
  resolveCatalogIdFromProviderId,
} from 'src/utils/model/modelCatalogCapabilities.js'
import { firstPartyNameToCanonical } from 'src/utils/model/canonicalName.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
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
  hasAnthropicApiKeyAuth,
  invalidateDefaultAwsProviderChainDebounced,
  isAnthropicAuthEnabled,
  isClaudeAISubscriber,
  isEnterpriseSubscriber,
} from '../../utils/auth.js'
import {
  isProfileAuthActive,
  isUsableStoredClaudeAiLogin,
} from '../../utils/anthropicProfile.js'
import {
  getOAuthAccountOnHold,
  getProfileAccountOnHold,
  OAuthAccountOnHoldError,
} from '../../utils/accountOnHold.js'
import { getAWSRegion, isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import {
  isHostAuthTokenRefreshAvailable,
  tryHostAuth401Recovery,
} from '../../utils/hostCredsFile.js'
import { getSdkOauthTokenRefreshCallback } from '../../utils/sdkOauthTokenRefresh.js'
import {
  type CooldownReason,
  handleFastModeOverageRejection,
  handleFastModeRejectedByAPI,
  isFastModeCooldown,
  isFastModeEnabled,
  isFastModeRefusalError,
  isModelFastModeRejectedForSession,
  markModelFastModeRejectedForSession,
  triggerFastModeCooldown,
} from '../../utils/fastMode.js'
import {
  isTlsCertificateVerificationError,
  readApiServedCertificateChain,
} from '../../utils/mtls.js'
import { handleFoundryCapabilityError } from '../../utils/foundryCapabilities.js'
import { isNonCustomOpusModel } from '../../utils/model/model.js'
import { disableKeepAlive } from '../../utils/proxy.js'
import { sleep } from '../../utils/sleep.js'
import {
  isPrefixLockHealDeclined,
  isThinkingBoundToOtherConversation,
  isTopLevelSafeguardsRejected,
  type ThinkingConfig,
} from '../../utils/thinking.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  checkMockRateLimitError,
  isMockRateLimitError,
} from '../rateLimitMocking.js'
import { getClientTargetUrl } from './client.js'
import {
  isBedrockModelAccessRefusalError,
  NAME_CONSTRAINT_CERT_ERROR_CODES,
  REPEATED_529_ERROR_MESSAGE,
} from './errors.js'
import {
  extractConnectionErrorDetails,
  isCertSignatureFailureError,
} from './errorUtils.js'
import { STREAM_NO_RESPONSE_RETRY_CAP } from '../../utils/firstByteWatchdog.js'

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
  'repl_main_thread:outputStyle:Concise',
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
/** Official 2.1.328 `xso = 60000` (`chunk@294254613.js:3270792`) — non-persistent Retry-After ceiling. */
export const NON_PERSISTENT_MAX_RETRY_AFTER_MS = 60_000
/** Official 2.1.328 `oyt = 0.25` — proportional jitter ratio. */
const RETRY_JITTER_RATIO = 0.25

function isUnattendedRetryEnabled(): boolean {
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

/**
 * Official 2.1.328 `Y1e(querySource)`:
 * Enable `CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS` when `CLAUDE_CODE_RETRY_WATCHDOG`
 * is UNSET, `CLAUDE_CODE_MAX_RETRIES === undefined`, on main-thread queries, and
 * gated by `tengu_steady_heron` (default true).
 */
export function getOverloadedRetryMaxWaitMs(
  querySource?: QuerySource,
): number | undefined {
  const maxWait = parseOptionalNonNegativeIntEnv(
    'CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS',
  )
  if (
    maxWait === undefined ||
    process.env.CLAUDE_CODE_MAX_RETRIES !== undefined ||
    isRetryWatchdogEnabled()
  ) {
    return undefined
  }
  let family: string | undefined
  try {
    const { getQuerySourceFamily } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/observerAgents.js') as typeof import('../../utils/observerAgents.js')
    family = getQuerySourceFamily(querySource)
  } catch {
    family = undefined
  }
  if (family !== 'main') return undefined
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_steady_heron', true)
    ? maxWait
    : undefined
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
  'StreamTruncated',
])

/** densable EYy / 2.1.214 #18+#46 + 2.1.321 #1878 StreamTruncated */
/**
 * Official 2.1.326 (#51) + 2.1.328 `gxs` / `hxs` / `xCt` / `y9e` / `Rbo`:
 * When the API rejects a request with HTTP 400
 * `max_tokens: X > Y, which is the maximum allowed number of output tokens for ...`
 * lower `max_tokens` to the API-reported maximum `Y` (>= 4096), retry once,
 * and remember that ceiling per normalized model ONLY once the reply actually
 * begins (`message_start` for streaming or validated response for non-streaming),
 * clearing automatically on `/clear`, compaction, `/resume` (session switch),
 * `clearBetaHeaderLatches()` / `resetStickyBetas()`, or provider/endpoint/auth
 * changes.
 */
const API_MAX_TOKENS_CEILING_RE =
  /max_tokens:\s*(\d+)\s*>\s*(\d+),\s*which is the maximum allowed number of output tokens for\b/i
export const MIN_API_MAX_TOKENS_CEILING = 4096

type ModelMaxTokensCeilingBucket = {
  scopeKey: string
  ceilings: Map<string, number>
}

const modelMaxTokensCeilingByStickyBetas = new WeakMap<
  object,
  ModelMaxTokensCeilingBucket
>()

function getLearnedMaxTokensScopeKey(): string {
  const provider = getAPIProvider()
  const baseUrl =
    process.env.ANTHROPIC_BASE_URL ??
    process.env.ANTHROPIC_FOUNDRY_BASE_URL ??
    process.env.ANTHROPIC_VERTEX_BASE_URL ??
    process.env.ANTHROPIC_BEDROCK_BASE_URL ??
    ''
  const sessionId = getSessionId()
  const authMode = process.env.ANTHROPIC_API_KEY
    ? 'api_key'
    : process.env.ANTHROPIC_AUTH_TOKEN
      ? 'auth_token'
      : process.env.CLAUDE_CODE_OAUTH_TOKEN
        ? 'oauth_env'
        : 'default'
  return `${sessionId}\0${provider}\0${baseUrl}\0${authMode}`
}

function getActiveModelMaxTokensCeilingMap(
  createIfMissing: boolean,
): Map<string, number> | undefined {
  const stickyBetas = getStickyBetas()
  const scopeKey = getLearnedMaxTokensScopeKey()
  const existing = modelMaxTokensCeilingByStickyBetas.get(stickyBetas)
  if (existing && existing.scopeKey === scopeKey) {
    return existing.ceilings
  }
  if (!createIfMissing) {
    if (existing) {
      modelMaxTokensCeilingByStickyBetas.delete(stickyBetas)
    }
    return undefined
  }
  const next: ModelMaxTokensCeilingBucket = {
    scopeKey,
    ceilings: new Map<string, number>(),
  }
  modelMaxTokensCeilingByStickyBetas.set(stickyBetas, next)
  return next.ceilings
}

function normalizeModelKeyForCeiling(model: string): string {
  return model.trim().toLowerCase()
}

export function getCachedModelMaxTokensCeiling(
  model: string,
): number | undefined {
  return getActiveModelMaxTokensCeilingMap(false)?.get(
    normalizeModelKeyForCeiling(model),
  )
}

export function setCachedModelMaxTokensCeiling(
  model: string,
  maxTokens: number,
): void {
  if (maxTokens >= MIN_API_MAX_TOKENS_CEILING) {
    getActiveModelMaxTokensCeilingMap(true)?.set(
      normalizeModelKeyForCeiling(model),
      maxTokens,
    )
  }
}

/**
 * Official 2.1.328 `xCt.onReplyBegun()`: commit a retry-lowered max_tokens
 * ceiling into the session cache ONLY once the reply stream actually begins
 * (`message_start`) or a non-streaming response succeeds.
 */
export function confirmModelMaxTokensCeiling(
  model: string,
  maxTokens: number,
): void {
  if (maxTokens < MIN_API_MAX_TOKENS_CEILING) return
  if (getCachedModelMaxTokensCeiling(model) === maxTokens) return
  setCachedModelMaxTokensCeiling(model, maxTokens)
  logForDebugging(
    `[max_tokens] A request for ${model} failed, and a reply began when it was sent again with max_tokens set to ${maxTokens}. Until the next /clear, compaction, resume or provider change, max_tokens for this model is capped at ${maxTokens}. Set CLAUDE_CODE_MAX_OUTPUT_TOKENS to pick a different limit.`,
    { level: 'warn' },
  )
}

export function clearCachedModelMaxTokensCeilings(): void {
  modelMaxTokensCeilingByStickyBetas.delete(getStickyBetas())
}

// Clear learned ceilings on /resume, /clear, and session switch (`switchSession` / `regenerateSessionId`).
onSessionSwitch(
  () => {
    clearCachedModelMaxTokensCeilings()
  },
  { scope: 'global' },
)

export function parseApiMaxTokensCeilingError(
  error: unknown,
): { requested: number; maximum: number } | null {
  if (!(error instanceof APIError) || error.status !== 400) return null
  const match = API_MAX_TOKENS_CEILING_RE.exec(error.message)
  if (!match) return null
  const requested = Number(match[1])
  const maximum = Number(match[2])
  if (
    !Number.isFinite(requested) ||
    !Number.isFinite(maximum) ||
    maximum < MIN_API_MAX_TOKENS_CEILING ||
    maximum >= requested
  ) {
    return null
  }
  return { requested, maximum }
}

/**
 * Official 2.1.328 `J1e` / `S_e` / `Z1e` / `aAt` (#62): in Claude Desktop's
 * Code tab (OAuth session managed by SDK host callback with no local refresh
 * token), a one-off 401 that is not explicitly an expired/revoked token retries
 * once after 1500ms with the original credential before asking the host for a
 * token refresh.
 */
export const DESKTOP_CODE_TAB_ONE_OFF_401_RETRY_DELAY_MS = 1500

const DESKTOP_ONE_OFF_401_PASSED_STATUSES = new Set([
  400, 403, 404, 409, 422, 424, 429,
])

type DesktopOneOff401State =
  | { state: 'unused' }
  | { state: 'due'; token: string }
  | { state: 'sent'; token: string }
  | { state: 'passed' }
  | { state: 'refused' }

function advanceDesktopOneOff401State(
  state: DesktopOneOff401State,
  currentToken: string | undefined,
  error: unknown,
): DesktopOneOff401State {
  switch (state.state) {
    case 'unused':
    case 'passed':
    case 'refused':
      return state
    case 'due':
      return { state: 'unused' }
    case 'sent': {
      if (currentToken !== state.token) {
        return { state: 'unused' }
      }
      if (error === null) {
        return { state: 'passed' }
      }
      if (!(error instanceof APIError) || error.status === undefined) {
        return state
      }
      if (error.status === 401 || isOAuthTokenRevokedError(error)) {
        return { state: 'refused' }
      }
      if (DESKTOP_ONE_OFF_401_PASSED_STATUSES.has(error.status)) {
        return { state: 'passed' }
      }
      return state
    }
  }
}

export function isDesktopCodeTabOneOff401Eligible(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 401) return false
  if (isOAuthTokenRevokedError(error)) return false
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  if (entrypoint !== 'claude-desktop' && entrypoint !== 'claude-desktop-3p') {
    return false
  }
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
    Boolean(process.env.CLAUDE_CODE_REMOTE_SESSION_ID) ||
    isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
  ) {
    return false
  }
  if (
    process.env.CLAUDE_CODE_OAUTH_401_WAIT_MS !== undefined &&
    process.env.CLAUDE_CODE_OAUTH_401_WAIT_MS !== ''
  ) {
    return false
  }
  const structuredCode = (
    error.error as
      | { error?: { details?: { error_code?: unknown } } }
      | undefined
  )?.error?.details?.error_code
  if (structuredCode === 'token_expired') {
    return false
  }
  const lower = error.message.toLowerCase()
  if (
    lower.includes('token_expired') ||
    lower.includes('oauth token has expired')
  ) {
    return false
  }
  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_tidy_swing', false)) {
    return false
  }
  return true
}

export function isStaleConnectionError(error: unknown): boolean {
  if (
    error instanceof Error &&
    (error as { code?: unknown }).code === 'StreamTruncated'
  ) {
    return true
  }
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

export type ApiRetryStatus =
  | {
      kind: 'retrying'
      deadline: number
      attempt: number
      maxRetries: number
      error: { status?: number; formatted: string }
    }
  | {
      kind: 'stalled'
      elapsedMs?: number
      attempt?: number
      maxRetries?: number
    }

interface RetryOptions {
  maxRetries?: number
  model: string
  fallbackModel?: string
  /** Official 2.1.316 X$e — family older-model fallback on Vertex/Bedrock access errors. */
  accessFallbackModel?: string
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
  /**
   * densable `r.onError` @184899103.
   * Classifier returns a unique `retry:…` token once; withRetry latches it
   * in a Set and immediately continues (no delay). Duplicate tokens are ignored.
   */
  onError?: (
    error: unknown,
  ) => string | null | undefined | Promise<string | null | undefined>
  /** densable onRetryStatus kind:"retrying" while the backoff sleep runs. */
  onRetryStatus?: (
    status: {
      kind: 'retrying'
      deadline: number
      attempt: number
      maxRetries: number
      error: { status?: number; formatted: string }
    } | null,
  ) => void
  /** Official 2.1.305 (#1035): check whether a usage limit lifted early. */
  isUsageLimitLifted?: () => Promise<boolean>
  /**
   * Official 2.1.328 `xCt.onReplyBegun()`: when true (streaming requests), do
   * not commit a retry-lowered max_tokens ceiling when `operation` returns the
   * stream object; deliver it to `onPendingMaxTokensCeiling` so the caller can
   * confirm once `message_start` arrives.
   */
  deferMaxTokensCeilingConfirmation?: boolean
  onPendingMaxTokensCeiling?: (pending: {
    model: string
    limit: number
    confirm: () => void
  }) => void
  /** Test override for the 1500ms Desktop Code tab one-off 401 retry delay. */
  desktopOneOff401DelayMs?: number
  /** Official 2.1.328 `r.isNonStreamingRequest` — allows 404 last_resort fallback on non-streaming requests. */
  isNonStreamingRequest?: boolean
  /** Official 2.1.328 `r.isResumePrefillRequest` — excludes 4xx prefill errors from last_resort fallback. */
  isResumePrefillRequest?: boolean
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
export type FallbackTriggeredReason =
  | 'overloaded'
  | 'model_not_found'
  | 'permission_denied'
  | 'refusal'
  | 'server_error'
  | 'model_blocked'
  | 'last_resort'

export class FallbackTriggeredError extends Error {
  public readonly reason: FallbackTriggeredReason
  public readonly cause?: unknown

  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
    reason: FallbackTriggeredReason = 'overloaded',
    cause?: unknown,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
    this.reason = reason
    this.cause = cause
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

/**
 * Official 2.1.301 A2e — 403 permission_error mentioning `model:`.
 */
export function isModelPermissionAPIError(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 403) {
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
  const isPermission =
    bodyType === 'permission_error' ||
    message.includes('"type":"permission_error"') ||
    message.includes('"type": "permission_error"')
  const mentionsModel =
    message.includes('model:') ||
    (bodyMessage !== undefined && bodyMessage.includes('model:'))
  return isPermission && mentionsModel
}

/**
 * Official 2.1.328 `oGe(e)` (`chunk@294254613.js:3293764`) — non-529 5xx server error.
 */
export function isNon529ServerError(error: unknown): error is APIError {
  return (
    error instanceof APIError &&
    error.status !== undefined &&
    error.status >= 500 &&
    error.status < 600 &&
    !is529Error(error)
  )
}

/** Official 2.1.328 `xas(e)` — `not_found_error` body type. */
function isNotFoundErrorType(error: APIError): boolean {
  const body =
    error.error && typeof error.error === 'object'
      ? (error.error as { type?: unknown; error?: { type?: unknown } })
      : undefined
  return (
    (error as { type?: unknown }).type === 'not_found_error' ||
    body?.type === 'not_found_error' ||
    body?.error?.type === 'not_found_error' ||
    (error.message?.includes('"type":"not_found_error"') ?? false) ||
    (error.message?.includes('"type": "not_found_error"') ?? false)
  )
}

/** Official 2.1.328 `mMs` (`chunk@294254613.js:3272890`). */
const LAST_RESORT_EXCLUDED_STATUSES = new Set([401, 407, 429, 404, 403, 413])

/** Official 2.1.328 `Ias(status)` — 4xx statuses excluded on resume-prefill requests. */
function isResumePrefillExcludedStatus(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429 &&
    status !== 451
  )
}

/**
 * Official 2.1.328 `mMs` + `Hso` (`chunk@294254613.js:3272890, 3286400`) —
 * returns true if an `APIError` must NOT trigger `last_resort` model fallback
 * (auth/quota/content/billing/context errors that switching models cannot fix).
 */
export function isLastResortFallbackExcluded(
  error: APIError,
  options?: {
    isNonStreamingRequest?: boolean
    isResumePrefillRequest?: boolean
  },
): boolean {
  const status = error.status
  if (
    status !== undefined &&
    LAST_RESORT_EXCLUDED_STATUSES.has(status) &&
    !(status === 404 && options?.isNonStreamingRequest === true)
  ) {
    return true
  }
  const body =
    error.error && typeof error.error === 'object'
      ? (error.error as {
          type?: unknown
          error?: {
            type?: unknown
            details?: { error_code?: unknown }
          }
        })
      : undefined
  const errorType =
    (error as { type?: unknown }).type ?? body?.error?.type ?? body?.type
  if (errorType === 'billing_error') {
    return true
  }
  if (
    options?.isResumePrefillRequest === true &&
    status !== undefined &&
    isResumePrefillExcludedStatus(status)
  ) {
    return true
  }
  if (
    isThinkingBoundToOtherConversation(error) &&
    !isPrefixLockHealDeclined(error)
  ) {
    return true
  }
  if (parseMaxTokensContextOverflowError(error) !== undefined) {
    return true
  }
  if (isFastModeNotEnabledError(error)) {
    return true
  }
  if (isTopLevelSafeguardsRejected(error)) {
    return true
  }
  const lower = (error.message ?? '').toLowerCase()
  if (
    lower.includes('credit balance is too low') ||
    lower.includes('organization has been disabled') ||
    lower.includes('output blocked by content filtering policy') ||
    lower.includes('prompt is too long') ||
    lower.includes('input is too long') ||
    lower.includes('cannot be used as an advisor when the request model is') ||
    lower.includes('could not process image') ||
    lower.includes('could not process pdf') ||
    lower.includes('pdf cannot be empty')
  ) {
    return true
  }
  if (
    status === 400 &&
    (body?.error?.type === 'policy_blocked' ||
      body?.error?.details?.error_code === 'dlp_request_denied')
  ) {
    return true
  }
  return false
}

/**
 * Official 2.1.328 `cAt` (`chunk@294254613.js:3294850`) — wrap retryable
 * non-`APIError` errors (AWS/GCP/WIF/connection/stale errors) into an
 * `APIError` payload so `createSystemAPIErrorMessage` emits retry notices for
 * all retryable errors, not only `APIError` instances.
 */
function toRetryNotificationError(error: unknown): APIError | null {
  if (error instanceof APIError) {
    return error
  }
  if (
    isAwsCredentialsProviderError(error) ||
    isGoogleAuthLibraryCredentialError(error) ||
    isStaleConnectionError(error) ||
    error instanceof Error
  ) {
    const wrapped = new APIError(
      undefined,
      undefined,
      errorMessage(error),
      undefined,
    )
    if (error instanceof Error) {
      ;(wrapped as { cause?: unknown }).cause = error
    }
    return wrapped
  }
  return null
}

function createRetryNotificationMessage(
  error: unknown,
  retryInMs: number,
  retryAttempt: number,
  maxRetries: number,
): SystemAPIErrorMessage | null {
  const apiErr = toRetryNotificationError(error)
  if (!apiErr) return null
  return createSystemAPIErrorMessage(
    apiErr,
    retryInMs,
    retryAttempt,
    maxRetries,
  )
}

function resolveCatalogEntryForModel(model: string) {
  const stripped = model.replace(/\[1m\]/gi, '').trim()
  const viaProvider = resolveCatalogIdFromProviderId(stripped)
  return (
    getDensableCatalogModel(stripped) ??
    (viaProvider ? getDensableCatalogModel(viaProvider) : undefined) ??
    getDensableCatalogModel(firstPartyNameToCanonical(stripped))
  )
}

function resolveCatalogFallbackModelId(
  fallbackCatalogId: string,
  provider: ReturnType<typeof getAPIProvider>,
): string {
  const providerKey =
    provider === 'firstParty'
      ? 'first_party'
      : provider === 'anthropicAws'
        ? 'anthropic_aws'
        : provider === 'anthropicGoogleCloud'
          ? 'anthropic_google_cloud'
          : provider
  const target = getDensableCatalogModel(fallbackCatalogId)
  const providerIds = target?.provider_ids as
    | Record<string, string | null | undefined>
    | undefined
  const mapped = providerIds?.[providerKey]
  return typeof mapped === 'string' && mapped.length > 0
    ? mapped
    : fallbackCatalogId
}

/**
 * Official 2.1.301 (#850): when the newest Fable model is not available to an
 * organization on the first-party Anthropic API, fall back once to the previous
 * Fable model (`fallback_3p`).
 */
export function resolveFableAvailabilityFallbackModel(
  model: string,
): string | undefined {
  const provider = getAPIProvider()
  if (provider !== 'firstParty') {
    return undefined
  }
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_NO_MODEL_FALLBACK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK)
  ) {
    return undefined
  }
  const entry = resolveCatalogEntryForModel(model)
  if (entry?.family === 'fable' && entry.fallback_3p) {
    const resolved = resolveCatalogFallbackModelId(entry.fallback_3p, provider)
    return resolved !== model ? resolved : undefined
  }
  return undefined
}

/**
 * Official 2.1.316 X$e — resolve an older model in the same family when
 * Vertex AI or Amazon Bedrock returns an availability / permission error.
 */
export function resolveAccessFallbackModel(options: {
  model: string
  accessFallbackModel?: string
}): string | undefined {
  if (
    options.accessFallbackModel !== undefined &&
    options.accessFallbackModel !== options.model
  ) {
    return options.accessFallbackModel
  }
  const provider = getAPIProvider()
  if (provider !== 'vertex' && provider !== 'bedrock') {
    return undefined
  }
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_NO_MODEL_FALLBACK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK)
  ) {
    return undefined
  }
  const entry = resolveCatalogEntryForModel(options.model)
  if (entry?.fallback_3p) {
    const resolved = resolveCatalogFallbackModelId(entry.fallback_3p, provider)
    if (resolved !== options.model) {
      return resolved
    }
  }
  return undefined
}

/**
 * Official 2.1.325 #2341 (`ir(gi, r.signal, Q9)`): race an in-flight host auth
 * token renewal against `signal` so stopping `claude-desktop-3p` aborts the
 * renewal immediately instead of hanging on "Stopping" until timeout.
 */
export async function raceHostAuthRefreshWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    throw new APIUserAbortError()
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new APIUserAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
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
  let watchdogSpentMs = 0
  let usageLimitSpentMs = 0
  // Official 2.1.328 `K` (`chunk@294254613.js:3282538`) — cumulative ms spent in
  // fast-mode short retry-after waits, capped at SHORT_RETRY_THRESHOLD_MS (20s).
  let fastModeShortRetrySpentMs = 0
  // Official 2.1.328 `Y1e(r.querySource)`: main-turn overload wait cap when
  // CLAUDE_CODE_RETRY_WATCHDOG and CLAUDE_CODE_MAX_RETRIES are both unset.
  const overloadWaitMaxMs = getOverloadedRetryMaxWaitMs(options.querySource)
  // densable 2.1.228 #14: cap GCP/AWS auth refresh retries (x6S/k6S = 2)
  let awsAuthRetryCount = 0
  let gcpAuthRetryCount = 0
  // densable 2.1.243 #22 UYo — StreamNoResponse retries once then exhausts.
  let streamNoResponseRetryCount = 0
  // densable y3b `h` — report mTLS material failure analytics at most once
  let mtlsReloadFailureReported = false
  // Official 2.1.319 (#1722): force-refresh OAuth at most once per request loop
  let oauth401ForcedRefreshDone = false
  // Official 2.1.319 (#1784): attempt TLS served-chain cert repair at most once
  let tlsCertRepairAttempted = false
  // Official 2.1.323 (#2005): allow at most one Desktop host credential renewal
  // on 403 (expired gateway token) per request.
  let hostAuth403Retried = false
  // Official 2.1.328 (`tn` / `J1e` / `S_e`): allow one direct 1500ms resend
  // with the original OAuth credential in Desktop Code tab before asking the
  // SDK host callback for a token refresh.
  let desktopOneOff401State: DesktopOneOff401State = { state: 'unused' }
  let lastClientOAuthAccessToken: string | undefined
  // Official 2.1.326 (#51) + 2.1.328 `xCt`: allow lowering max_tokens to API-reported ceiling once
  let maxTokensCeilingAdjusted = false
  let pendingModelMaxTokensCeiling: { model: string; limit: number } | undefined
  const isSecurityControlQuery =
    options.querySource === 'auto_mode' ||
    options.querySource === 'auto_mode_investigator'
  // densable `Fe=new Set` @184899103 — each onError retry token fires once.
  const consumedOnErrorRetryTokens = new Set<string>()
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new APIUserAbortError()
    }

    // Capture whether fast mode is active before this attempt
    // (fallback may change the state mid-loop)
    const wasFastModeActive = isFastModeEnabled()
      ? Boolean(
          retryContext.fastMode &&
            !isFastModeCooldown() &&
            !isModelFastModeRejectedForSession(retryContext.model),
        )
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
        (lastError instanceof APIError &&
          lastError.status === 403 &&
          isHostAuthTokenRefreshAvailable() &&
          !hostAuth403Retried) ||
        isOAuthTokenRevokedError(lastError) ||
        isBedrockAuthError(lastError) ||
        isVertexAuthError(lastError) ||
        isStaleConnection ||
        mtlsReloadAttempted
      ) {
        // On 401 "token expired" or 403 "token revoked" (or Desktop host 403), force a token refresh
        if (
          (lastError instanceof APIError && lastError.status === 401) ||
          (lastError instanceof APIError &&
            lastError.status === 403 &&
            isHostAuthTokenRefreshAvailable() &&
            !hostAuth403Retried) ||
          isOAuthTokenRevokedError(lastError)
        ) {
          // densable lt / invalidateWIFToken when profile WIF drives the request
          let handledProfileWif = false
          try {
            const { getLastIssuedWifAccessToken, invalidateWifToken } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../../utils/anthropicProfile.js') as typeof import('../../utils/anthropicProfile.js')
            if (
              isProfileAuthActive({
                storedClaudeAiLogin: isUsableStoredClaudeAiLogin(
                  getClaudeAIOAuthTokens(),
                ),
              })
            ) {
              // densable lt(e): e = bearer that failed, not a disk re-read
              // (sibling may already have rotated credentials on disk).
              await invalidateWifToken(getLastIssuedWifAccessToken())
              handledProfileWif = true
            }
          } catch {
            handledProfileWif = false
          }
          if (!handledProfileWif) {
            const failedAccessToken =
              lastClientOAuthAccessToken ??
              getClaudeAIOAuthTokens()?.accessToken
            if (desktopOneOff401State.state === 'due') {
              // Official 2.1.328 (`if (tn.state === "due") tn = { state: "sent", token: tn.token }`):
              // resend once with the original OAuth credential before calling
              // handleOAuth401Error / SDK host token refresh.
              desktopOneOff401State = {
                state: 'sent',
                token: desktopOneOff401State.token,
              }
            } else if (failedAccessToken) {
              // Official 2.1.319 (#1722): on repeated 401s within the same
              // request, adopt a token refreshed by another session instead of
              // forcing another refresh_token call every retry.
              let forcedOutcome:
                | 'refreshed'
                | 'unchanged'
                | 'failed'
                | undefined
              await handleOAuth401Error(failedAccessToken, {
                adoptOnly: oauth401ForcedRefreshDone,
                onForcedRefreshOutcome: outcome => {
                  forcedOutcome = outcome
                },
              })
              if (forcedOutcome === 'refreshed' || forcedOutcome === 'failed') {
                oauth401ForcedRefreshDone = true
              }
              // densable `let z = f$e(); if (z) throw re(...), new nd(new yz(z.url), o)`
              const hold = getOAuthAccountOnHold()
              if (hold) {
                logEvent('api_request', {
                  status:
                    'api_request_account_on_hold' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                throw new CannotRetryError(
                  new OAuthAccountOnHoldError(hold.url),
                  retryContext,
                )
              }
              const latestAccessToken = getClaudeAIOAuthTokens()?.accessToken
              if (
                (oauth401ForcedRefreshDone ||
                  getSdkOauthTokenRefreshCallback() !== null) &&
                (latestAccessToken === failedAccessToken ||
                  latestAccessToken === undefined)
              ) {
                logEvent('api_request', {
                  status:
                    'api_request_oauth_refresh_exhausted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                throw new CannotRetryError(
                  lastError instanceof Error
                    ? lastError
                    : new Error('OAuth 401 refresh exhausted'),
                  retryContext,
                )
              }
            } else if (
              lastError instanceof APIError &&
              (lastError.status === 401 || lastError.status === 403) &&
              isHostAuthTokenRefreshAvailable()
            ) {
              // Official lfa / host_auth_401_recovery + 2.1.323 (#2005) + 2.1.325 (#2341):
              // On 401 or 403 (organization gateway answering expired token
              // with 403 in Claude Desktop), ask Desktop for a fresh token and retry.
              // Race against options.signal so stopping claude-desktop-3p aborts
              // an in-flight token renewal immediately instead of hanging on "Stopping".
              const is403 = lastError.status === 403
              if (is403) {
                hostAuth403Retried = true
              }
              if (options.signal?.aborted) {
                throw new APIUserAbortError()
              }
              const hostResult = await raceHostAuthRefreshWithSignal(
                tryHostAuth401Recovery(options.signal),
                options.signal,
              )
              if (
                hostResult === 'failed' ||
                hostResult === 'exhausted' ||
                (is403 && hostResult !== 'updated')
              ) {
                throw new CannotRetryError(lastError, retryContext)
              }
            }
          }
        }
        client = await getClient()
        lastClientOAuthAccessToken = getClaudeAIOAuthTokens()?.accessToken
      }

      options.onRetryStatus?.(null)
      const result = await operation(client, attempt, retryContext)
      desktopOneOff401State = advanceDesktopOneOff401State(
        desktopOneOff401State,
        lastClientOAuthAccessToken,
        null,
      )
      if (pendingModelMaxTokensCeiling) {
        const pending = pendingModelMaxTokensCeiling
        pendingModelMaxTokensCeiling = undefined
        const isStreamResult =
          result !== null &&
          typeof result === 'object' &&
          Symbol.asyncIterator in result
        if (options.deferMaxTokensCeilingConfirmation || isStreamResult) {
          options.onPendingMaxTokensCeiling?.({
            model: pending.model,
            limit: pending.limit,
            confirm: () =>
              confirmModelMaxTokensCeiling(pending.model, pending.limit),
          })
        } else {
          confirmModelMaxTokensCeiling(pending.model, pending.limit)
        }
      }
      return result
    } catch (error) {
      const wasDesktopOneOff401Sent = desktopOneOff401State.state === 'sent'
      desktopOneOff401State = advanceDesktopOneOff401State(
        desktopOneOff401State,
        lastClientOAuthAccessToken,
        error,
      )
      const refusedAfterDesktopOneOff401 =
        wasDesktopOneOff401Sent && desktopOneOff401State.state === 'refused'
      // densable `if (x instanceof nd) throw x`
      if (error instanceof CannotRetryError) throw error
      if (error instanceof APIUserAbortError) throw error

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

      // densable `await r.onError?.(St)` @184899103 — unique token, `tt--`, continue.
      const onErrorToken = await options.onError?.(error)
      if (onErrorToken && !consumedOnErrorRetryTokens.has(onErrorToken)) {
        consumedOnErrorRetryTokens.add(onErrorToken)
        logForDebugging(
          `API onError retry (${onErrorToken}) attempt ${attempt}/${maxRetries + 1}`,
          { level: 'warn' },
        )
        attempt--
        continue
      }

      // densable 2.1.243 #22: first-byte StreamNoResponse retries once (UYo=1).
      if (
        !isRetryWatchdogActive() &&
        extractConnectionErrorDetails(error)?.code === 'StreamNoResponse'
      ) {
        if (streamNoResponseRetryCount >= STREAM_NO_RESPONSE_RETRY_CAP) {
          throw new CannotRetryError(error, retryContext)
        }
        streamNoResponseRetryCount++
        continue
      }

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

      // Official 2.1.328 (`chunk@294254613.js:3281400-3281650`): permanent
      // model_not_found / permission_denied AND non-529 5xx (`oGe`) when not in
      // fast mode / watchdog → FallbackTriggeredError with reason.
      // Official 2.1.301 (#850): also fall back once on firstParty for Fable availability errors.
      const isModelNotFound = isModelNotFoundAPIError(error)
      const isModelPerm = isModelPermissionAPIError(error)
      const isServerErrorFallback =
        !wasFastModeActive &&
        !isFullRetryWatchdogActive() &&
        !isUnattendedRetryEnabled() &&
        isNon529ServerError(error)
      const effectiveFallbackModel =
        options.fallbackModel ??
        (isModelNotFound || isModelPerm
          ? (resolveAccessFallbackModel(options) ??
            resolveFableAvailabilityFallbackModel(options.model))
          : undefined)
      if (
        (isModelNotFound || isModelPerm || isServerErrorFallback) &&
        effectiveFallbackModel &&
        effectiveFallbackModel !== options.model
      ) {
        const fallbackReason: FallbackTriggeredReason = isModelNotFound
          ? 'model_not_found'
          : isModelPerm
            ? 'permission_denied'
            : 'server_error'
        logEvent('tengu_api_model_not_found_fallback_triggered', {
          original_model:
            options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fallback_model:
            effectiveFallbackModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          provider: getAPIProviderForStatsig(),
          reason:
            fallbackReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw new FallbackTriggeredError(
          options.model,
          effectiveFallbackModel,
          fallbackReason,
          error,
        )
      }

      // Official 2.1.319 (#1784 & #1817): after a TLS certificate error,
      // perform a single TLS handshake to the configured API host (even when
      // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set; skipped if only
      // ALL_PROXY is set) to restore a dropped cross-certificate and retry.
      if (!tlsCertRepairAttempted && isTlsCertificateVerificationError(error)) {
        tlsCertRepairAttempted = true
        const apiUrl =
          (client as { baseURL?: string } | null)?.baseURL ||
          getClientTargetUrl(getAPIProvider(), options.model) ||
          process.env.ANTHROPIC_BASE_URL ||
          'https://api.anthropic.com'
        const repairOutcome = await readApiServedCertificateChain(apiUrl, {
          signal: options.signal,
          afterModelRequest: true,
        })
        if (repairOutcome === 'restored') {
          client = null
          attempt--
          continue
        }
      }

      // Official 2.1.321/322 (#1880 & #1963): Fast mode fallback on 429, 529,
      // 5xx server errors, timeouts (including when watchdog is active), or
      // fast-mode refusal (e.g. Vertex) — try standard speed on the SAME model
      // first, and refund the retry attempt (`attempt--`).
      if (
        wasFastModeActive &&
        !isUnattendedRetryEnabled() &&
        ((error instanceof APIError &&
          (error.status === 429 ||
            is529Error(error) ||
            (error.status !== undefined && error.status >= 500))) ||
          error instanceof APIConnectionTimeoutError)
      ) {
        if (error instanceof APIError && error.status === 429) {
          // If the 429 is specifically because extra usage (overage) is not
          // available, permanently disable fast mode with a specific message.
          const overageReason = error.headers?.get(
            'anthropic-ratelimit-unified-overage-disabled-reason',
          )
          if (overageReason !== null && overageReason !== undefined) {
            handleFastModeOverageRejection(overageReason)
            retryContext.fastMode = false
            attempt--
            continue
          }
        }

        const retryAfterMs =
          error instanceof APIError ? getRetryAfterMs(error) : null
        const isShortRetryAfter =
          retryAfterMs !== null && retryAfterMs < SHORT_RETRY_THRESHOLD_MS
        if (
          error instanceof APIError &&
          (error.status === 429 || is529Error(error)) &&
          !isRetryWatchdogActive() &&
          isShortRetryAfter
        ) {
          // Official 2.1.328 `eGe` (`chunk@294254613.js:3282538`): enforce
          // cumulative 20s cap across fast-mode short retry-after waits, report
          // retry status, and yield a retry notification before sleeping.
          const backoffMs = getRetryDelay(
            attempt,
            null,
            SHORT_RETRY_THRESHOLD_MS,
          )
          const waitMs = Math.max(backoffMs, retryAfterMs)
          if (
            fastModeShortRetrySpentMs + waitMs < SHORT_RETRY_THRESHOLD_MS &&
            attempt <= maxRetries
          ) {
            fastModeShortRetrySpentMs += waitMs
            options.onRetryStatus?.({
              kind: 'retrying',
              deadline: Date.now() + waitMs,
              attempt,
              maxRetries,
              error: {
                status: error.status,
                formatted: error.message,
              },
            })
            const notif = createRetryNotificationMessage(
              error,
              waitMs,
              attempt,
              maxRetries,
            )
            if (notif) {
              yield notif
            }
            await sleep(waitMs, options.signal, { abortError })
            continue
          }
        }
        // Long/unknown retry-after, 5xx, timeout, or watchdog active: fall back
        // to standard speed on the same model and refund the retry slot.
        const cooldownMs = Math.max(
          retryAfterMs ?? DEFAULT_FAST_MODE_FALLBACK_HOLD_MS,
          MIN_COOLDOWN_MS,
        )
        const cooldownReason: CooldownReason =
          error instanceof APIConnectionTimeoutError
            ? 'timeout'
            : is529Error(error)
              ? 'overloaded'
              : error instanceof APIError &&
                  error.status !== undefined &&
                  error.status >= 500
                ? 'server_error'
                : 'rate_limit'
        triggerFastModeCooldown(Date.now() + cooldownMs, cooldownReason)
        if (isFastModeEnabled()) {
          retryContext.fastMode = false
        }
        attempt--
        continue
      }

      // Official 2.1.322 (#1963): Vertex / API fast-mode refusal falls back to
      // standard speed on the same model for this session and refunds attempt.
      if (wasFastModeActive && isFastModeRefusalError(error)) {
        if (error instanceof APIError && error.status === 400) {
          markModelFastModeRejectedForSession(retryContext.model)
        } else {
          triggerFastModeCooldown(
            Date.now() + DEFAULT_FAST_MODE_FALLBACK_HOLD_MS,
            'refused',
          )
        }
        retryContext.fastMode = false
        attempt--
        continue
      }

      // Fast mode fallback: if the API rejects the fast mode parameter
      // (e.g., org doesn't have fast mode enabled), permanently disable fast
      // mode and retry at standard speed — EXCEPT for Opus 4.8 after sunset
      // (tengu_sunset_penguin_opus48), where fast mode requests must error
      // rather than falling back to standard Opus 4.8.
      if (
        wasFastModeActive &&
        (isFastModeNotEnabledError(error) ||
          isSpeedParameterUnsupportedError(error, options.model)) &&
        !isOpus48FastModeRemoved(options.model)
      ) {
        handleFastModeRejectedByAPI()
        retryContext.fastMode = false
        attempt--
        continue
      }

      // Non-foreground sources bail immediately on 529 — no retry amplification
      // during capacity cascades. User never sees these fail.
      // Official 2.1.328: `!h_e(r.querySource) && !ME()`.
      if (
        is529Error(error) &&
        !shouldRetry529(options.querySource) &&
        !isFullRetryWatchdogActive()
      ) {
        logEvent('tengu_api_529_background_dropped', {
          query_source:
            options.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw new CannotRetryError(error, retryContext)
      }

      // Official 2.1.328 `Hi`: overload wait active when Y1e(querySource)
      // resolved CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS and error is 529.
      const overloadWaitActive =
        overloadWaitMaxMs !== undefined &&
        is529Error(error) &&
        !(
          error instanceof APIError &&
          error.status !== undefined &&
          error.status < 500
        )

      // Track consecutive 529 errors (Official #1880: only fall back to another
      // model when `!wasFastModeActive` — fast mode tries standard speed first).
      // Official 2.1.328 (`chunk@294254613.js:3283609`): allow explicit
      // `options.fallbackModel !== undefined` to trigger 529 fallback for
      // Claude.ai subscribers and non-Opus models as well.
      if (
        !wasFastModeActive &&
        is529Error(error) &&
        (process.env.FALLBACK_FOR_ALL_PRIMARY_MODELS ||
          options.fallbackModel !== undefined ||
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
              'overloaded',
              error,
            )
          }

          if (
            process.env.USER_TYPE === 'external' &&
            !process.env.IS_SANDBOX &&
            !isRetryWatchdogEnabled() &&
            !isUnattendedRetryEnabled() &&
            !overloadWaitActive
          ) {
            logEvent('tengu_api_custom_529_overloaded_error', {})
            throw new CannotRetryError(
              new Error(REPEATED_529_ERROR_MESSAGE),
              retryContext,
            )
          }
        }
      }

      // Official 2.1.323 (#2005): Do not retry Desktop host 403 a second time
      if (
        error instanceof APIError &&
        error.status === 403 &&
        hostAuth403Retried
      ) {
        throw new CannotRetryError(error, retryContext)
      }

      // Official 2.1.328 `Hs`: persistent capacity retry driven by
      // `isRetryWatchdogEnabled() || isUnattendedRetryEnabled()` on 429/529
      // OR `overloadWaitActive` (`Hi`) on main-turn 529.
      const persistent =
        overloadWaitActive ||
        ((isRetryWatchdogEnabled() || isUnattendedRetryEnabled()) &&
          isTransientCapacityError(error))
      if (refusedAfterDesktopOneOff401 && !persistent) {
        // Official 2.1.328 (`if (yo && !Hs && !wd) is--`): do not burn a retry
        // attempt when the one-shot Desktop OAuth resend is refused again with 401.
        attempt--
      } else if (attempt > maxRetries && !persistent) {
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

      // AWS/GCP errors aren't always APIError, but can be retried.
      // leftover 239: !(Aew||Tew||kew) && (!Os || !Cew) → CannotRetry.
      const handledCloudAuthError =
        handleAwsCredentialError(error) || handleGcpCredentialError(error)
      let handledWifAuthError = false
      try {
        const { invalidateOidcFederationCacheOnRetry } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../utils/anthropicOidc.js') as typeof import('../../utils/anthropicOidc.js')
        handledWifAuthError = await invalidateOidcFederationCacheOnRetry(error)
      } catch {
        handledWifAuthError = false
      }
      if (
        !handledCloudAuthError &&
        !handledWifAuthError &&
        !isStaleConnectionError(error) &&
        (!(error instanceof APIError) || !shouldRetry(error))
      ) {
        // Official 2.1.328 (`chunk@294254613.js:3286400-3286800`): fall back
        // via `last_resort` on eligible non-retryable HTTP errors when a
        // distinct `options.fallbackModel` is configured.
        if (
          error instanceof APIError &&
          error.status !== undefined &&
          !isLastResortFallbackExcluded(error, options) &&
          options.fallbackModel &&
          options.fallbackModel !== options.model
        ) {
          logEvent('tengu_api_fallback_last_resort', {
            status: error.status,
            provider: getAPIProviderForStatsig(),
            fastMode: retryContext.fastMode ?? false,
          })
          logEvent('api_request', {
            status:
              'api_request_last_resort_fallback' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new FallbackTriggeredError(
            options.model,
            options.fallbackModel,
            error.status === 404 && isNotFoundErrorType(error)
              ? 'model_not_found'
              : 'last_resort',
            error,
          )
        }
        // densable `re("api_request", x instanceof yz || Upe(x) !== null ? "api_request_account_on_hold" : "api_request_non_retryable")`
        if (
          error instanceof OAuthAccountOnHoldError ||
          getProfileAccountOnHold(error) !== null
        ) {
          logEvent('api_request', {
            status:
              'api_request_account_on_hold' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
        }
        throw new CannotRetryError(error, retryContext)
      }

      // Handle max tokens context overflow errors by adjusting max_tokens for the next attempt
      // NOTE: With extended-context-window beta, this 400 error should not occur.
      // The API now returns 'model_context_window_exceeded' stop_reason instead.
      // Keeping for backward compatibility.
      // densable 2.1.218 RFo: clamp to availableContext ONLY (no thinking inflate)
      // and abort when the adjustment makes no progress (doomed identical re-send).
      if (error instanceof APIError) {
        // Official 2.1.326 (#51) + 2.1.328 `xCt`: if API says `max_tokens: X > Y, which is
        // the maximum allowed number of output tokens for ...`, lower max_tokens
        // to Y (>= 4096), retry once, and cache only once the reply begins.
        const ceilingData =
          !isSecurityControlQuery && !maxTokensCeilingAdjusted
            ? parseApiMaxTokensCeilingError(error)
            : null
        if (
          ceilingData &&
          (retryContext.maxTokensOverride === undefined ||
            ceilingData.maximum < retryContext.maxTokensOverride)
        ) {
          maxTokensCeilingAdjusted = true
          retryContext.maxTokensOverride = ceilingData.maximum
          pendingModelMaxTokensCeiling = {
            model: retryContext.model,
            limit: ceilingData.maximum,
          }
          logForDebugging(
            `[max_tokens] API reported ceiling ${ceilingData.maximum} (< requested ${ceilingData.requested}) for ${retryContext.model}; retrying with lowered max_tokens`,
            { level: 'warn' },
          )
          continue
        }

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
      const overloaded = is529Error(error)
      const overloadedBaseDelayMs = overloaded
        ? getOverloadedRetryBaseDelayMs()
        : undefined
      const overloadedMaxDelayMs = overloaded
        ? getOverloadedRetryMaxDelayMs()
        : undefined
      // Official 2.1.328 (`Hs` capacity wait cap):
      // `($e ?? s.CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS ?? Infinity) - spentMs`.
      const maxWaitMs = persistent
        ? (overloadWaitMaxMs ??
          parseOptionalNonNegativeIntEnv(
            'CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS',
          ))
        : undefined
      if (maxWaitMs !== undefined && maxWaitMs - watchdogSpentMs <= 0) {
        throw new CannotRetryError(error, retryContext)
      }

      // Official 2.1.301 (#843) + 2.1.328 (`Hs` 429 usage-limit wait cap):
      // Driven by `persistent` (`zHe()` ignores `CLAUDE_CODE_RETRY_WATCHDOG_SCOPE`).
      let isUsageLimit429 = false
      let usageLimitOverrideDelay: number | undefined
      if (persistent && error instanceof APIError && error.status === 429) {
        const resetDelay = getRateLimitResetDelayMs(error)
        if (
          resetDelay !== null &&
          error.headers?.get?.('anthropic-ratelimit-unified-status') ===
            'rejected'
        ) {
          const maxUsageLimitWaitMs = getRetryWatchdogMaxUsageLimitWaitMs()
          const remainingUsageLimitWait =
            (maxUsageLimitWaitMs ?? Infinity) - usageLimitSpentMs
          if (resetDelay > remainingUsageLimitWait) {
            const overageStatus = error.headers?.get?.(
              'anthropic-ratelimit-unified-overage-status',
            )
            const overageAllowed =
              overageStatus === 'allowed' || overageStatus === 'allowed_warning'
            const disabledReason = error.headers?.get?.(
              'anthropic-ratelimit-unified-overage-disabled-reason',
            )
            if (
              remainingUsageLimitWait <= 0 ||
              (!overageAllowed && disabledReason !== 'fetch_error')
            ) {
              throw new CannotRetryError(error, retryContext)
            }
            usageLimitOverrideDelay = overageAllowed
              ? Math.min(remainingUsageLimitWait, getRetryDelay(attempt))
              : remainingUsageLimitWait
          }
          isUsageLimit429 = true
        }
      }

      let delayMs: number
      let suppressRetryBanner = false
      const oauthTokensNow = getClaudeAIOAuthTokens()
      const desktopOneOff401Token =
        !persistent &&
        desktopOneOff401State.state === 'unused' &&
        lastClientOAuthAccessToken !== undefined &&
        !oauth401ForcedRefreshDone &&
        !oauthTokensNow?.refreshToken &&
        getSdkOauthTokenRefreshCallback() !== null &&
        isDesktopCodeTabOneOff401Eligible(error)
          ? lastClientOAuthAccessToken
          : undefined

      if (desktopOneOff401Token !== undefined) {
        desktopOneOff401State = {
          state: 'due',
          token: desktopOneOff401Token,
        }
        delayMs =
          options.desktopOneOff401DelayMs ??
          DESKTOP_CODE_TAB_ONE_OFF_401_RETRY_DELAY_MS
        suppressRetryBanner = true
        logForDebugging(
          `A 401 under an SDK host: sending the request once more in ${delayMs} ms, before the host is asked for a token`,
        )
      } else if (
        persistent &&
        error instanceof APIError &&
        error.status === 429
      ) {
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
        const retryAfterMs =
          error instanceof APIError ? getRetryAfterMs(error) : null
        if (
          overloadWaitActive &&
          maxWaitMs !== undefined &&
          retryAfterMs !== null &&
          retryAfterMs > maxWaitMs - watchdogSpentMs
        ) {
          logEvent('tengu_api_retry_after_too_long', {
            delayMs: retryAfterMs,
            status: (error as APIError).status,
            provider: getAPIProviderForStatsig(),
          })
          throw new CannotRetryError(error, retryContext)
        }
        delayMs = Math.min(
          getRetryDelay(
            persistentAttempt,
            retryAfter,
            overloadedMaxDelayMs ?? PERSISTENT_MAX_BACKOFF_MS,
            overloadedBaseDelayMs,
          ),
          PERSISTENT_RESET_CAP_MS,
        )
      } else {
        // Official 2.1.328 (`chunk@294254613.js:3289294`): in non-persistent
        // mode, abort with `tengu_api_retry_after_too_long` when `Retry-After`
        // exceeds `Math.max(60_000, maxDelay * 1.25)`.
        const retryAfterMs = parseRetryAfterHeaderMs(retryAfter) ?? 0
        const retryAfterCeilingMs = Math.max(
          NON_PERSISTENT_MAX_RETRY_AFTER_MS,
          (overloadedMaxDelayMs ?? 0) * (1 + RETRY_JITTER_RATIO),
        )
        if (isFullRetryWatchdogActive()) {
          delayMs = Math.min(
            getRetryDelay(
              attempt,
              retryAfter,
              overloadedMaxDelayMs,
              overloadedBaseDelayMs,
            ),
            PERSISTENT_RESET_CAP_MS,
          )
        } else if (retryAfterMs > retryAfterCeilingMs) {
          logEvent('tengu_api_retry_after_too_long', {
            delayMs: retryAfterMs,
            status: error instanceof APIError ? error.status : undefined,
            provider: getAPIProviderForStatsig(),
          })
          logEvent('api_request', {
            status:
              'api_request_retry_after_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new CannotRetryError(error, retryContext)
        } else {
          delayMs = getRetryDelay(
            attempt,
            retryAfter,
            overloadedMaxDelayMs,
            overloadedBaseDelayMs,
          )
        }
      }
      if (usageLimitOverrideDelay !== undefined) {
        delayMs = usageLimitOverrideDelay
      }
      if (maxWaitMs !== undefined) {
        delayMs = Math.min(delayMs, Math.max(0, maxWaitMs - watchdogSpentMs))
        watchdogSpentMs += delayMs
      }
      if (persistent && isUsageLimit429) {
        usageLimitSpentMs += delayMs
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

      if (suppressRetryBanner) {
        options.onRetryStatus?.(null)
      } else {
        options.onRetryStatus?.({
          kind: 'retrying',
          deadline: Date.now() + delayMs,
          attempt: reportedAttempt,
          maxRetries,
          error: {
            status: error instanceof APIError ? error.status : undefined,
            formatted:
              error instanceof APIError ? error.message : errorMessage(error),
          },
        })
      }

      const useHeartbeatSleep =
        persistent ||
        delayMs > NON_PERSISTENT_MAX_RETRY_AFTER_MS ||
        (isFullRetryWatchdogActive() &&
          delayMs > NON_PERSISTENT_MAX_RETRY_AFTER_MS)
      if (useHeartbeatSleep) {
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
        // Official 2.1.305 (#1035) + 2.1.328: when
        // CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS is set during a
        // usage-limit wait, periodically check isUsageLimitLifted().
        const recheckMs =
          isUsageLimit429 && persistent && options.isUsageLimitLifted
            ? getRetryWatchdogUsageLimitRecheckMs()
            : undefined
        let recheckRemaining =
          recheckMs !== undefined && recheckMs > 0 ? recheckMs : Infinity
        let remaining = delayMs
        while (remaining > 0) {
          if (options.signal?.aborted) throw new APIUserAbortError()
          if (!suppressRetryBanner) {
            const notif = createRetryNotificationMessage(
              error,
              remaining,
              reportedAttempt,
              maxRetries,
            )
            if (notif) {
              yield notif
            }
          }
          const chunk = Math.min(
            remaining,
            HEARTBEAT_INTERVAL_MS,
            recheckRemaining,
          )
          await sleep(chunk, options.signal, { abortError })
          remaining -= chunk
          if (recheckMs !== undefined && recheckMs > 0) {
            recheckRemaining -= chunk
            if (
              recheckRemaining <= 0 &&
              remaining > HEARTBEAT_INTERVAL_MS &&
              options.isUsageLimitLifted
            ) {
              recheckRemaining = recheckMs
              let lifted = false
              try {
                lifted = await options.isUsageLimitLifted()
              } catch {
                lifted = false
              }
              if (lifted) {
                break
              }
            }
          }
        }
        // Clamp so the for-loop never terminates on persistent capacity waits.
        // Backoff uses the separate persistentAttempt counter which keeps
        // growing to the 5-min cap (bounded by maxWaitMs when configured).
        if (persistent && attempt >= maxRetries) attempt = maxRetries
      } else {
        if (!suppressRetryBanner) {
          const notif = createRetryNotificationMessage(
            error,
            delayMs,
            attempt,
            maxRetries,
          )
          if (notif) {
            yield notif
          }
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

function parseOptionalNonNegativeIntEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const parsed = parseInt(raw, 10)
  return !Number.isNaN(parsed) && parsed >= 0 ? parsed : undefined
}

function parseBoundedIntEnv(
  name: string,
  min: number,
  max: number,
): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  if (!/^\d+$/.test(raw)) return undefined
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return undefined
  return parsed
}

export const OVERLOADED_RETRY_MAX_DELAY_MIN_MS = 32000
/** Official 2.1.323 (#2202): raised max of CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS from 64000 to 300000. */
export const OVERLOADED_RETRY_MAX_DELAY_MAX_MS = 300000

export function getOverloadedRetryBaseDelayMs(): number | undefined {
  return parseBoundedIntEnv(
    'CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS',
    500,
    32000,
  )
}

export function getOverloadedRetryMaxDelayMs(): number | undefined {
  return parseBoundedIntEnv(
    'CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS',
    OVERLOADED_RETRY_MAX_DELAY_MIN_MS,
    OVERLOADED_RETRY_MAX_DELAY_MAX_MS,
  )
}

export function getRetryWatchdogMaxWaitMs(
  overloaded: boolean,
): number | undefined {
  if (overloaded) {
    const overloadedWait = parseOptionalNonNegativeIntEnv(
      'CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS',
    )
    if (overloadedWait !== undefined) return overloadedWait
  }
  return parseOptionalNonNegativeIntEnv(
    'CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS',
  )
}

export function getRetryWatchdogMaxUsageLimitWaitMs(): number | undefined {
  return parseOptionalNonNegativeIntEnv(
    'CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS',
  )
}

/** Official 2.1.305 (#1035): CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS */
export function getRetryWatchdogUsageLimitRecheckMs(): number | undefined {
  return parseOptionalNonNegativeIntEnv(
    'CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS',
  )
}

export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
  baseDelayMs = BASE_DELAY_MS,
): number {
  const baseDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
  const jitter = Math.random() * 0.25 * baseDelay
  const backoffMs = Math.round(baseDelay + jitter)

  if (retryAfterHeader) {
    const retryAfterMs = parseRetryAfterHeaderMs(retryAfterHeader)
    if (retryAfterMs !== null) {
      return Math.max(retryAfterMs, backoffMs)
    }
  }

  return backoffMs
}

export function parseMaxTokensContextOverflowError(error: APIError):
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
export function isFastModeNotEnabledError(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }
  return (
    error.status === 400 &&
    (error.message?.includes('Fast mode is not enabled') ?? false)
  )
}

export function isSpeedParameterUnsupportedError(
  error: unknown,
  model: string,
): boolean {
  if (!(error instanceof APIError) || error.status !== 400) {
    return false
  }
  const match = error.message?.match(
    /'([^']+)' does not support the `speed` parameter/,
  )?.[1]
  return (
    match !== undefined &&
    firstPartyNameToCanonical(match) === firstPartyNameToCanonical(model)
  )
}

/**
 * Official 2.1.316 Auo — deprecation notice for Opus 4.8 fast mode before the
 * `tengu_sunset_penguin_opus48` removal date (default `'2026-11-30'`).
 */
export function getOpus48FastModeDeprecationNotice(
  model: string,
  nowMs: number = Date.now(),
): {
  key: 'opus48-fast-mode-deprecation'
  text: string
  priority: 'immediate'
  requeueOnPreempt: true
  color: 'warning'
} | null {
  if (firstPartyNameToCanonical(model) !== 'claude-opus-4-8') {
    return null
  }
  const raw = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_sunset_penguin_opus48',
    '2026-11-30',
  )
  const sunsetMs = Date.parse(raw)
  if (Number.isNaN(sunsetMs) || nowMs >= sunsetMs) {
    return null
  }
  const formatted = new Date(sunsetMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return {
    key: 'opus48-fast-mode-deprecation',
    text: `Opus 4.8 fast mode is deprecated and will be removed on ${formatted}`,
    priority: 'immediate',
    requeueOnPreempt: true,
    color: 'warning',
  }
}

/**
 * Returns true when `model` is Opus 4.8 and the `tengu_sunset_penguin_opus48`
 * removal date has passed (fast mode requests must error and not fall back).
 */
export function isOpus48FastModeRemoved(
  model: string,
  nowMs: number = Date.now(),
): boolean {
  if (firstPartyNameToCanonical(model) !== 'claude-opus-4-8') {
    return false
  }
  const raw = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_sunset_penguin_opus48',
    '2026-11-30',
  )
  const sunsetMs = Date.parse(raw)
  return !Number.isNaN(sunsetMs) && nowMs >= sunsetMs
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
    // Official 2.1.323 (#2006): Bedrock 403 model-access refusal is not a
    // stale-credential error; do not refresh AWS credentials or retry it.
    if (isBedrockModelAccessRefusalError(error)) {
      return false
    }
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

const OVERAGE_DISABLED_REASON_HEADER =
  'anthropic-ratelimit-unified-overage-disabled-reason'
const UNIFIED_CLAIM_HEADER = 'anthropic-ratelimit-unified-representative-claim'
const UNIFIED_OVERAGE_STATUS_HEADER =
  'anthropic-ratelimit-unified-overage-status'

/** densable n9f */
const SPEND_CAP_OVERAGE_REASONS = new Set([
  'org_spend_cap_reached',
  'org_level_disabled_until',
])

/** densable Y8f */
const SPEND_OR_CREDITS_OVERAGE_REASONS = new Set([
  ...SPEND_CAP_OVERAGE_REASONS,
  'out_of_credits',
  'org_level_disabled',
  'org_service_level_disabled',
])

/** densable xew — body may quote the key with or without backslashes */
const OVERAGE_DISABLED_REASON_IN_BODY =
  /\\?"overageDisabledReason\\?":\s*\\?"([a-z_]+)\\?"/

/** densable r5n */
function hasUnifiedRateLimitHeaders(error: APIError): boolean {
  return Boolean(
    error.headers?.get?.(UNIFIED_CLAIM_HEADER) ||
      error.headers?.get?.(UNIFIED_OVERAGE_STATUS_HEADER),
  )
}

/**
 * Official 2.1.328 `Iso(e)` (`chunk@294254613.js:3297279`) — transient 429
 * lacking unified rate-limit quota headers (`representative-claim`,
 * `overage-status`, `overage-disabled-reason`), allowing Pro/Max Claude.ai
 * subscribers to retry transient non-quota 429s.
 */
export function isTransientNonUnified429(error: APIError): boolean {
  return (
    error.status === 429 &&
    !hasUnifiedRateLimitHeaders(error) &&
    !error.headers?.get?.(OVERAGE_DISABLED_REASON_HEADER)
  )
}

/**
 * densable 2.1.239 Rew — 429 spend-limit / out-of-credits must not retry
 * (watchdog included). Header n9f always fails; Y8f fails when the response
 * has no unified claim/overage-status pair; body `exceeded_limit` + Y8f
 * reason also fails.
 */
export function isSpendLimitOrOutOfCreditsError(error: APIError): boolean {
  if (error.status !== 429) {
    return false
  }
  if (error.message.includes('service_spend_limit_reached')) {
    return true
  }
  const reason = error.headers?.get?.(OVERAGE_DISABLED_REASON_HEADER)
  if (
    reason &&
    (SPEND_CAP_OVERAGE_REASONS.has(reason) ||
      (!hasUnifiedRateLimitHeaders(error) &&
        SPEND_OR_CREDITS_OVERAGE_REASONS.has(reason)))
  ) {
    return true
  }
  if (!error.message.includes('exceeded_limit')) {
    return false
  }
  const fromBody = OVERAGE_DISABLED_REASON_IN_BODY.exec(error.message)?.[1]
  return (
    fromBody !== undefined && SPEND_OR_CREDITS_OVERAGE_REASONS.has(fromBody)
  )
}

/**
 * densable 2.1.239 Cew credits-required gate. `fetch_error` and
 * `org_level_disabled_until` fall through to Rew.
 */
function isNonRetryableCreditsRequired(error: APIError): boolean {
  if (error.status !== 429) {
    return false
  }
  const body = error.error
  const detailsCode =
    typeof body === 'object' && body !== null
      ? (body as { error?: { details?: { error_code?: unknown } } }).error
          ?.details?.error_code
      : undefined
  const creditsRequired =
    detailsCode === 'credits_required' ||
    error.message?.toLowerCase().includes('usage credits are required') ||
    error.message?.toLowerCase().includes('extra usage is required')
  if (!creditsRequired) {
    return false
  }
  const reason = error.headers?.get(OVERAGE_DISABLED_REASON_HEADER)
  return reason !== 'fetch_error' && reason !== 'org_level_disabled_until'
}

/**
 * Official 2.1.323 (#2107): When a user explicitly chose to wait in the usage
 * limit menu and the retry request after the wait is still refused (429 with
 * a later reset window), do not silently advance to a later reset — signal
 * callers to reopen the usage limit menu instead.
 */
export function shouldOpenUsageLimitMenuAfterWaitRefusal(
  error: unknown,
  opts: {
    choseWaitInMenu: boolean
    previousResetsAt?: number
    nextResetsAt?: number
  },
): boolean {
  if (!opts.choseWaitInMenu) return false
  if (!(error instanceof APIError) || error.status !== 429) return false
  if (
    opts.previousResetsAt !== undefined &&
    opts.nextResetsAt !== undefined &&
    opts.nextResetsAt > opts.previousResetsAt
  ) {
    return true
  }
  const status = error.headers?.get('anthropic-ratelimit-unified-status')
  return status === 'rejected'
}

/**
 * densable 2.1.239 Cew. Exported so #44 En_ (400 policy_blocked +
 * x-should-retry:false) can be locked without inventing a second retry gate.
 */
export function shouldRetry(error: APIError): boolean {
  // Never retry mock errors - they're from /mock-limits command for testing
  if (isMockRateLimitError(error)) {
    return false
  }

  // densable 2.1.239 Cew — credits-required / Rew spend-limit / out-of-credits
  // fail immediately (watchdog must not retry these; double-wait burns quota).
  if (
    isNonRetryableCreditsRequired(error) ||
    isSpendLimitOrOutOfCreditsError(error)
  ) {
    return false
  }

  // densable 2.1.311 vns: respect explicit x-should-retry: false on 429, 529,
  // or first-party 503 (unless overage-disabled-reason is fetch_error) even
  // when persistent retry / CLAUDE_CODE_RETRY_WATCHDOG is enabled.
  if (
    isTransientCapacityError(error) &&
    error.headers?.get('x-should-retry') === 'false' &&
    (error.status === 429 ||
      error.status === 529 ||
      (error.status === 503 &&
        getAPIProvider() === 'firstParty' &&
        isFirstPartyAnthropicBaseUrl())) &&
    error.headers?.get(
      'anthropic-ratelimit-unified-overage-disabled-reason',
    ) !== 'fetch_error'
  ) {
    return false
  }

  // Persistent / watchdog mode: 429/529 always retryable, bypass subscriber
  // gates (x-should-retry: false was already respected above per densable vns).
  // Official 2.1.328 `wMs`: `if (zHe() && fAt(e)) return true`.
  if (
    (isRetryWatchdogEnabled() || isUnattendedRetryEnabled()) &&
    isTransientCapacityError(error)
  ) {
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

  // densable odn: wl()+Xt / !$V()+Wd / AL before x-should-retry.
  // Local wl lacks if(Wd())return!1 — compose !profileActive.
  const oauthTokens = getClaudeAIOAuthTokens()
  const revoked = isOAuthTokenRevokedError(error)
  const profileActive = isProfileAuthActive({
    storedClaudeAiLogin: isUsableStoredClaudeAiLogin(oauthTokens),
  })
  if (
    isAnthropicAuthEnabled() &&
    !profileActive &&
    oauthTokens?.accessToken &&
    (error.status === 401 || revoked)
  ) {
    return true
  }
  // $V = Gg().key; local probe is hasAnthropicApiKeyAuth (skip helper / CI throw).
  if (
    !hasAnthropicApiKeyAuth() &&
    profileActive &&
    (error.status === 401 || revoked)
  ) {
    return true
  }
  // Official 2.1.323 (#2005): Claude Desktop host credential refresh covers
  // both 401 and 403 (when an organization's gateway answers an expired token with 403).
  if (
    isHostAuthTokenRefreshAvailable() &&
    (error.status === 401 || error.status === 403)
  ) {
    return true
  }

  // Official 2.1.326 (#51): allow retry when API reports max_tokens > model max
  if (parseApiMaxTokensCeilingError(error) !== null) {
    return true
  }

  // Note this is not a standard header.
  const shouldRetryHeader = error.headers?.get('x-should-retry')

  // If the server explicitly says whether or not to retry, obey.
  // For Max and Pro users, should-retry is true, but in several hours, so we shouldn't
  // UNLESS the 429 lacks unified rate-limit headers (transient non-quota 429, official Iso).
  // Enterprise users can retry because they typically use PAYG instead of rate limits.
  if (
    shouldRetryHeader === 'true' &&
    (!isClaudeAISubscriber() ||
      isEnterpriseSubscriber() ||
      isTransientNonUnified429(error))
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
    const connCode = extractConnectionErrorDetails(error)?.code
    // densable 2.1.239 Cew: BedrockUnexpectedContentType is not retried
    // (retrying would issue a second Bedrock request / double bill).
    if (connCode === 'BedrockUnexpectedContentType') {
      return false
    }
    // Official 2.1.323 (#2072) & 2.1.326 (#174): certificate name-constraint
    // and CERT_SIGNATURE_FAILURE errors never succeed on retry — fail fast.
    if (
      (connCode !== undefined &&
        NAME_CONSTRAINT_CERT_ERROR_CODES.has(connCode)) ||
      isCertSignatureFailureError(error)
    ) {
      return false
    }
    return true
  }

  if (!error.status) return false

  // Retry on request timeouts.
  if (error.status === 408) return true

  // Retry on lock timeouts.
  if (error.status === 409) return true

  // Retry on rate limits, but not for ClaudeAI Subscription users
  // unless it is a transient non-unified 429 lacking quota headers (official Iso).
  // Enterprise users can retry because they typically use PAYG instead of rate limits.
  if (error.status === 429) {
    return (
      !isClaudeAISubscriber() ||
      isEnterpriseSubscriber() ||
      isTransientNonUnified429(error)
    )
  }

  // densable odn late: if(e.status===401)return lAe(),!0
  // Clear API key cache on 401 and allow retry.
  // OAuth/profile refresh is in the main retry loop via handleOAuth401Error / lt.
  if (error.status === 401) {
    clearApiKeyHelperCache()
    return true
  }

  // densable odn late: if(TX(e))return!0
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
const maxRetriesClampWarnedSlot = new HostSlot<{ warned: boolean }>(() => ({
  warned: false,
}))

/**
 * Official 2.1.328 `zHe()`: `CLAUDE_CODE_RETRY_WATCHDOG` is truthy/enabled,
 * IGNORING `CLAUDE_CODE_RETRY_WATCHDOG_SCOPE`. Drives persistent 429/529
 * capacity retries, subscriber 429 bypass, heartbeat, and usage-limit recheck.
 */
export function isRetryWatchdogEnabled(
  watchdog: string | undefined = process.env.CLAUDE_CODE_RETRY_WATCHDOG,
): boolean {
  if (watchdog === undefined || watchdog === '') return false
  if (watchdog === '0' || watchdog.toLowerCase() === 'false') return false
  const parsed = parseInt(watchdog, 10)
  return (
    (!Number.isNaN(parsed) && parsed > 1) ||
    isEnvTruthy(watchdog) ||
    Number.isNaN(parsed) ||
    parsed === 1
  )
}

/**
 * Official 2.1.328 `ME()`: full retry watchdog (non-capacity behaviors such as
 * 300-retry budget, >15 max-retry clamp lift, background 529 drop bypass) —
 * active when `CLAUDE_CODE_RETRY_WATCHDOG` is enabled AND
 * `CLAUDE_CODE_RETRY_WATCHDOG_SCOPE !== 'capacity'`.
 */
export function isFullRetryWatchdogActive(
  watchdog: string | undefined = process.env.CLAUDE_CODE_RETRY_WATCHDOG,
  scope: string | undefined = process.env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE,
): boolean {
  if (!isRetryWatchdogEnabled(watchdog)) return false
  return scope !== 'capacity'
}

export function isRetryWatchdogActive(
  watchdog: string | undefined = process.env.CLAUDE_CODE_RETRY_WATCHDOG,
  scope: string | undefined = process.env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE,
): boolean {
  return isFullRetryWatchdogActive(watchdog, scope)
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
      const clampWarnState = maxRetriesClampWarnedSlot.of(
        getBootstrapSessionHost(),
      )
      if (!clampWarnState.warned) {
        clampWarnState.warned = true
        logForDebugging(
          `CLAUDE_CODE_MAX_RETRIES=${parsed} clamped to ${MAX_RETRIES_CLAMP}`,
          { level: 'warn' },
        )
      }
      return MAX_RETRIES_CLAMP
    }
    return parsed
  }
  // Official 2.1.199 stream-retry budget for transient mid-response drops
  // (gated by watchdogActive so scoped/nested `claude -p` stays on default).
  const watchdog = process.env.CLAUDE_CODE_RETRY_WATCHDOG
  if (watchdogActive && watchdog !== undefined && watchdog !== '') {
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

const HTTP_DATE_TIME_RE = String.raw`(\d\d:\d\d)(:\d\d)?(?:\.\d{1,9})?`
const HTTP_DATE_TZ_RE = String.raw`(?:GMT|UTC?|Z|(?:GMT|UTC)?([+-][01]\d):?([0-5]\d))`
const RFC7231_DATE_RE = new RegExp(
  String.raw`^(?:[a-z]{3,9},? *)?(\d\d?)[ -]([a-z]{3})[a-z]{0,6}[ -](\d\d(?:\d\d)?) +${HTTP_DATE_TIME_RE} +${HTTP_DATE_TZ_RE}$`,
  'i',
)
const ALT_DATE_RE = new RegExp(
  String.raw`^(?:[a-z]{3,9},? *)?([a-z]{3}) (\d\d?) (\d{4}) ${HTTP_DATE_TIME_RE} ${HTTP_DATE_TZ_RE}(?: \(.*\))?$`,
  'i',
)
const ASCTIME_DATE_RE =
  /^[a-z]{3,9} ([a-z]{3} +\d\d?) (\d\d:\d\d:\d\d)(?: GMT| UTC)? (\d{4})(?: GMT)?$/i
const ISO_DATE_RE =
  /^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?)(?:Z|([+-][01]\d):?([0-5]\d))$/i

function parseHttpDateMs(raw: string): number {
  const m1 = RFC7231_DATE_RE.exec(raw) ?? ALT_DATE_RE.exec(raw)
  if (m1) {
    const [, a, b, c, hhmm, ss, tzH, tzM] = m1
    return Date.parse(
      `${a} ${b} ${c} ${hhmm}${ss ?? ':00'} GMT${tzH ?? '+00'}${tzM ?? '00'}`,
    )
  }
  const m2 = ISO_DATE_RE.exec(raw)
  if (m2) {
    return Date.parse(
      `${m2[1]?.toUpperCase()}${m2[2] ?? '+00'}:${m2[3] ?? '00'}`,
    )
  }
  const m3 = ASCTIME_DATE_RE.exec(raw)
  if (m3) {
    return Date.parse(`${m3[1]} ${m3[3]} ${m3[2]} GMT`)
  }
  return Number.NaN
}

/**
 * Official 2.1.328 `wp` / `aB` / `FCi` / `vUe` (`chunk@286370035.js:298900-299600`) —
 * parse `Retry-After` header in milliseconds supporting BOTH numeric seconds
 * (integer or decimal) AND HTTP-date formats (RFC 7231 IMF-fixdate, RFC 850,
 * asctime, ISO-8601). Past HTTP-dates return null so normal backoff applies.
 */
export function parseRetryAfterHeaderMs(
  header: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (
    typeof header !== 'string' ||
    header.length === 0 ||
    header.length > 100
  ) {
    return null
  }
  const trimmed = header.replace(/^[ \t]+|[ \t]+$/g, '')
  if (trimmed.length === 0) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed)
    return Number.isFinite(sec) ? Math.round(sec * 1000) : null
  }
  const parsedDateMs = parseHttpDateMs(trimmed)
  if (Number.isFinite(parsedDateMs) && parsedDateMs > nowMs) {
    return Math.round(parsedDateMs - nowMs)
  }
  return null
}

export function getRetryAfterMs(
  error: APIError,
  nowMs: number = Date.now(),
): number | null {
  const retryAfter = getRetryAfter(error)
  return parseRetryAfterHeaderMs(retryAfter, nowMs)
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
