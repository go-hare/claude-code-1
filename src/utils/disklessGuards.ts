/**
 * Official 2.1.331 diskless guard infrastructure (chunks #48, #83, #144, #189, #1574).
 *
 * Pure leaf module (no top-level imports of `sessionHost`, `debug`, or `analytics`)
 * so both bootstrap/host layers and deep I/O modules can import it without cycles.
 */

export type DisklessProvider = {
  isDiskless: () => boolean
  isDisklessProcess: () => boolean
  reportBuilt?: (info: unknown) => void
}

export type DisklessWriteSkippedEvent = {
  writer: string
  targetPath: string
}

let activeProvider: DisklessProvider | undefined
let pinnedStorageV5Reader: (() => unknown) | undefined
const writeSkippedObservers = new Set<
  (event: DisklessWriteSkippedEvent) => void
>()

/**
 * Register a synchronous reader for the active pinned `StorageV5` backend
 * (wired by `storageV5/index.ts` at module load so leaf modules such as
 * `config.ts` can query it under native Node ESM without bare `require()`).
 */
export function registerPinnedStorageV5Reader(
  reader: (() => unknown) | undefined,
): void {
  pinnedStorageV5Reader = reader
}

/**
 * Returns the active pinned `StorageV5` backend via the registered reader, if any.
 */
export function getRegisteredPinnedStorageV5(): unknown {
  try {
    return pinnedStorageV5Reader?.()
  } catch {
    return undefined
  }
}

/**
 * Official diskless provider registration (wired by `sessionHost.ts` at init).
 */
export function registerDisklessProvider(
  provider: DisklessProvider | undefined,
): void {
  activeProvider = provider
}

/**
 * Returns the currently registered `DisklessProvider`, if any.
 */
export function getDisklessProvider(): DisklessProvider | undefined {
  return activeProvider
}

/**
 * True when the active session host (including ALS tenant override) is diskless.
 */
export function isDisklessActive(): boolean {
  try {
    return activeProvider?.isDiskless() ?? false
  } catch {
    return false
  }
}

/**
 * True when the root/default process host itself was launched diskless
 * (ignores per-tenant ALS overrides).
 */
export function isDisklessProcessActive(): boolean {
  try {
    return activeProvider?.isDisklessProcess() ?? false
  } catch {
    return false
  }
}

/**
 * Forward build/boot diagnostics to the registered diskless provider, if supported.
 */
export function reportDisklessBuilt(info: unknown): void {
  try {
    activeProvider?.reportBuilt?.(info)
  } catch {
    // Non-fatal diagnostic hook
  }
}

/**
 * Recognizes `NoConfigHomeError` without requiring a direct class import.
 */
export function isNoConfigHomeError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'NoConfigHomeError'
  )
}

/**
 * Official 2.1.331 user-facing refusal message when a command/program is attempted
 * in a diskless session.
 */
export const DISK_PROGRAMS_UNAVAILABLE_MESSAGE =
  'Programs are unavailable in this session; the command was not run.'

/**
 * Typed refusal error thrown when a disk-dependent operation is attempted in a
 * diskless session.
 */
export class DisklessRefusalError extends Error {
  readonly reason: string
  readonly code = 'DISKLESS_REFUSED' as const

  constructor(reason: string, message: string = reason) {
    super(message)
    this.name = 'DisklessRefusalError'
    this.reason = reason
  }
}

/**
 * Refuse launching external programs/subprocesses when the current session is diskless.
 */
export function assertProgramStartAllowedInDiskless(context?: string): void {
  if (isDisklessActive()) {
    throw new DisklessRefusalError(
      context ?? DISK_PROGRAMS_UNAVAILABLE_MESSAGE,
      DISK_PROGRAMS_UNAVAILABLE_MESSAGE,
    )
  }
}

/**
 * Refuse creating, verifying, or writing under the shared per-uid temp directory
 * in a diskless session.
 */
export function assertTempDirAllowedInDiskless(): void {
  if (isDisklessActive()) {
    throw new Error(
      'The temp directory is unavailable in a diskless session: nothing is created, verified or written under the shared per-uid temp root',
    )
  }
}

/**
 * Optional observer hook (primarily for telemetry verification and tests) invoked
 * synchronously whenever `logDisklessWriteSkipped` runs.
 */
export function subscribeDisklessWriteSkipped(
  observer: (event: DisklessWriteSkippedEvent) => void,
): () => void {
  writeSkippedObservers.add(observer)
  return () => {
    writeSkippedObservers.delete(observer)
  }
}

/**
 * Official 2.1.331 `a$` — log a debug warning and emit `tengu_diskless_write_skipped`
 * safely without ever throwing.
 */
export function logDisklessWriteSkipped(
  writer: string,
  targetPath: string,
): void {
  for (const observer of writeSkippedObservers) {
    try {
      observer({ writer, targetPath })
    } catch {
      // Observers must never break callers
    }
  }

  // Lazily dispatch to debug logger and analytics without creating a module cycle.
  try {
    void import('./debug.js')
      .then(({ logForDebugging }) => {
        logForDebugging(
          `[diskless] skipped write by ${writer} to ${targetPath}`,
          { level: 'warn' },
        )
      })
      .catch(() => {})
  } catch {
    // Ignore early/mocked module errors
  }

  try {
    void import('../services/analytics/index.js')
      .then(({ logEvent }) => {
        logEvent('tengu_diskless_write_skipped', {
          writer: writer as unknown as never,
        })
      })
      .catch(() => {})
  } catch {
    // Ignore early/mocked analytics errors
  }
}

/**
 * Official 2.1.331 sentinel reason for settings/paths/hooks dropped on a diskless host.
 */
export const DROPPED_ON_A_DISKLESS_HOST = 'dropped_on_a_diskless_host' as const

/**
 * Returns `undefined` when the active session is diskless; otherwise returns `value`.
 */
export function dropForADisklessHost<T>(value: T): T | undefined {
  return isDisklessActive() ? undefined : value
}

/**
 * Filters out disk-bound items (settings/paths/hooks) when the active session is diskless.
 * If `shouldDropOnDiskless` is omitted, all items are dropped when diskless.
 */
export function filterOutForDisklessHost<T>(
  items: readonly T[],
  shouldDropOnDiskless: (item: T) => boolean = () => true,
): T[] {
  if (!isDisklessActive()) {
    return [...items]
  }
  return items.filter(item => !shouldDropOnDiskless(item))
}
