/**
 * densable 2.1.212 mid-conversation system + prompt-cache alignment.
 *
 * densable symbols:
 * - J8t model gate
 * - B6n createApiSystemMessage
 * - eN flush → api_system after user
 * - Jdy cache_control on trailing api_system when !Vme() && !Gri()
 * - KQn / e9i reject detectors
 * - Vri / Gri midConvCachePromotionRejected demote latch
 * - sticky o3 reject → midConvLatchedOff (DV stickyBetas)
 * - w3y demote orphan api_system not between user and assistant
 * - xNi 3P beta allowlist keeps o3
 */

import { randomUUID } from 'crypto'
import { APIError } from '@anthropic-ai/sdk'
import {
  getMidConvCachePromotionRejected,
  isStickyBetaRejected,
  setMidConvCachePromotionRejected,
  stickyRejectBeta,
} from '../bootstrap/state.js'
import { MID_CONVERSATION_SYSTEM_BETA_HEADER } from '../constants/betas.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import {
  type APIProvider,
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './model/providers.js'

const KNOWN_UNSUPPORTED_EXACT = new Set([
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
])

/**
 * densable ouu — cache_control errors that mean role:system rejection
 * (system.N path), not proxy cache_control demotion (e9i).
 */
const SYSTEM_CACHE_CONTROL_RE = /\bsystem\.\d+\./

export type ApiSystemMessage = {
  type: 'api_system'
  uuid: string
  timestamp: string
  message: {
    role: 'system'
    content: string
  }
  /** densable per-turn effort statement carrier (not used for mid-conv text). */
  outputConfig?: { effort?: string | number }
}

/** densable B6n */
export function createApiSystemMessage(content: string): ApiSystemMessage {
  return {
    type: 'api_system',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'system', content },
  }
}

export function isApiSystemMessage(
  msg: { type?: string } | null | undefined,
): msg is ApiSystemMessage {
  return msg?.type === 'api_system'
}

export function isMidConversationSystemForced(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM) ||
    isEnvTruthy(env.CLAUDE_CODE_MID_CONVERSATION_SYSTEM)
  )
}

/**
 * densable Vme — kill experimental betas (incl. cache_control on api_system).
 */
export function isExperimentalBetasDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) ||
    isHipaaPolicy(env)
  )
}

/**
 * densable Jee("hipaa") — HIPAA policy disables mid-conv system + experimental betas.
 * Local: CLAUDE_CODE_HIPAA=1 (or CLAUDE_CODE_HIPAA_COMPLIANCE=1).
 */
export function isHipaaPolicy(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_HIPAA) ||
    isEnvTruthy(env.CLAUDE_CODE_HIPAA_COMPLIANCE)
  )
}

/**
 * densable fj(P_) — providers that support experimental capability fallbacks.
 */
export function providerSupportsMidConvCapability(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return (
    provider === 'firstParty' ||
    provider === 'anthropicAws' ||
    provider === 'foundry' ||
    provider === 'mantle'
  )
}

/**
 * densable qBn — firstParty-ish for experimental beta keep-all (vs xNi strip).
 */
export function isFirstPartyIshProvider(
  provider: APIProvider = getAPIProvider(),
): boolean {
  return (
    provider === 'firstParty' ||
    provider === 'anthropicAws' ||
    provider === 'foundry'
  )
}

/**
 * densable J8t model gate (memoized at call sites via getAllModelBetas).
 *
 * FORCE env → on; hipaa → off; known older Claude models → off;
 * mythos / mid_conv_system capability → on; else fj(provider) capability fallback.
 */
export function shouldUseMidConversationSystem(input: {
  model?: string
  env?: NodeJS.ProcessEnv
  /** When provided, overrides model heuristic (from model beta map). */
  modelBetaEnabled?: boolean
  /** Optional capability flag (official dW mid_conv_system). */
  midConvSystemCapability?: boolean
  /** densable midConvLatchedOff — sticky reject of o3 this session. */
  latchedOff?: boolean
  provider?: APIProvider
}): boolean {
  const env = input.env ?? process.env
  if (isHipaaPolicy(env)) return false
  if (isMidConversationSystemForced(env)) return true
  if (input.latchedOff) return false
  if (isStickyBetaRejected(MID_CONVERSATION_SYSTEM_BETA_HEADER)) return false
  if (input.modelBetaEnabled !== undefined) return input.modelBetaEnabled
  const m = input.model ?? ''
  if (!m) return false
  const canonical = getCanonicalName(m)
  if (
    canonical.includes('claude-3-') ||
    KNOWN_UNSUPPORTED_EXACT.has(canonical) ||
    KNOWN_UNSUPPORTED_EXACT.has(m)
  ) {
    return false
  }
  if (
    input.midConvSystemCapability === true ||
    canonical === 'claude-mythos-5'
  ) {
    return true
  }
  // densable fj(P_(e)) capability fallback for unknown/newer models on 1P-ish.
  return providerSupportsMidConvCapability(input.provider)
}

