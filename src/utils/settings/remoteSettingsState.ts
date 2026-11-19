/**
 * Official 2.1.325 (#1371 & #1429):
 * - `forceRemoteSettingsRefresh` blocking & `storedCopyRefusal` runtime state
 * - `droppedHelperTier` & MDM / remote-settings base URL + `apiKeyHelper` reconciliation
 */

import { logForDebugging } from '../debug.js'
import {
  getGatewayAuth,
  isGatewayAuthExpired,
  isGatewayAuthPinned,
} from '../gatewayEnv.js'
import { createSignal } from '../signal.js'
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

export type RemoteSettingsLoadStatus =
  | { state: 'ok'; hasSettings: boolean }
  | {
      state: 'failed'
      failure: { errorKind: string; httpStatus?: number }
      restrictionsOnly?: boolean
    }
  | {
      state: 'stale_cache'
      failure: { errorKind: string; httpStatus?: number }
      transportEnvWithheld: boolean
    }
  | { state: 'ineligible' }

export type RemoteSettingsNoticeWord = 'pending' | 'missing' | 'answered'

export type RemoteSettingsNoticeSaid = {
  word: RemoteSettingsNoticeWord
  epoch: number
}

export type RemoteSettingsNoticeResult = {
  said: RemoteSettingsNoticeSaid | undefined
  message: string | null
  severity: 'notice' | 'warning'
}

export type RemoteSettingsConsentOutcome =
  | 'approved'
  | 'first_party_silent'
  | 'no_check_needed'
  | 'rejected'
  | 'deferred_non_interactive'
  | 'deferred_no_consent_surface'
  | 'superseded'

type RemoteSettingsRuntimeState = {
  sessionCache: SettingsJson | null
  verifiedPayload: SettingsJson | null
  storedCopyTrust: StoredCopyTrust
  storedCopyRefusal: StoredCopyRefusal | null
  refusedCopyHelperTier: HelperTier | null
  droppedHelperTier: HelperTier | null
  lastLoadStatus: RemoteSettingsLoadStatus | undefined
  loadCycleBegun: boolean
  loadCycleEnded: boolean
  loadBackstopReleased: boolean
  eligibilityMemo: boolean | undefined
  loadEpoch: number
}

