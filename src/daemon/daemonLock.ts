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
 * densable jen — cmdline must look like a claude daemon process.
 * Linux: /proc/<pid>/cmdline. Other platforms: best-effort (accept if unreadable).
 */
export async function isDaemonCmdline(pid: number): Promise<boolean> {
  if (process.platform !== 'linux') {
    // Non-Linux: no portable cmdline; rely on pid live + optional procStart.
    return true
  }
  try {
    const { readFile } = await import('fs/promises')
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8')
    const parts = raw.split('\0')
    // densable: r[0]==="claude daemon" || r.slice(1,4).includes("daemon")
    if (parts[0] === 'claude daemon') return true
    return parts.slice(1, 4).includes('daemon')
  } catch {
    // Unreadable (permission / gone): densable treats as alive candidate.
    return true
  }
}

/**
 * densable iPs / Ex — compare process start identity when lock.procStart set.
 * When procStart is missing (older writers), accept pid-only.
 */
export async function matchesDaemonProcStart(
  pid: number,
  expected: unknown,
  attempts: number = 1,
): Promise<boolean> {
  if (expected === undefined || expected === null) return true
  for (let n = 0; n < attempts; n++) {
    if (n > 0) {
      await new Promise(r => setTimeout(r, 50))
    }
    const live = await readProcessStartIdentity(pid)
    if (live !== undefined) {
      return live === expected || deepEqualProcStart(live, expected)
    }
  }
  // Could not read live identity — densable iPs returns false after retries.
  return false
}

function deepEqualProcStart(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * densable Ex/phh — process start identity for PID reuse detection.
 * Linux: /proc/<pid>/stat starttime; others: ps -o lstart= (best-effort).
 */
export async function readProcessStartIdentity(
  pid: number,
): Promise<unknown | undefined> {
  if (process.platform === 'linux') {
    try {
      const { readFile } = await import('fs/promises')
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      // Field 22 (1-indexed) is starttime after comm in parens.
      const close = stat.lastIndexOf(')')
      if (close >= 0) {
        const rest = stat.slice(close + 2).split(' ')
        // After comm: state(3) ... starttime is field 22 overall → index 19 in rest
        // (fields 1-2 consumed by pid+comm). rest[0]=state → rest[19]=starttime.
        const starttime = rest[19]
        if (starttime !== undefined) return starttime
      }
    } catch {
      return undefined
    }
  }
  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      {
        timeout: 1000,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      },
    )
    const s = stdout.trim()
    return s.length > 0 ? s : undefined
  } catch {
    return undefined
  }
}

/**
 * Official bW — lock exists + pid alive + cmdline + procStart.
 *
 * Live probe is densable cI:
 *   try { process.kill(pid, 0) } catch { return null }
 * Any throw (ESRCH **or** EPERM) → treat as dead so the supervisor slot
 * can be released. Do not fortify EPERM as live (that stuck install/restart).
 */
export async function readAliveDaemonLock(
  configDir?: string,
): Promise<DaemonLockData | null> {
  const lock = await readDaemonLock(configDir)
  if (!lock) return null
  if (!isDaemonPidRaceLive(lock.pid)) return null
  // densable jen: refuse PID reuse of non-daemon process.
  if (!(await isDaemonCmdline(lock.pid))) return null
  // densable iPs: refuse when procStart diverges (PID recycled).
  if (!(await matchesDaemonProcStart(lock.pid, lock.procStart, 1))) {
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

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

/**
 * densable cI / bW live probe (readAliveDaemonLock only):
 *   try { process.kill(pid, 0); return true } catch { return false }
 *
 * Official treats **any** throw (ESRCH and EPERM) as dead so a
 * permission-denied peer does not permanently occupy the **read** path
 * (claim slot / status). Do **not** reuse this for install/race replace —
 * that path must treat non-ESRCH (EPERM) as live (see isDaemonPidInstallLive).
 */
export function isDaemonPidRaceLive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * densable install/race kill0 probe (post-R9d / detectDaemonLockRace):
 *   try { process.kill(pid, 0); return true }
 *   catch (re) { return zt(re) !== "ESRCH" }
 *
 * EPERM → live (refuse steal / report race). ESRCH → dead.
 * Distinct from cI (`isDaemonPidRaceLive`) where any throw is dead.
 */
export function isDaemonPidInstallLive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return errnoCode(err) !== 'ESRCH'
  }
}

/**
 * densable post-R9d peer gate before R0o:
 *   try {
 *     process.kill(ie.pid, 0)
 *     ne = await jen(ie.pid) && await iPs(ie.pid, ie.procStart, …)
 *   } catch (re) {
 *     if (zt(re) !== "ESRCH") ne = true
 *   }
 *   if (ne) refuse replace
 *
 * kill0 success alone is not enough — non-daemon cmdline / procStart
 * mismatch allows stale lock reclaim (PID reuse). Non-ESRCH throw
 * (EPERM) still blocks steal.
 */
