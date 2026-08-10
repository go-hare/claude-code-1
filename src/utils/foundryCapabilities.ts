/**
 * densable Foundry deployment capability strip (`$Fe` / `uns` / `dns` / `cns` / `lns` / `lnu` / `xco` / `cnu`).
 *
 * SEA 2.1.221: unsupported features are learned from Foundry 400 error messages
 * and stored in bootstrap `foundryDeploymentCapabilities` Map. Empty map →
 * `$Fe` returns true (allow). Key = `${foundryBaseUrl|resource}::canonicalModel`.
 */

import { APIError } from '@anthropic-ai/sdk'
import { getFoundryDeploymentCapabilities } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getCanonicalName } from './model/model.js'
import { getAPIProvider } from './model/providers.js'

/** densable t8g — capabilities that trigger tool-search strip / retry. */
const FOUNDRY_STRIP_CAPABILITIES = new Set([
  'tool_search_server',
  'tool_search',
  'structured_outputs',
])

/** densable QGg */
const NOT_SUPPORTED_IN_WORKSPACE =
  /([a-z0-9_, ]+?)\s+not supported in your workspace/i

/** densable ZGg */
const FEATURES_NOT_AVAILABLE =
  /features are not available for Azure AI Foundry workspaces?:\s*([a-z0-9_, ]+)/i

/** densable e8g */
const WEB_SEARCH_UNAVAILABLE =
  /server-side web search is not available in this environment/i

/** densable anu */
const CAPABILITY_NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * densable `lns` — Foundry resource base URL for capability map keys.
 */
export function getFoundryResourceBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.ANTHROPIC_FOUNDRY_BASE_URL) return env.ANTHROPIC_FOUNDRY_BASE_URL
  if (env.ANTHROPIC_FOUNDRY_RESOURCE) {
    return `https://${env.ANTHROPIC_FOUNDRY_RESOURCE}.services.ai.azure.com`
  }
  return undefined
}

/**
 * densable `cns` — capability map key for a model on the current Foundry resource.
 */
export function getFoundryCapabilityKey(model: string): string {
  const base = getFoundryResourceBaseUrl() ?? 'unknown-foundry-resource'
  return `${base}::${getCanonicalName(model)}`
}

/**
 * densable `lnu` — parse unsupported capability names from a Foundry 400 message.
 */
export function parseFoundryUnsupportedCapabilities(
  message: string,
): string[] | null {
  const m1 = message.match(NOT_SUPPORTED_IN_WORKSPACE)?.[1]
  if (m1) {
    const names = m1.split(',').map(s => s.trim())
    if (names.every(n => CAPABILITY_NAME_RE.test(n))) return names
  }
  const m2 = message.match(FEATURES_NOT_AVAILABLE)?.[1]
  if (m2) {
    const names = m2
      .split(/[,\s]+/)
      .filter(n => n !== 'and' && CAPABILITY_NAME_RE.test(n))
    return names.length > 0 ? names : null
  }
  if (WEB_SEARCH_UNAVAILABLE.test(message)) return ['web_search']
  return null
}

/**
 * densable `uns` — record unsupported capabilities for a deployment/model.
 */
export function recordFoundryUnsupportedCapabilities(
  model: string,
  capabilities: readonly string[],
): void {
  if (capabilities.length === 0) return
  const key = getFoundryCapabilityKey(model)
  const map = getFoundryDeploymentCapabilities()
  const existing = map.get(key)
  if (existing && capabilities.every(c => existing.has(c))) return
  const next = existing ? new Set(existing) : new Set<string>()
  for (const c of capabilities) next.add(c)
  map.set(key, next)
  logForDebugging(
    `[foundry-capabilities] deployment ${key} does not support: ${[...next].join(', ')}`,
    { level: 'warn' },
  )
}

/**
 * densable `$Fe` — true when the Foundry deployment supports `capability`.
 * Empty map (no 400s learned yet) → default allow.
 * Non-foundry providers always true (provider-scoped; map is Foundry-only).
 */
export function isFoundryCapabilitySupported(
  model: string,
  capability: string,
): boolean {
  if (getAPIProvider() !== 'foundry') return true
  const map = getFoundryDeploymentCapabilities()
  if (map.size === 0) return true
  return !map.get(getFoundryCapabilityKey(model))?.has(capability)
}

