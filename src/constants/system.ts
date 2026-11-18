// Critical system constants extracted to break circular dependencies

import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import {
  getGatewayAuth,
  isGatewayAuthPinned,
  isGatewayHttpLoopbackHost,
} from '../utils/gatewayEnv.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../utils/model/providers.js'
import { getWorkload } from '../utils/workloadContext.js'

/** densable 2.1.229 Hzo options — force attribution past env opt-out. */
export type AttributionHeaderOptions = {
  /**
   * densable `ignoreEnvOptOut`. When true on direct first-party Anthropic
   * (not unix-socket tunnel), skip `CLAUDE_CODE_ATTRIBUTION_HEADER` env opt-out
   * so auto-mode classifier sideQuery still sends the billing header.
   */
  ignoreEnvOptOut?: boolean
  responseBeforeCompaction?: {
    messageId?: string
    turnPosition?: { promptIndex?: number; turnIndex?: number }
  }
}

const DEFAULT_PREFIX = `You are Claude Code, Anthropic's official CLI for Claude.`
const AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX = `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
const AGENT_SDK_PREFIX = `You are a Claude agent, built on Anthropic's Claude Agent SDK.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

/**
 * Check if attribution header is enabled.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 */
function isAttributionHeaderEnabled(): boolean {
  // Official ATTRIBUTION_HEADER densable pure env half.
  try {
    const { resolveAttributionHeaderEnvOverride } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    const envOverride = resolveAttributionHeaderEnvOverride()
    if (envOverride === false) return false
    if (envOverride === true) return true
  } catch {
    if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ATTRIBUTION_HEADER)) {
      return false
    }
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_attribution_header', true)
}

/**
 * densable 2.1.229 Hzo gate: force past env opt-out only on direct first-party
 * Anthropic (provider firstParty + first-party base + no ANTHROPIC_UNIX_SOCKET).
 */
function shouldIgnoreAttributionEnvOptOut(
  options?: AttributionHeaderOptions,
): boolean {
  return (
    options?.ignoreEnvOptOut === true &&
    getAPIProvider() === 'firstParty' &&
    isFirstPartyAnthropicBaseUrl() &&
    !process.env.ANTHROPIC_UNIX_SOCKET
  )
}

/**
 * Get attribution header for API requests.
 * Returns a header string with cc_version and cc_entrypoint.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 *
 * densable 2.1.229 Hzo: `ignoreEnvOptOut` lets auto-mode classifier sideQuery
 * keep the billing header when the user set CLAUDE_CODE_ATTRIBUTION_HEADER=0.
 *
 * When NATIVE_CLIENT_ATTESTATION is enabled, includes a `cch=00000` placeholder.
 * Before the request is sent, Bun's native HTTP stack finds this placeholder
 * in the request body and overwrites the zeros with a computed hash. The
 * server verifies this token to confirm the request came from a real Claude
 * Code client. See bun-anthropic/src/http/Attestation.zig for implementation.
 *
 * We use a placeholder (instead of injecting from Zig) because same-length
 * replacement avoids Content-Length changes and buffer reallocation.
 */
function hasClaudeGatewayJwtAud(token: string | undefined): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length < 2) return false
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as { aud?: unknown }
    return (
      payload.aud === 'claude-gateway' ||
      (Array.isArray(payload.aud) && payload.aud.includes('claude-gateway'))
    )
  } catch {
    return false
  }
}

function isNonNegativeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1
}

