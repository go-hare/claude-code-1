import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import { hostname } from 'os'
import { getOauthConfig } from '../constants/oauth.js'
import {
  checkGate_CACHED_OR_BLOCKING,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js'
import { getSecureStorage } from '../utils/secureStorage/index.js'
import { jsonStringify } from '../utils/slowOperations.js'

/**
 * Trusted device token source for bridge (remote-control) sessions.
 *
 * Bridge sessions have SecurityTier=ELEVATED on the server (CCR v2).
 * The server gates ConnectBridgeWorker on its own flag
 * (sessions_elevated_auth_enforcement in Anthropic Main); this CLI-side
 * flag controls whether the CLI sends X-Trusted-Device-Token at all.
 * Two flags so rollout can be staged: flip CLI-side first (headers
 * start flowing, server still no-ops), then flip server-side.
 *
 * Enrollment (POST /auth/trusted_devices) is gated server-side by
 * account_session.created_at < 10min, so it must happen during /login.
 * Token is persistent (90d rolling expiry) and stored in keychain.
 *
 * See anthropics/anthropic#274559 (spec), #310375 (B1b tenant RPCs),
 * #295987 (B2 Python routes), #307150 (C1' CCR v2 gate).
 */

const TRUSTED_DEVICE_GATE = 'tengu_sessions_elevated_auth_enforcement'
/** densable nFn — org policy that requires a trusted device for elevated RC. */
const REQUIRE_TRUSTED_DEVICES_POLICY = 'require_trusted_devices'
/** densable `C` @180888501 — `qle()`. */
const DISABLE_PROACTIVE_ENROLLMENT =
  'tengu_sessions_elevated_auth_disable_proactive_enrollment'

/**
 * densable cei / CLOUD_CANNOT_REACH_ELEVATED_HINT.
 */
export const CLOUD_CANNOT_REACH_ELEVATED_HINT =
  'not reachable from a cloud session — that session requires a trusted device, which a cloud session never has; message it from one of your own machines instead'

/**
 * densable iFn / isTrustedDeviceActiveForOrg — GB gate then eya(nFn).
 * Product-cut: policy limits never enforce require_trusted_devices.
 */
export function isTrustedDeviceActiveForOrg(): boolean {
  return false
}

/**
 * densable H9b / isRemoteControlPeerUnreachableFromHere.
 * Official: `V.CLAUDE_CODE_REMOTE===true && !V.CLAUDE_TRUSTED_DEVICE_TOKEN && iFn()`.
 */
export function isRemoteControlPeerUnreachableFromHere(): boolean {
  return (
    process.env.CLAUDE_CODE_REMOTE === 'true' &&
    !process.env.CLAUDE_TRUSTED_DEVICE_TOKEN &&
    isTrustedDeviceActiveForOrg()
  )
}

/**
 * densable P9b / formatUnreachableElevatedRefusal.
 */
export function formatUnreachableElevatedRefusal(displayName: string): string {
  return `Nothing was sent: Remote Control session '${displayName}' is ${CLOUD_CANNOT_REACH_ELEVATED_HINT}.`
}

function isGateEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(TRUSTED_DEVICE_GATE, false)
}

/**
 * densable `wV` @180889346 — GB gate then policy allow.
 * Product-cut: policy limits always allow require_trusted_devices.
 */
export function isTrustedDeviceGateEnabled(): boolean {
  return isGateEnabled()
}

/**
 * densable `qle` @180889346.
 */
export function isProactiveEnrollmentDisabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    DISABLE_PROACTIVE_ENROLLMENT,
    false,
  )
}

/**
 * densable `hLt` / `U` @180890334 — env then secure-storage token, no GB gate.
 */
export async function readStoredTrustedDeviceToken(): Promise<
  string | undefined
> {
  const envToken = process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
  if (envToken) return envToken
  return getSecureStorage().read()?.trustedDeviceToken
}

/**
 * densable `gy` @180890594 — `wV()` then `hLt()`.
 */
export async function getTrustedDeviceTokenIfGateOn(): Promise<
  string | undefined
> {
  if (!isTrustedDeviceGateEnabled()) return
  return readStoredTrustedDeviceToken()
}

/** densable `L` @180888481 — `Xle` enroll cooldown. */
const TRUSTED_DEVICE_ENROLL_RETRY_MS = 300_000

/** densable `k.lastEnrollAttemptAtMs` @180888421. */
let lastEnrollAttemptAtMs = 0

/**
 * densable `Xle` @180891056. 403 `untrusted_device`: bust cache, enroll once
 * per cooldown if the token is missing or unchanged, then return the new
 * token so the caller retries. NEVER `export function Xle`. No Far key store.
 */
