/**
 * Official residual post-183 env gates (batch densify helpers).
 */

import { join } from 'node:path'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
  type APIProvider,
} from './model/providers.js'

export function isClaudeApiSkillDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL)
}

/**
 * Official CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL — skip registerClaudeCodeSkill
 * (skill name: claude-code-docs). Does NOT gate the claude-code-guide agent.
 * GB tengu_birch_kettle further gates isEnabled on the skill.
 */
export function isClaudeCodeSkillDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL)
}

export function isNestedChainIdleDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_NESTED_CHAIN_IDLE)
}

export function isBackgroundPluginRefreshEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH)
}

export function isExperimentalAdvisorToolEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL)
}

/** Official CLAUDE_CODE_DISABLE_ADVISOR_TOOL densable. */
export function isAdvisorToolDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL)
}

/**
 * Env-only truthy for CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY.
 * Full official $5l gate is {@link shouldEnableGatewayModelDiscovery}.
 */
export function isGatewayModelDiscoveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY)
}

/**
 * Official $5l densable — gateway model discovery is eligible when:
 * ENABLE_GATEWAY_MODEL_DISCOVERY + provider firstParty + !Gd() + ANTHROPIC_BASE_URL set.
 * Full q5l /v1/models download remains denser.
 */
export function shouldEnableGatewayModelDiscovery(input?: {
  env?: NodeJS.ProcessEnv
  provider?: APIProvider
}): boolean {
  const env = input?.env ?? process.env
  if (!isGatewayModelDiscoveryEnabled(env)) return false
  const provider = input?.provider ?? getAPIProvider()
  if (provider !== 'firstParty') return false
  // Official: if (Gd()) return false — first-party host skips gateway discovery
  if (isFirstPartyAnthropicBaseUrl(env)) return false
  if (!env.ANTHROPIC_BASE_URL) return false
  return true
}

export type GatewayModelOption = {
  value: string
  label: string
  description: string
}

export type GatewayModelsCacheFile = {
  baseUrl?: string
  models?: Array<{ id?: string; display_name?: string }>
}

/** Official U5l densable — `<configHome>/cache/gateway-models.json`. */
export function getGatewayModelsCachePath(configHome: string): string {
  return join(configHome, 'cache', 'gateway-models.json')
}

/**
 * densable 2.1.223 #9 — gateway discovery keeps Claude models even when the
 * id is provider-prefixed (`vertex_ai/claude-*`, `bedrock/anthropic.claude-*`).
 * SEA: `a.data.data.filter((d)=>/(claude|anthropic)/i.test(d.id))`
 */
export const GATEWAY_USABLE_MODEL_ID_RE = /(claude|anthropic)/i

export function isGatewayUsableModelId(id: string): boolean {
  return GATEWAY_USABLE_MODEL_ID_RE.test(id)
}

/**
 * Official mkr densable pure parse — map cached gateway models to picker options
 * when $5l is on and cache baseUrl matches current ANTHROPIC_BASE_URL.
 * Does not touch the filesystem; pass raw JSON via `raw`.
 */
export function parseGatewayModelOptionsFromCache(input: {
  raw: string | null | undefined
  env?: NodeJS.ProcessEnv
  provider?: APIProvider
}): GatewayModelOption[] {
  const env = input.env ?? process.env
  if (!shouldEnableGatewayModelDiscovery({ env, provider: input.provider })) {
    return []
  }
  const expectedBaseUrl = env.ANTHROPIC_BASE_URL
  if (!input.raw || !expectedBaseUrl) return []
  try {
    const parsed = JSON.parse(input.raw) as GatewayModelsCacheFile
    if (!parsed || parsed.baseUrl !== expectedBaseUrl) return []
    if (!Array.isArray(parsed.models)) return []
    return parsed.models
      .filter(
        (m): m is { id: string; display_name?: string } =>
          typeof m?.id === 'string' &&
          m.id.length > 0 &&
          isGatewayUsableModelId(m.id),
      )
      .map(m => ({
        value: m.id,
        label: m.display_name || m.id,
        description: 'From gateway',
      }))
  } catch {
    return []
  }
}

/**
 * Official q5l densable pure — normalize /v1/models response into cache body.
 * Accepts Anthropic list shape `{ data: [{id, display_name?}] }` or bare array.
 */
