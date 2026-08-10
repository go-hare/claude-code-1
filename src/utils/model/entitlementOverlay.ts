/**
 * densable 2.1.220 — entitlement overlay gate + deny-set helpers.
 *
 * SEA symbols (2.1.220):
 * - `QXt` — modelAccessCache rows with apiName + entitled
 * - `zig` / `fq` → `getModelEntitlementDenySet` (firstParty|gateway only)
 * - `XW` → `isModelDenied`
 * - `zkt` → `isEntitlementOverlayUnavailable`
 *
 * `zkt` deps:
 * - `xn()` → getAPIProvider()
 * - `zv()` → OAuth accessToken != null
 * - `Sx()` → hasProfileScope() (user:profile), not isClaudeAISubscriber
 * - `nZ()` → getAnthropicApiKey() (try/catch → null)
 * - `QXt()` → getModelAccessCache()
 *
 * True when firstParty OAuth session has a token, lacks profile scope, has no
 * Anthropic API key, and bootstrap model_access cache is empty — entitlement
 * overlay cannot be applied ("entitlement_blind").
 */

import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  hasProfileScope,
} from '../auth.js'
import { getCanonicalName } from './model.js'
import {
  getModelAccessCache,
  type ModelAccessCacheEntry,
} from './effortCatalog.js'
import { getAPIProvider, type APIProvider } from './providers.js'

export type EntitlementOverlayDeps = {
  getProvider: () => APIProvider
  /** densable `zv` — OAuth accessToken present (not full subscriber check). */
  hasOAuthAccessToken: () => boolean
  /** densable `Sx` / `hasProfileScope`. */
  hasProfileScope: () => boolean
  /** densable `nZ` — API key or null. */
  getAnthropicApiKey: () => string | null
  /** densable `QXt` — filtered model_access cache. */
  getModelAccessCache: () => readonly ModelAccessCacheEntry[]
}

const defaultDeps: EntitlementOverlayDeps = {
  getProvider: () => getAPIProvider(),
  hasOAuthAccessToken: () => getClaudeAIOAuthTokens()?.accessToken != null,
  hasProfileScope: () => hasProfileScope(),
  getAnthropicApiKey: () => {
    try {
      return getAnthropicApiKey()
    } catch {
      return null
    }
  },
  getModelAccessCache: () => getModelAccessCache(),
}

/**
 * densable `Vig` + `zig` — canonicalize apiName for deny-set membership.
 */
export function canonicalizeModelAccessApiName(apiName: string): string {
  return getCanonicalName(apiName.trim().toLowerCase())
}

/**
 * densable `zig` — build deny set from model_access rows with entitled:false.
 */
export function buildModelEntitlementDenySet(
  entries: readonly ModelAccessCacheEntry[] | null | undefined,
): Set<string> {
  const deny = new Set<string>()
  for (const row of entries ?? []) {
    if (!row.entitled) {
      deny.add(canonicalizeModelAccessApiName(row.apiName))
    }
  }
  return deny
}

/**
 * densable `fq` / export `getModelEntitlementDenySet`.
 * Non-firstParty/non-gateway → empty set (overlay N/A).
 */
export function getModelEntitlementDenySet(
  deps: Pick<
    EntitlementOverlayDeps,
    'getProvider' | 'getModelAccessCache'
  > = defaultDeps,
): Set<string> {
  const provider = deps.getProvider()
  if (provider !== 'firstParty' && provider !== 'gateway') {
    return new Set()
  }
  return buildModelEntitlementDenySet(deps.getModelAccessCache())
}

/**
 * densable `XW` / export `isModelDenied`.
 * Empty deny set → never denied.
 */
export function isModelDenied(
  model: string,
  denySet: Set<string> = getModelEntitlementDenySet(),
): boolean {
  if (denySet.size === 0) return false
  const canonical = canonicalizeModelAccessApiName(model)
  return denySet.has(canonical)
}

/**
 * densable `zkt` / export `isEntitlementOverlayUnavailable`.
 *
 * firstParty && hasOAuthAccessToken && !hasProfileScope &&
 * getAnthropicApiKey() === null && modelAccessCache.length === 0
 */
export function isEntitlementOverlayUnavailable(
  deps: EntitlementOverlayDeps = defaultDeps,
): boolean {
  return (
    deps.getProvider() === 'firstParty' &&
    deps.hasOAuthAccessToken() &&
    !deps.hasProfileScope() &&
    deps.getAnthropicApiKey() === null &&
    deps.getModelAccessCache().length === 0
  )
}

/**
 * densable `g$c` — entitlement-blind AND model family target is opus-5.
 * Used by refusal-fallback arm path to avoid arming opus-5 when blind.
 */
export function isEntitlementBlindOpus5Target(
  model: string,
  deps: EntitlementOverlayDeps = defaultDeps,
): boolean {
  if (!isEntitlementOverlayUnavailable(deps)) return false
  return canonicalizeModelAccessApiName(model) === 'claude-opus-5'
}

/**
 * densable `_$c` — when entitlement-blind and target is opus-5, substitute
 * claude-opus-4-8; otherwise passthrough.
 */
export function applyEntitlementBlindFallbackTarget(
  model: string,
  deps: EntitlementOverlayDeps = defaultDeps,
  substitute = 'claude-opus-4-8',
): string {
  return isEntitlementBlindOpus5Target(model, deps) ? substitute : model
}
