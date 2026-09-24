/**
 * densable 2.1.251 #30 `mr` — self-hosted runner session abort supervisor.
 *
 * Gold (`qi` / `mr` @188594529): terminate() logs abort then `ug(pid)`
 * (`taskkill /T /F` via `P`/`f`). stop() calls reapDescendants.
 *
 * SEA has `Fr`/`ir`/`Ir` BODY, but `treeSnapshot` is only declared and
 * cleared — never assigned — so the identity reap is dead code in gold
 * too. Local keeps the same no-op snapshot clear (not inventing a
 * snapshot builder).
 */
import type { ChildProcess } from 'node:child_process'
import { killSessionProcessTree } from './killSessionProcessTree.js'

/** densable `Nn` — default session-stop grace / SIGKILL timeout */
export const SIGKILL_TIMEOUT_DEFAULT_MS = 5_000
/** densable `Zi` — default max-lifetime in-flight grace */
export const DEFAULT_MAX_LIFETIME_GRACE_MS = 900_000
/** densable `Vi` — reap wait cap after stop */
export const REAP_WAIT_CAP_MS = 1_500

export type SessionChildSupervisorOpts = {
  child: ChildProcess
  sessionId: string
  maxLifetimeMs: number
  maxLifetimeGraceMs: number
  sigkillTimeoutMs: number
  sigkillGraceMs: number
  onDebug: (msg: string) => void
  onStatus: (msg: string) => void
  /** Test seam — production uses `ug` / killSessionProcessTree. */
  killProcessTree?: typeof killSessionProcessTree
}

export class SessionChildSupervisor {
  static SIGKILL_TIMEOUT_DEFAULT_MS = SIGKILL_TIMEOUT_DEFAULT_MS

  maxLifetimeTimer: ReturnType<typeof setTimeout> | undefined
  maxLifetimeGraceTimer: ReturnType<typeof setTimeout> | undefined
  sigkillTimer: ReturnType<typeof setTimeout> | undefined
  sigkillGraceTimer: ReturnType<typeof setTimeout> | undefined
  stopped = false
  turnInFlight = false
  maxLifetimeDeferred = false
  terminating = false
  /** Gold assigns a process-tree snapshot elsewhere; never peeled. */
  treeSnapshot: Promise<unknown> | undefined
  reap: Promise<void> = Promise.resolve()
  terminatedAt = 0
  child: ChildProcess
  sessionId: string
  maxLifetimeGraceMs: number
  sigkillTimeoutMs: number
  sigkillGraceMs: number
  onDebug: (msg: string) => void
  onStatus: (msg: string) => void
  killProcessTree: typeof killSessionProcessTree

  constructor(opts: SessionChildSupervisorOpts) {
    this.child = opts.child
    this.sessionId = opts.sessionId
    this.maxLifetimeGraceMs = opts.maxLifetimeGraceMs
    this.sigkillTimeoutMs = opts.sigkillTimeoutMs
    this.sigkillGraceMs = opts.sigkillGraceMs
    this.onDebug = opts.onDebug
    this.onStatus = opts.onStatus
    this.killProcessTree = opts.killProcessTree ?? killSessionProcessTree
    void this.child.pid
    if (opts.maxLifetimeMs > 0) {
      const maxLifetimeMs = opts.maxLifetimeMs
      this.maxLifetimeTimer = setTimeout(() => {
        if (this.stopped || this.terminating) return
        if (!this.turnInFlight) {
          this.onDebug(
            `[runner:stuck] Session ${this.sessionId} exceeded max lifetime of ${maxLifetimeMs}ms — aborting child pid=${this.child.pid}`,
          )
          this.terminate()
          return
        }
        this.maxLifetimeDeferred = true
        this.onStatus(
          `[runner:session] ${this.sessionId} max session age reached (${maxLifetimeMs}ms) — waiting up to ${this.maxLifetimeGraceMs}ms for in-flight turn to finish before terminating`,
        )
        this.maxLifetimeGraceTimer = setTimeout(() => {
          if (this.stopped || this.terminating) return
          this.onDebug(
            `[runner:stuck] Session ${this.sessionId} still mid-turn ${this.maxLifetimeGraceMs}ms after max lifetime of ${maxLifetimeMs}ms — aborting child pid=${this.child.pid}`,
          )
          this.terminate()
        }, this.maxLifetimeGraceMs)
      }, maxLifetimeMs)
    }
  }

  noteTurnStart(): void {
    this.turnInFlight = true
  }

  noteTurnEnd(): void {
    this.turnInFlight = false
    if (this.maxLifetimeDeferred && !this.stopped && !this.terminating) {
      this.onStatus(
        `[runner:session] ${this.sessionId} in-flight turn finished after max session age — aborting child pid=${this.child.pid}`,
      )
      this.terminate()
    }
  }

  /** densable `signalGroup` — no caller in gold spawn; keep 1:1. */
  signalGroup(signal: NodeJS.Signals | number): void {
    const pid = this.child.pid
    if (pid === undefined) {
      this.child.kill(signal)
      return
    }
    if (pid <= 1) return
    try {
      process.kill(-pid, signal)
    } catch {
      this.child.kill(signal)
    }
  }

  /**
   * densable `reapDescendants`. Gold body awaits `Fr`/`ir` identity.
   * Those callees are ABSENT — snapshot is never assigned, so this is a
   * no-op beyond clearing an unset snapshot.
   */
  reapDescendants(_waitMs: number): void {
    const snapshot = this.treeSnapshot
    if (snapshot === undefined) return
    this.treeSnapshot = undefined
  }

  get descendantsReaped(): Promise<void> {
    return this.reap
  }

  terminate(): void {
    if (this.terminating) return
    if (this.stopped) return
    this.terminating = true
    this.terminatedAt = Date.now()
    this.onDebug(
      `[runner:session] Abort signal received, killing process tree at pid=${this.child.pid}`,
    )
    if (this.child.pid) {
      void this.killProcessTree(this.child.pid, this.onDebug)
    } else {
      this.child.kill()
    }
  }

  stop(): void {
    this.stopped = true
    this.reapDescendants(
      Math.max(
        1,
        Math.min(
          REAP_WAIT_CAP_MS,
          this.terminatedAt + this.sigkillTimeoutMs - Date.now(),
        ),
      ),
    )
    if (this.sigkillTimer) clearTimeout(this.sigkillTimer)
    if (this.sigkillGraceTimer) clearTimeout(this.sigkillGraceTimer)
    if (this.maxLifetimeTimer) clearTimeout(this.maxLifetimeTimer)
    if (this.maxLifetimeGraceTimer) clearTimeout(this.maxLifetimeGraceTimer)
  }

  get terminationRequested(): boolean {
    return this.terminating
  }
}