export function planGatewayModelsCacheWrite(input: {
  baseUrl: string
  responseBody: unknown
}): GatewayModelsCacheFile | undefined {
  const baseUrl = input.baseUrl.replace(/\/+$/, '')
  if (!baseUrl) return undefined
  const body = input.responseBody
  let rows: unknown[] = []
  if (Array.isArray(body)) {
    rows = body
  } else if (body && typeof body === 'object') {
    const data = (body as { data?: unknown }).data
    if (Array.isArray(data)) rows = data
  }
  const models = rows
    .map(row => {
      if (!row || typeof row !== 'object') return null
      const r = row as { id?: unknown; display_name?: unknown; name?: unknown }
      if (typeof r.id !== 'string' || !r.id) return null
      // densable 2.1.223 #9 — keep provider-prefixed Claude ids
      if (!isGatewayUsableModelId(r.id)) return null
      const display =
        typeof r.display_name === 'string'
          ? r.display_name
          : typeof r.name === 'string'
            ? r.name
            : undefined
      return display ? { id: r.id, display_name: display } : { id: r.id }
    })
    .filter((m): m is { id: string; display_name?: string } => m !== null)
  if (models.length === 0) return undefined
  return { baseUrl, models }
}

/**
 * Official q5l densable consumer — GET `{baseUrl}/v1/models` and write
 * gateway-models.json when $5l is on. Injectable get/write for tests.
 */
export async function fetchAndCacheGatewayModels(input?: {
  env?: NodeJS.ProcessEnv
  provider?: APIProvider
  configHome?: string
  getJson?: (url: string, headers: Record<string, string>) => Promise<unknown>
  writeFile?: (path: string, body: string) => void | Promise<void>
  resolveAuthHeaders?: () => Record<string, string> | null | undefined
  mkdirp?: (dir: string) => void | Promise<void>
}): Promise<
  { ok: true; path: string; modelCount: number } | { ok: false; reason: string }
> {
  const env = input?.env ?? process.env
  if (!shouldEnableGatewayModelDiscovery({ env, provider: input?.provider })) {
    return { ok: false, reason: 'gate_off' }
  }
  const baseUrl = env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '')
  if (!baseUrl) return { ok: false, reason: 'no_base_url' }

  let headers: Record<string, string> = {}
  try {
    if (input?.resolveAuthHeaders) {
      headers = input.resolveAuthHeaders() ?? {}
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const auth = require('./auth.js') as {
        getAnthropicApiKey?: () => string | null
        getClaudeAIOAuthTokens?: () => { accessToken?: string } | null
      }
      const oauth = auth.getClaudeAIOAuthTokens?.()?.accessToken
      const apiKey = auth.getAnthropicApiKey?.()
      if (oauth) headers = { Authorization: `Bearer ${oauth}` }
      else if (apiKey) headers = { 'x-api-key': apiKey }
    }
  } catch {
    // densable optional auth
  }
  if (!headers.Authorization && !headers['x-api-key']) {
    return { ok: false, reason: 'no_auth' }
  }

  const url = `${baseUrl}/v1/models`
  let body: unknown
  try {
    if (input?.getJson) {
      body = await input.getJson(url, headers)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const axios = require('axios') as {
        get: (
          u: string,
          opts: { headers: Record<string, string>; timeout: number },
        ) => Promise<{ data: unknown }>
      }
      const resp = await axios.get(url, { headers, timeout: 8000 })
      body = resp.data
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'fetch_failed',
    }
  }

  const cache = planGatewayModelsCacheWrite({ baseUrl, responseBody: body })
  if (!cache) return { ok: false, reason: 'empty_models' }

  let configHome = input?.configHome
  if (!configHome) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getClaudeConfigHomeDir } = require('./envUtils.js') as {
        getClaudeConfigHomeDir: () => string
      }
      configHome = getClaudeConfigHomeDir()
    } catch {
      return { ok: false, reason: 'no_config_home' }
    }
  }
  const path = getGatewayModelsCachePath(configHome)
  const json = JSON.stringify(cache)
  try {
    if (input?.writeFile) {
      await input.writeFile(path, json)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pathMod = require('node:path') as typeof import('node:path')
      if (input?.mkdirp) await input.mkdirp(pathMod.dirname(path))
      else fs.mkdirSync(pathMod.dirname(path), { recursive: true })
      fs.writeFileSync(path, json, { encoding: 'utf-8', mode: 0o600 })
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'write_failed',
    }
  }
  return { ok: true, path, modelCount: cache.models?.length ?? 0 }
}

export function isOpus47FastModeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE)
}

export function isForceBridgeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_BRIDGE)
}

export function isForceEvaluateMemoryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_EVALUATE_MEMORY)
}

export function isForceMemorySurveyEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_FORCE_MEMORY_SURVEY)
}

export function shouldPreferPluginHttps(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PLUGIN_PREFER_HTTPS)
}

export function shouldKeepMarketplaceOnFailure(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE)
}

