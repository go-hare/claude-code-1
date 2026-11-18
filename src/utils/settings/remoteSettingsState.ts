/**
 * Official 2.1.325 (#1371 & #1429):
 * - `forceRemoteSettingsRefresh` blocking & `storedCopyRefusal` runtime state
 * - `droppedHelperTier` & MDM / remote-settings base URL + `apiKeyHelper` reconciliation
 */

import { logForDebugging } from '../debug.js'
import type { SettingsJson } from './types.js'

export type StoredCopyRefusal = {
  atMs: number
  reason: string
  forcesRefresh: boolean
}

export type StoredCopyTrust =
  | 'not_asked'
  | { trusted: true; reason?: string }
  | { trusted: false; reason: string }

export type HelperTier = {
  apiKeyHelper: string
  env: Record<string, string>
}

export type RemoteHelperTierStatus =
  | 'settings_unloaded'
  | 'restart_needed'
  | null

const BASE_URL_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_API_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
] as const

type RemoteSettingsRuntimeState = {
  sessionCache: SettingsJson | null
  verifiedPayload: SettingsJson | null
  storedCopyTrust: StoredCopyTrust
  storedCopyRefusal: StoredCopyRefusal | null
  refusedCopyHelperTier: HelperTier | null
  droppedHelperTier: HelperTier | null
}

const state: RemoteSettingsRuntimeState = {
  sessionCache: null,
  verifiedPayload: null,
  storedCopyTrust: 'not_asked',
  storedCopyRefusal: null,
  refusedCopyHelperTier: null,
  droppedHelperTier: null,
}

function stringOnlyEnv(
  env: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!env || typeof env !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') {
      out[k] = v
    }
  }
  return out
}

/**
 * Official `gdt` (#1429): extract `{ apiKeyHelper, env }` from a settings object
 * when `apiKeyHelper` is a non-empty string.
 */
export function extractHelperTier(
  settings: SettingsJson | null | undefined,
): HelperTier | null {
  if (!settings) return null
  const helper = settings.apiKeyHelper
  if (typeof helper !== 'string' || helper.trim() === '') {
    return null
  }
  return {
    apiKeyHelper: helper,
    env: stringOnlyEnv(settings.env as Record<string, unknown> | undefined),
  }
}

/**
 * Official `Xd` (#1371): record refusal of an untrusted or stale stored
 * remote-settings copy, propagating `forcesRefresh` when `forceRemoteSettingsRefresh` is true.
 */
export function recordStoredCopyRefusal(
  settings: SettingsJson | null | undefined,
  reason: string,
  isRefreshable: boolean,
  nowMs: number = Date.now(),
): StoredCopyRefusal {
  const forcesRefresh =
    isRefreshable && settings?.forceRemoteSettingsRefresh === true
  const refusal: StoredCopyRefusal = {
    atMs: nowMs,
    reason,
    forcesRefresh,
  }
  state.storedCopyTrust = { trusted: false, reason }
  state.storedCopyRefusal = refusal
  state.refusedCopyHelperTier = isRefreshable
    ? extractHelperTier(settings)
    : null
  logForDebugging(
    `Remote settings: the stored copy is not trusted at rest (${reason}); treating it as absent`,
  )
  return refusal
}

export function getStoredCopyRefusal(): StoredCopyRefusal | null {
  return state.storedCopyRefusal
}

export function getStoredCopyTrust(): StoredCopyTrust {
  return state.storedCopyTrust
}

export function isForceRemoteSettingsRefreshBlocking(
  settings: SettingsJson | null | undefined,
  refusal: StoredCopyRefusal | null = state.storedCopyRefusal,
): boolean {
  return (
    settings?.forceRemoteSettingsRefresh === true ||
    refusal?.forcesRefresh === true
  )
}

/**
 * Evaluate a stored remote-settings copy against trust/staleness checks (#1371).
 * When `trusted` is false, records `storedCopyRefusal` and returns `{ admitted: false, refusal }`.
 */
export function evaluateStoredRemoteSettingsCopy(
  storedSettings: SettingsJson | null | undefined,
  opts: {
    trusted: boolean
    reason?: string
    isRefreshable?: boolean
    nowMs?: number
  },
):
  | { admitted: true; settings: SettingsJson | null }
  | { admitted: false; refusal: StoredCopyRefusal; blocked: boolean } {
  if (opts.trusted && storedSettings) {
    state.storedCopyTrust = { trusted: true, reason: opts.reason }
    state.storedCopyRefusal = null
    state.refusedCopyHelperTier = null
    state.sessionCache = storedSettings
    state.verifiedPayload = storedSettings
    return { admitted: true, settings: storedSettings }
  }
  const refusal = recordStoredCopyRefusal(
    storedSettings,
    opts.reason ?? 'untrusted',
    opts.isRefreshable ?? true,
    opts.nowMs,
  )
  return {
    admitted: false,
    refusal,
    blocked: isForceRemoteSettingsRefreshBlocking(storedSettings, refusal),
  }
}

/**
 * Official `keepHelperLeaving` (#1429): preserve verified `apiKeyHelper` + env
 * in `droppedHelperTier` when resetting the remote settings session cache.
 */
