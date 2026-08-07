/**
 * densable 2.1.216 client-side bg session reap — `wUs` / `AUs` / `bNt` / `uLe`.
 *
 * Used by `claude daemon stop` after control-socket shutdown (or fallback)
 * unless `--keep-workers`. Does not invent supervisor-in-process kill paths;
 * reaps via roster + orphan sock/pid scan with procStart identity gates.
 */

import { readdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import {
  type DispatchRequest,
  type RosterEntry,
  getDaemonConfigDir,
  getProcessStartTime,
  getPtyDir,
  getPtyErrPath,
  getPtySockPath,
  getSpareDir,
  killPtyHost,
  readRoster,
  updateRoster,
} from './bgWorker.js'
import { isTerminalState, patchBgJobState, readBgJobState } from './jobState.js'

export type ClientBgReapOpts = {
  /**
   * densable `supervisorKilledAll` — when true (control-socket shutdown already
   * reaped workers), force non-done jobs to stopped/stopped even if no
   * exec-exit snapshot is available.
   */
  supervisorKilledAll?: boolean
}

export type ClientBgReapResult = {
  reaped: number
  kept: number
}

export type WorkerKillVerdict = 'killed' | 'gone' | 'foreign' | 'unverified'

type ReapTarget = {
  pid: number
  procStart?: string
  ptySock?: string
  dispatch?: DispatchRequest
}

/** densable mst — Windows worker pid files under daemon config. */
export function getPtyPidDir(): string {
  return join(getDaemonConfigDir(), 'pty-pids')
}

export function getPtyPidPath(short: string): string {
  return join(getPtyPidDir(), `${short}.pid`)
}

/** densable U4 / yCu(..., "late") */
export function getPtyLatePath(sockPath: string): string {
  if (process.platform === 'win32') {
    const name = sockPath.split('\\').pop()!
    return join(getPtyPidDir(), `${name}.late`)
  }
  return `${sockPath}.late`
}

/** densable kye — exec-mode exit snapshot next to sock (or under pty-pids on win). */
export function getExecExitPath(sockPath: string): string {
  if (process.platform === 'win32') {
    const name = sockPath.split('\\').pop()!
    return join(getPtyPidDir(), `${name}.exec-exit`)
  }
  return `${sockPath}.exec-exit`
}

/**
 * densable kept-workers note (`u(kept)`):
 * `note: N background session(s) could not be verified as still ours and
 * was/were left running (records kept). Re-run \`claude daemon stop\` to retry.`
 */
export function formatUnverifiedKeptNote(kept: number): string {
  const unit = kept === 1 ? 'session' : 'sessions'
  const verb = kept === 1 ? 'was' : 'were'
  return (
    `note: ${kept} background ${unit} could not be verified as still ours and ` +
    `${verb} left running (records kept). Re-run \`claude daemon stop\` to retry.`
  )
}

function errnoCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err
    ? String((err as { code?: unknown }).code)
    : ''
}

/**
 * densable `uLe` — SIGTERM process group then pid; escalate SIGKILL after 5s
 * only if procStart still matches (Q$r).
 */
export function killTermWithEscalation(
  pid: number,
  procStart: string | undefined,
): boolean {
  const candidates = [-pid, pid].filter(n => Math.abs(n) > 1)
  for (const n of candidates) {
    try {
      process.kill(n, 'SIGTERM')
    } catch {
      continue
    }
    const abs = Math.abs(candidates[0]!)
    setTimeout(
      (killPid: number, expected: string | undefined) => {
        void (async () => {
          if (expected !== undefined) {
            const live = await getProcessStartTime(Math.abs(killPid), {
              skipCache: true,
            })
            if (live !== expected) return
          }
          try {
            process.kill(killPid, 'SIGKILL')
          } catch {
            // gone
          }
        })()
      },
      5000,
      n,
      procStart,
    ).unref()
    return true
  }
  return false
}