export function shouldSkipFastModeOrgCheck(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK)
}

/** Official densable — CLAUDE_CODE_SKIP_FAST_MODE_NETWORK_ERRORS. */
export function shouldSkipFastModeNetworkErrors(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_FAST_MODE_NETWORK_ERRORS)
}

/**
 * Official bZe densable — prefer HTTPS for plugin git when REMOTE or
 * PLUGIN_PREFER_HTTPS is set.
 */
export function shouldPreferPluginHttpsOrRemote(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_REMOTE) || shouldPreferPluginHttps(env)
}

/**
 * Official OPs densable — GitHub owner/repo → git URL (HTTPS when bZe).
 */
export function githubRepoGitUrl(
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return shouldPreferPluginHttpsOrRemote(env)
    ? `https://github.com/${repo}.git`
    : `git@github.com:${repo}.git`
}

/**
 * Official CLAUDE_CODE_SKIP_PROJECT_BACKFILL densable (env schema qnm).
 * Product Project/Local CLAUDE.md skip uses GB tengu_paper_halyard only —
 * no confirmed 2.1.207 consumer wiring this env into getClaudeMds/attachments.
 */
export function shouldSkipProjectBackfill(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_PROJECT_BACKFILL)
}

/**
 * CLAUDE_CODE_SKIP_REPO_UPLOAD densable-only (2.1.207 env schema/export Wnm).
 * Official binary has no product consumer on createAndUploadGitBundle /
 * teleport — do not wire this into upload paths. Helper + unit tests only.
 */
export function shouldSkipRepoUpload(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SKIP_REPO_UPLOAD)
}

export function shouldSuppressSessionAttribution(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_SUPPRESS_SESSION_ATTRIBUTION)
}

/** Optional GrowthBook feature key for system prompt experiments. */
export function getSystemPromptGbFeature(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

/**
 * Official print densable — SYSTEM_PROMPT_GB_FEATURE is only consulted when
 * CLAUDE_CODE_REMOTE is truthy. Returns the GB feature key or undefined.
 */
export function getRemoteSystemPromptGbFeatureKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!isEnvTruthy(env.CLAUDE_CODE_REMOTE)) return undefined
  return getSystemPromptGbFeature(env)
}

/**
 * Official densable pure resolve — when remote + GB key set, prefer non-empty
 * `gbValue` over `base`. Does not touch GrowthBook; pass the cached value.
 */
export function resolveSystemPromptWithRemoteGb(input: {
  base?: string
  env?: NodeJS.ProcessEnv
  /** GrowthBook string for the SYSTEM_PROMPT_GB_FEATURE key. */
  gbValue?: unknown
}): string | undefined {
  const key = getRemoteSystemPromptGbFeatureKey(input.env)
  if (!key) return input.base
  if (typeof input.gbValue === 'string' && input.gbValue.length > 0) {
    return input.gbValue
  }
  return input.base
}

/**
 * Official eUi densable — whether MCP allowlist-from-env enforcement is on:
 * MCP_ALLOWLIST_ENV truthy → on; explicit falsy → off; else local-agent only.
 *
 * Official denser consumer (stdio spawn): `eUi()?{...lqi(),...kVt()}:GO()` —
 * when true, only pass platform-safe inherited keys (+ injected proxy env);
 * when false, use full managed subprocess env. See {@link buildMcpStdioBaseEnv}.
 */
export function shouldEnforceMcpAllowlistEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CLAUDE_CODE_MCP_ALLOWLIST_ENV
  if (isEnvTruthy(raw)) return true
  if (isEnvDefinedFalsy(raw)) return false
  return env.CLAUDE_CODE_ENTRYPOINT === 'local-agent'
}

/**
 * Official Tog densable — platform-safe env keys inherited by MCP stdio children
 * when eUi allowlist mode is on (lqi()).
 */
export const MCP_STDIO_SAFE_ENV_KEYS_UNIX = [
  'HOME',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'USER',
] as const

export const MCP_STDIO_SAFE_ENV_KEYS_WIN32 = [
  'APPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'PATH',
  'PROCESSOR_ARCHITECTURE',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERNAME',
  'USERPROFILE',
  'PROGRAMFILES',
] as const

/** Official Tog densable — select safe key list for platform. */
export function getMcpStdioSafeEnvKeys(
  platform: NodeJS.Platform | string = process.platform,
): readonly string[] {
  return platform === 'win32'
    ? MCP_STDIO_SAFE_ENV_KEYS_WIN32
    : MCP_STDIO_SAFE_ENV_KEYS_UNIX
}

