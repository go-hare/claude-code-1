/**
 * Official daemon.lock densable (EvK / iV_ / bW / C__ / asK helpers).
 *
 * Path: <configDir>/daemon.lock
 * Fields used by KF: pid, version, startedAt, origin, (optional) procStart/launchTarget.
 */

import { readFile, writeFile, unlink, rename } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'

export type DaemonLockOrigin = 'transient' | 'service' | string

export type DaemonLockData = {
  pid: number
  version: string
  /** Epoch ms — official uses Date.now(). */
  startedAt: number
  origin?: DaemonLockOrigin
  spawnedBy?: string
  launchTarget?: string
  procStart?: unknown
}

export function getDaemonLockPath(
  configDir: string = getClaudeConfigHomeDir(),
): string {
  return join(configDir, 'daemon.lock')
}

/**
 * Official iV_ — read lock file; null if missing/invalid.
 */
export async function readDaemonLock(
  configDir?: string,
): Promise<DaemonLockData | null> {
  try {
    const raw = await readFile(getDaemonLockPath(configDir), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.version === 'string' &&
      typeof parsed.startedAt === 'number'
    ) {
      return parsed as DaemonLockData
    }
    // Tolerate ISO startedAt from older local writers.
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.version === 'string' &&
      typeof parsed.startedAt === 'string'
    ) {
      const ms = Date.parse(parsed.startedAt)
      if (!Number.isNaN(ms)) {
        return {
          ...(parsed as DaemonLockData),
          startedAt: ms,
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Official bW (simplified) — lock exists + pid alive.
 * Full official also checks cmdline contains "daemon" and procStart match;
 * those are platform-specific and optional for KF zombie signalling.
 */
export async function readAliveDaemonLock(
  configDir?: string,
): Promise<DaemonLockData | null> {
  const lock = await readDaemonLock(configDir)
  if (!lock) return null
  try {
    process.kill(lock.pid, 0)
  } catch {
    return null
  }
  return lock
}

/**
 * Official C__ — SIGTERM + wait gracefulMs (default 2s).
 * Returns eperm | exited | timed-out.
 */
export async function signalSupervisorRestart(
  pid: number,
  opts?: { gracefulMs?: number },
): Promise<'eperm' | 'exited' | 'timed-out'> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code === 'EPERM') return 'eperm'
    return 'exited'
  }
  const deadline = Date.now() + (opts?.gracefulMs ?? 2000)
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return 'exited'
    }
    await new Promise(r => setTimeout(r, 50))
  }
  return 'timed-out'
}

/**
 * Write daemon.lock (atomic-ish: tmp + rename when possible).
 * Official Yo8 / SvK — best-effort for local supervisor start.
 */
export async function writeDaemonLock(
  data: DaemonLockData,
  configDir?: string,
): Promise<boolean> {
  const path = getDaemonLockPath(configDir)
  const tmp = `${path}.tmp.${data.pid}.${data.startedAt}`
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    try {
      await rename(tmp, path)
    } catch {
      // Windows may block rename over existing — overwrite.
      await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
      await unlink(tmp).catch(() => {})
    }
    return true
  } catch (err) {
    await unlink(tmp).catch(() => {})
    // last resort direct write
    try {
      await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
      return true
    } catch {
      process.stderr.write(
        `daemon: failed to write lock: ${errorMessage(err)}\n`,
      )
      return false
    }
  }
}

/**
 * Unconditional unlink of daemon.lock (missing is fine).
 * Prefer {@link clearDaemonLockIfOwned} on graceful exit so a newer
 * supervisor's lock is never wiped by a dying predecessor.
 */
export async function clearDaemonLock(configDir?: string): Promise<void> {
  try {
    await unlink(getDaemonLockPath(configDir))
  } catch {
    // missing is fine
  }
}

/**
 * Official CvK via Q — only unlink when lock still belongs to this process:
 *   let l = await iV_(); if (l && l.pid === X.pid && l.startedAt === X.startedAt) await CvK()
 *
 * Prevents a retiring/stale supervisor from deleting a lock rewritten by a
 * newer binary takeover or a second start.
 */
export async function clearDaemonLockIfOwned(
  owner: { pid: number; startedAt: number },
  configDir?: string,
): Promise<boolean> {
  const lock = await readDaemonLock(configDir)
  if (!lock) return false
  if (lock.pid !== owner.pid || lock.startedAt !== owner.startedAt) {
    return false
  }
  await clearDaemonLock(configDir)
  return true
}

/**
 * Official eAO — label embedded in --spawned-by JSON.
 */
export function daemonSpawnedByLabel(
  argv: readonly string[] = process.argv.slice(2),
): string {
  if (argv[0] === 'agents') return 'claude agents'
  if (argv.includes('--bg')) return 'claude --bg'
  return 'claude'
}

/**
 * Official CH({label,cwd,pid}) value for --spawned-by.
 */
export function buildSpawnedByPayload(input?: {
  label?: string
  cwd?: string
  pid?: number
}): string {
  return JSON.stringify({
    label: input?.label ?? daemonSpawnedByLabel(),
    cwd: input?.cwd ?? process.cwd(),
    pid: input?.pid ?? process.pid,
  })
}
