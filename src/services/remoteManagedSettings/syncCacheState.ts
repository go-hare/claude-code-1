/**
 * Leaf state module for the remote-managed-settings sync cache.
 *
 * Split from syncCache.ts to break the settings.ts → syncCache.ts → auth.ts →
 * settings.ts cycle. auth.ts sits inside the large settings SCC; importing it
 * from settings.ts's own dependency chain pulls hundreds of modules into the
 * eagerly-evaluated SCC at startup.
 *
 * This module imports only leaves (path, envUtils, file, json, types,
 * settings/settingsCache — also a leaf, only type-imports validation). settings.ts
 * reads the cache from here. syncCache.ts keeps isRemoteManagedSettingsEligible
 * (the auth-touching part) and re-exports everything from here for callers that
 * don't care about the cycle.
 *
 * Eligibility is a tri-state here: undefined (not yet determined — return
 * null), false (ineligible — return null), true (proceed). managedEnv.ts
 * calls isRemoteManagedSettingsEligible() just before the policySettings
 * read — after userSettings/flagSettings env vars are applied, so the check
 * sees config-provided CLAUDE_CODE_USE_BEDROCK/ANTHROPIC_BASE_URL. That call
 * computes once and mirrors the result here via setEligibility(). Every
 * subsequent read hits the cached bool instead of re-running the auth chain.
 *
 * densable 2.1.238 OBu / dD — sessionCache + verifiedPayload + consentedPayload
 * (Qxn triple-pointer). Does NOT invent storageV5 backendView / resetEpoch /
 * helper attestation (MN_).
 */

import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { readFileSync } from '../../utils/fileRead.js'
import { stripBOM } from '../../utils/jsonRead.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { SETTINGS_KEY_ALIASES } from '../../utils/settings/settingsAliases.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { getRemoteSettingsPath } from '../../utils/residualFinalEnvGates.js'

const SETTINGS_FILENAME = 'remote-settings.json'

let sessionCache: SettingsJson | null = null
let verifiedPayload: SettingsJson | null = null
let consentedPayload: SettingsJson | null = null
let eligible: boolean | undefined

export type ReplaceSessionCacheOptions = {
  /** densable RMr(..., {verified:true}) — marks this object as the verified pointer. */
  verified?: boolean
}

/**
 * densable RMr / OBu.replaceSessionCache.
 * Always writes sessionCache. verifiedPayload updates only when opts.verified.
 */
export function setSessionCache(
  value: SettingsJson | null,
  opts?: ReplaceSessionCacheOptions,
): void {
  sessionCache = value
  if (opts?.verified) {
    verifiedPayload = value
  }
}

/**
 * densable q8s portable: auto-consent from disk only when there is no
 * policy-helper / extraKnownMarketplaces surface (canonical or nxn alias
 * `additionalMarketplaces`). Full q8s hashes helpers against MN_()
 * attestation — tip has no backendView, so a helper surface does NOT
 * auto-consent (do not invent helper attestation).
 */
function shouldAutoConsentFromDisk(settings: SettingsJson): boolean {
  const rec = settings as SettingsJson & {
    policyHelpers?: unknown
  } & Record<string, unknown>
  return (
    rec.policyHelpers === undefined &&
    rec.extraKnownMarketplaces === undefined &&
    !SETTINGS_KEY_ALIASES.some(
      ({ alias, canonical }) =>
        canonical === 'extraKnownMarketplaces' && rec[alias] !== undefined,
    )
  )
}

/**
 * densable OBu.seedFromDisk — sessionCache = e; consentedPayload ??= e when
 * q8s(e) is undefined (no helper surface). Does not set verifiedPayload.
 */
export function seedSessionCacheFromDisk(value: SettingsJson): void {
  sessionCache = value
  if (shouldAutoConsentFromDisk(value)) {
    consentedPayload ??= value
  }
}

/**
 * densable W8s / OBu.markConsented. Caller must pass the same object currently
 * in sessionCache for Qxn identity to hold.
 */
export function markSessionCacheConsented(value: SettingsJson | null): void {
  consentedPayload = value
}

export function resetSyncCache(): void {
  sessionCache = null
  verifiedPayload = null
  consentedPayload = null
  eligible = undefined
}

export function setEligibility(v: boolean): boolean {
  eligible = v
  return v
}

export function getSettingsPath(): string {
  // Official CLAUDE_CODE_REMOTE_SETTINGS_PATH override for tests / CCR.
  const override = getRemoteSettingsPath()
  if (override) return override
  return join(getClaudeConfigHomeDir(), SETTINGS_FILENAME)
}

/**
 * densable Qxn — sessionCache, verifiedPayload and consentedPayload are the
 * same non-null object (pointer identity, not deep equal).
 */
export function isRemoteManagedSettingsTripleConsented(): boolean {
  return (
    sessionCache !== null &&
    sessionCache === verifiedPayload &&
    sessionCache === consentedPayload
  )
}

/**
 * densable psr — `Z_e()!=="remote" || Qxn()`.
 *
 * Full sIn origin (plist / hklm / helper) is not portable. Tip treats origin
 * as remote iff the remote session cache is populated this session.
 */
export function isRemoteManagedPolicyConsented(): boolean {
  if (sessionCache === null) return true
  return isRemoteManagedSettingsTripleConsented()
}

// sync IO — settings pipeline is sync. fileRead and jsonRead are leaves;
// file.ts and json.ts both sit in the settings SCC.
function loadSettings(): SettingsJson | null {
  try {
    const content = readFileSync(getSettingsPath())
    const data: unknown = jsonParse(stripBOM(content))
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null
    }
    return data as SettingsJson
  } catch {
    return null
  }
}

export function getRemoteManagedSettingsSyncFromCache(): SettingsJson | null {
  if (eligible !== true) return null
  if (sessionCache) return sessionCache
  const cachedSettings = loadSettings()
  if (cachedSettings) {
    seedSessionCacheFromDisk(cachedSettings)
    // Remote settings just became available for the first time. Any merged
    // getSettings_DEPRECATED() result cached before this moment is missing
    // the policySettings layer (the `eligible !== true` guard above returned
    // null). Flush so the next merged read re-merges with this layer visible.
    //
    // Fires at most once: subsequent calls hit `if (sessionCache)` above.
    // When called from loadSettingsFromDisk() (settings.ts:546), the merged
    // cache is still null (setSessionSettingsCache runs at :732 after
    // loadSettingsFromDisk returns) — no-op. The async-fetch arm (index.ts
    // setSessionCache + notifyChange) already handles its own reset.
    //
    // gh-23085: isBridgeEnabled() at main.tsx Commander-definition time
    // (before preAction → init() → isRemoteManagedSettingsEligible()) reached
    // getSettings_DEPRECATED() at auth.ts:115. The try/catch in bridgeEnabled
    // swallowed the later getGlobalConfig() throw, but the merged settings
    // cache was already poisoned. See managedSettingsHeadless.int.test.ts.
    resetSettingsCache()
    return cachedSettings
  }
  return null
}
