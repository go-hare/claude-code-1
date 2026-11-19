import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
  setPromptCache1hAllowlist,
  setPromptCache1hEligible,
} from 'src/bootstrap/state.js'
import type { QuerySource } from 'src/constants/querySource.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { isClaudeAISubscriber } from 'src/utils/auth.js'
import { shouldIncludeFirstPartyOnlyBetas } from 'src/utils/betas.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import { type CacheScope, splitSysPromptPrefix } from '../../../utils/api.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import {
  firstPartyNameToCanonical,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getSmallFastModel,
} from '../../../utils/model/model.js'
import {
  MAIN_PROMPT_CACHE_QUERY_SOURCES,
  type PromptCacheTtl,
  querySourceMatchesAllowlist,
  resolvePromptCacheTtlOverride,
} from '../../../utils/promptCacheTtl.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import { currentLimits } from '../../claudeAiLimits.js'

function parseModelForCacheMatch(model: string): {
  name: string
  date?: string
} {
  const without1m = model.replace(/\[1m\]$/i, '')
  const canonical = firstPartyNameToCanonical(without1m)
  const dateMatch = without1m.match(/(?:-|@)(\d{8})(?:$|-v\d|\[)/i)
  return {
    name: canonical,
    date: dateMatch?.[1],
  }
}

/**
 * Official wmn — compares two model strings after normalizing `[1m]` suffix,
 * cross-region prefixes (via firstPartyNameToCanonical), and optional 8-digit
 * date tags (an undated model matches any dated variant of the same canonical).
 */
export function isSameModelForPromptCaching(a: string, b: string): boolean {
  const pa = parseModelForCacheMatch(a)
  const pb = parseModelForCacheMatch(b)
  return (
    pa.name === pb.name &&
    (pa.date === undefined || pb.date === undefined || pa.date === pb.date)
  )
}

export function getPromptCachingEnabled(model: string): boolean {
  // Global disable takes precedence
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING)) return false

  // Check if we should disable for small/fast model
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_HAIKU)) {
    const smallFastModel = getSmallFastModel()
    if (isSameModelForPromptCaching(model, smallFastModel)) return false
  }

  // Check if we should disable for default Sonnet
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_SONNET)) {
    const defaultSonnet = getDefaultSonnetModel()
    if (isSameModelForPromptCaching(model, defaultSonnet)) return false
  }

  // Check if we should disable for default Opus
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_OPUS)) {
    const defaultOpus = getDefaultOpusModel()
    if (isSameModelForPromptCaching(model, defaultOpus)) return false
  }

  // densable Dde @189266434 — FABLE: Rfe (`claude-fable-`) || nY (env default).
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_FABLE)) {
    if (model.includes('claude-fable-')) return false
    const defaultFable = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL
    if (defaultFable && isSameModelForPromptCaching(model, defaultFable)) {
      return false
    }
  }

  // densable Dde — MYTHOS: nbt (`claude-mythos-`).
  if (isEnvTruthy(process.env.DISABLE_PROMPT_CACHING_MYTHOS)) {
    if (model.includes('claude-mythos-')) return false
  }

  return true
}

export function getCacheControl({
  scope,
  querySource,
  agentCacheTtlOverride,
}: {
  scope?: CacheScope
  querySource?: QuerySource
  agentCacheTtlOverride?: PromptCacheTtl
} = {}): {
  type: 'ephemeral'
  ttl?: '5m' | '1h'
  scope?: CacheScope
} {
  const resolved = resolvePromptCacheTtl(querySource, {
    agentCacheTtlOverride,
  })
  return {
    type: 'ephemeral',
    ...(resolved.ttl && { ttl: resolved.ttl }),
    ...(scope === 'global' && { scope }),
  }
}

/**
 * densable 2.1.248 `Ivt` — `jTt` override then subscriber/GB.
 * Default GB allowlist is `_zt` (main conversation sources), not empty.
 */
function resolvePromptCacheTtl(
  querySource?: QuerySource,
  opts: {
    agentCacheTtlOverride?: PromptCacheTtl
    ignoreOverage?: boolean
  } = {},
): {
  ttl: '5m' | '1h'
  reason: string
} {
  const ignoreOverage = opts.ignoreOverage === true
  const subscriptionInOverage =
    isClaudeAISubscriber() &&
    !ignoreOverage &&
    currentLimits.isUsingOverage === true
  const override = resolvePromptCacheTtlOverride(
    querySource,
    opts.agentCacheTtlOverride,
    subscriptionInOverage,
  )
  if (override !== undefined) {
    return override
  }

  // densable Ivt: if(!o||u)return 5m. ignoreOverage skips leftover
  // eligibility latch so ScheduleWakeup B1 stays 1h across --resume.
  if (ignoreOverage) {
    if (!isClaudeAISubscriber()) {
      return { ttl: '5m', reason: 'default' }
    }
  } else {
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
    if (!userEligible) {
      return { ttl: '5m', reason: 'default' }
    }
  }

  let allowlist = getPromptCache1hAllowlist()
  if (allowlist === null) {
    const config = getFeatureValue_CACHED_MAY_BE_STALE<{
      allowlist?: string[]
    }>('tengu_prompt_cache_1h_config', {
      allowlist: [...MAIN_PROMPT_CACHE_QUERY_SOURCES],
    })
    allowlist = config.allowlist ?? [...MAIN_PROMPT_CACHE_QUERY_SOURCES]
    setPromptCache1hAllowlist(allowlist)
  }

  return querySourceMatchesAllowlist(querySource, allowlist)
    ? { ttl: '1h', reason: 'subscriber' }
    : { ttl: '5m', reason: 'default' }
}

/** densable 2.1.248 `B1(e,t)` — `Ivt(e,t).ttl==="1h"`. */
export function should1hCacheTTL(
  querySource?: QuerySource,
  opts: {
    agentCacheTtlOverride?: PromptCacheTtl
    ignoreOverage?: boolean
  } = {},
): boolean {
  return resolvePromptCacheTtl(querySource, opts).ttl === '1h'
}

/**
 * densable MWT — tengu_prompt_cache_diagnostics, gated by J2 + ZQt.
 * ZQt: anthropicAws iff ANTHROPIC_AWS_BASE_URL unset; else firstParty && 1P URL.
 */
export function isPromptCacheDiagnosticsEnabled(): boolean {
  if (!shouldIncludeFirstPartyOnlyBetas()) return false
  const provider = getAPIProvider()
  const hostEligible =
    provider === 'anthropicAws'
      ? process.env.ANTHROPIC_AWS_BASE_URL === undefined
      : provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()
  if (!hostEligible) return false
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_prompt_cache_diagnostics',
    false,
  )
}

export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: QuerySource
    agentCacheTtlOverride?: PromptCacheTtl
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
            agentCacheTtlOverride: options?.agentCacheTtlOverride,
          }),
        }),
    }
  })
}