/** densable Gri */
export function isMidConvCachePromotionRejected(): boolean {
  return getMidConvCachePromotionRejected()
}

/** densable Vri */
export function latchMidConvCachePromotionRejected(): void {
  setMidConvCachePromotionRejected(true)
}

/**
 * densable sticky reject o3 after server rejects role:system (KQn path).
 */
export function latchMidConvSystemRejected(): void {
  stickyRejectBeta(MID_CONVERSATION_SYSTEM_BETA_HEADER)
}

/**
 * densable KQn — server rejected mid-conversation role:"system".
 */
export function isMidConvSystemRoleRejected(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 400) return false
  const t = error.message ?? ''
  if (
    t.includes(MID_CONVERSATION_SYSTEM_BETA_HEADER) &&
    t.includes('anthropic-beta')
  ) {
    return true
  }
  if (t.includes('Unexpected role') && t.includes('input message role')) {
    return true
  }
  if (t.includes('cache_control') && SYSTEM_CACHE_CONTROL_RE.test(t)) {
    return true
  }
  return t.includes('not supported') && /role .{0,2}system/i.test(t)
}

/**
 * densable e9i — proxy rejected cache_control on api_system tail
 * (not system.N / tool_result / ttl / empty text).
 */
export function isApiSystemCacheControlRejected(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 400) return false
  const t = error.message ?? ''
  if (!t.includes('cache_control')) return false
  if (SYSTEM_CACHE_CONTROL_RE.test(t)) return false
  if (t.includes('empty text block')) return false
  if (t.includes('tool_result')) return false
  if (/\bttl\b/i.test(t)) return false
  const lower = t.toLowerCase()
  return (
    lower.includes('not permitted') ||
    lower.includes('cannot be set') ||
    lower.includes('unknown name') ||
    lower.includes('unknown field') ||
    lower.includes('unrecognized') ||
    lower.includes('additional propert')
  )
}

/**
 * densable SEA 2.1.237 eDT `canMarkApiSystem` provider/base-URL eligibility.
 * Message-tail ephemeral caching is unaffected — this only gates **api_system**
 * `cache_control` so custom BASE_URL / gateway sessions do not stamp a proxy-
 * rejected breakpoint (proactive; midConv demote remains as reactive backup).
 *
 * Gold: `docs/upstream-extraction/v2.1.237/snippets/gold-canMarkApiSystem-eDT.txt`
 *   !latched && !dje() && (
 *     FF()&&rXt&&H2m  ||  (bedrock|vertex|mantle)&&rzi  ||  foundry&&JOT
 *   )
 */
