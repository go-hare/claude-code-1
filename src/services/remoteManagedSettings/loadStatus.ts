/**
 * densable 2.1.248 #4 — remote managed-settings load-fail diagnostics.
 *
 * SEA ISe @180756302 sha=22320eb7789c1845
 * SEA zre @199434623 sha=486d03ff1ba09fd6
 * SEA r @199434788 · WTt @199435288 · cZe @199436286
 * SEA oIn @199434739 · x @190483421
 * UI @201568447 — startup warning for failed / stale_cache only.
 */

import { CLAUDE_AI_INFERENCE_SCOPE } from '../../constants/oauth.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'

/** ISe return codes (plus undefined = eligible). */
export type RemoteManagedSettingsISeReason =
  | 'third_party_provider'
  | 'custom_base_url'
  | 'no_auth'
  | 'oauth_no_inference_scope'
  | 'prosumer_oauth'

/** zre / r() ineligible reasons. Do not add keys beyond this gold map. */
export type RemoteManagedSettingsIneligibleReason =
  | 'third_party_provider'
  | 'custom_base_url'
  | 'sandboxed_entrypoint'
  | 'unpinned_gateway'
  | 'unsupported_subscription'
  | 'no_auth'

/** WTt errorKind map. Do not add keys beyond this gold map. */
export type RemoteManagedSettingsErrorKind =
  | 'no_auth_available'
  | 'http_401'
  | 'http_403'
  | 'http_4xx'
  | 'http_5xx'
  | 'timeout'
  | 'network_error'
  | 'gateway_cert_mismatch'
  | 'gateway_pin_refused'
  | 'gateway_pin_unreadable'
  | 'parse_error'
  | 'invalid_settings'
  | 'unknown_error'

export type RemoteManagedSettingsFailure = {
  errorKind: RemoteManagedSettingsErrorKind
  httpStatus?: number
}

export type RemoteManagedSettingsLoadStatus =
  | { state: 'ok'; hasSettings: boolean }
  | {
      state: 'stale_cache'
      failure: RemoteManagedSettingsFailure
      transportEnvWithheld: boolean
    }
  | { state: 'failed'; failure: RemoteManagedSettingsFailure }
  | { state: 'ineligible'; reason: RemoteManagedSettingsIneligibleReason }

let eligibilityMemo: boolean | undefined
let ineligibleReason: RemoteManagedSettingsIneligibleReason | undefined
let lastLoadStatus: RemoteManagedSettingsLoadStatus | undefined

export function resetRemoteManagedSettingsLoadStatus(): void {
  eligibilityMemo = undefined
  ineligibleReason = undefined
  lastLoadStatus = undefined
}

/** TY / recordEligibility — memoize fetch-gate result + ineligible reason. */
export function recordEligibility(
  eligible: boolean,
  reason?: RemoteManagedSettingsIneligibleReason,
): boolean {
  eligibilityMemo = eligible
  ineligibleReason = eligible ? undefined : reason
  return eligible
}

/** KMe */
export function getEligibilityMemo(): boolean | undefined {
  return eligibilityMemo
}

/** yKe */
export function yKe(): RemoteManagedSettingsIneligibleReason | undefined {
  return ineligibleReason
}

/** sbt */
export function sbt(status: RemoteManagedSettingsLoadStatus): void {
  lastLoadStatus = status
}

/** YMe */
export function YMe(): RemoteManagedSettingsLoadStatus | undefined {
  return lastLoadStatus
}

/**
 * ISe — why this session cannot fetch remote managed settings.
 * `undefined` = eligible (vk: ISe()===void 0).
 */
export function ISe(
  e: { skipBaseUrlCheck?: boolean } = {},
): RemoteManagedSettingsISeReason | undefined {
  if (getAPIProvider() !== 'firstParty') return 'third_party_provider'
  if (!e.skipBaseUrlCheck && !isFirstPartyAnthropicBaseUrl()) {
    return 'custom_base_url'
  }
  try {
    const { key } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (key) return
  } catch {
    // no API key
  }
  const o = getClaudeAIOAuthTokens()
  if (!o?.accessToken) return 'no_auth'
  if (!o.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE)) {
    return 'oauth_no_inference_scope'
  }
  if (o.subscriptionType == null) return
  if (o.subscriptionType !== 'enterprise' && o.subscriptionType !== 'team') {
    return 'prosumer_oauth'
  }
  return
}

/** vk */
export function vk(): boolean {
  return ISe() === undefined
}

/** zre — last load snapshot, or synthesized ineligible when the fetch was skipped. */
export function zre(): RemoteManagedSettingsLoadStatus | undefined {
  const e = YMe()
  if (e) return e
  if (getEligibilityMemo() === false) {
    const t = yKe()
    if (t) return { state: 'ineligible', reason: t }
  }
  return
}

/** oIn — eligible and the fetch has not recorded a status yet. */
export function oIn(): boolean {
  return getEligibilityMemo() === true && YMe() === undefined
}

/** r(e) — ineligible reason copy. No default (gold switch). */
export function formatIneligibleReason(
  e: RemoteManagedSettingsIneligibleReason,
): string | undefined {
  switch (e) {
    case 'third_party_provider':
      return 'not available on Bedrock/Vertex/third-party providers'
    case 'custom_base_url':
      return 'not available with a custom ANTHROPIC_BASE_URL'
    case 'sandboxed_entrypoint':
      return 'not available in sandboxed sessions'
    case 'unpinned_gateway':
      return 'gateway auth is unpinned; run `claude auth login` to pin'
    case 'unsupported_subscription':
      return 'requires an Enterprise or Team subscription'
    case 'no_auth':
      return 'no usable credentials for the settings fetch'
  }
}

