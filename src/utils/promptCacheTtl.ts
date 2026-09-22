import { getAPIProvider } from './model/providers.js'
import { isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'

/**
 * densable 2.1.243 `sFr` / `_zt` + 2.1.248 `jTt` — prompt-cache TTL for the
 * main conversation vs subagents. Settings keys are `promptCacheTtl` /
 * `subagentPromptCacheTtl`. Resolve order: force_5m_env > env > setting >
 * agent_frontmatter > enable_1h_env.
 */

export type PromptCacheTtl = '5m' | '1h'

export type PromptCacheTtlReason =
  | 'force_5m_env'
  | 'env'
  | 'setting'
  | 'agent_frontmatter'
  | 'enable_1h_env'

export type PromptCacheTtlResolution = {
  ttl: PromptCacheTtl
  reason: PromptCacheTtlReason
}

/** densable `_zt` — query sources billed as the main conversation. */
export const MAIN_PROMPT_CACHE_QUERY_SOURCES = [
  'repl_main_thread*',
  'sdk',
  'auto_mode',
  'memdir_relevance',
] as const

export function querySourceMatchesAllowlist(
  querySource: string | undefined,
  patterns: readonly string[],
): boolean {
  if (querySource === undefined) return false
  return patterns.some(pattern =>
    pattern.endsWith('*')
      ? querySource.startsWith(pattern.slice(0, -1))
      : querySource === pattern,
  )
}

export function isMainPromptCacheQuerySource(
  querySource: string | undefined,
): boolean {
  return querySourceMatchesAllowlist(
    querySource,
    MAIN_PROMPT_CACHE_QUERY_SOURCES,
  )
}

function parsePromptCacheTtl(value: unknown): PromptCacheTtl | undefined {
  return value === '5m' || value === '1h' ? value : undefined
}

/**
 * densable 2.1.248 `mUt` — agent frontmatter `experimental.cacheTtl`.
 * Key match is case-insensitive (`cachettl`); only `"5m"` / `"1h"` survive.
 */
export function parseAgentFrontmatterCacheTtl(
  frontmatter: Record<string, unknown>,
): PromptCacheTtl | undefined {
  const experimental = frontmatter.experimental
  if (typeof experimental !== 'object' || experimental === null) {
    return undefined
  }
  const ttl = Object.entries(experimental).find(
    ([key]) => key.toLowerCase() === 'cachettl',
  )?.[1]
  return ttl === '5m' || ttl === '1h' ? ttl : undefined
}

/**
 * densable 2.1.248 `jTt(e,t,r=!1)` — env / settings / agent frontmatter /
 * ENABLE_PROMPT_CACHING_1H override. `"1h"` from frontmatter is ignored while
 * a Claude subscription is in overage. Returns undefined so the caller can
 * apply the subscriber/GB default.
 */
export function resolvePromptCacheTtlOverride(
  querySource?: string,
  agentCacheTtlOverride?: PromptCacheTtl,
  subscriptionInOverage = false,
): PromptCacheTtlResolution | undefined {
  if (isEnvTruthy(process.env.FORCE_PROMPT_CACHING_5M)) {
    return { ttl: '5m', reason: 'force_5m_env' }
  }

  const isMain = isMainPromptCacheQuerySource(querySource)
  const envTtl = parsePromptCacheTtl(
    isMain
      ? process.env.CLAUDE_CODE_PROMPT_CACHE_TTL
      : process.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL,
  )
  if (envTtl !== undefined) {
    return { ttl: envTtl, reason: 'env' }
  }

  const settings = getInitialSettings()
  const settingTtl = parsePromptCacheTtl(
    isMain ? settings.promptCacheTtl : settings.subagentPromptCacheTtl,
  )
  if (settingTtl !== undefined) {
    return { ttl: settingTtl, reason: 'setting' }
  }

  if (
    agentCacheTtlOverride !== undefined &&
    !(agentCacheTtlOverride === '1h' && subscriptionInOverage)
  ) {
    return { ttl: agentCacheTtlOverride, reason: 'agent_frontmatter' }
  }

  if (
    isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H) ||
    (getAPIProvider() === 'bedrock' &&
      isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK))
  ) {
    return { ttl: '1h', reason: 'enable_1h_env' }
  }

  return undefined
}