/**
 * densable `AUs(pid, procStart)` kill policy:
 * - kill0 fail non-ESRCH → foreign
 * - kill0 fail ESRCH → try uLe → killed|gone
 * - missing procStart → foreign (never SIGTERM)
 * - unreadable start (retry 250ms) → unverified
 * - mismatch → foreign
 * - match → uLe → killed|gone
 */
export async function verifyAndKillWorkerPid(
  pid: number,
  procStart: string | undefined,
): Promise<WorkerKillVerdict> {
  try {
    process.kill(pid, 0)
  } catch (err) {
    if (errnoCode(err) !== 'ESRCH') return 'foreign'
    return killTermWithEscalation(pid, procStart) ? 'killed' : 'gone'
  }
  if (procStart === undefined) return 'foreign'
  let live = await getProcessStartTime(pid, { skipCache: true })
  if (live === undefined) {
    await new Promise(r => setTimeout(r, 250))
    live = await getProcessStartTime(pid, { skipCache: true })
  }
  if (live === undefined) return 'unverified'
  if (live !== procStart) return 'foreign'
  return killTermWithEscalation(pid, procStart) ? 'killed' : 'gone'
}

type ExecExitOutcome = {
  state: 'done' | 'stopped' | 'crashed'
  detail: string
}

/**
 * densable `bPo` — read `.exec-exit` for exec-mode workers only.
 * Best-effort; missing/invalid → null.
 */
export async function readExecExitOutcome(
  ptySock: string | undefined,
  dispatch: DispatchRequest | undefined,
): Promise<ExecExitOutcome | null> {
  if (!ptySock || dispatch?.launch?.mode !== 'exec') return null
  try {
    const raw = await readFile(getExecExitPath(ptySock), 'utf8')
    const n = JSON.parse(raw) as {
      code?: unknown
      signal?: unknown
      tail?: unknown
    }
    if (typeof n.code !== 'number') return null
    const tail =
      typeof n.tail === 'string'
        ? (n.tail
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .findLast(l => l.trim())
            ?.trim() ?? '')
        : ''
    if (n.code === 0) {
      return { state: 'done', detail: tail || '(no output)' }
    }
    const signal = typeof n.signal === 'string' ? n.signal : undefined
    if (signal === 'SIGINT' || signal === 'SIGQUIT') {
      return { state: 'stopped', detail: 'stopped' }
    }
    const a = signal ? `${signal} (${n.code})` : `exit ${n.code}`
    return {
      state: 'crashed',
      detail: tail ? `${a} — ${tail}` : a,
    }
  } catch {
    return null
  }
}

async function markJobStopped(
  short: string,
  outcome: ExecExitOutcome | { state: 'stopped'; detail: 'stopped' },
): Promise<void> {
  const current = readBgJobState(short)
  if (!current || isTerminalState(current)) return
  // densable PIt: crashed → failed state on job file
  const state =
    outcome.state === 'crashed'
      ? 'failed'
      : outcome.state === 'done'
        ? 'done'
        : 'stopped'
  const detail =
    outcome.state === 'stopped' ? 'stopped' : outcome.detail || 'stopped'
  patchBgJobState(short, {
    state,
    detail,
    tempo: 'idle',
    inFlight: undefined,
    needs: undefined,
    firstTerminalAt: current.firstTerminalAt ?? new Date().toISOString(),
  })
}

async function unlinkQuiet(path: string): Promise<void> {
  await unlink(path).catch(() => {})
}