/**
 * Official lqi densable — pick only Tog-safe keys from env.
 * Skips undefined and values starting with `()` (shell-function pollution).
 */
export function pickMcpStdioSafeInheritedEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform | string = process.platform,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of getMcpStdioSafeEnvKeys(platform)) {
    const value = env[key]
    if (value === undefined) continue
    if (value.startsWith('()')) continue
    out[key] = value
  }
  return out
}

/**
 * Official eUi base densable — `eUi()?{...lqi(),...kVt()}:GO()`.
 * `injectedEnv` is kVt (upstream proxy etc); `managedEnv` is GO (subprocessEnv).
 * Does not inject project/session markers — use {@link buildMcpStdioTransportEnv}.
 */
export function buildMcpStdioBaseEnv(input: {
  enforceAllowlist: boolean
  processEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform | string
  /** Official kVt — injected env layered on safe keys in allowlist mode. */
  injectedEnv?: Readonly<Record<string, string | undefined>> | null
  /** Official GO — full managed env when allowlist is off. */
  managedEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>
}): Record<string, string | undefined> {
  if (input.enforceAllowlist) {
    const safe = pickMcpStdioSafeInheritedEnv(
      input.processEnv ?? process.env,
      input.platform ?? process.platform,
    )
    if (!input.injectedEnv) return safe
    const out: Record<string, string | undefined> = { ...safe }
    for (const [k, v] of Object.entries(input.injectedEnv)) {
      if (v !== undefined) out[k] = v
    }
    return out
  }
  const managed = input.managedEnv ?? input.processEnv ?? process.env
  return { ...managed }
}

/**
 * Official MCP stdio transport env densable:
 * strip CLAUDE_CODE_CHILD_SESSION from base, then inject
 * CLAUDE_PROJECT_DIR / CLAUDE_CODE_SESSION_ID / CLAUDECODE=1, then server env.
 */
export function buildMcpStdioTransportEnv(input: {
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>
  projectDir: string
  sessionId: string
  serverEnv?: Readonly<Record<string, string>> | null
}): Record<string, string> {
  const { CLAUDE_CODE_CHILD_SESSION: _childSession, ...rest } =
    input.baseEnv as Record<string, string | undefined>
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) out[k] = v
  }
  out.CLAUDE_PROJECT_DIR = input.projectDir
  out.CLAUDE_CODE_SESSION_ID = input.sessionId
  out.CLAUDECODE = '1'
  if (input.serverEnv) {
    for (const [k, v] of Object.entries(input.serverEnv)) {
      out[k] = v
    }
  }
  return out
}

/**
 * Env var name whose value is a comma-separated MCP allowlist.
 * - Bare truthy flag → [] (enforce with empty list)
 * - Bare falsy flag → null (off)
 * - Named env key → parse that env's comma-separated value
 * - Unset + local-agent → [] (official eUi default on)
 * - Unset otherwise → null
 *
 * Note: official eUi denser consumer is stdio env selection (lqi+kVt vs GO),
 * not server-name filtering. This list densable remains for optional consumers.
 */
export function getMcpAllowlistFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] | null {
  const key = env.CLAUDE_CODE_MCP_ALLOWLIST_ENV?.trim()
  if (!key) {
    return env.CLAUDE_CODE_ENTRYPOINT === 'local-agent' ? [] : null
  }
  // Bare truthy/falsy flag enables/disables without naming a list env.
  if (isEnvTruthy(key)) return []
  if (isEnvDefinedFalsy(key)) return null
  const raw = env[key] ?? ''
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export function getResumeFromSessionId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.CLAUDE_CODE_RESUME_FROM_SESSION?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

/**
 * Prefer HTTPS for plugin/marketplace git URLs when env is set.
 * Converts git@host:path and ssh://git@host/path forms.
 */
export function rewritePluginGitUrlPreferHttps(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Official bZe: REMOTE || PLUGIN_PREFER_HTTPS
  if (!shouldPreferPluginHttpsOrRemote(env)) return url
  // git@host:owner/repo(.git)
  const scp = url.match(/^git@([^:]+):(.+)$/)
  if (scp) {
    const host = scp[1]!
    const path = scp[2]!.replace(/\.git$/, '')
    return `https://${host}/${path}.git`
  }
  // ssh://git@host/owner/repo
  const ssh = url.match(/^ssh:\/\/git@([^/]+)\/(.+)$/)
  if (ssh) {
    const host = ssh[1]!
    const path = ssh[2]!.replace(/\.git$/, '')
    return `https://${host}/${path}.git`
  }
  // plain http → https
  if (url.startsWith('http://')) {
    return `https://${url.slice('http://'.length)}`
  }
  return url
}