export async function isDaemonPeerBlockingInstall(
  lock: Pick<DaemonLockData, 'pid' | 'procStart'>,
): Promise<boolean> {
  try {
    process.kill(lock.pid, 0)
    return (
      (await isDaemonCmdline(lock.pid)) &&
      (await matchesDaemonProcStart(lock.pid, lock.procStart, 1))
    )
  } catch (err) {
    return errnoCode(err) !== 'ESRCH'
  }
}

/** densable ccT — settle after R0o replace before ownership re-read. */
export const DAEMON_LOCK_REPLACE_SETTLE_MS = 100

/**
 * densable R9d — exclusive create of daemon.lock (flag wx on final path).
 * Succeeds only when the file does not exist. Never unlinks a peer lock.
 */
export async function tryCreateDaemonLockExclusive(
  data: DaemonLockData,
  configDir?: string,
): Promise<boolean> {
  const path = getDaemonLockPath(configDir)
  const body = JSON.stringify(data, null, 2)
  try {
    await writeFile(path, body, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (err) {
    if (errnoCode(err) === 'EEXIST') return false
    process.stderr.write(
      `daemon: failed exclusive lock create: ${errorMessage(err)}\n`,
    )
    return false
  }
}

/**
 * Write daemon.lock — densable R0o (tmp + wx + rename; EEXIST/EPERM unlink-retry).
 *
 * Used only to replace a **stale** lock after R9d fails and the peer pid is dead.
 * Must not be the sole install path on a live peer (Windows rename-over would
 * steal the lock). Prefer {@link installDaemonLock}.
 *
 *   1. write tmp with flag wx
 *   2. rename tmp → lock
 *   3. on EEXIST/EPERM/EACCES: unlink lock, rename again; still fail → false
 *   4. re-read: must match pid + startedAt or return false
 * Never falls back to writeFile(lockPath) success (would clobber live peers).
 */
export async function writeDaemonLock(
  data: DaemonLockData,
  configDir?: string,
): Promise<boolean> {
  const path = getDaemonLockPath(configDir)
  const tmp = `${path}.tmp.${data.pid}.${data.startedAt}`
  const body = JSON.stringify(data, null, 2)

  try {
    // densable R0o: wx so two writers don't share the same tmp path content race
    await writeFile(tmp, body, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    // Rare: same pid+startedAt retry — fall back to truncate write of tmp
    if (errnoCode(err) === 'EEXIST') {
      try {
        await writeFile(tmp, body, 'utf8')
      } catch (err2) {
        process.stderr.write(
          `daemon: failed to write lock tmp: ${errorMessage(err2)}\n`,
        )
        return false
      }
    } else {
      process.stderr.write(
        `daemon: failed to write lock tmp: ${errorMessage(err)}\n`,
      )
      return false
    }
  }

  try {
    await rename(tmp, path)
  } catch (err) {
    const code = errnoCode(err)
    // densable R0o: Windows/EEXIST — unlink target then rename; never silent overwrite
    if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
      await unlink(path).catch(() => {})
      try {
        await rename(tmp, path)
      } catch (err2) {
        await unlink(tmp).catch(() => {})
        const code2 = errnoCode(err2)
        if (code2 === 'EEXIST' || code2 === 'EPERM' || code2 === 'EACCES') {
          return false
        }
        process.stderr.write(
          `daemon: failed to rename lock: ${errorMessage(err2)}\n`,
        )
        return false
      }
    } else {
      await unlink(tmp).catch(() => {})
      process.stderr.write(
        `daemon: failed to rename lock: ${errorMessage(err)}\n`,
      )
      return false
    }
  }

  // densable R0o post-check: r?.pid===e.pid && r?.startedAt===e.startedAt
  const readBack = await readDaemonLock(configDir)
  if (readBack?.pid === data.pid && readBack?.startedAt === data.startedAt) {
    return true
  }
  return false
}

/**
 * densable post-tG4 lock install: R9d first; only R0o when peer is dead/missing.
 *
 *   S = R9d(_)
 *   if (!S) {
 *     ie = Gne()
 *     if (ie) {
 *       try {
 *         process.kill(ie.pid, 0)
 *         ne = jen(ie.pid) && iPs(ie.pid, ie.procStart, …)
 *       } catch (re) {
 *         if (zt(re) !== "ESRCH") ne = true  // EPERM → live, refuse
 *       }
 *       if (ne) refuse
 *       S = R0o(_)
 *     } else S = R0o(_)
 *     if (!S) refuse
 *     sleep(ccT); re-read ownership or refuse
 *   }
 *
 * Prevents Windows rename/unlink path from overwriting a live supervisor lock.
 * Do not use cI (EPERM=dead) here — that would steal under permission-denied.
 */
export async function installDaemonLock(
  data: DaemonLockData,
  configDir?: string,
  opts?: { settleMs?: number },
): Promise<boolean> {
  if (await tryCreateDaemonLockExclusive(data, configDir)) {
    return true
  }

  const existing = await readDaemonLock(configDir)
  if (existing) {
    if (await isDaemonPeerBlockingInstall(existing)) {
      return false
    }
  }

  const replaced = await writeDaemonLock(data, configDir)
  if (!replaced) return false

  const settle = opts?.settleMs ?? DAEMON_LOCK_REPLACE_SETTLE_MS
  if (settle > 0) {
    await new Promise(r => setTimeout(r, settle))
  }
  const after = await readDaemonLock(configDir)
  if (!after || after.pid !== data.pid || after.startedAt !== data.startedAt) {
    return false
  }
  return true
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

/**
 * Official tG4 pre-write gate: only a non-transient starter may ask a
 * live transient daemon to yield.
 */
export function shouldRequestDaemonYield(
  existingOrigin: string | undefined,
  newOrigin: string,
): boolean {
  return existingOrigin === 'transient' && newOrigin !== 'transient'
}

/**
 * Official "another daemon is already running …" stderr/log line (tG4).
 */
export function buildAnotherDaemonRunningMessage(input: {
  pid: number
  version: string
  existingOrigin?: string
  newOrigin: string
  askedYield: boolean
  platform?: NodeJS.Platform
}): string {
  const originLabel = input.existingOrigin ?? 'unknown'
  let why: string
  if (input.askedYield) {
    why = `origin=${originLabel}; asked it to yield but the handover failed (see above)`
  } else if (input.newOrigin === 'transient') {
    why = `origin=${originLabel}; an on-demand daemon never displaces a running one`
  } else {
    why = `origin=${originLabel}; only a transient daemon can be displaced`
  }
  const stopHint =
    (input.platform ?? process.platform) === 'win32'
      ? `Stop it with \`taskkill /PID ${input.pid}\`, then retry.`
      : 'Run `claude daemon stop` to stop it, then retry.'
  return `another daemon is already running (pid=${input.pid}, version=${input.version}, ${why}). ${stopHint}`
}

export type ClaimDaemonSupervisorSlotResult =
  | { ok: true }
  | { ok: false; reason: string; askedYield: boolean }

/**
 * Official tG4 pre-SvK arbitration:
 *   1. bW() alive lock
 *   2. if lock is transient and we are not → control op=yield, wait ≤5s
 *   3. if lock still held → refuse (never double-write over a live daemon)
 *
 * Does not write the lock — caller writes after ok.
 */
export async function claimDaemonSupervisorSlot(opts: {
  origin: string
  configDir?: string
  yieldTimeoutMs?: number
  log?: (msg: string) => void
  /** Injected for tests; default sends control `yield`. */
  requestYield?: () => Promise<{
    ok: boolean
    yielding?: boolean
    error?: string
  }>
}): Promise<ClaimDaemonSupervisorSlotResult> {
  const log = opts.log ?? (() => {})
  const yieldTimeoutMs = opts.yieldTimeoutMs ?? 5000
  let lock = await readAliveDaemonLock(opts.configDir)
  let askedYield = false

  if (lock && shouldRequestDaemonYield(lock.origin, opts.origin)) {
    askedYield = true
    log(
      `transient daemon running (pid=${lock.pid}, origin=transient) — asking it to yield to origin=${opts.origin}`,
    )

    const requestYield =
      opts.requestYield ??
      (async () => {
        const { sendControlRequest } = await import('./controlSocketClient.js')
        const { PROTO_VERSION } = await import('./bgWorker.js')
        const resp = await sendControlRequest(
          { proto: PROTO_VERSION, op: 'yield' },
          { timeoutMs: 2000 },
        )
        if (resp.ok && resp.op === 'yield') {
          return { ok: true, yielding: resp.yielding === true }
        }
        return {
          ok: false,
          error:
            typeof resp.error === 'string'
              ? resp.error
              : resp.code
                ? String(resp.code)
                : 'yield failed',
        }
      })

    const yieldResp = await requestYield()
    if (yieldResp.ok && yieldResp.yielding) {
      const deadline = Date.now() + yieldTimeoutMs
      while (lock && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100))
        lock = await readAliveDaemonLock(opts.configDir)
      }
      if (lock) {
        log('yield acked but lock still held after 5s — refusing to start')
      }
    } else if (yieldResp.ok) {
      log('existing daemon refused to yield (it reports origin!=transient)')
    } else {
      log(
        `existing daemon unreachable on control socket (${yieldResp.error ?? 'unknown'}); not taking over`,
      )
    }
  }

  lock = await readAliveDaemonLock(opts.configDir)
  if (lock) {
    const reason = buildAnotherDaemonRunningMessage({
      pid: lock.pid,
      version: lock.version,
      existingOrigin: lock.origin,
      newOrigin: opts.origin,
      askedYield,
    })
    log(reason)
    return { ok: false, reason, askedYield }
  }

  return { ok: true }
}

/**
 * Official post-SvK race check: if another live pid owns the lock after
 * our write attempt, exit rather than run a second supervisor.
 */
export async function detectDaemonLockRace(
  owner: { pid: number; startedAt: number },
  configDir?: string,
): Promise<DaemonLockData | null> {
  const lock = await readDaemonLock(configDir)
  if (!lock) return null
  if (lock.pid === owner.pid && lock.startedAt === owner.startedAt) {
    return null
  }
  // densable install/race: EPERM (non-ESRCH) counts as live peer — report race.
  // Do not use cI here (that treats EPERM as dead and would miss dual-supervisor).
  if (!isDaemonPidInstallLive(lock.pid)) return null
  return lock
}