async function readWinPid(short: string): Promise<number> {
  try {
    const raw = await readFile(getPtyPidPath(short), 'utf8')
    const n = Number(raw.trim().slice(0, 4096) || '0')
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/**
 * densable `wUs` — client-side bg reap after daemon stop.
 * Returns `{ reaped, kept }` where kept = unverified (records retained).
 */
export async function clientBgReapAll(
  opts: ClientBgReapOpts = {},
): Promise<ClientBgReapResult> {
  const roster = await readRoster({ silent: true })
  const targets = new Map<string, ReapTarget>()

  for (const [short, entry] of Object.entries(roster.workers) as Array<
    [string, RosterEntry]
  >) {
    targets.set(short, {
      pid: entry.pid,
      procStart: entry.procStart,
      ptySock: entry.ptySock,
      dispatch: entry.dispatch,
    })
  }

  const isWin = process.platform === 'win32'
  const scanDir = isWin ? getPtyPidDir() : getPtyDir()
  const scanSuffix = isWin ? '.pid' : '.sock'

  const names = await readdir(scanDir).catch(() => [] as string[])
  const primary = new Set(names.filter(n => n.endsWith(scanSuffix)))

  for (const name of names) {
    if (!name.endsWith(scanSuffix)) {
      // densable: orphan sidecars without base sock (unix only)
      if (!isWin) {
        const side = ['.err', '.late', '.exec-exit', '.err.read'].find(s =>
          name.endsWith(`.sock${s}`),
        )
        if (side && !primary.has(name.slice(0, -side.length))) {
          const short = name.slice(0, -`.sock${side}`.length)
          // densable: keep .exec-exit if still in roster (exit snapshot)
          if (!(side === '.exec-exit' && targets.has(short))) {
            await unlinkQuiet(join(scanDir, name))
          }
        }
      }
      continue
    }
    const short = name.slice(0, -scanSuffix.length)
    if (targets.has(short)) continue
    const pid = isWin ? await readWinPid(short) : 0
    targets.set(short, {
      pid,
      ptySock: getPtySockPath(short),
    })
  }

  // densable: orphan spare `*.pty.sock` not referenced by roster
  if (!isWin) {
    const knownSocks = new Set<string>()
    for (const t of targets.values()) {
      if (t.ptySock) knownSocks.add(t.ptySock)
    }
    const spareNames = await readdir(getSpareDir()).catch(() => [] as string[])
    for (const name of spareNames) {
      if (!name.endsWith('.pty.sock')) continue
      const sockPath = join(getSpareDir(), name)
      if (knownSocks.has(sockPath)) continue
      targets.set(`spare:${name}`, { pid: 0, ptySock: sockPath })
    }
  }

  let reaped = 0
  const kept = new Set<string>()

  await Promise.all(
    Array.from(targets.entries()).map(async ([short, t]) => {
      const execOutcome = t.dispatch
        ? await readExecExitOutcome(t.ptySock, t.dispatch)
        : null

      let didReap = false
      if (t.ptySock && (await killPtyHost(t.ptySock))) {
        didReap = true
        reaped++
      } else if (t.pid) {
        const verdict = await verifyAndKillWorkerPid(t.pid, t.procStart)
        switch (verdict) {
          case 'killed':
            didReap = true
            reaped++
            break
          case 'unverified':
            kept.add(short)
            return
          case 'gone':
          case 'foreign':
            break
        }
      }

      if (!short.startsWith('spare:')) {
        const stopped = {
          state: 'stopped' as const,
          detail: 'stopped' as const,
        }
        const outcome =
          execOutcome?.state === 'done'
            ? execOutcome
            : opts.supervisorKilledAll
              ? stopped
              : (execOutcome ?? stopped)
        await markJobStopped(short, outcome)
        const sock = t.ptySock ?? getPtySockPath(short)
        await unlinkQuiet(getExecExitPath(sock))
      }

      if (isWin) {
        await unlinkQuiet(getPtyPidPath(short))
        const sock = t.ptySock ?? getPtySockPath(short)
        const errPath = getPtyErrPath(sock)
        await unlinkQuiet(errPath)
        await unlinkQuiet(`${errPath}.read`)
        await unlinkQuiet(getPtyLatePath(sock))
      }

      // When sock kill failed but we still touched the worker, best-effort
      // sidecar cleanup on unix (densable bNt error path + kye unlink).
      if (!isWin && t.ptySock && !didReap) {
        // leave live sockets alone; only clean dead sidecars already handled
      }
    }),
  )

  if (targets.size > 0) {
    await updateRoster(r => {
      for (const short of targets.keys()) {
        if (!kept.has(short)) {
          delete r.workers[short]
        }
      }
      return r
    }).catch(() => {})
  }

  return { reaped, kept: kept.size }
}