/**
 * densable `dns` — extract unsupported capabilities from a Foundry 400 APIError.
 */
export function extractFoundryUnsupportedFromError(
  error: unknown,
): string[] | null {
  if (getAPIProvider() !== 'foundry') return null
  if (!(error instanceof APIError) || error.status !== 400) return null
  const body = error.error
  if (body && typeof body === 'object' && 'error' in body) {
    const inner = (body as { error?: unknown }).error
    if (
      inner &&
      typeof inner === 'object' &&
      'message' in inner &&
      typeof (inner as { message?: unknown }).message === 'string'
    ) {
      return parseFoundryUnsupportedCapabilities(
        (inner as { message: string }).message,
      )
    }
  }
  return parseFoundryUnsupportedCapabilities(error.message ?? '')
}

/**
 * densable `xco` — on Foundry 400, learn capabilities and return a retry token
 * when the error is a stripable tool-search / structured_outputs capability miss.
 * Returns null when not applicable.
 */
export function handleFoundryCapabilityError(
  error: unknown,
  model: string,
  purpose?: string,
): string | null {
  const caps = extractFoundryUnsupportedFromError(error)
  if (!caps) return null
  recordFoundryUnsupportedCapabilities(model, caps)
  if (purpose === 'web_search_tool') {
    return 'fail:foundry-purpose-request'
  }
  if (caps.some(c => FOUNDRY_STRIP_CAPABILITIES.has(c))) {
    return `retry:foundry-capability-strip:${caps.join(',')}`
  }
  return null
}

type StripableToolFields = {
  name?: string
  description?: string
  defer_loading?: boolean
  strict?: boolean
}

/** densable `Osr` — DeferredToolPlaceholder wire name. */
const DEFERRED_TOOL_PLACEHOLDER_NAME = 'DeferredToolPlaceholder'

/**
 * densable `kco` — exact placeholder description. Keep in sync with
 * `DEFERRED_TOOL_PLACEHOLDER_DESCRIPTION` in searchExtraTools.ts (cannot import
 * from there: searchExtraTools → foundryCapabilities).
 */
const DEFERRED_TOOL_PLACEHOLDER_DESCRIPTION =
  'Reserved placeholder that keeps deferred tool loading active; never call this tool.'

/**
 * densable `cnu` — strip defer_loading / strict from tools when the deployment
 * learned those features are unsupported. Also drops DeferredToolPlaceholder
 * when tool_search is unsupported (name===Osr && description===kco).
 *
 * Accepts BetaToolUnion-shaped objects (some variants may lack `name`);
 * non-named entries pass through unchanged.
 */
export function stripFoundryUnsupportedToolFields<T>(
  tools: T[],
  model: string,
): T[] {
  if (getAPIProvider() !== 'foundry') return tools
  const map = getFoundryDeploymentCapabilities()
  if (map.size === 0) return tools
  const unsupported = map.get(getFoundryCapabilityKey(model))
  if (!unsupported || unsupported.size === 0) return tools

  const stripToolSearch =
    unsupported.has('tool_search_server') || unsupported.has('tool_search')
  const stripStrict = unsupported.has('structured_outputs')
  if (!stripToolSearch && !stripStrict) return tools

  let changed = false
  const out: T[] = []
  for (const tool of tools) {
    const t = tool as T & StripableToolFields
    // densable: if(c&&l.name===Osr&&l.description===kco) drop
    const dropPlaceholder =
      stripToolSearch &&
      t.defer_loading === true &&
      t.name === DEFERRED_TOOL_PLACEHOLDER_NAME &&
      t.description === DEFERRED_TOOL_PLACEHOLDER_DESCRIPTION
    if (dropPlaceholder) {
      changed = true
      continue
    }
    const hasDefer = stripToolSearch && t.defer_loading === true
    const hasStrict = stripStrict && t.strict === true
    if (!hasDefer && !hasStrict) {
      out.push(tool)
      continue
    }
    changed = true
    const next = { ...t } as T & StripableToolFields
    if (hasDefer) delete next.defer_loading
    if (hasStrict) delete next.strict
    out.push(next as T)
  }
  return changed ? out : tools
}