export async function recoverTrustedDeviceTokenAfterUntrusted(
  previousToken?: string,
  credentials?: unknown,
): Promise<string | undefined> {
  if (!isTrustedDeviceGateEnabled()) return
  clearTrustedDeviceTokenCache()
  let n = await getTrustedDeviceTokenIfGateOn()
  if (!n || n === previousToken) {
    if (Date.now() - lastEnrollAttemptAtMs >= TRUSTED_DEVICE_ENROLL_RETRY_MS) {
      lastEnrollAttemptAtMs = Date.now()
      await enrollTrustedDevice({ trigger: 'server_denied', credentials })
      n = await getTrustedDeviceTokenIfGateOn()
    }
  }
  if (!n || n === previousToken) return
  logForDebugging(
    '[trusted-device] Token changed after untrusted_device 403 (cache bust or lazy enrollment); caller will retry',
  )
  return n
}

/**
 * densable `cdt` @180891452 — `Xle` then `retry(newToken)`.
 * NEVER `export function cdt`.
 */
export async function retryAfterTrustedDeviceRenew<T>(
  previousToken: string | undefined,
  retry: (token: string) => Promise<T>,
  credentials?: unknown,
): Promise<T | undefined> {
  const o = await recoverTrustedDeviceTokenAfterUntrusted(
    previousToken,
    credentials,
  )
  if (!o) return
  return retry(o)
}

/**
 * densable `d5o` @180891821 — bind-path enroll.
 */
export async function trustedDeviceTokenForBind(
  credentials?: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTrustedDeviceGateEnabled()) {
    return { ok: false, error: 'trusted_devices_off' }
  }
  clearTrustedDeviceTokenCache()
  if (await readStoredTrustedDeviceToken()) {
    return { ok: true }
  }
  if (isProactiveEnrollmentDisabled()) {
    return { ok: false, error: 'enrollment_paused' }
  }
  logForDebugging(
    '[trusted-device] Not enrolled, enrolling for a device-bound session',
  )
  await enrollTrustedDevice({ trigger: 'device_bind', credentials })
  return (await getTrustedDeviceTokenIfGateOn())
    ? { ok: true }
    : { ok: false, error: 'not_given' }
}

// Memoized — secureStorage.read() spawns a macOS `security` subprocess (~40ms).
// bridgeApi.ts calls this from getHeaders() on every poll/heartbeat/ack.
// Cache cleared after enrollment (below) and on logout (clearAuthRelatedCaches).
//
// Only the storage read is memoized — the GrowthBook gate is checked live so
// that a gate flip after GrowthBook refresh takes effect without a restart.
const readStoredToken = memoize((): string | undefined => {
  // Env var takes precedence for testing/canary.
  const envToken = process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
  if (envToken) {
    return envToken
  }
  return getSecureStorage().read()?.trustedDeviceToken
})

export function getTrustedDeviceToken(): string | undefined {
  if (!isGateEnabled()) {
    return undefined
  }
  return readStoredToken()
}

export function clearTrustedDeviceTokenCache(): void {
  readStoredToken.cache?.clear?.()
}

/**
 * Clear the stored trusted device token from secure storage and the memo cache.
 * Called before enrollTrustedDevice() during /login so a stale token from the
 * previous account isn't sent as X-Trusted-Device-Token while enrollment is
 * in-flight (enrollTrustedDevice is async — bridge API calls between login and
 * enrollment completion would otherwise still read the old cached token).
 */
export function clearTrustedDeviceToken(): void {
  if (!isGateEnabled()) {
    return
  }
  const secureStorage = getSecureStorage()
  try {
    const data = secureStorage.read()
    if (data?.trustedDeviceToken) {
      delete data.trustedDeviceToken
      secureStorage.update(data)
    }
  } catch {
    // Best-effort — don't block login if storage is inaccessible
  }
  readStoredToken.cache?.clear?.()
}

/**
 * Enroll this device via POST /auth/trusted_devices and persist the token
 * to keychain. Best-effort — logs and returns on failure so callers
 * (post-login hooks) don't block the login flow.
 *
 * The server gates enrollment on account_session.created_at < 10min, so
 * this must be called immediately after a fresh /login. Calling it later
 * (e.g. lazy enrollment on /bridge 403) will fail with 403 stale_session.
 */