const state: RemoteSettingsRuntimeState = {
  sessionCache: null,
  verifiedPayload: null,
  storedCopyTrust: 'not_asked',
  storedCopyRefusal: null,
  refusedCopyHelperTier: null,
  droppedHelperTier: null,
  lastLoadStatus: undefined,
  loadCycleBegun: false,
  loadCycleEnded: false,
  loadBackstopReleased: false,
  eligibilityMemo: undefined,
  loadEpoch: 0,
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

/**
 * Official #1531: Remote managed settings load cycle & status notifications.
 */
export const REMOTE_SETTINGS_STILL_LOADING_MSG =
  'Remote managed settings are still loading'
export const REMOTE_SETTINGS_DID_NOT_LOAD_MSG =
  'Remote managed settings did not load'
export const REMOTE_SETTINGS_HAVE_LOADED_MSG =
  'Remote managed settings have now loaded'

const loadStatusChanged = createSignal<[]>()

/**
 * Subscribe to remote managed settings load status / lifecycle transitions
 * (Official `Wye` / `ysi`, #1531).
 */
export const onRemoteSettingsLoadStatusChanged = loadStatusChanged.subscribe

export function getActiveRemoteSettings(): SettingsJson | null {
  return state.sessionCache
}

export function setRemoteSettingsLoadStatus(
  status: RemoteSettingsLoadStatus | undefined,
): void {
  state.lastLoadStatus = status
  loadStatusChanged.emit()
}

export function getRemoteSettingsLoadStatus():
  | RemoteSettingsLoadStatus
  | undefined {
  return state.lastLoadStatus
}

export function markRemoteSettingsLoadCycleBegun(): void {
  state.loadCycleBegun = true
  loadStatusChanged.emit()
}

export function markRemoteSettingsLoadCycleEnded(): void {
  state.loadCycleEnded = true
  loadStatusChanged.emit()
}

export function releaseRemoteSettingsLoadBackstop(): void {
  state.loadBackstopReleased = true
  loadStatusChanged.emit()
}

export function setRemoteSettingsEligibilityMemo(
  eligible: boolean | undefined,
): void {
  state.eligibilityMemo = eligible
  loadStatusChanged.emit()
}

export function bumpRemoteSettingsLoadEpoch(): number {
  state.loadEpoch += 1
  loadStatusChanged.emit()
  return state.loadEpoch
}

export function isRemoteSettingsNoticeRelevant(): boolean {
  const status = state.lastLoadStatus
  switch (status?.state) {
    case 'failed':
      return true
    case 'stale_cache':
      return status.transportEnvWithheld
    case undefined:
      return (
        state.eligibilityMemo === true &&
        (state.loadCycleEnded || state.loadBackstopReleased)
      )
    default:
      return false
  }
}

export function formatRemoteSettingsFailureReason(
  errorKind: string,
  httpStatus?: number,
): string {
  switch (errorKind) {
    case 'no_auth_available':
      return 'no credentials available'
    case 'profile_credential_error':
      return 'the profile credential could not authenticate the fetch (details in the debug log)'
    case 'api_key_not_sent':
    case 'http_401':
      return 'authentication rejected (401)'
    case 'network_edge_blocked':
    case 'nonorigin_cf':
      return 'blocked before reaching Anthropic (403) — signing in again will not help; check your VPN, proxy, or firewall'
    case 'http_403':
      return 'access denied (403)'
    case 'http_4xx':
      if (httpStatus === 204 || httpStatus === 404) {
        return `answered by a network intermediary, not Anthropic (${httpStatus}); check this network's proxy`
      }
      return `client error${httpStatus ? ` (${httpStatus})` : ''}`
    case 'http_5xx':
      return `server error${httpStatus ? ` (${httpStatus})` : ''}`
    case 'timeout':
      return 'request timed out'
    default:
      return errorKind
  }
}

export function buildRemoteSettingsLoadNotice(
  prevSaid: RemoteSettingsNoticeSaid | undefined,
): RemoteSettingsNoticeResult | null {
  const status = state.lastLoadStatus
  const epoch = state.loadEpoch
  const relevant = isRemoteSettingsNoticeRelevant()

  if (!relevant) {
    if (prevSaid === undefined) return null
    if (status?.state === 'ineligible') {
      return { said: undefined, message: null, severity: 'notice' }
    }
    if (
      prevSaid.word === 'answered' ||
      (status?.state !== 'ok' && status?.state !== 'stale_cache')
    ) {
      return null
    }
  }

  const word: RemoteSettingsNoticeWord = !relevant
    ? 'answered'
    : status === undefined && state.loadCycleBegun && !state.loadCycleEnded
      ? 'pending'
      : 'missing'

  if (prevSaid?.epoch === epoch && prevSaid.word === word) {
    return null
  }

  let message: string
  if (status === undefined) {
    message =
      word === 'pending'
        ? REMOTE_SETTINGS_STILL_LOADING_MSG
        : REMOTE_SETTINGS_DID_NOT_LOAD_MSG
  } else {
    switch (status.state) {
      case 'failed':
        message = `Remote managed settings failed to load (${formatRemoteSettingsFailureReason(status.failure.errorKind, status.failure.httpStatus)}) · ${status.restrictionsOnly ? "the cached policy's restrictions still apply" : 'no remote policy applied'}`
        break
      case 'stale_cache':
        message = `Remote managed settings failed to load (${formatRemoteSettingsFailureReason(status.failure.errorKind, status.failure.httpStatus)}) · using cached policy${status.transportEnvWithheld ? ' (proxy/CA/provider env withheld)' : ''}`
        break
      case 'ok':
        message = `${REMOTE_SETTINGS_HAVE_LOADED_MSG} · ${status.hasSettings ? 'remote policy applied' : 'no remote policy to apply'}`
        break
      case 'ineligible':
        return null
    }
  }

  return {
    said: { word, epoch },
    message,
    severity: word === 'answered' ? 'notice' : 'warning',
  }
}

/**
 * Official #1512: Team/Enterprise first-party API pull consent-free apply check.
 * When `isFirstPartyTrusted` is true, there is no open interactive consent
 * review, and no untrusted stored-copy refusal is active, remote settings can
 * be applied silently without an interactive approval prompt (`first_party_silent`).
 */
export function shouldApplyRemoteSettingsConsentFree(opts: {
  isFirstPartyTrusted: boolean
  hasOpenReview?: boolean
  hasDangerousSettingsChanged?: boolean
}): boolean {
  if (opts.hasOpenReview) return false
  if (state.storedCopyRefusal !== null) return false
  if (!opts.hasDangerousSettingsChanged) return true
  return opts.isFirstPartyTrusted
}

export function resolveRemoteSettingsConsentOutcome(opts: {
  isFirstPartyTrusted: boolean
  isInteractive: boolean
  hasOpenReview?: boolean
  hasDangerousSettingsChanged?: boolean
  promptResult?: 'approved' | 'rejected' | 'deferred_no_consent_surface'
}): RemoteSettingsConsentOutcome {
  if (!opts.hasDangerousSettingsChanged) {
    return 'no_check_needed'
  }
  if (
    shouldApplyRemoteSettingsConsentFree({
      isFirstPartyTrusted: opts.isFirstPartyTrusted,
      hasOpenReview: opts.hasOpenReview,
      hasDangerousSettingsChanged: opts.hasDangerousSettingsChanged,
    })
  ) {
    return 'first_party_silent'
  }
  if (!opts.isInteractive) {
    return 'deferred_non_interactive'
  }
  return opts.promptResult ?? 'deferred_no_consent_surface'
}

export function applyRemoteSettingsConsentFreeIfEligible(
  settings: SettingsJson,
  opts: {
    isFirstPartyTrusted: boolean
    isInteractive: boolean
    hasOpenReview?: boolean
    hasDangerousSettingsChanged?: boolean
    promptResult?: 'approved' | 'rejected' | 'deferred_no_consent_surface'
  },
): {
  applied: boolean
  outcome: RemoteSettingsConsentOutcome
  persistedConsent: boolean
} {
  const outcome = resolveRemoteSettingsConsentOutcome(opts)
  if (
    outcome === 'approved' ||
    outcome === 'first_party_silent' ||
    outcome === 'no_check_needed'
  ) {
    setVerifiedRemoteSettingsForTesting(settings)
    setRemoteSettingsLoadStatus({
      state: 'ok',
      hasSettings: Object.keys(settings).length > 0,
    })
    return { applied: true, outcome, persistedConsent: true }
  }
  if (outcome === 'deferred_non_interactive') {
    state.sessionCache = settings
    return { applied: true, outcome, persistedConsent: false }
  }
  return { applied: false, outcome, persistedConsent: false }
}

export function resetRemoteSettingsStateForTesting(): void {
  state.sessionCache = null
  state.verifiedPayload = null
  state.storedCopyTrust = 'not_asked'
  state.storedCopyRefusal = null
  state.refusedCopyHelperTier = null
  state.droppedHelperTier = null
  state.lastLoadStatus = undefined
  state.loadCycleBegun = false
  state.loadCycleEnded = false
  state.loadBackstopReleased = false
  state.eligibilityMemo = undefined
  state.loadEpoch = 0
}

/**
 * Official 2.1.319 (#1761, `Qe` @19204739):
 * Before polling remote managed settings in the background, refresh/check
 * whether the pinned Claude apps gateway sign-in has expired. If expired,
 * skip the request so the terminal does not send requests that the gateway
 * refuses and logs as `invalid_token`.
 */
export async function shouldSkipRemoteManagedSettingsPollForExpiredGateway(
  refreshGatewayAuth?: () => Promise<unknown>,
): Promise<boolean> {
  const gatewayAuth = getGatewayAuth()
  if (!isGatewayAuthPinned(gatewayAuth)) {
    return false
  }
  if (isGatewayAuthExpired(gatewayAuth) && refreshGatewayAuth) {
    try {
      await refreshGatewayAuth()
    } catch {
      // Refresh failed; fall through to re-check expiry below.
    }
  }
  const latest = getGatewayAuth()
  if (isGatewayAuthPinned(latest) && isGatewayAuthExpired(latest)) {
    logForDebugging(
      'Remote settings: Background poll skipped because the gateway sign-in has expired',
    )
    return true
  }
  return false
}
