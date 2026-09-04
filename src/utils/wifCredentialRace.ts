/**
 * densable 2.1.243 #24 WIF CI token share — official H / Ee / y / pe / me / lt.
 * Wrap chain: user_oauth `y(H(Ee(p), after-recorded-401), fail-closed)`;
 * OIDC env-quad `y(H(p, always), fail-open)`.
 */

import { readFile } from 'fs/promises'
import { dirname } from 'path'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../services/analytics/index.js'
import { AnthropicProfileOauthError } from './anthropicProfile.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode } from './errors.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { sleep } from './sleep.js'

/** Match densable B / OIDC_CACHE_BACKGROUND_SEC without importing anthropicOidc. */
const WIF_CACHE_BACKGROUND_SEC = 30

export const WIF_FAILED_ACCESS_TOKENS_MAX = 20

/** Official `ue`. */
export const WIF_LOCK_RETRIES = {
  'fail-closed': 5,
  'fail-open': 15,
} as const

const WIF_LOCK_STALE_MS = 60_000
const WIF_LOCK_UPDATE_MS = 5_000

/** Process-global — same CI job siblings share credentials file, not memory. */
const failedAccessTokens = new Set<string>()

export type WifSiblingAdoptionMode = 'always' | 'after-recorded-401'
export type WifLockMode = keyof typeof WIF_LOCK_RETRIES

export type WifAccessToken = {
  token: string
  expiresAt: number | null
}

export type WifTokenProviderOpts = { forceRefresh?: boolean }

export type WifTokenProvider = (
  opts?: WifTokenProviderOpts,
) => Promise<WifAccessToken>

type LockFn = (
  file: string,
  options?: {
    stale?: number
    update?: number
    onCompromised?: (err: Error) => void
  },
) => Promise<() => Promise<void>>

let lockForTests: LockFn | undefined
let sleepForTests: ((ms: number) => Promise<void>) | undefined

function analyticsMode(
  mode: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000)
}

/** densable lt(e) — record rejected exchange token before cache invalidate. */
export function recordWifFailedAccessToken(token: string | undefined): void {
  if (!token) return
  failedAccessTokens.add(token)
  if (failedAccessTokens.size <= WIF_FAILED_ACCESS_TOKENS_MAX) return
  for (const stale of failedAccessTokens) {
    failedAccessTokens.delete(stale)
    if (failedAccessTokens.size <= WIF_FAILED_ACCESS_TOKENS_MAX) break
  }
}

export function clearWifCredentialRaceStateForTests(): void {
  failedAccessTokens.clear()
  lockForTests = undefined
  sleepForTests = undefined
}

export function setWifCredentialsLockForTests(
  next: {
    lock?: LockFn
    sleep?: (ms: number) => Promise<void>
  } | null,
): void {
  lockForTests = next?.lock
  sleepForTests = next?.sleep
}

export function getWifFailedAccessTokensForTests(): ReadonlySet<string> {
  return failedAccessTokens
}

/** densable `o.has(c)` — skip pinning a bearer `lt` already rejected. */
export function isWifFailedAccessToken(token: string | undefined): boolean {
  return Boolean(token && failedAccessTokens.has(token))
}

