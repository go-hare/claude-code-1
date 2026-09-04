import { getAPIProvider } from './model/providers.js'
import { isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'

/**
 * densable 2.1.243 `sFr` / `_zt` — prompt-cache TTL for the main conversation
 * vs subagents. Settings keys are `promptCacheTtl` / `subagentPromptCacheTtl`.
 * Env wins over settings; FORCE_PROMPT_CACHING_5M wins over both.
 */

export type PromptCacheTtl = '5m' | '1h'

export type PromptCacheTtlReason =
  | 'force_5m_env'
  | 'env'
  | 'setting'
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
 * densable `sFr(e)` — env / settings / ENABLE_PROMPT_CACHING_1H override.
 * Returns undefined so the caller can apply the subscriber/GB default.
 */
export function resolvePromptCacheTtlOverride(
  querySource?: string,
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
    isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H) ||
    (getAPIProvider() === 'bedrock' &&
      isEnvTruthy(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK))
  ) {
    return { ttl: '1h', reason: 'enable_1h_env' }
  }

  return undefined
}
