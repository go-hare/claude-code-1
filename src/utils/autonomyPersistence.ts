import { mkdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { lock } from './lockfile.js'
import { sessionContextAls } from './sessionHost.js'

/**
 * Process-global mutex map keyed by resolved `rootDir` so concurrent hosts
 * targeting the same `.claude/autonomy/.lock` serialize cleanly without
 * contending on `lockfile.lock()` (`ELOCKED`).
 */
const persistenceLocks = new Map<string, Promise<unknown>>()

function safeGetAlsStore() {
  try {
    return sessionContextAls?.getStore?.()
  } catch {
    return undefined
  }
}

/**
 * Two-phase persistence retention. Active records (queued/running, etc.) are
 * always kept — capping them risks evicting in-flight work; that responsibility
 * lives in caller-side leak detection. Inactive (terminal) records are ranked
 * by `getTimestamp` desc and capped to fill the remaining budget below `max`.
 *
 * Returned list is sorted by `getTimestamp` desc regardless of activity, so
 * the persisted file is plain reverse-chronological order — listings/UI can
 * consume it directly without re-sorting.
 */
export function retainActiveFirst<T>(
  records: readonly T[],
  isActive: (record: T) => boolean,
  getTimestamp: (record: T) => number,
  max: number,
): T[] {
  const sortDesc = (left: T, right: T) =>
    getTimestamp(right) - getTimestamp(left)
  const active = records.filter(isActive).slice().sort(sortDesc)
  const history = records
    .filter(record => !isActive(record))
    .slice()
    .sort(sortDesc)
    .slice(0, Math.max(0, max - active.length))
  return [...active, ...history].sort(sortDesc)
}

export function getAutonomyPersistenceLockCountForTests(): number {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'getAutonomyPersistenceLockCountForTests can only be called in tests',
    )
  }
  return persistenceLocks.size
}

export async function withAutonomyPersistenceLock<T>(
  rootDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = resolve(rootDir)
  const lockPath = join(key, '.claude', 'autonomy', '.lock')
  const previous = persistenceLocks.get(key) ?? Promise.resolve()

  let release!: () => void
  const current = new Promise<void>(resolveGate => {
    release = resolveGate
  })
  const chained = previous.then(() => current)
  persistenceLocks.set(key, chained)

  const callerStore = safeGetAlsStore()
  await previous
  try {
    await mkdir(join(key, '.claude', 'autonomy'), { recursive: true })
    await writeFile(lockPath, '', { flag: 'a' })
    const unlock = await lock(lockPath, {
      lockfilePath: `${lockPath}.lock`,
      retries: {
        retries: 10,
        factor: 1.2,
        minTimeout: 10,
        maxTimeout: 100,
      },
    })
    try {
      const currentStore = safeGetAlsStore()
      if (currentStore !== callerStore && sessionContextAls) {
        if (callerStore !== undefined) {
          return await sessionContextAls.run(callerStore, fn)
        }
        return await sessionContextAls.exit(fn)
      }
      return await fn()
    } finally {
      await unlock().catch(() => {})
    }
  } finally {
    release()
    if (persistenceLocks.get(key) === chained) {
      persistenceLocks.delete(key)
    }
  }
}