async function readCredentialsRecord(
  credentialsPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(credentialsPath, 'utf-8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

/**
 * densable H(e,t,r,o) — on forceRefresh, adopt sibling-written access_token
 * when `r==="always" || o.size>0` and the file token is still in-band.
 */
export function wrapWifSiblingRotatedTokenAdoption(
  provider: WifTokenProvider,
  credentialsPath: string,
  mode: WifSiblingAdoptionMode,
  rejectedTokens: ReadonlySet<string> = failedAccessTokens,
): WifTokenProvider {
  return async opts => {
    if (!opts?.forceRefresh) return provider(opts)
    if (mode === 'always' || rejectedTokens.size > 0) {
      try {
        const parsed = await readCredentialsRecord(credentialsPath)
        const token = parsed?.access_token
        const expiresAt = parsed?.expires_at
        if (
          typeof token === 'string' &&
          token &&
          !rejectedTokens.has(token) &&
          (typeof expiresAt !== 'number' ||
            nowUnixSec() < expiresAt - WIF_CACHE_BACKGROUND_SEC)
        ) {
          logEvent('tengu_wif_user_oauth_refresh_race_resolved', {
            mode: analyticsMode(mode),
          })
          logForDebugging(
            'wif: adopting sibling-rotated access token from credentials file; skipping refresh grant',
          )
          return {
            token,
            expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
          }
        }
      } catch (err) {
        logForDebugging(
          `wif: rotated-token adoption check failed: ${errorMessage(err)}`,
        )
      }
    }
    return provider(opts)
  }
}

function isInvalidGrantWithoutAccountHold(err: unknown): boolean {
  if (!(err instanceof AnthropicProfileOauthError)) return false
  if (err.statusCode !== 400 && err.statusCode !== 401) return false
  const body = err.body
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  if (bodyStr.includes('account_on_hold')) return false
  if (typeof body === 'string' && body.includes('"invalid_grant"')) return true
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const error = (body as Record<string, unknown>).error
    return error === 'invalid_grant'
  }
  return false
}

/**
 * densable Ee(e,t) — stale refresh_token in credentials file → clear on invalid_grant.
 */
export function wrapWifInvalidGrantRefreshCleanup(
  provider: WifTokenProvider,
  credentialsPath: string,
  writeCredentials: (
    path: string,
    value: Record<string, unknown>,
  ) => Promise<void>,
): WifTokenProvider {
  return async opts => {
    const before = await readCredentialsRecord(credentialsPath)
    const refreshBefore =
      typeof before?.refresh_token === 'string' ? before.refresh_token : null
    try {
      return await provider(opts)
    } catch (err) {
      if (
        isInvalidGrantWithoutAccountHold(err) &&
        typeof refreshBefore === 'string' &&
        refreshBefore
      ) {
        try {
          const after = await readCredentialsRecord(credentialsPath)
          if (after && after.refresh_token === refreshBefore) {
            await writeCredentials(credentialsPath, {
              ...after,
              refresh_token: undefined,
            })
            logEvent('tengu_wif_user_oauth_refresh_token_cleared', {})
          }
        } catch (writeErr) {
          if (writeErr instanceof AnthropicProfileOauthError) {
            logForDebugging(
              `wif: refresh-token cleanup write failed: ${writeErr.message}`,
              { level: 'warn' },
            )
          } else {
            logError(
              new Error(
                `WIF: failed to clear stale user_oauth refresh_token: ${errorMessage(writeErr)}`,
              ),
            )
          }
        }
      }
      throw err
    }
  }
}

/** Official `O` — already-released proper-lockfile handle. */
function isIgnorableLockRelease(err: unknown): boolean {
  const code = getErrnoCode(err)
  return code === 'ERELEASED' || code === 'ENOTACQUIRED'
}

/**
 * Official `me` — lock the credentials directory; ELOCKED retries then `d`.
 */
async function acquireWifCredentialsDirLock(
  dir: string,
  retries: number,
  mode: WifLockMode,
): Promise<() => Promise<void>> {
  const lockFn = lockForTests ?? lockfile.lock
  const wait = sleepForTests ?? ((ms: number) => sleep(ms))
  for (let attempt = 0; ; attempt++) {
    try {
      return await lockFn(dir, {
        stale: WIF_LOCK_STALE_MS,
        update: WIF_LOCK_UPDATE_MS,
        onCompromised: err =>
          logForDebugging(`WIF credentials lock compromised: ${err}`, {
            level: 'error',
          }),
      })
    } catch (err) {
      if (getErrnoCode(err) !== 'ELOCKED') throw err
      if (attempt >= retries) {
        logEvent('tengu_wif_user_oauth_lock_retry_limit', {
          attempt,
          mode: analyticsMode(mode),
        })
        throw new AnthropicProfileOauthError(
          `Could not acquire credentials lock at ${dir} after ${retries} retries`,
        )
      }
      logEvent('tengu_wif_user_oauth_lock_retry', {
        attempt,
        mode: analyticsMode(mode),
      })
      await wait(1000 + Math.random() * 1000)
    }
  }
}

/**
 * Official `y` / `pe` — serialize refresh on dirname(credentialsPath).
 * fail-closed / retry-limit `d` throw; other fail-open errors skip the lock.
 */
export function wrapWifCredentialsLock(
  provider: WifTokenProvider,
  credentialsPath: string,
  mode: WifLockMode,
): WifTokenProvider {
  return async opts => {
    const dir = dirname(credentialsPath)
    let release: (() => Promise<void>) | undefined
    try {
      release = await acquireWifCredentialsDirLock(
        dir,
        WIF_LOCK_RETRIES[mode],
        mode,
      )
    } catch (err) {
      if (mode === 'fail-closed' || err instanceof AnthropicProfileOauthError) {
        throw err
      }
      logForDebugging(
        `wif: credentials lock unavailable at ${dir} (${errorMessage(err)}); refreshing without cross-process serialization`,
      )
      return provider(opts)
    }
    try {
      logEvent('tengu_wif_user_oauth_lock_acquired', {
        mode: analyticsMode(mode),
      })
      return await provider(opts)
    } finally {
      logEvent('tengu_wif_user_oauth_lock_released', {
        mode: analyticsMode(mode),
      })
      try {
        await release()
      } catch (err) {
        if (isIgnorableLockRelease(err)) {
          logForDebugging(`wif: lock release failed: ${err}`)
        } else {
          logError(err)
        }
      }
    }
  }
}
