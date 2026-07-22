/**
 * Bg Manager — orchestrates background session lifecycle.
 *
 * Upstream equivalent: `BG4` (createBgManager) in the official 2.1.153 binary.
 *
 * Responsibilities:
 *   - Accept dispatch requests (via control socket or file watcher)
 *   - Spawn Worker instances (PTY host processes for each session)
 *   - Adopt workers from previous supervisor (roster.json)
 *   - Handle control socket ops (list/has/dispatch/attach/subscribe/kill/reply/resize)
 *   - Manage spare pool (pre-warmed sessions)
 *   - Periodic retirement of idle/settled workers
 *   - Roster persistence for crash recovery
 */

import { mkdir, unlink, readdir, rm, lstat } from 'fs/promises'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import type { Socket } from 'net'
import { freemem } from 'os'
import {
  BgWorker,
  type DispatchRequest,
  type AttacherEntry,
  type SpawnPtyFn,
  type RosterFile,
  createDefaultSpawnPty,
  createSignal,
  encodeDetachMsg,
  getDaemonInstanceDir,
  getPtyDir,
  getRvDir,
  getSpareDir,
  getRendezvousSockPath,
  getPtySockPath,
  getPtyErrPath,
  getControlSocketPath,
  getDispatchDir,
  readRoster,
  updateRoster,
  createEmptyRoster,
  isSocketAlive,
  killPtyHost,
  PROTO_VERSION,
  MIN_PROTO_VERSION,
  RETIRE_GRACE_MS,
  RETIRE_GRACE_LONG_MS,
  TICK_INTERVAL_MS,
} from './bgWorker.js'
import {
  type BgJobState,
  readBgJobState,
  writeBgJobState,
  getJobDirPath,
  isTerminalState,
} from './jobState.js'
import {
  startControlSocket,
  respond,
  writeJsonLine,
  type ControlRequest,
  type ControlResponse,
  type ControlSocketInstance,
  type LeaseInfo,
} from './controlSocket.js'
import {
  type HeldSpare,
  spawnSpare,
  claimSpare,
  reapOrphanSpares,
  getBgLowMemThresholdBytes,
} from './bgSpare.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { errorMessage } from '../utils/errors.js'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { DispatchRequest } from './bgWorker.js'

export interface BgManagerInstance {
  handles: Map<string, BgWorker>
  dispatch(req: DispatchRequest): void
  leaseCount(): number
  liveHandleCount(): number
  killAll(reap?: boolean, sig?: string): number
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Pinned sessions — official GJ_ / if8
// ---------------------------------------------------------------------------

async function readPinnedSessions(): Promise<Set<string>> {
  try {
    const { getClaudeConfigHomeDir } = await import('../utils/envUtils.js')
    const pinsPath = join(getClaudeConfigHomeDir(), 'pins.json')
    const { readFile } = await import('fs/promises')
    const raw = await readFile(pinsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((s: unknown) => typeof s === 'string'))
  } catch {
    return new Set()
  }
}

// ---------------------------------------------------------------------------
// Dispatch watcher — official PmO / uG4
// ---------------------------------------------------------------------------

async function startDispatchWatcher(
  onDispatch: (req: DispatchRequest) => void,
): Promise<{ close(): void }> {
  const dir = getDispatchDir()
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {})

  // Use polling-based watcher (chokidar-like) for cross-platform support
  let closed = false
  const seen = new Set<string>()

  const poll = async () => {
    if (closed) return
    try {
      const files = await readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.json') || seen.has(file)) continue
        seen.add(file)
        const filePath = join(dir, file)
        try {
          const { readFile } = await import('fs/promises')
          const raw = await readFile(filePath, 'utf-8')
          const req = JSON.parse(raw) as DispatchRequest
          await unlink(filePath).catch(() => {})
          if (req && req.short && req.sessionId) {
            onDispatch(req)
          }
        } catch (e) {
          // Move to rejected
          const rejDir = join(dir, 'rejected')
          await mkdir(rejDir, { recursive: true }).catch(() => {})
          const { rename } = await import('fs/promises')
          await rename(filePath, join(rejDir, file)).catch(() =>
            unlink(filePath).catch(() => {}),
          )
        }
      }
    } catch {}
  }

  // Initial scan
  await poll()

  // Watch for new files
  let watcher: { close(): void } | undefined
  try {
    const { watch } = await import('fs')
    const fsWatcher = watch(dir, { persistent: false }, (event, filename) => {
      if (event === 'rename' && filename?.endsWith('.json')) {
        poll()
      }
    })
    watcher = fsWatcher
  } catch {
    // Fallback to polling
    const timer = setInterval(poll, 500)
    timer.unref()
    watcher = { close: () => clearInterval(timer) }
  }

  return {
    close() {
      closed = true
      watcher?.close()
    },
  }
}

// ---------------------------------------------------------------------------
// Worker settle handler — official R3q
// Wires up onSettle/onState listeners for a worker to update job state,
// roster, and clean up sockets.
// ---------------------------------------------------------------------------

