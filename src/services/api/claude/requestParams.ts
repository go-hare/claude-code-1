import type {
  BetaMessageStreamParams,
  BetaOutputConfig,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getSessionId, isEffortUnsupported } from 'src/bootstrap/state.js'
import {
  EFFORT_BETA_HEADER,
  TASK_BUDGETS_BETA_HEADER,
} from 'src/constants/betas.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { shouldIncludeFirstPartyOnlyBetas } from 'src/utils/betas.js'
import { logForDebugging } from 'src/utils/debug.js'
import { type EffortValue, modelSupportsEffort } from 'src/utils/effort.js'
import { getOauthAccountInfo } from '../../../utils/auth.js'
import { getOrCreateUserID } from '../../../utils/config.js'
import {
  CAPPED_DEFAULT_MAX_TOKENS,
  getModelMaxOutputTokens,
} from '../../../utils/context.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { validateBoundedIntEnvVar } from '../../../utils/envValidation.js'
import { errorMessage } from '../../../utils/errors.js'
import { safeParseJSON } from '../../../utils/json.js'
import { jsonStringify } from '../../../utils/slowOperations.js'

/**
 * densable 2.1.219 zie — network-down codes (no route / refuse / DNS).
 * Mid-stream: cause=network_down when finalizing partial content.
 * densable 2.1.238 #17: SEA `rhe` 仍含 ERR_PROXY_TUNNEL — 不从本集合移除。
 * 点名文案在 formatAPIError（T9r），不是新 cause enum / F4y。
 */
export const STREAM_NETWORK_DOWN_CODES = new Set([
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
export const STREAM_STALE_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ConnectionClosed',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ERR_SOCKET_CLOSED',
  'StreamSuspended',
])

// Define a type that represents valid JSON values
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]

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

/**
 * Configure effort parameters for API request.
 */
export function configureEffortParams(
  effortValue: EffortValue | undefined,
  outputConfig: BetaOutputConfig,
  extraBodyParams: Record<string, unknown>,
  betas: string[],
  model: string,
): void {
  if (!modelSupportsEffort(model) || 'effort' in outputConfig) {
    return
  }
  if (isEffortUnsupported(model)) {
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
export type TaskBudgetParam = {
  type: 'tokens'
  total: number
  remaining?: number
}

export function configureTaskBudgetParams(
  taskBudget: { total: number; remaining?: number } | undefined,
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
export function getNonstreamingFallbackTimeoutMs(): number {
  const override = parseInt(process.env.API_TIMEOUT_MS || '', 10)
  if (override) return override
  // Official REMOTE densable — shorter non-streaming timeout under CCR.
  let isRemote = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../utils/residualFinalEnvGates.js') as typeof import('../../../utils/residualFinalEnvGates.js')
    isRemote = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  return isRemote ? 120_000 : 300_000
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
      require('../../../utils/residualFinalEnvGates.js') as typeof import('../../../utils/residualFinalEnvGates.js')
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
