import { constants, watch } from 'fs'
import { mkdtemp, open, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export type FileWatchVerdict = 'delivers' | 'refused' | 'silent' | 'unprobed'
type ProbeOptions = {
  directory?: string
  budgetMs?: number
  rewriteEveryMs?: number
  watch?: typeof watch
}
const REFUSED_CODES = new Set(['EMFILE', 'ENFILE', 'ENOSPC'])
function isRefused(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    REFUSED_CODES.has(String(error.code))
  )
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Official Yi/eu: prove that the host delivers fs.watch events. The probe only
 * rewrites its own private temporary inode, and never touches settings/hooks. */
export async function probeNativeFileWatching(
  options: ProbeOptions = {},
): Promise<FileWatchVerdict> {
  let directory: string
  try {
    directory = await mkdtemp(
      join(options.directory ?? tmpdir(), 'fswatch-probe-'),
    )
  } catch {
    return 'unprobed'
  }
  let watcher: ReturnType<typeof watch> | undefined
  const interval = options.rewriteEveryMs ?? 100
  try {
    const path = join(directory, 'probe')
    const initial = await open(path, 'wx', 0o600)
    let identity: Awaited<ReturnType<typeof initial.stat>>
    try {
      await initial.write('0', 0)
      identity = await initial.stat()
    } finally {
      await initial.close()
    }
    let fired = false
    let refused = false
    try {
      watcher = (options.watch ?? watch)(path, () => {
        fired = true
      })
    } catch (error) {
      return isRefused(error) ? 'refused' : 'unprobed'
    }
    watcher.on('error', error => {
      refused ||= isRefused(error)
    })
    const startedAt = performance.now()
    let rewrite = 0
    while (
      !fired &&
      !refused &&
      performance.now() - startedAt < (options.budgetMs ?? 1500)
    ) {
      const handle = await open(
        path,
        constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      )
      try {
        const current = await handle.stat()
        if (
          current.dev !== identity.dev ||
          current.ino !== identity.ino ||
          current.nlink !== 1
        ) {
          return 'unprobed'
        }
        await handle.write(String(++rewrite), 0)
      } finally {
        await handle.close()
      }
      await delay(interval)
    }
    // Some native backends deliver the event after the write callback returns.
    await delay(interval * 2)
    return fired ? 'delivers' : refused ? 'refused' : 'silent'
  } catch {
    return 'unprobed'
  } finally {
    watcher?.close()
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