export function isApiSystemCacheControlEligible(
  provider: APIProvider = getAPIProvider(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // FF() = Dzo() && !dje(); dje checked by caller. Dzo = firstParty|anthropicAws|foundry
  // (SEA also VJ anthropicGoogleCloud — tip has no such provider; invent-ban).
  if (
    isExperimentalApiSystemCacheProvider(provider) &&
    isApiSystemCacheBaseUrlEligibleRxt(provider, env) &&
    isApiSystemCacheHostEligibleH2m(provider, env)
  ) {
    return true
  }
  if (
    (provider === 'bedrock' ||
      provider === 'vertex' ||
      provider === 'mantle') &&
    isCloudProviderDefaultBaseUrlUnset(provider, env)
  ) {
    return true
  }
  if (provider === 'foundry' && isFoundryApiSystemCacheEligible(env)) {
    return true
  }
  return false
}

/** SEA Dzo — providers that participate in FF()∧rXt∧H2m branch. */
function isExperimentalApiSystemCacheProvider(provider: APIProvider): boolean {
  return (
    provider === 'firstParty' ||
    provider === 'anthropicAws' ||
    provider === 'foundry'
  )
}

/** SEA rXt — firstParty requires om(); anthropicAws requires AWS base unset. */
function isApiSystemCacheBaseUrlEligibleRxt(
  provider: APIProvider,
  env: NodeJS.ProcessEnv,
): boolean {
  if (provider === 'anthropicAws') {
    return env.ANTHROPIC_AWS_BASE_URL === undefined
  }
  if (provider === 'firstParty') {
    return isFirstPartyAnthropicBaseUrl(env)
  }
  return false
}

/**
 * SEA H2m — WiF / credentials base_url probe when firstParty + BASE_URL unset.
 * Tip has no Udt/zAn WiF latch equivalent → early-exit paths yield true
 * (ASSUME / non-firstParty / BASE_URL defined / !Udt).
 */
function isApiSystemCacheHostEligibleH2m(
  provider: APIProvider,
  env: NodeJS.ProcessEnv,
): boolean {
  if (provider !== 'firstParty') return true
  if (env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL) return true
  if (env.ANTHROPIC_BASE_URL !== undefined) return true
  // SEA: !Udt() → true. Tip WiF Udt absent → treat as !Udt.
  return true
}

/** SEA rzi */
function isCloudProviderDefaultBaseUrlUnset(
  provider: 'bedrock' | 'vertex' | 'mantle',
  env: NodeJS.ProcessEnv,
): boolean {
  switch (provider) {
    case 'bedrock':
      return env.ANTHROPIC_BEDROCK_BASE_URL === undefined
    case 'vertex':
      return env.ANTHROPIC_VERTEX_BASE_URL === undefined
    case 'mantle':
      return env.ANTHROPIC_BEDROCK_MANTLE_BASE_URL === undefined
  }
}

/** SEA JOT — unset foundry base → true; else hostname *.services.ai.azure.com */
function isFoundryApiSystemCacheEligible(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const base = env.ANTHROPIC_FOUNDRY_BASE_URL
  if (base === undefined) return true
  try {
    return new URL(base).hostname.endsWith('.services.ai.azure.com')
  } catch {
    return false
  }
}

/**
 * densable Jdy c / SEA eDT canMarkApiSystem: allow cache_control on api_system
 * when not demoted, experimental betas live, and provider/base-URL eligible.
 */
export function shouldCacheControlOnApiSystem(
  provider: APIProvider = getAPIProvider(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    !isMidConvCachePromotionRejected() &&
    !isExperimentalBetasDisabled(env) &&
    isApiSystemCacheControlEligible(provider, env)
  )
}

/**
 * densable w3y — demote orphan api_system not sitting between user and
 * (assistant | api_system | end) into isMeta user messages.
 */
export function demoteOrphanApiSystemMessages<
  T extends { type: string; message?: { content?: unknown } },
>(
  messages: T[],
  opts: {
    /** densable q5n wrap — when true leave content unwrapped. */
    skipSystemReminderWrap?: boolean
    wrapSystemReminder?: (text: string) => string
    createUserMeta: (content: string) => T
  },
): T[] {
  let out: T[] | undefined
  for (let n = 0; n < messages.length; n++) {
    const o = messages[n]!
    if (o.type !== 'api_system') {
      out?.push(o)
      continue
    }
    const prev = out ? out.at(-1) : messages[n - 1]
    const next = messages[n + 1]
    if (prev?.type === 'api_system') {
      // merge into previous api_system content
      out ??= messages.slice(0, n)
      const last = out.at(-1) as T & {
        message: { content: string }
      }
      const oMsg = o as unknown as ApiSystemMessage
      const content =
        typeof oMsg.message?.content === 'string' ? oMsg.message.content : ''
      last.message.content += `\n\n${content}`
      continue
    }
    const afterUser = prev?.type === 'user'
    const beforeOk =
      next === undefined ||
      next.type === 'assistant' ||
      next.type === 'api_system'
    if (afterUser && beforeOk) {
      out?.push(o)
      continue
    }
    out ??= messages.slice(0, n)
    const oMsg = o as unknown as ApiSystemMessage
    const text =
      typeof oMsg.message?.content === 'string' ? oMsg.message.content : ''
    const content =
      opts.skipSystemReminderWrap || !opts.wrapSystemReminder
        ? text
        : opts.wrapSystemReminder(text)
    out.push(opts.createUserMeta(content))
  }
  return out ?? messages
}

/**
 * densable $3y — pure text extract from user messages for api_system buffer.
 * Returns null if any non-text block present.
 */
export function extractPureTextFromUserMessages(
  messages: Array<{ message?: { content?: unknown } | null }>,
): string | null {
  const parts: string[] = []
  for (const msg of messages) {
    const content = msg.message?.content
    if (typeof content === 'string') {
      parts.push(content)
      continue
    }
    if (!Array.isArray(content)) return null
    for (const block of content) {
      if (
        !block ||
        typeof block !== 'object' ||
        !('type' in block) ||
        (block as { type: string }).type !== 'text' ||
        !('text' in block)
      ) {
        return null
      }
      parts.push(String((block as { text: string }).text))
    }
  }
  const joined = parts.join('\n')
  return joined.trim().length > 0 ? joined : null
}