export async function enrollTrustedDevice(opts?: {
  trigger?: 'proactive' | 'device_bind' | 'server_denied'
  credentials?: unknown
}): Promise<void> {
  const trigger = opts?.trigger ?? 'proactive'
  try {
    // checkGate_CACHED_OR_BLOCKING awaits any in-flight GrowthBook re-init
    // (triggered by refreshGrowthBookAfterAuthChange in login.tsx) before
    // reading the gate, so we get the post-refresh value.
    if (!(await checkGate_CACHED_OR_BLOCKING(TRUSTED_DEVICE_GATE))) {
      logForDebugging(
        `[trusted-device] Gate ${TRUSTED_DEVICE_GATE} is off, skipping enrollment`,
      )
      return
    }
    if (isProactiveEnrollmentDisabled()) {
      logForDebugging(
        `[trusted-device] Proactive enrollment disabled via ${DISABLE_PROACTIVE_ENROLLMENT}, skipping`,
      )
      return
    }
    // If CLAUDE_TRUSTED_DEVICE_TOKEN is set (e.g. by an enterprise wrapper),
    // skip enrollment — the env var takes precedence in readStoredToken() so
    // any enrolled token would be shadowed and never used.
    if (process.env.CLAUDE_TRUSTED_DEVICE_TOKEN) {
      logForDebugging(
        '[trusted-device] CLAUDE_TRUSTED_DEVICE_TOKEN env var is set, skipping enrollment (env var takes precedence)',
      )
      return
    }
    // Lazy require — utils/auth.ts transitively pulls ~1300 modules
    // (config → file → permissions → sessionStorage → commands). Daemon callers
    // of getTrustedDeviceToken() don't need this; only /login does.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      checkAndRefreshOAuthTokenIfNeeded,
      getClaudeAIOAuthTokens,
      isClaudeAISubscriber,
      isConsumerSubscriber,
    } = require('../utils/auth.js') as typeof import('../utils/auth.js')
    const { getAPIProvider } =
      require('../utils/model/providers.js') as typeof import('../utils/model/providers.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (getAPIProvider() !== 'firstParty' || !isClaudeAISubscriber()) {
      return
    }
    // Product-cut: policy limits never enforce require_trusted_devices.
    // Keep densable bind/deny trigger path (policy allow is always true).
    const bindOrDenied =
      trigger === 'server_denied' ||
      (trigger === 'device_bind' && isConsumerSubscriber())
    if (!bindOrDenied) {
      logForDebugging(
        `[trusted-device] Org has not enabled ${REQUIRE_TRUSTED_DEVICES_POLICY}, skipping enrollment`,
      )
      return
    }
    if (isEssentialTrafficOnly()) {
      logForDebugging(
        '[trusted-device] Essential traffic only, skipping enrollment',
      )
      return
    }
    await checkAndRefreshOAuthTokenIfNeeded(0, false, opts?.credentials)
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging('[trusted-device] No OAuth token, skipping enrollment')
      return
    }
    // Always re-enroll on /login — the existing token may belong to a
    // different account (account-switch without /logout). Skipping enrollment
    // would send the old account's token on the new account's bridge calls.
    const secureStorage = getSecureStorage()

    const baseUrl = getOauthConfig().BASE_API_URL
    let response
    try {
      response = await axios.post<{
        device_token?: string
        device_id?: string
      }>(
        `${baseUrl}/api/auth/trusted_devices`,
        { display_name: `Claude Code on ${hostname()} · ${process.platform}` },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
          validateStatus: s => s < 500,
        },
      )
    } catch (err: unknown) {
      logForDebugging(
        `[trusted-device] Enrollment request failed: ${errorMessage(err)}`,
      )
      return
    }

    if (response.status !== 200 && response.status !== 201) {
      logForDebugging(
        `[trusted-device] Enrollment failed ${response.status}: ${jsonStringify(response.data).slice(0, 200)}`,
      )
      return
    }

    const token = response.data?.device_token
    if (!token || typeof token !== 'string') {
      logForDebugging(
        '[trusted-device] Enrollment response missing device_token field',
      )
      return
    }

    try {
      const storageData = secureStorage.read()
      if (!storageData) {
        logForDebugging(
          '[trusted-device] Cannot read storage, skipping token persist',
        )
        return
      }
      storageData.trustedDeviceToken = token
      const result = secureStorage.update(storageData)
      if (!result.success) {
        logForDebugging(
          `[trusted-device] Failed to persist token: ${result.warning ?? 'unknown'}`,
        )
        return
      }
      readStoredToken.cache?.clear?.()
      logForDebugging(
        `[trusted-device] Enrolled device_id=${response.data.device_id ?? 'unknown'}`,
      )
    } catch (err: unknown) {
      logForDebugging(
        `[trusted-device] Storage write failed: ${errorMessage(err)}`,
      )
    }
  } catch (err: unknown) {
    logForDebugging(`[trusted-device] Enrollment error: ${errorMessage(err)}`)
  }
}
