/**
 * Minimal module for firing macOS keychain reads in parallel with main.tsx
 * module evaluation, so keychain reads overlap remaining imports.
 *
 * densable 2.1.238 (`joa` / `Akd` / `LDn` / `F8o` / `$8o` / `Uoa`):
 *   - no `process.platform === 'darwin'` guard (missing `security` → Akd catch null)
 *   - spawn timeout / sync throw → null (do not prime; pending sentinel stays)
 *   - legacy slot `FHr = "pending"` until a non-null spawn result lands
 *   - fast paths `LDn(Uoa)` cap wait at 250ms via `withDeadline` (`jg`)
 *   - REPL preAction still `LDn()` unbounded
 *
 * Imports stay minimal: child_process + macOsKeychainHelpers.ts (NOT
 * macOsKeychainStorage.ts — that pulls in execa → human-signals →
 * cross-spawn, ~58ms of synchronous module init).
 */

import { execFile } from 'child_process'
import { isBareMode } from '../envUtils.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  ofDefaultHost,
  runWithSession,
} from '../sessionHost.js'
import { withDeadline } from '../sleep.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getMacOsKeychainStorageServiceName,
  getUsername,
  keychainCacheState,
  primeKeychainCacheFromPrefetch,
} from './macOsKeychainHelpers.js'

const KEYCHAIN_PREFETCH_TIMEOUT_MS = 10_000

/** densable `Uoa` — fast-path wait budget for hung `security` (ms). */
export const KEYCHAIN_PREFETCH_FASTPATH_BUDGET_MS = 250

type PrefetchSpawnResult = { stdout: string | null }

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void

type SpawnExecFile = (
  file: string,
  args: readonly string[],
  options: { encoding: string; timeout: number; windowsHide: boolean },
  callback: ExecFileCallback,
) => unknown

type KeychainPrefetchHostState = {
  execFileImpl: SpawnExecFile
  /**
   * Shared with auth.ts getApiKeyFromConfigOrMacOSKeychain(). densable `FHr`:
   *   null            — not started / cleared
   *   "pending"       — in flight (or timed out — sync reader must retry)
   *   { stdout }      — completed with a spawn result (stdout may still be null)
   */
  legacyApiKeyPrefetch: PrefetchSpawnResult | 'pending' | null
  /** Distinguishes explicit per-host clearLegacyApiKeyPrefetch() from unset fallback. */
  legacyApiKeyCleared: boolean
  prefetchPromise: Promise<void> | null
}

const keychainPrefetchHostSlot = new HostSlot<KeychainPrefetchHostState>(
  () => ({
    execFileImpl: execFile as SpawnExecFile,
    legacyApiKeyPrefetch: null,
    legacyApiKeyCleared: false,
    prefetchPromise: null,
  }),
)

function getKeychainPrefetchHostState(): KeychainPrefetchHostState {
  return keychainPrefetchHostSlot.of(getBootstrapSessionHost())
}

function spawnSecurity(
  serviceName: string,
  execImpl: SpawnExecFile,
): Promise<PrefetchSpawnResult | null> {
  return new Promise(resolve => {
    try {
      execImpl(
        'security',
        ['find-generic-password', '-a', getUsername(), '-w', '-s', serviceName],
        {
          encoding: 'utf-8',
          timeout: KEYCHAIN_PREFETCH_TIMEOUT_MS,
          windowsHide: true,
        },
        (err, stdout) => {
          const timedOut = Boolean(err && 'killed' in err && err.killed)
          resolve(
            timedOut ? null : { stdout: err ? null : stdout?.trim() || null },
          )
        },
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * densable `joa` — fire both keychain reads in parallel. Called at main.tsx
 * top-level. Bare mode is a no-op.
 * Missing `security` (non-darwin) is swallowed by Akd try/catch → null.
 */
export function startKeychainPrefetch(): void {
  const hostState = getKeychainPrefetchHostState()
  if (hostState.prefetchPromise || isBareMode()) return

  const captured = getActiveSessionFromAls()
  const generation = keychainCacheState.generation
  hostState.legacyApiKeyCleared = false
  hostState.legacyApiKeyPrefetch = 'pending'
  const oauthSpawn = spawnSecurity(
    getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX),
    hostState.execFileImpl,
  ).then(result => {
    if (!result) return
    if (captured !== undefined && getActiveSessionFromAls() !== captured) {
      runWithSession(captured, () =>
        primeKeychainCacheFromPrefetch(result.stdout, generation),
      )
    } else {
      primeKeychainCacheFromPrefetch(result.stdout, generation)
    }
  })
  const legacySpawn = spawnSecurity(
    getMacOsKeychainStorageServiceName(),
    hostState.execFileImpl,
  ).then(result => {
    if (result && hostState.legacyApiKeyPrefetch === 'pending') {
      hostState.legacyApiKeyPrefetch = result
    }
  })
  hostState.prefetchPromise = Promise.all([oauthSpawn, legacySpawn]).then(
    () => {},
  )
}

/**
 * densable `LDn` — await prefetch. `ms === undefined` waits forever (REPL
 * preAction). Else `withDeadline` (`jg`) so fast paths cannot stall on hung
 * keychain. No-op when prefetch was never started.
 */
export async function ensureKeychainPrefetchCompleted(
  ms?: number,
): Promise<void> {
  const own = keychainPrefetchHostSlot.peek(getBootstrapSessionHost())
  const prefetchPromise =
    own?.prefetchPromise ??
    ofDefaultHost(keychainPrefetchHostSlot).prefetchPromise
  if (!prefetchPromise) return
  await (ms === undefined ? prefetchPromise : withDeadline(prefetchPromise, ms))
}

/**
 * densable `F8o` — consumed by getApiKeyFromConfigOrMacOSKeychain() before
 * it falls through to sync execSync. Returns null if prefetch hasn't
 * completed (including in-flight / timeout pending).
 */
export function getLegacyApiKeyPrefetchResult(): {
  stdout: string | null
} | null {
  const own = keychainPrefetchHostSlot.peek(getBootstrapSessionHost())
  const legacyApiKeyPrefetch =
    own && (own.legacyApiKeyPrefetch !== null || own.legacyApiKeyCleared)
      ? own.legacyApiKeyPrefetch
      : ofDefaultHost(keychainPrefetchHostSlot).legacyApiKeyPrefetch
  return legacyApiKeyPrefetch === 'pending' ? null : legacyApiKeyPrefetch
}

/**
 * densable `$8o` — clear prefetch result. Called alongside
 * getApiKeyFromConfigOrMacOSKeychain cache invalidation so a stale
 * prefetch doesn't shadow a fresh write.
 */
export function clearLegacyApiKeyPrefetch(): void {
  const hostState = getKeychainPrefetchHostState()
  hostState.legacyApiKeyPrefetch = null
  hostState.legacyApiKeyCleared = true
}

/** Test-only: restore module locals + default execFile. */
export function _resetKeychainPrefetchForTesting(): void {
  const hostState = getKeychainPrefetchHostState()
  hostState.prefetchPromise = null
  hostState.legacyApiKeyPrefetch = null
  hostState.legacyApiKeyCleared = false
  hostState.execFileImpl = execFile as SpawnExecFile
}

/** Test-only: inject spawn (do not mock `child_process` globally). */
export function _setKeychainPrefetchExecFileForTesting(
  impl: SpawnExecFile,
): void {
  getKeychainPrefetchHostState().execFileImpl = impl
}