function wireWorkerLifecycle(
  handles: Map<string, BgWorker>,
  worker: BgWorker,
  onKeepAliveChange: () => void,
  pendingSettleWrites: Set<Promise<unknown>>,
  log: (msg: string) => void,
): void {
  const trackWrite = (p: Promise<unknown>) => {
    pendingSettleWrites.add(p)
    p.finally(() => pendingSettleWrites.delete(p))
  }

  worker.onSettle.subscribe((outcome: string) => {
    log(`bg settled ${worker.record.short} (${outcome})`)
    const jobDir = getJobDirPath(worker.record.short)
    const finalState =
      outcome === 'done' ? 'done' : outcome === 'killed' ? 'stopped' : 'failed'
    const detail = worker.record.detail

    // Delete job dir if flagged
    if (worker.shouldDeleteJobDir) {
      trackWrite(rm(jobDir, { recursive: true, force: true }).catch(() => {}))
    } else {
      // Update job state to terminal
      trackWrite(
        (async () => {
          const state = readBgJobState(worker.record.short)
          if (!state) {
            if (outcome === 'crashed') return
          } else if (
            isTerminalState(state) &&
            !(outcome === 'crashed' && state.state === 'failed')
          ) {
            return
          } else if (
            outcome === 'done' &&
            state.state === 'blocked' &&
            worker.dispatch.launch.mode !== 'exec'
          ) {
            return
          }
          const now = new Date().toISOString()
          const base = state ?? {
            state: 'working' as const,
            detail: '',
            tempo: 'active' as const,
            output: null,
            children: null,
            linkScanOffset: 0,
            template:
              worker.dispatch.launch.mode === 'exec'
                ? 'exec'
                : (worker.dispatch.agent ?? worker.dispatch.routine ?? 'bg'),
            routine: worker.dispatch.routine,
            respawnFlags: [...worker.dispatch.respawnFlags],
            intent: worker.record.intent,
            name: worker.record.name,
            sessionId: worker.record.sessionId,
            cwd: worker.record.cwd,
            worktreePath:
              worker.dispatch.worktree?.path ?? worker.record.worktreePath,
            createdAt: new Date(worker.dispatch.createdAt).toISOString(),
            updatedAt: now,
            firstTerminalAt: null,
            backend: 'daemon' as const,
          }
          writeBgJobState(worker.record.short, {
            ...base,
            state: finalState,
            detail:
              finalState === 'stopped'
                ? 'stopped'
                : (detail || base.detail).replace(/; respawning$/, ''),
            tempo: 'idle',
            inFlight: undefined,
            updatedAt: now,
            firstTerminalAt: base.firstTerminalAt ?? now,
          })
        })().catch(() => {}),
      )
    }

    // Update roster (remove worker)
    trackWrite(
      updateRoster(r => {
        delete r.workers[worker.record.short]
      }).catch(() => {}),
    )

    // Clean up sockets
    if (process.platform !== 'win32') {
      const entry = worker.rosterEntry()
      trackWrite(
        unlink(getRendezvousSockPath(worker.record.short)).catch(() => {}),
      )
      if (entry.ptySock) {
        trackWrite(unlink(entry.ptySock).catch(() => {}))
        trackWrite(unlink(getPtyErrPath(entry.ptySock)).catch(() => {}))
      }
    }

    // Exec mode: keep handle around for 5 min for late attachers
    if (worker.dispatch.launch.mode === 'exec' && outcome !== 'killed') {
      onKeepAliveChange()
      setTimeout(
        (h, short, w) => {
          if (h.get(short) === w) h.delete(short)
        },
        300_000,
        handles,
        worker.record.short,
        worker,
      ).unref()
      return
    }

    handles.delete(worker.record.short)
    onKeepAliveChange()
  })

  worker.onState.subscribe((patch: Record<string, unknown>) => {
    // Update roster when PID changes
    if (patch.pid) {
      updateRoster(r => {
        r.workers[worker.record.short] = worker.rosterEntry()
      }).catch(() => {})
    }
    // Update job state on crash/resume
    if (patch.state === 'crashed' || patch.state === 'resuming') {
      const state = patch.state as string
      const detail = worker.record.detail
      const tempo = state === 'crashed' ? 'idle' : 'active'
      const jobDir = getJobDirPath(worker.record.short)
      const current = readBgJobState(worker.record.short)
      if (!current || isTerminalState(current)) return
      if (state === 'resuming' && current.state !== 'crashed') return
      writeBgJobState(worker.record.short, {
        ...current,
        state: state as BgJobState['state'],
        detail,
        tempo: tempo as BgJobState['tempo'],
        inFlight: undefined,
        updatedAt: new Date().toISOString(),
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Orphan reaping — official GmO / f3q
// ---------------------------------------------------------------------------

async function reapOrphanPtyHosts(
  handles: Map<string, BgWorker>,
  log: (msg: string) => void,
): Promise<void> {
  if (process.platform === 'win32') return

  const ptyDir = getPtyDir()
  const knownSocks = new Set<string>()
  for (const w of handles.values()) {
    const entry = w.rosterEntry()
    if (entry.ptySock) knownSocks.add(entry.ptySock)
  }

  let files: string[]
  try {
    files = await readdir(ptyDir)
  } catch {
    return
  }

  let reaped = 0
  for (const file of files) {
    if (!file.endsWith('.sock')) continue
    const sockPath = join(ptyDir, file)
    if (knownSocks.has(sockPath)) continue
    reaped++
    // Try to kill the orphan PTY host
    const sock = (await import('net')).connect(sockPath)
    sock.on('error', () => {
      unlink(sockPath).catch(() => {})
    })
    sock.once('connect', () => {
      sock.resume()
      const { encodeCtrlFrame } =
        require('./ptyHost.js') as typeof import('./ptyHost.js')
      sock.write(encodeCtrlFrame({ t: 'kill', sig: 'SIGTERM' }))
      sock.end()
      setTimeout((s: typeof sock) => s.destroy(), 2000, sock).unref()
    })
  }

  // Clean up orphan .err files
  for (const file of files) {
    if (file.endsWith('.sock.err')) {
      const sockFile = file.slice(0, -4)
      if (!files.includes(sockFile)) {
        unlink(join(ptyDir, file)).catch(() => {})
      }
    }
  }

  if (reaped) log(`bg orphan-reap: ${reaped} roster-less pty host(s)`)
}

/** Clean up stale daemon instance directories — official FvK */
async function cleanStaleDaemonDirs(): Promise<void> {
  if (process.platform === 'win32') return
  const instanceDir = getDaemonInstanceDir()
  const parentDir = join(instanceDir, '..')
  const myName = instanceDir.split('/').pop()!

  try {
    const entries = await readdir(parentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === myName) continue
      const dir = join(parentDir, entry.name)
      // Check if control socket is alive
      const controlSock = join(dir, 'control.sock')
      if (await isSocketAlive(controlSock)) continue
      // Check if recently modified
      const stat = await lstat(dir).catch(() => null)
      if (!stat || Date.now() - stat.mtimeMs < 10_000) continue
      // Check if any sockets remain
      const rv = await readdir(join(dir, 'rv')).catch(() => [])
      const pty = await readdir(join(dir, 'pty')).catch(() => [])
      const spare = await readdir(join(dir, 'spare')).catch(() => [])
      if (rv.length || pty.length || spare.length) continue
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Ensure daemon directories — official aL6 / UvK
// ---------------------------------------------------------------------------

async function ensureDaemonDirs(): Promise<void> {
  if (process.platform === 'win32') return

  const instanceDir = getDaemonInstanceDir()
  await mkdir(instanceDir, { recursive: true, mode: 0o700 }).catch(() => {})

  // Touch mtime
  const { utimes } = await import('fs/promises')
  const now = new Date()
  await utimes(instanceDir, now, now).catch(() => {})

  // Verify ownership
  const uid = process.getuid?.()
  const parentDir = join(instanceDir, '..')
  for (const dir of [parentDir, instanceDir]) {
    const stat = await lstat(dir)
    if (uid !== undefined && stat.uid !== uid) {
      throw new Error(`refusing to bind: ${dir} is owned by uid ${stat.uid}`)
    }
    if ((stat.mode & 0o777) !== 0o700) {
      const { chmod } = await import('fs/promises')
      await chmod(dir, 0o700)
    }
  }
}

// ---------------------------------------------------------------------------
// BG Manager — official BG4
// ---------------------------------------------------------------------------

export async function startBgManager(opts?: {
  onLog?: (msg: string) => void
  spawnPty?: SpawnPtyFn
  getAuthSnapshot?: () => Promise<string | undefined>
  onKeepAliveChange?: () => void
  onShutdown?: () => void
  onNudge?: () => Promise<boolean>
  onYield?: () => boolean
}): Promise<BgManagerInstance> {
  const log = opts?.onLog ?? (() => {})
  const handles = new Map<string, BgWorker>()
  const pendingSettleWrites = new Set<Promise<unknown>>()
  // Official: O = _.spawnPty ?? nqq(); j = _.spawnPty === void 0
  // Spare only uses the default Bun.spawn path when caller did not inject spawnPty.
  const usingDefaultSpawnPty = opts?.spawnPty === undefined
  const spawnPty = opts?.spawnPty ?? createDefaultSpawnPty()
  const onKeepAliveChange = opts?.onKeepAliveChange ?? (() => {})
  let closed = false
  let adoptionComplete = false
  let hasDispatched = false
  // Official Y / A — held spare + in-flight refill
  let heldSpare: HeldSpare | null = null
  let spareRefilling = false
  /**
   * Local product: shorts with in-flight claimSpare (await sendClaim, no
   * handles entry yet). densable D3q registers handle first so oAp sees a
   * pid; we await sendClaim before register, so without this set:
   *   - concurrent dispatch for same short can cold-spawn in parallel
   *   - awaitWorkerAck 5s timeout races sendClaim's 5s retry budget →
   *     ETIMEOUT while claim still succeeds (ghost left-arrow / double work)
   */
  const claimingShorts = new Set<string>()

  /**
   * Official J() — refill single held spare when eligible.
   * Gates: tengu_bg_spare_enable, low-mem, hasDispatched, adoptionComplete ($),
   * no held/refilling, not closed, default spawnPty, not Windows.
   */
  const refillSpare = (): void => {
    if (
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_bg_spare_enable', true) !==
      true
    ) {
      if (heldSpare) {
        heldSpare.dispose()
        heldSpare = null
      }
      return
    }
    const lowMemThreshold = getBgLowMemThresholdBytes()
    if (lowMemThreshold > 0 && freemem() < lowMemThreshold) {
      if (heldSpare) {
        heldSpare.dispose()
        heldSpare = null
      }
      return
    }
    // Official: !w || Y || A || z || !$ || !O || !j || windows
    if (
      !hasDispatched ||
      heldSpare ||
      spareRefilling ||
      closed ||
      !adoptionComplete ||
      !spawnPty ||
      !usingDefaultSpawnPty ||
      process.platform === 'win32'
    ) {
      return
    }
    spareRefilling = true
    let spawned: HeldSpare | null = null
    let exitedBeforeAssign = false
    void spawnSpare({
      log,
      onExit: () => {
        if (spawned === null) {
          exitedBeforeAssign = true
          return
        }
        if (heldSpare === spawned) {
          heldSpare = null
          // Official: only refill if spare lived ≥2s (avoid crash loops)
          if (Date.now() - spawned.startedAt >= 2000) refillSpare()
        }
      },
    })
      .then(spare => {
        spawned = spare
        if (!spare || closed || exitedBeforeAssign) {
          spare?.dispose()
          return
        }
        heldSpare = spare
        logEvent('tengu_bg_spare_spawn', {})
      })
      .catch((err: unknown) => {
        // Official Pw(C) soft-fail for spawn errno; otherwise rethrow path → log
        log(`bg-spare spawn failed: ${errorMessage(err)}`)
      })
      .finally(() => {
        spareRefilling = false
      })
  }

  // Seed state.json for a dispatch (shared by claim + cold spawn paths).
  const seedJobState = (req: DispatchRequest): void => {
    const jobDir = getJobDirPath(req.short)
    mkdirSync(jobDir, { recursive: true })
    const now = new Date().toISOString()
    const existingState = readBgJobState(req.short)
    if (existingState) {
      const flags = req.respawnFlags ?? []
      if (flags.length > 0 && existingState.respawnFlags.length === 0) {
        writeBgJobState(req.short, {
          ...existingState,
          respawnFlags: flags,
          sessionId: req.sessionId,
          resumeSessionId:
            req.launch.mode === 'resume'
              ? req.sessionId
              : (existingState.resumeSessionId ?? req.sessionId),
          daemonShort: req.short,
          updatedAt: now,
        })
      } else if (existingState.sessionId !== req.sessionId) {
        writeBgJobState(req.short, {
          ...existingState,
          sessionId: req.sessionId,
          resumeSessionId:
            req.launch.mode === 'resume'
              ? req.sessionId
              : (existingState.resumeSessionId ?? req.sessionId),
          daemonShort: req.short,
          updatedAt: now,
        })
      }
    } else {
      writeBgJobState(req.short, {
        state: 'starting',
        detail: 'starting\u2026',
        tempo: 'active',
        output: null,
        children: null,
        linkScanOffset: 0,
        template: req.agent ?? req.routine ?? 'bg',
        routine: req.routine,
        respawnFlags: req.respawnFlags ?? [],
        intent: req.intent ?? '',
        name: req.name,
        sessionId: req.sessionId,
        resumeSessionId: req.sessionId,
        daemonShort: req.short,
        cwd: req.cwd,
        originCwd: req.cwd,
        worktreePath: req.worktree?.path,
        createdAt: now,
        updatedAt: now,
        firstTerminalAt: null,
      })
    }
  }

  // --- Dispatch handler (official M) ---
  const handleDispatch = (
    req: DispatchRequest,
    retryCount = 0,
    afterUpgrade?: boolean,
  ): void => {
    if (closed) return
    hasDispatched = true

    const existingHandle = handles.get(req.short)
    if (existingHandle) {
      if (
        (existingHandle.isKilling ||
          existingHandle.isRetiring ||
          existingHandle.record.outcome) &&
        retryCount < 30
      ) {
        if (
          retryCount === 15 &&
          (existingHandle.isKilling || existingHandle.isRetiring)
        ) {
          existingHandle.kill('SIGKILL')
        }
        setTimeout(handleDispatch, 100, req, retryCount + 1, afterUpgrade)
        return
      }
      const isDying =
        existingHandle.isKilling ||
        existingHandle.isRetiring ||
        existingHandle.record.outcome
      log(
        isDying
          ? `bg: dispatch ${req.short} dropped — retry budget exhausted (handle still settling)`
          : `bg: dup dispatch ${req.short} dropped (existing handle still live)`,
      )
      return
    }
    // Claim in flight (no handle yet) — retry like settling, never cold-parallel.
    if (claimingShorts.has(req.short)) {
      if (retryCount < 30) {
        setTimeout(handleDispatch, 100, req, retryCount + 1, afterUpgrade)
        return
      }
      log(
        `bg: dispatch ${req.short} dropped — spare claim still in flight after retries`,
      )
      return
    }

    // Official: low-mem with live handles → retire settled before spawn
    const free = freemem()
    const lowMemThreshold = getBgLowMemThresholdBytes()
    if (lowMemThreshold > 0 && free < lowMemThreshold && handles.size > 0) {
      const freeMb = Math.round(free / 1024 / 1024)
      log(
        `bg: low memory (${freeMb}MB free) — retiring settled workers before spawning ${req.short}`,
      )
      logEvent('tengu_bg_dispatch_low_mem', {
        free_mb: freeMb,
        handles: handles.size,
      })
      void readPinnedSessions()
        .catch(() => new Set<string>())
        .then(pinned => {
          for (const w of handles.values()) {
            void w.retireIfSettled(RETIRE_GRACE_MS, pinned).catch(() => {})
          }
        })
    }
    // Official: spare-source dispatch under low-mem is skipped entirely
    if (
      req.source === 'spare' &&
      lowMemThreshold > 0 &&
      free < lowMemThreshold
    ) {
      log(`bg: low memory — skipping spare dispatch ${req.short}`)
      return
    }

    seedJobState(req)

    // Spare claim path (local: await sendClaim before register handle).
    // densable D3q is fire-and-forget; we await so fail → cold spawn and
    // awaitWorkerAck never acks a dead spare pid (ghost left-arrow job).
    if (
      heldSpare &&
      !afterUpgrade &&
      req.launch.mode !== 'exec' &&
      heldSpare.cliVersion === MACRO.VERSION &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_bg_spare_enable', true) ===
        true
    ) {
      const spare = heldSpare
      heldSpare = null
      // Occupy short before await sendClaim so concurrent dispatch + oAp
      // see "in flight" rather than empty (product vs densable fire-and-forget).
      claimingShorts.add(req.short)
      void claimSpare(req, spare, spawnPty, opts?.getAuthSnapshot)
        .then(worker => {
          if (closed) {
            claimingShorts.delete(req.short)
            try {
              worker.kill('SIGTERM')
            } catch {
              /* ignore */
            }
            try {
              spare.dispose()
            } catch {
              /* ignore */
            }
            return
          }
          // Race: cold path or prior handle may own short already
          if (handles.has(req.short)) {
            claimingShorts.delete(req.short)
            log(
              `bg claimed-spare ${req.short} dropped — handle already present`,
            )
            // sendClaim already started the spare session — must kill worker,
            // not just spare.dispose() (host may already be the claimed job).
            try {
              worker.kill('SIGTERM')
            } catch {
              /* ignore */
            }
            try {
              spare.dispose()
            } catch {
              /* ignore */
            }
            return
          }
          // Register before clearing claiming so waiters never see a gap.
          handles.set(req.short, worker)
          claimingShorts.delete(req.short)
          wireWorkerLifecycle(
            handles,
            worker,
            onKeepAliveChange,
            pendingSettleWrites,
            log,
          )
          onKeepAliveChange()
          logEvent('tengu_bg_spare_claim', {
            age_ms: Date.now() - spare.startedAt,
          })
          log(`bg claimed-spare ${req.short} (${req.source})`)
          refillSpare()
        })
        .catch((err: unknown) => {
          // sendClaim failed (spare killed in claimSpare) → cold spawn.
          // Keep claimingShorts until coldSpawn registers handle (or we abort)
          // so awaitWorkerAck never sees an empty gap after deadline.
          const code =
            err && typeof err === 'object' && 'code' in err
              ? String((err as { code?: unknown }).code)
              : undefined
          const reason =
            code === 'ENOENT'
              ? 'enoent'
              : code === 'ECONNREFUSED'
                ? 'econnrefused'
                : err instanceof Error
                  ? 'error'
                  : 'unknown'
          logEvent('tengu_bg_spare_claim_fail', {})
          log(`bg-spare claim failed (${reason}): ${errorMessage(err)}`)
          try {
            spare.dispose()
          } catch {
            /* already killed */
          }
          if (closed || handles.has(req.short)) {
            claimingShorts.delete(req.short)
            return
          }
          coldSpawn(req, afterUpgrade)
          claimingShorts.delete(req.short)
        })
      return
    }

    coldSpawn(req, afterUpgrade)
  }

  /** Cold spawn (official zF.spawn) + wire lifecycle. */
  function coldSpawn(req: DispatchRequest, afterUpgrade?: boolean): void {
    if (closed || handles.has(req.short)) return
    const worker = BgWorker.spawn(
      req,
      spawnPty,
      opts?.getAuthSnapshot,
      afterUpgrade ? { afterUpgrade: true } : undefined,
    )
    handles.set(req.short, worker)
    wireWorkerLifecycle(
      handles,
      worker,
      onKeepAliveChange,
      pendingSettleWrites,
      log,
    )
    onKeepAliveChange()
    refillSpare()
    log(`bg spawned ${req.short} (${req.source})`)
  }

  // --- Kill all workers ---
  const killAll = (reap?: boolean, sig: string = 'SIGTERM'): number => {
    let count = 0
    for (const w of handles.values()) {
      if (!w.record.outcome) {
        w.kill(sig as 'SIGTERM' | 'SIGKILL')
        count++
      }
    }
    return count
  }

  // --- Ensure directories ---
  await ensureDaemonDirs()

  // Create pty/ rv/ spare/ directories (official non-windows)
  if (process.platform !== 'win32') {
    await mkdir(getRvDir(), { recursive: true, mode: 0o700 }).catch(() => {})
    await mkdir(getPtyDir(), { recursive: true, mode: 0o700 }).catch(() => {})
    await mkdir(getSpareDir(), { recursive: true, mode: 0o700 }).catch(() => {})
  }

  // --- Clean stale dirs ---
  cleanStaleDaemonDirs()

  // --- Start control socket (SG4) ---
  const controlSocket = await startControlSocket(
    async (req, socket, remainder, addLease) => {
      return handleControlRequest(
        handles,
        handleDispatch,
        opts?.onNudge ?? (async () => false),
        killAll,
        () => adoptionComplete,
        opts?.onYield ?? (() => false),
        addLease,
        req,
        socket,
        remainder,
        log,
        claimingShorts,
      )
    },
  )

  controlSocket.onLeaseChange.subscribe(onKeepAliveChange)
  // Official: first lease arms hasDispatched then J() refill
  controlSocket.onLeaseChange.subscribe(() => {
    if (controlSocket.leaseCount() > 0 && !hasDispatched) {
      hasDispatched = true
      refillSpare()
    }
  })

  // --- Adopt workers from roster ---
  const roster = await readRoster()
  let adopted = 0
  let dead = 0
  let respawned = 0

  await Promise.all(
    Object.entries(roster.workers).map(async ([short, entry]) => {
      let worker: BgWorker | null = null
      try {
        worker = await BgWorker.adopt(
          short,
          entry,
          spawnPty,
          opts?.getAuthSnapshot,
        )
      } catch (e) {
        console.error('[bg] adopt error:', e)
        dead++
        return
      }

      // If adopt failed but PTY socket is alive, try unverified
      if (
        !worker &&
        entry.procStart === undefined &&
        entry.ptySock &&
        (await isSocketAlive(entry.ptySock))
      ) {
        worker = BgWorker.unverified(short, entry)
      }

      if (worker) {
        handles.set(short, worker)
        wireWorkerLifecycle(
          handles,
          worker,
          onKeepAliveChange,
          pendingSettleWrites,
          log,
        )
        adopted++
      } else if (entry.pendingRespawn === 'upgrade') {
        respawned++
        handleDispatch(entry.dispatch, 0, true)
      } else {
        dead++
        // Update job state to failed
        const state = readBgJobState(short)
        if (state && !isTerminalState(state)) {
          const now = new Date().toISOString()
          writeBgJobState(short, {
            ...state,
            state: 'failed',
            detail: 'process gone while supervisor was down',
            tempo: 'idle',
            updatedAt: now,
            firstTerminalAt: state.firstTerminalAt ?? now,
          })
        }
        // Clean up sockets
        if (process.platform !== 'win32') {
          unlink(getRendezvousSockPath(short)).catch(() => {})
          if (entry.ptySock) {
            unlink(entry.ptySock).catch(() => {})
            unlink(getPtyErrPath(entry.ptySock)).catch(() => {})
          }
        }
      }
    }),
  )

  if (adopted + dead + respawned > 0) {
    log(`bg adopt: adopted=${adopted} respawned=${respawned} dead=${dead}`)
  }

  // Reap orphan PTY hosts not in roster (official GmO)
  if (!roster.parseFailed) {
    await reapOrphanPtyHosts(handles, log)
  }
  // Reap orphan spare socks (official f3q) — only when roster parse ok.
  // Adoption finishes before refillSpare is eligible (needs adoptionComplete),
  // so heldSpare is always null here; spare socks are not yet held.
  if (!roster.parseFailed) {
    await reapOrphanSpares(handles, log)
  }

  // Write initial roster
  await updateRoster(r => {
    r.workers = {}
    for (const [short, w] of handles) {
      r.workers[short] = w.rosterEntry()
    }
  }).catch(() => {})

  // --- Start dispatch watcher ---
  const watcher = await startDispatchWatcher(handleDispatch)

  adoptionComplete = true
  onKeepAliveChange()
  // Official: if (q.size > 0) w = !0; J()
  if (handles.size > 0) hasDispatched = true
  refillSpare()

  // --- Periodic tick: retire idle workers; pass refillSpare like official J ---
  let lastTickAt = Date.now()
  const tickTimer = setInterval(async () => {
    const now = Date.now()
    const drift = now - lastTickAt - TICK_INTERVAL_MS
    lastTickAt = now

    // If machine was suspended (drift > tick interval), shift grace clocks
    if (drift > TICK_INTERVAL_MS) {
      for (const w of handles.values()) {
        w.shiftGraceClocksForward(drift)
      }
      onKeepAliveChange()
      // Official still calls E() (J/refill) after clock shift
      refillSpare()
      return
    }

    const graceMs = RETIRE_GRACE_LONG_MS
    const pinned = await readPinnedSessions().catch(() => new Set<string>())

    // Respawn stale workers (version mismatch)
    for (const w of handles.values()) {
      if (pinned.has(w.dispatch.short)) {
        w.respawnIfIdleStale(pinned).catch(() => {})
      }
    }

    // Retire settled workers
    await Promise.all(
      [...handles.values()].map(w =>
        w.retireIfSettled(graceMs, pinned).catch(() => ({ retired: false })),
      ),
    )

    onKeepAliveChange()
    // Official: E() = J at end of tick
    refillSpare()
  }, TICK_INTERVAL_MS)
  tickTimer.unref()

  log('bg manager: ready')

  return {
    handles,
    dispatch: handleDispatch,
    leaseCount: () => controlSocket.leaseCount(),
    liveHandleCount: () => {
      let count = 0
      for (const w of handles.values()) {
        if (!w.record.outcome) count++
      }
      return count
    },
    killAll,
    async close() {
      closed = true
      clearInterval(tickTimer)
      watcher.close()
      // Official: dispose held spare on close
      if (heldSpare) {
        heldSpare.dispose()
        heldSpare = null
      }
      await controlSocket.close()
      for (const w of handles.values()) w.stop()
      await Promise.allSettled([...pendingSettleWrites])
      // Clean up instance dir if empty
      if (
        handles.size === 0 &&
        !roster.parseFailed &&
        process.platform !== 'win32'
      ) {
        await rm(getDaemonInstanceDir(), {
          recursive: true,
          force: true,
        }).catch(() => {})
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Control request handler — official JmO
// ---------------------------------------------------------------------------

/** Cursor home + erase display */
const CLEAR_SCREEN = '\x1B[H\x1B[2J'
/** Erase display + cursor home (Ink's forceRedraw order) */
const CLEAR_SCREEN_ALT = '\x1B[2J\x1B[H'
/** Erase line */
const ERASE_LINE = '\x1B[2K'

async function handleControlRequest(
  handles: Map<string, BgWorker>,
  dispatch: (
    req: DispatchRequest,
    retryCount?: number,
    afterUpgrade?: boolean,
  ) => void,
  onNudge: () => Promise<boolean>,
  killAll: (reap?: boolean, sig?: string) => number,
  isReady: () => boolean,
  onYield: () => boolean,
  addLease: (socket: Socket, info: LeaseInfo | null) => void,
  req: ControlRequest,
  socket: Socket,
  remainder: Buffer,
  log: (msg: string) => void,
  /** In-flight spare claims (no handle yet) — gates awaitWorkerAck ETIMEOUT. */
  claimingShorts?: Set<string>,
): Promise<ControlResponse | null | undefined> {
  const op = req.op

  // --- Pre-adoption ops (no proto check) ---
  if (op === 'ping') {
    return {
      ok: true,
      op: 'ping',
      version: MACRO.VERSION,
      proto: PROTO_VERSION,
    }
  }
  if (op === 'nudge') {
    return {
      ok: true,
      op: 'nudge',
      restarting: await onNudge(),
      version: MACRO.VERSION,
    }
  }
  if (op === 'yield') {
    return { ok: true, op: 'yield', yielding: onYield() }
  }
  if (op === 'lease') {
    addLease(socket, { label: req.client as string | undefined })
    socket.write(JSON.stringify({ ok: true, op: 'lease' }) + '\n')
    return null // Keep socket open
  }
  if (op === 'leases') {
    return { ok: true, op: 'leases' }
  }
  if (op === 'shutdown') {
    const reapWorkers = req.reapWorkers !== false
    const reaped = reapWorkers ? killAll(true) : 0
    return { ok: true, op: 'shutdown', reaped }
  }

  // --- Check adoption complete ---
  if (!isReady()) {
    return {
      ok: false,
      error: 'daemon starting (adoption in progress)',
      code: 'ESTARTING',
    }
  }

  // --- Proto version check ---
  const clientProto = req.proto
  if (
    typeof clientProto !== 'number' ||
    !Number.isInteger(clientProto) ||
    clientProto < MIN_PROTO_VERSION ||
    clientProto > PROTO_VERSION
  ) {
    return {
      ok: false,
      error: `proto mismatch (server=${PROTO_VERSION}, client=${clientProto}) — daemon and CLI versions differ; restart claude`,
      code: 'EPROTO',
      serverProto: PROTO_VERSION,
      serverVersion: MACRO.VERSION,
    }
  }

  // --- Dispatch ops ---
  switch (op) {
    case 'list':
      return {
        ok: true,
        op: 'list',
        jobs: Array.from(handles.values()).map(w =>
          w.isKilling || w.isRetiring ? { ...w.record, dying: true } : w.record,
        ),
      }

    case 'has': {
      const short = req.short as string
      const worker = handles.get(short)
      return {
        ok: true,
        op: 'has',
        alive: worker !== undefined && !worker.record.outcome,
        present: worker !== undefined,
      }
    }

    case 'dispatch': {
      const d = req.d as DispatchRequest
      if (!d || !d.short || !d.sessionId) {
        return { ok: false, error: 'missing dispatch fields' }
      }
      dispatch(d)
      // Wait for worker to acknowledge (await-ack pattern)
      return awaitWorkerAck(
        handles,
        socket,
        'dispatch',
        d.short,
        d.nonce,
        req.timeoutMs as number | undefined,
        claimingShorts,
      )
    }

    case 'await-ack':
      return awaitWorkerAck(
        handles,
        socket,
        'await-ack',
        req.short as string,
        req.nonce as string | undefined,
        req.timeoutMs as number | undefined,
        claimingShorts,
      )

    case 'reply': {
      const short = req.short as string
      const worker = handles.get(short)
      if (
        !worker ||
        worker.isRetiring ||
        worker.isKilling ||
        worker.record.outcome
      ) {
        return {
          ok: false,
          error: 'job not found — it may have already exited',
          code: 'ENOJOB',
        }
      }
      if (!(await worker.reply(req.text as string))) {
        return {
          ok: false,
          error:
            "job isn't accepting replies — it may be in a non-interactive state",
          code: 'ENOREPLY',
        }
      }
      return { ok: true, op: 'reply' }
    }

    case 'kill': {
      const short = req.short as string
      const worker = handles.get(short)
      if (!worker) {
        return {
          ok: false,
          error: 'job not found — it may have already exited',
          code: 'ENOJOB',
        }
      }
      if (worker.dispatch.launch.mode === 'exec' && worker.record.outcome) {
        handles.delete(short)
        return { ok: true, op: 'kill' }
      }
      worker.kill((req.signal as 'SIGTERM' | 'SIGKILL') ?? 'SIGTERM')
      return { ok: true, op: 'kill' }
    }

    case 'respawn-stale': {
      const short = req.short as string
      const worker = handles.get(short)
      if (!worker) {
        return {
          ok: false,
          error: 'job not found — it may have already exited',
          code: 'ENOJOB',
        }
      }
      const result = await worker.respawnIfIdleStale()
      return { ok: true, op: 'respawn-stale', ...result }
    }

    case 'resize': {
      const short = req.short as string
      const worker = handles.get(short)
      if (!worker) {
        return {
          ok: false,
          error: 'job not found — it may have already exited',
          code: 'ENOJOB',
        }
      }
      if (req.attachId) {
        const attacher = worker.attachers.get(req.attachId as string)
        if (!attacher) return { ok: true, op: 'resize' }
        attacher.cols = req.cols as number
        attacher.rows = req.rows as number
        if (attacher.repaint) attacher.repaint()
        return { ok: true, op: 'resize' }
      }
      worker.resize(req.cols as number, req.rows as number)
      return { ok: true, op: 'resize' }
    }

    case 'stop': {
      const short = req.short as string
      const worker = handles.get(short)
      if (!worker) return { ok: false, error: 'job not found', code: 'ENOJOB' }
      worker.kill('SIGTERM')
      return { ok: true, op: 'stop' }
    }

    case 'attach':
      return handleAttachOp(
        handles,
        dispatch,
        req,
        socket,
        remainder,
        addLease,
        log,
      )

    case 'subscribe':
      return handleSubscribeOp(handles, req, socket, addLease)

    case 'ensure-spare':
      return { ok: true, op: 'ensure-spare' }

    case 'permission-response':
      return { ok: true, op: 'permission-response' }

    default:
      return { ok: false, error: `unknown op: ${op}`, code: 'EUNKNOWN' }
  }
}

// ---------------------------------------------------------------------------
// Attach op handler — official case "attach" in JmO
// ---------------------------------------------------------------------------

function handleAttachOp(
  handles: Map<string, BgWorker>,
  dispatch: (
    req: DispatchRequest,
    retryCount?: number,
    afterUpgrade?: boolean,
  ) => void,
  req: ControlRequest,
  socket: Socket,
  remainder: Buffer,
  addLease: (socket: Socket, info: LeaseInfo | null) => void,
  log: (msg: string) => void,
): ControlResponse | null {
  const short = req.short as string
  const worker = handles.get(short)

  if (
    !worker ||
    worker.isKilling ||
    (worker.record.outcome && worker.dispatch.launch.mode !== 'exec')
  ) {
    return {
      ok: false,
      error: 'job not found — it may have already exited',
      code: 'ENOJOB',
    }
  }
  if (worker.isUnverified) {
    return {
      ok: false,
      error:
        'worker is live but supervisor could not verify its identity — try restarting the supervisor to re-adopt',
      code: 'EUNVERIFIED',
    }
  }
  if (worker.isRetiring) {
    return {
      ok: false,
      error: 'job is retiring; retry attach',
      code: 'ERESPAWNING',
    }
  }

  // Send ack with initial state
  addLease(socket, null)
  socket.write(
    JSON.stringify({
      ok: true,
      op: 'attach',
      decModes: worker.decModeSnapshot(),
      via: worker.via,
      tempo: worker.record.tempo,
      state: worker.record.state,
    }) + '\n',
  )

  const cols = (req.cols as number) || 120
  const rows = (req.rows as number) || 30
  const attachId = (req.attachId as string) ?? socket
  const holdingFrame = req.holdingFrame as boolean | undefined

  // Buffering: collect output until we see clear-screen or timeout
  let outputBuffer: string[] | null = []
  let bufferBytes = 0
  let lastChunk = ''
  let cancelRepaint = () => {}
  let stallTimer: ReturnType<typeof setInterval> | undefined
  let stallCount = 0
  let gotOutput = false

  const flushBuffer = (send: boolean) => {
    if (outputBuffer === null) return
    const buf = outputBuffer
    outputBuffer = null
    clearTimeout(flushTimeout)
    if (send && !socket.destroyed) {
      for (const chunk of buf) socket.write(chunk)
    }
  }

  const flushTimeout = setTimeout(() => {
    const isEmpty = outputBuffer !== null && bufferBytes === 0
    const shouldHold = isEmpty && holdingFrame === true

    if (!shouldHold) flushBuffer(true)

    if (isEmpty && !socket.destroyed) {
      // Session hasn't produced output yet — show waiting message
      if (!shouldHold) {
        const state = worker.record.state
        const msg =
          state === 'starting' ||
          state === 'resuming' ||
          state === 'adopted' ||
          state === 'crashed'
            ? 'Session is starting — it will appear once ready. Ctrl+Z to detach'
            : 'Waiting for session to redraw… Ctrl+Z to detach'
        socket.write(`${CLEAR_SCREEN}${ERASE_LINE}\n  \x1B[2m${msg}\x1B[0m\n`)
      }

      // Periodic repaint attempts
      stallTimer = setInterval(() => {
        stallCount++
        const attacher = worker.attachers.get(attachId)
        cancelRepaint()
        cancelRepaint = worker.resizeForRepaint(
          attacher?.cols ?? cols,
          attacher?.rows ?? rows,
        )
      }, 1000)
      stallTimer.unref()
    }
  }, 500)

  const clearStall = () => {
    if (stallTimer) {
      clearInterval(stallTimer)
      stallTimer = undefined
    }
  }

  // Stream output to attacher
  const unsubStream = worker.onStream.subscribe((data: string) => {
    if (socket.destroyed) return
    gotOutput = true

    if (outputBuffer !== null) {
      const combined = lastChunk + data
      if (
        combined.includes(CLEAR_SCREEN) ||
        combined.includes(CLEAR_SCREEN_ALT) ||
        combined.includes(CLEAR_SCREEN.slice(0, 3) + ERASE_LINE)
      ) {
        clearStall()
        cancelRepaint()
        flushBuffer(false)
        if (socket.writableLength <= MAX_REQUEST_SIZE) socket.write(data)
        else socket.destroy()
        return
      }
      outputBuffer.push(data)
      bufferBytes += data.length
      lastChunk = combined.slice(-6)
      if (bufferBytes > 65536) flushBuffer(true)
      return
    }

    clearStall()
    if (socket.writableLength > MAX_REQUEST_SIZE) {
      socket.destroy()
      return
    }
    socket.write(data)
  })

  const unsubRepaintDone = worker.onRepaintDone.subscribe(() => {
    cancelRepaint()
    flushBuffer(true)
  })

  // Kick existing attacher with same ID (Windows)
  if (process.platform === 'win32') {
    for (const a of worker.attachers.values()) a.kick()
  }

  // Register this attacher
  worker.attachers.set(attachId, {
    cols,
    rows,
    caps: req.caps as Record<string, unknown> | undefined,
    kick: () => {
      if (stallTimer) clearInterval(stallTimer)
      cancelRepaint()
      unsubStream()
      unsubRepaintDone()
      socket.removeAllListeners('data')
      if (!socket.destroyed) {
        socket.write(
          encodeDetachMsg('EKICKED: Session opened in another window'),
        )
        socket.end()
      }
      worker.attachers.delete(attachId)
    },
  })

  worker.noteActivity()
  worker.seedFocus(true)
  worker.sendAttacherCaps((req.caps as Record<string, unknown>) ?? null)

  // Exec mode: replay ring immediately
  let onSettleHandler: (() => void) | undefined
  if (worker.dispatch.launch.mode === 'exec') {
    socket.write(CLEAR_SCREEN + ERASE_LINE)
    for (const chunk of worker.ringSnapshot()) socket.write(chunk)
    flushBuffer(false)

    onSettleHandler = () => {
      const attacher = worker.attachers.get(attachId)
      if (socket.destroyed || !attacher) return
      const label =
        worker.record.outcome === 'done'
          ? 'done'
          : worker.record.outcome === 'killed'
            ? 'stopped'
            : 'failed'
      const footer = `\r\n\x1B[2m— ${label} · Ctrl+Z to return —\x1B[0m\r\n`
      socket.write(footer)
      attacher.repaint = () => {
        if (socket.destroyed) return
        socket.write(CLEAR_SCREEN + ERASE_LINE)
        for (const chunk of worker.ringSnapshot()) socket.write(chunk)
        socket.write(footer)
      }
    }

    if (worker.record.outcome) {
      onSettleHandler()
      socket.once('close', () => {
        clearTimeout(flushTimeout)
        unsubStream()
        unsubRepaintDone()
        worker.attachers.delete(attachId)
      })
      return null
    }
  }

  // Trigger initial repaint
  cancelRepaint = worker.resizeForRepaint(cols, rows)

  // Subscribe to settle
  const unsubSettle = worker.onSettle.subscribe(() => {
    if (onSettleHandler && worker.record.outcome !== 'killed') {
      onSettleHandler()
      return
    }
    socket.end()
  })

  // Forward input from attacher to worker
  const decoder = new StringDecoder('utf8')
  if (remainder.length) worker.write(decoder.write(remainder))
  socket.on('data', (chunk: Buffer) => worker.write(decoder.write(chunk)))

  // Handle attacher disconnect
  socket.once('close', () => {
    if (stallTimer) clearInterval(stallTimer)
    cancelRepaint()
    flushBuffer(false)
    unsubStream()
    unsubSettle()
    unsubRepaintDone()
    if (!worker.attachers.delete(attachId)) return
    const trailing = decoder.end()
    if (trailing) worker.write(trailing)

    if (worker.attachers.size > 0) {
      const last = [...worker.attachers.values()].at(-1)!
      worker.resizeForRepaint(last.cols, last.rows)
      worker.sendAttacherCaps(last.caps ?? null)
    } else {
      worker.seedFocus(false)
      worker.sendAttacherCaps(null)
    }
  })

  return null // Socket ownership transferred
}

// ---------------------------------------------------------------------------
// Subscribe op handler — official case "subscribe" in JmO
// ---------------------------------------------------------------------------

function handleSubscribeOp(
  handles: Map<string, BgWorker>,
  req: ControlRequest,
  socket: Socket,
  addLease: (socket: Socket, info: LeaseInfo | null) => void,
): ControlResponse | null {
  const short = req.short as string
  const worker = handles.get(short)
  if (!worker) {
    return {
      ok: false,
      error: 'job not found — it may have already exited',
      code: 'ENOJOB',
    }
  }

  addLease(socket, null)

  // Send snapshot
  writeJsonLine(socket, {
    type: 'snapshot',
    record: worker.record,
    streamTail: worker.tail((req.tail as number) ?? 200),
  })

  // If already settled, send immediately and close
  if (worker.record.outcome) {
    writeJsonLine(socket, { type: 'settled', outcome: worker.record.outcome })
    socket.end()
    return null
  }

  // Stream updates
  const unsubs = [
    worker.onStream.subscribe((line: string) => {
      writeJsonLine(socket, { type: 'stream', line })
    }),
    worker.onState.subscribe((patch: Record<string, unknown>) => {
      writeJsonLine(socket, { type: 'state', patch })
    }),
    worker.onSettle.subscribe((outcome: string) => {
      writeJsonLine(socket, { type: 'settled', outcome })
      socket.end()
    }),
  ]

  socket.on('close', () => {
    for (const u of unsubs) u()
  })

  return null // Socket ownership transferred
}

// ---------------------------------------------------------------------------
// Await-ack helper — official yG4
// Waits for a worker to appear and emit its first state update.
// ---------------------------------------------------------------------------

/**
 * Default ack budget must cover local claimSpare await sendClaim (~5s retries)
 * + cold spawn / wire. densable oAp sees a handle immediately (fire-and-forget
 * D3q); our product await needs headroom past sendClaim alone.
 */
const DEFAULT_WORKER_ACK_TIMEOUT_MS = 12_000

function awaitWorkerAck(
  handles: Map<string, BgWorker>,
  socket: Socket,
  op: string,
  short: string,
  nonce: string | undefined,
  timeoutMs: number | undefined,
  /** Local product: shorts with claimSpare in flight (no handle yet). */
  claimingShorts?: Set<string>,
): ControlResponse | null {
  // densable oAp polls for handle. Local used to return ok:true immediately
  // when worker missing — that ghost-acked claimSpare before sendClaim, so
  // left-arrow disowned while spare never started. Poll until handle or timeout.
  // While claimingShorts has short, treat as "in flight" (do not ETIMEOUT early
  // solely because handles is empty mid-sendClaim).
  const timeout = timeoutMs ?? DEFAULT_WORKER_ACK_TIMEOUT_MS
  const deadline = Date.now() + timeout
  let done = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let unsub: (() => void) | undefined
  let unsubSettle: (() => void) | undefined

  const finish = (resp: ControlResponse) => {
    if (done) return
    done = true
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    unsub?.()
    unsubSettle?.()
    respond(socket, resp)
  }

  const checkNonceConflict = (worker: BgWorker): ControlResponse | null => {
    const workerNonce = (worker.record as { nonce?: string }).nonce
    if (
      nonce !== undefined &&
      workerNonce !== undefined &&
      workerNonce !== nonce
    ) {
      const live =
        !worker.record.outcome && !worker.isKilling && !worker.isRetiring
      if (live) {
        return {
          ok: false,
          op,
          short,
          code: 'EALIVE',
          alive: true,
          error: `Session ${short} is already running — \`claude attach ${short}\` to join it`,
        }
      }
      return {
        ok: false,
        op,
        short,
        code: 'ESTALE',
        error:
          'a previous dispatch with this id is still being cleaned up — retry in a moment',
      }
    }
    return null
  }

  const attachToWorker = (worker: BgWorker): void => {
    const conflict = checkNonceConflict(worker)
    if (conflict) {
      finish(conflict)
      return
    }

    if (worker.record.pid > 0) {
      finish({ ok: true, op, short, pid: worker.record.pid })
      return
    }

    unsub = worker.onState.subscribe((patch: Record<string, unknown>) => {
      if (patch.pid) {
        finish({ ok: true, op, short, pid: patch.pid as number })
      }
    })

    unsubSettle = worker.onSettle.subscribe(() => {
      finish({
        ok: true,
        op,
        short,
        settled: worker.record.outcome,
      })
    })

    if (worker.record.pid > 0) {
      finish({ ok: true, op, short, pid: worker.record.pid })
    }
  }

  const poll = (): void => {
    if (done || socket.destroyed) return
    const worker = handles.get(short)
    if (worker) {
      attachToWorker(worker)
      return
    }
    const stillClaiming = claimingShorts?.has(short) === true
    if (Date.now() >= deadline && !stillClaiming) {
      finish({
        ok: false,
        op,
        short,
        timeout: true,
        code: 'ETIMEOUT',
        error: 'worker ack timeout',
      })
      return
    }
    // Mid-claim past nominal deadline: keep polling a bit, hard-cap +5s so a
    // stuck claimingShort never hangs the control socket forever.
    if (Date.now() >= deadline + 5_000) {
      finish({
        ok: false,
        op,
        short,
        timeout: true,
        code: 'ETIMEOUT',
        error: 'worker ack timeout (claim still in flight)',
      })
      return
    }
    pollTimer = setTimeout(poll, 25)
    pollTimer.unref?.()
  }

  socket.once('close', () => {
    if (done) return
    done = true
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    unsub?.()
    unsubSettle?.()
  })

  const existing = handles.get(short)
  if (existing) {
    attachToWorker(existing)
  } else {
    pollTimer = setTimeout(poll, 25)
    pollTimer.unref?.()
  }

  return null // Always async respond via finish()
}

// ---------------------------------------------------------------------------
// Max request size constant (shared with attach)
// ---------------------------------------------------------------------------

const MAX_REQUEST_SIZE = 1_048_576

// ---------------------------------------------------------------------------
// Public dispatch helper (for FleetView / CLI)
// ---------------------------------------------------------------------------

/**
 * densable BF_ / yNo failure shape — `alive:true` when short is already
 * running (short-alive / EALIVE). Left-arrow queues only when `!alive`.
 */
export type SubmitDispatchError = Error & {
  alive?: boolean
  reason?: string
  short?: string
  code?: string
}

export function isSubmitDispatchAliveError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'alive' in err &&
    (err as { alive?: unknown }).alive === true
  )
}

function throwSubmitDispatchError(
  message: string,
  opts?: {
    alive?: boolean
    reason?: string
    short?: string
    code?: string
  },
): never {
  const err = new Error(message) as SubmitDispatchError
  err.name = 'SubmitDispatchError'
  if (opts?.alive !== undefined) err.alive = opts.alive
  if (opts?.reason !== undefined) err.reason = opts.reason
  if (opts?.short !== undefined) err.short = opts.short
  if (opts?.code !== undefined) err.code = opts.code
  throw err
}

/**
 * Create and submit a dispatch request.
 * Tries control socket first, falls back to file-based dispatch.
 * On short-alive (EALIVE) throws with `alive:true` — no file fallback.
 */
export async function submitDispatch(opts: {
  intent: string
  name?: string
  agent?: string
  /**
   * densable routine field (separate from agent/template) — Fleet @routine.
   */
  routine?: string
  /**
   * densable n.exec — bash `!cmd` body. When set, launch.mode=exec via $F_.
   * Mutually exclusive with resumeSessionId for launch shape.
   */
  exec?: string
  cwd?: string
  extraArgs?: string[]
  source?: string
  sessionId?: string
  /** Resume an existing transcript in a newly forked background session. */
  resumeSessionId?: string
  forkSession?: boolean
  /**
   * Official Sj4 providedSessionId — use this as the new forked job id so
   * A8q-written state (short = id.slice(0,8)) matches the spawn.
   */
  providedSessionId?: string
  /** Official isolation / worktree handoff for left-arrow adopt. */
  isolation?: 'worktree' | 'none'
  worktree?: { path: string }
  /** Bridge reattach env (CLAUDE_BRIDGE_REATTACH_*) — official rit(). */
  env?: Record<string, string>
  reattachEnv?: Record<string, string>
  /**
   * Official aAf → BF_ env: CLAUDE_BG_SESSION_PERMISSION_RULES JSON +
   * CLAUDE_BG_MEMORY_TOGGLED_OFF=1 for bg worker inherit.
   */
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  memoryToggledOff?: boolean
}): Promise<{ short: string; sessionId: string }> {
  const { randomUUID } = await import('crypto')
  // New job session id (fork target). Resume source is resumeSessionId.
  const sessionId = opts.providedSessionId ?? opts.sessionId ?? randomUUID()
  const short = sessionId.slice(0, 8)
  // Prefer explicit name; empty intent should not become "new session" when
  // A8q already seeded (left-arrow empty). deriveSessionName('') → "new session".
  const derivedName =
    opts.name ??
    (opts.exec?.trim()
      ? opts.exec.trim().slice(0, 40)
      : opts.intent.trim()
        ? deriveSessionName(opts.intent)
        : undefined)

  // Official BF_: merge permission/memory into worker env.
  const inheritEnv: Record<string, string> = {}
  if (opts.sessionPermissionRules) {
    inheritEnv.CLAUDE_BG_SESSION_PERMISSION_RULES = JSON.stringify(
      opts.sessionPermissionRules,
    )
  }
  if (opts.memoryToggledOff) {
    inheritEnv.CLAUDE_BG_MEMORY_TOGGLED_OFF = '1'
  }

  const env = {
    ...inheritEnv,
    ...(opts.env ?? {}),
    ...(opts.reattachEnv ?? {}),
  }

  // densable launch: n?.exec ? {mode:"exec", ...$F_(n.exec)} : resume | prompt
  const { shellExecSpec } = await import('./bgWorker.js')
  let launch: DispatchRequest['launch']
  if (opts.exec !== undefined && opts.exec.trim()) {
    const spec = shellExecSpec(opts.exec.trim())
    launch = {
      mode: 'exec',
      cmd: spec.cmd,
      args: spec.args,
    }
  } else if (opts.resumeSessionId) {
    launch = {
      mode: 'resume',
      sessionId: opts.resumeSessionId,
      fork: opts.forkSession !== false,
      flagArgs: [
        ...(derivedName ? ['-n', derivedName] : []),
        ...(opts.agent ? ['--agent', opts.agent] : []),
        ...(opts.extraArgs || []),
      ],
    }
  } else {
    launch = {
      mode: 'prompt',
      sessionId,
      args: [
        '--session-id',
        sessionId,
        ...(derivedName ? ['-n', derivedName] : []),
        ...(opts.agent ? ['--agent', opts.agent] : []),
        ...(opts.extraArgs || []),
      ],
    }
  }

  // densable uea: nonce for await-ack / short-alive (EALIVE) discrimination.
  const nonce = randomUUID().slice(0, 8)

  const dispatch: DispatchRequest = {
    short,
    sessionId,
    nonce,
    // densable exec jobs still carry intent for Fleet label (often the cmd)
    intent: opts.exec?.trim() ? opts.exec.trim() : opts.intent,
    name: derivedName,
    agent: opts.agent,
    routine: opts.routine,
    cwd: opts.cwd || process.cwd(),
    respawnFlags: opts.extraArgs || [],
    source: opts.source || 'fleet',
    createdAt: Date.now(),
    seed: {
      intent: opts.exec?.trim() ? opts.exec.trim() : opts.intent,
      name: opts.name,
    },
    isolation: opts.isolation,
    worktree: opts.worktree,
    env: Object.keys(env).length > 0 ? env : undefined,
    reattachEnv:
      Object.keys(opts.reattachEnv ?? {}).length > 0
        ? opts.reattachEnv
        : undefined,
    launch,
  }

  // Try control socket
  const { sendControlRequest } = await import('./controlSocketClient.js')
  // Align client socket timeout + server awaitWorkerAck (req.timeoutMs).
  // Must cover claimSpare await sendClaim (~5s) + register; densable D3q
  // fire-and-forget needs less headroom. Keep client == server to avoid
  // early client cut → file-fallback double-dispatch.
  const DISPATCH_ACK_TIMEOUT_MS = DEFAULT_WORKER_ACK_TIMEOUT_MS
  const resp = await sendControlRequest(
    {
      op: 'dispatch',
      proto: PROTO_VERSION,
      d: dispatch,
      timeoutMs: DISPATCH_ACK_TIMEOUT_MS,
    },
    { timeoutMs: DISPATCH_ACK_TIMEOUT_MS },
  )

  if (resp.ok) {
    // densable yNo / await-ack: settled crashed|failed must NOT look like success
    // — hNo only disowns on n.ok; treating crashed as ok leaves shells orphaned
    // and skip abandon.
    const settled = resp.settled
    if (
      typeof settled === 'string' &&
      (settled === 'crashed' || settled === 'failed' || settled === 'killed')
    ) {
      throwSubmitDispatchError(
        `Background dispatch settled immediately (${settled})${
          typeof resp.error === 'string' && resp.error ? `: ${resp.error}` : ''
        }`,
        { short, reason: 'settled' },
      )
    }
    return { short, sessionId }
  }

  // densable BF_: short-alive → {ok:false, alive:true}; no file fallback.
  // code may be EALIVE / ealive (Pwp.EALIVE); reason short-alive / short_alive.
  const code =
    typeof resp.code === 'string' ? resp.code.toUpperCase() : undefined
  const reasonRaw =
    typeof resp.reason === 'string'
      ? resp.reason
      : typeof resp.error === 'string'
        ? resp.error
        : undefined
  const reasonNorm = reasonRaw?.toLowerCase().replace(/_/g, '-') ?? ''
  if (
    code === 'EALIVE' ||
    reasonNorm === 'short-alive' ||
    resp.alive === true
  ) {
    throwSubmitDispatchError(
      typeof resp.error === 'string' && resp.error
        ? resp.error
        : `Session ${short} is already running — \`claude attach ${short}\` to join it`,
      {
        alive: true,
        reason: 'short_alive',
        short,
        code: 'EALIVE',
      },
    )
  }

  // ESTALE: previous handle still settling — do not double-dispatch via file.
  if (code === 'ESTALE' || reasonNorm === 'stale-short') {
    throwSubmitDispatchError(
      typeof resp.error === 'string' && resp.error
        ? resp.error
        : 'Previous session is still shutting down — try again in a moment',
      {
        alive: false,
        reason: 'stale_short',
        short,
        code: 'ESTALE',
      },
    )
  }

  // Worker-ack timeout: do NOT file-fallback (would double-dispatch after a
  // slow-but-alive spawn). Only use file fallback on genuine disconnect.
  if (resp.timeout === true || code === 'ETIMEOUT') {
    throwSubmitDispatchError(
      typeof resp.error === 'string' && resp.error
        ? resp.error
        : 'Background dispatch worker ack timeout',
      { reason: 'ack_timeout', short, code: 'ETIMEOUT' },
    )
  }

  // Fallback: write dispatch file (ENOCONN / daemon offline)
  const dispatchDir = getDispatchDir()
  await mkdir(dispatchDir, { recursive: true }).catch(() => {})
  const { writeFile } = await import('fs/promises')
  await writeFile(join(dispatchDir, `${short}.json`), JSON.stringify(dispatch))

  return { short, sessionId }
}

function deriveSessionName(intent: string): string {
  const words = intent
    .trim()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'new session'
  const name = words.slice(0, 4).join(' ')
  return name.length > 30 ? name.slice(0, 29) + '…' : name
}