export function getAttributionHeader(
  options?: AttributionHeaderOptions,
): string {
  // densable Hzo:
  // if (!(o?.ignoreEnvOptOut && firstParty && hjt() && !UNIX_SOCKET) && Ap(env)) return ""
  if (
    !shouldIgnoreAttributionEnvOptOut(options) &&
    !isAttributionHeaderEnabled()
  ) {
    return ''
  }

  const provider = getAPIProvider()
  const isFirstPartyDirect =
    provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()
  const version = MACRO.VERSION
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? 'unknown'

  // cch=00000 placeholder is overwritten by Bun's HTTP stack with attestation token
  const cch = feature('NATIVE_CLIENT_ATTESTATION') ? ' cch=00000;' : ''
  // cc_workload: turn-scoped hint so the API can route e.g. cron-initiated
  // requests to a lower QoS pool. Absent = interactive default.
  const workload = getWorkload()
  const workloadPair = workload ? ` cc_workload=${workload};` : ''

  // #578: cc_gateway attribution field (SEA 325 sJs)
  const gatewayAuth = provider === 'gateway' ? getGatewayAuth() : null
  const nonFirstPartyBaseHost = (() => {
    const baseUrl = process.env.ANTHROPIC_BASE_URL
    if (
      provider !== 'firstParty' ||
      !baseUrl ||
      process.env.ANTHROPIC_UNIX_SOCKET !== undefined ||
      isFirstPartyAnthropicBaseUrl()
    ) {
      return undefined
    }
    try {
      return new URL(baseUrl).host || undefined
    } catch {
      return undefined
    }
  })()
  const hasGatewayCreds =
    isGatewayAuthPinned(gatewayAuth) ||
    hasClaudeGatewayJwtAud(gatewayAuth?.jwt ?? process.env.ANTHROPIC_AUTH_TOKEN)
  const gatewayActive =
    (provider === 'gateway' || nonFirstPartyBaseHost !== undefined) &&
    hasGatewayCreds
  const gatewayUrl = gatewayAuth?.url ?? process.env.ANTHROPIC_BASE_URL
  let isLoopbackOrInvalid = false
  if (gatewayUrl !== undefined) {
    if (!URL.canParse(gatewayUrl)) {
      isLoopbackOrInvalid = true
    } else {
      isLoopbackOrInvalid = isGatewayHttpLoopbackHost(
        new URL(gatewayUrl).hostname,
      )
    }
  }
  const hostVerdict = (
    gatewayAuth as { hostVerdict?: Record<string, unknown> } | null
  )?.hostVerdict
  const hasVouchedVerdict =
    hostVerdict !== undefined && 'vouched' in hostVerdict
  const gatewayPair =
    (provider === 'gateway' || gatewayActive) &&
    !(isLoopbackOrInvalid || hasVouchedVerdict)
      ? ` cc_gateway=${gatewayActive ? '1' : 'env'};`
      : ''

  const prevMsgId = options?.responseBeforeCompaction?.messageId
  const prevPromptIdx =
    options?.responseBeforeCompaction?.turnPosition?.promptIndex
  const prevTurnIdx = options?.responseBeforeCompaction?.turnPosition?.turnIndex
  const prevMsgPair =
    prevMsgId !== undefined &&
    /^msg_[A-Za-z0-9_]{1,64}$/.test(prevMsgId) &&
    isFirstPartyDirect
      ? ` cc_prev_msg=${prevMsgId};`
      : ''
  const prevPosPair =
    isNonNegativeInt(prevPromptIdx) &&
    isPositiveInt(prevTurnIdx) &&
    isFirstPartyDirect
      ? ` cc_prev_prompt_index=${prevPromptIdx}; cc_prev_turn_index=${prevTurnIdx};`
      : ''
  const bgDispatch = process.env.CLAUDE_BG_DISPATCH_ENTRYPOINT
  const dispatchPair =
    process.env.CLAUDE_CODE_SESSION_KIND === 'bg' &&
    bgDispatch !== undefined &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(bgDispatch) &&
    isFirstPartyDirect
      ? ` cc_dispatch_entrypoint=${bgDispatch};`
      : ''

  const header = `x-anthropic-billing-header: cc_version=${version}; cc_entrypoint=${entrypoint};${cch}${workloadPair}${gatewayPair}${prevMsgPair}${prevPosPair}${dispatchPair}`

  logForDebugging(`attribution header ${header}`)
  return header
}