export function resetRemoteSettingsSessionCache(): void {
  if (
    state.sessionCache !== null &&
    state.sessionCache === state.verifiedPayload
  ) {
    const tier = extractHelperTier(state.sessionCache)
    if (tier !== null) {
      state.droppedHelperTier = {
        ...tier,
        env: {
          ...(state.droppedHelperTier?.env ?? {}),
          ...tier.env,
        },
      }
    }
  }
  state.sessionCache = null
  state.verifiedPayload = null
  state.storedCopyTrust = 'not_asked'
  state.storedCopyRefusal = null
  state.refusedCopyHelperTier = null
}

export function setVerifiedRemoteSettingsForTesting(
  settings: SettingsJson | null,
): void {
  state.sessionCache = settings
  state.verifiedPayload = settings
  state.storedCopyTrust = settings ? { trusted: true } : 'not_asked'
  state.storedCopyRefusal = null
  state.refusedCopyHelperTier = null
}

/**
 * Official `nb` (#1429): retain only base URL env vars from `droppedHelperTier`
 * that match the active `process.env[k]` and are not overridden by `currentSessionCache`.
 */
export function retainDroppedHelperBaseUrlEnv(
  dropped: HelperTier,
  currentSessionCache: SettingsJson | null,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const droppedEnv = dropped.env ?? {}
  const currentEnv =
    currentSessionCache?.env && typeof currentSessionCache.env === 'object'
      ? currentSessionCache.env
      : {}
  const retained: Record<string, string> = {}
  for (const key of BASE_URL_ENV_KEYS) {
    const val = droppedEnv[key]?.trim()
    if (val && val === env[key]?.trim() && currentEnv[key] === undefined) {
      retained[key] = val
    }
  }
  return retained
}

/**
 * Official `Rsi` (#1429): resolve the effective remote `HelperTier` across
 * verified session cache, refused-copy tier, and `droppedHelperTier`.
 */
export function resolveRemoteHelperTier(
  env: NodeJS.ProcessEnv = process.env,
): HelperTier | null {
  const active = extractHelperTier(state.sessionCache)
  if (active !== null) {
    return active
  }
  if (state.sessionCache === null && state.refusedCopyHelperTier !== null) {
    return state.refusedCopyHelperTier
  }
  if (state.droppedHelperTier === null) {
    return null
  }
  const retainedEnv = retainDroppedHelperBaseUrlEnv(
    state.droppedHelperTier,
    state.sessionCache,
    env,
  )
  if (Object.keys(retainedEnv).length === 0) {
    return null
  }
  return {
    ...state.droppedHelperTier,
    env: retainedEnv,
  }
}

/**
 * Official `Psi` (#1429): report whether helper tier requires reload or restart.
 */
export function getRemoteHelperTierStatus(): RemoteHelperTierStatus {
  const active = extractHelperTier(state.sessionCache)
  if (active !== null) {
    return state.sessionCache === state.verifiedPayload
      ? null
      : 'settings_unloaded'
  }
  if (state.sessionCache === null && state.refusedCopyHelperTier !== null) {
    return 'settings_unloaded'
  }
  return state.droppedHelperTier === null ? null : 'restart_needed'
}

export function getDroppedHelperTier(): HelperTier | null {
  return state.droppedHelperTier
}

/**
 * Reconcile MDM and `remote-settings.json` when both specify base URLs or
 * `apiKeyHelper` (#1429). Remote wins over MDM for conflicting keys; if remote
 * is absent/untrusted, MDM values are retained and any `droppedHelperTier` base
 * URL matching `process.env` is preserved.
 */
export function reconcileMdmAndRemoteSettings(
  mdmSettings: SettingsJson | null | undefined,
  remoteSettings: SettingsJson | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): {
  apiKeyHelper: string | undefined
  baseUrlEnv: Record<string, string>
  source: 'remote' | 'mdm' | 'dropped' | 'none'
} {
  const remoteHelper = extractHelperTier(remoteSettings)
  const mdmHelper = extractHelperTier(mdmSettings)
  const dropped = resolveRemoteHelperTier(env)

  const baseUrlEnv: Record<string, string> = {}
  const mdmEnv = stringOnlyEnv(
    mdmSettings?.env as Record<string, unknown> | undefined,
  )
  const remoteEnv = stringOnlyEnv(
    remoteSettings?.env as Record<string, unknown> | undefined,
  )

  for (const key of BASE_URL_ENV_KEYS) {
    if (remoteEnv[key] !== undefined) {
      baseUrlEnv[key] = remoteEnv[key]
    } else if (mdmEnv[key] !== undefined) {
      baseUrlEnv[key] = mdmEnv[key]
    } else if (dropped?.env[key] !== undefined) {
      baseUrlEnv[key] = dropped.env[key]
    }
  }

  if (remoteHelper !== null) {
    return {
      apiKeyHelper: remoteHelper.apiKeyHelper,
      baseUrlEnv,
      source: 'remote',
    }
  }
  if (mdmHelper !== null) {
    return {
      apiKeyHelper: mdmHelper.apiKeyHelper,
      baseUrlEnv,
      source: 'mdm',
    }
  }
  if (dropped !== null) {
    return {
      apiKeyHelper: dropped.apiKeyHelper,
      baseUrlEnv,
      source: 'dropped',
    }
  }
  return {
    apiKeyHelper: undefined,
    baseUrlEnv,
    source: 'none',
  }
}

export function resetRemoteSettingsStateForTesting(): void {
  state.sessionCache = null
  state.verifiedPayload = null
  state.storedCopyTrust = 'not_asked'
  state.storedCopyRefusal = null
  state.refusedCopyHelperTier = null
  state.droppedHelperTier = null
}