/** WTt */
export function WTt(
  e: RemoteManagedSettingsErrorKind,
  t?: number,
): string | undefined {
  switch (e) {
    case 'no_auth_available':
      return 'no credentials available'
    case 'http_401':
      return 'authentication rejected (401)'
    case 'http_403':
      return 'access denied (403)'
    case 'http_4xx':
      return `client error${t ? ` (${t})` : ''}`
    case 'http_5xx':
      return `server error${t ? ` (${t})` : ''}`
    case 'timeout':
      return 'request timed out'
    case 'network_error':
      return 'network error'
    case 'gateway_cert_mismatch':
      return 'gateway certificate mismatch'
    case 'gateway_pin_refused':
      return 'gateway TLS pin is in a symlinked credentials file'
    case 'gateway_pin_unreadable':
      return 'gateway TLS pin could not be read from the credentials file'
    case 'parse_error':
      return 'server response could not be parsed'
    case 'invalid_settings':
      return 'server returned invalid settings'
    case 'unknown_error':
      return 'unexpected error'
  }
}

/** cZe — /doctor /status body. Em-dash is U+2014. */
export function cZe(e: RemoteManagedSettingsLoadStatus): string {
  switch (e.state) {
    case 'ok':
      return e.hasSettings ? 'loaded' : 'none configured for this organization'
    case 'stale_cache':
      return `fetch failed \u2014 using stale cache (${WTt(e.failure.errorKind, e.failure.httpStatus)})${e.transportEnvWithheld ? '; proxy/CA/provider env withheld until a fetch succeeds' : ''}`
    case 'failed':
      return `fetch failed \u2014 no policy applied (${WTt(e.failure.errorKind, e.failure.httpStatus)})`
    case 'ineligible':
      return `not fetched \u2014 ${formatIneligibleReason(e.reason)}`
  }
}

/**
 * x() — record fetch outcome. Ineligible sessions only store ineligible.
 * transportEnvWithheld is !WW(); WW is not portable here, so withheld is
 * only set when the caller passes it (stale_cache tests / future WW).
 */
export function recordRemoteManagedSettingsFetchOutcome(e: {
  fetchSucceeded: boolean
  settings: { [key: string]: unknown } | null
  failure?: RemoteManagedSettingsFailure
  transportEnvWithheld?: boolean
}): void {
  if (getEligibilityMemo() === false) {
    const t = yKe()
    if (t) sbt({ state: 'ineligible', reason: t })
    return
  }
  if (e.fetchSucceeded) {
    sbt({
      state: 'ok',
      hasSettings: e.settings !== null && Object.keys(e.settings).length > 0,
    })
    return
  }
  if (e.failure) {
    const t = e.settings !== null && Object.keys(e.settings).length > 0
    sbt(
      t
        ? {
            state: 'stale_cache',
            failure: e.failure,
            transportEnvWithheld: e.transportEnvWithheld === true,
          }
        : { state: 'failed', failure: e.failure },
    )
  }
}

/** Gf @201568447 — startup warning; only failed / stale_cache. */
export function formatRemoteManagedSettingsStartupWarning(
  status: RemoteManagedSettingsLoadStatus | undefined = zre(),
): string | undefined {
  if (status?.state !== 'failed' && status?.state !== 'stale_cache') {
    return
  }
  const l = WTt(status.failure.errorKind, status.failure.httpStatus)
  const suffix =
    status.state === 'stale_cache'
      ? status.transportEnvWithheld
        ? ' \u00b7 using cached policy (proxy/CA/provider env withheld)'
        : ' \u00b7 using cached policy'
      : ' \u00b7 no remote policy applied'
  return `Remote managed settings failed to load (${l})${suffix} \u00b7 /status for details`
}

/** Gmr / /status line. */
export function formatRemoteManagedSettingsDoctorLine(
  status: RemoteManagedSettingsLoadStatus | undefined = zre(),
): string | undefined {
  const value = formatRemoteManagedSettingsStatusValue(status)
  if (value) return `Managed settings (remote): ${value}`
  return
}

export function formatRemoteManagedSettingsStatusValue(
  status: RemoteManagedSettingsLoadStatus | undefined = zre(),
): string | undefined {
  if (status) return cZe(status)
  if (oIn()) {
    return 'checking\u2026 (fetch in progress; re-run in a moment)'
  }
  return
}

export function classifyRemoteManagedSettingsErrorKind(input: {
  kind: string
  status?: number
  message: string
}): {
  errorKind: RemoteManagedSettingsErrorKind
  httpStatus?: number
} {
  const { kind, status, message } = input
  const withStatus = (
    errorKind: RemoteManagedSettingsErrorKind,
  ): {
    errorKind: RemoteManagedSettingsErrorKind
    httpStatus?: number
  } =>
    status !== undefined ? { errorKind, httpStatus: status } : { errorKind }
  if (message.includes('TLS pin is in a symlinked credentials file')) {
    return withStatus('gateway_pin_refused')
  }
  if (message.includes('TLS pin could not be read from the credentials file')) {
    return withStatus('gateway_pin_unreadable')
  }
  if (
    message.includes('TLS certificate does not match') ||
    message.includes('certificate does not match stored pin')
  ) {
    return withStatus('gateway_cert_mismatch')
  }
  if (kind === 'auth') {
    return withStatus(status === 401 ? 'http_401' : 'http_403')
  }
  if (kind === 'timeout') return withStatus('timeout')
  if (kind === 'network') return withStatus('network_error')
  if (status !== undefined && status >= 500) return withStatus('http_5xx')
  if (status !== undefined && status >= 400) return withStatus('http_4xx')
  return withStatus('unknown_error')
}
